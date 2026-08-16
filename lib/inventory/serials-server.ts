import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  inventory,
  inventorySerials,
  items,
  locations,
} from "@/drizzle/schema";
import { normaliseSerial, serialKey } from "./serial-rules";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = typeof db | Tx;

export type SerialStatus = "IN_STOCK" | "PICKED" | "SHIPPED" | "CONSUMED";

/**
 * Does this item need serials captured? Read from the item rather than passed
 * in, so a caller can't accidentally skip capture by forgetting to check.
 */
export async function itemTracking(tx: DbOrTx, itemId: number) {
  const [row] = await tx
    .select({
      isBatchTracked: items.isBatchTracked,
      isLotTracked: items.isLotTracked,
      hasExpiry: items.hasExpiry,
      isSerialTracked: items.isSerialTracked,
      organizationId: items.organizationId,
    })
    .from(items)
    .where(eq(items.itemId, itemId))
    .limit(1);
  return row ?? null;
}

export type RecordSerialsInput = {
  organizationId: number;
  itemId: number;
  serials: string[];
  locationId: number;
  batchNumber: string | null;
  lotNumber: string | null;
  expiryDate: string | null;
  inventoryStatusId: number;
  poLineId: number | null;
  employeeId: number;
};

export type RecordSerialsResult =
  | { ok: true; recorded: number }
  | { ok: false; reason: "duplicate"; serials: string[] };

/**
 * Book serials in at a location.
 *
 * Duplicates are detected by asking the database rather than by checking
 * first and inserting after: two receivers scanning the same unit at the same
 * moment would both pass a prior check. The unique index is the authority, and
 * a conflict is reported as a normal outcome rather than thrown, because
 * "this unit is already booked in" is a thing a receiver needs told, not a
 * crash.
 */
export async function recordReceivedSerials(
  tx: Tx,
  input: RecordSerialsInput,
): Promise<RecordSerialsResult> {
  const cleaned = input.serials.map(normaliseSerial).filter(Boolean);
  if (cleaned.length === 0) return { ok: true, recorded: 0 };

  const existing = await tx
    .select({ serialNumber: inventorySerials.serialNumber })
    .from(inventorySerials)
    .where(
      and(
        eq(inventorySerials.organizationId, input.organizationId),
        eq(inventorySerials.itemId, input.itemId),
        inArray(
          sql`upper(${inventorySerials.serialNumber})`,
          cleaned.map(serialKey),
        ),
      ),
    );
  if (existing.length > 0) {
    return { ok: false, reason: "duplicate", serials: existing.map((e) => e.serialNumber) };
  }

  await tx.insert(inventorySerials).values(
    cleaned.map((serialNumber) => ({
      organizationId: input.organizationId,
      itemId: input.itemId,
      serialNumber,
      status: "IN_STOCK" as const,
      locationId: input.locationId,
      batchNumber: input.batchNumber,
      lotNumber: input.lotNumber,
      expiryDate: input.expiryDate,
      inventoryStatusId: input.inventoryStatusId,
      poLineId: input.poLineId,
      receivedByEmployeeId: input.employeeId,
    })),
  );

  return { ok: true, recorded: cleaned.length };
}

/**
 * Serials currently sitting in a bin for a given item/batch/lot.
 *
 * Batch and lot are matched with IS NULL rather than `=` when absent, for the
 * same reason `stockKeyCondition` does: SQL treats NULLs as distinct and an
 * untracked item would otherwise match nothing.
 */
export async function serialsAtLocation(
  tx: DbOrTx,
  key: {
    itemId: number;
    locationId: number;
    batchNumber: string | null;
    lotNumber: string | null;
  },
) {
  return tx
    .select({
      serialId: inventorySerials.serialId,
      serialNumber: inventorySerials.serialNumber,
    })
    .from(inventorySerials)
    .where(
      and(
        eq(inventorySerials.itemId, key.itemId),
        eq(inventorySerials.locationId, key.locationId),
        eq(inventorySerials.status, "IN_STOCK"),
        key.batchNumber === null
          ? isNull(inventorySerials.batchNumber)
          : eq(inventorySerials.batchNumber, key.batchNumber),
        key.lotNumber === null
          ? isNull(inventorySerials.lotNumber)
          : eq(inventorySerials.lotNumber, key.lotNumber),
      ),
    )
    .orderBy(inventorySerials.serialNumber);
}

export type ConsumeResult =
  | { ok: true; consumed: number }
  | { ok: false; reason: "not-here"; serials: string[] };

/**
 * Move serials from a bin onto a pallet as part of a pick.
 *
 * The update is conditioned on the unit still being IN_STOCK at that location,
 * and the affected-row count is checked against what was asked for. That makes
 * the "someone else picked this unit a second ago" race a reported failure
 * rather than a silent overwrite -- the row count is the only thing that can
 * see it, since a prior SELECT would have been true at the time.
 */
export async function consumeSerialsForPick(
  tx: Tx,
  input: {
    organizationId: number;
    itemId: number;
    locationId: number;
    serials: string[];
    lpnId: string;
    soId: number | null;
    employeeId: number;
  },
): Promise<ConsumeResult> {
  const keys = input.serials.map(serialKey);
  if (keys.length === 0) return { ok: true, consumed: 0 };

  const updated = await tx
    .update(inventorySerials)
    .set({
      status: "PICKED",
      lpnId: input.lpnId,
      soId: input.soId,
      pickedAt: new Date().toISOString(),
      pickedByEmployeeId: input.employeeId,
    })
    .where(
      and(
        eq(inventorySerials.organizationId, input.organizationId),
        eq(inventorySerials.itemId, input.itemId),
        eq(inventorySerials.locationId, input.locationId),
        eq(inventorySerials.status, "IN_STOCK"),
        inArray(sql`upper(${inventorySerials.serialNumber})`, keys),
      ),
    )
    .returning({ serialNumber: inventorySerials.serialNumber });

  if (updated.length !== keys.length) {
    const took = new Set(updated.map((u) => serialKey(u.serialNumber)));
    return {
      ok: false,
      reason: "not-here",
      serials: input.serials.filter((s) => !took.has(serialKey(s))),
    };
  }
  return { ok: true, consumed: updated.length };
}

/**
 * Close the loop at dispatch: every picked serial on this order becomes
 * SHIPPED, stamped with the shipment that carried it.
 *
 * The location is cleared because the unit is no longer in the building, and a
 * stale bin reference would make it look pickable. Everything else on the row
 * is kept -- the point of this table is that the trail survives the stock.
 */
export async function markSerialsShipped(
  tx: Tx,
  input: { soId: number; shipmentId: string },
): Promise<number> {
  const updated = await tx
    .update(inventorySerials)
    .set({
      status: "SHIPPED",
      shipmentId: input.shipmentId,
      locationId: null,
      shippedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(inventorySerials.soId, input.soId),
        eq(inventorySerials.status, "PICKED"),
      ),
    )
    .returning({ serialId: inventorySerials.serialId });
  return updated.length;
}

export type SerialDrift = {
  locationId: number;
  locationCode: string;
  itemId: number;
  sku: string;
  batchNumber: string | null;
  lotNumber: string | null;
  stockQuantity: number;
  serialCount: number;
};

/**
 * Where the serial rows and the stock quantities disagree.
 *
 * Two tables describe the same physical reality: `inventory` says a bin holds
 * 12, and `inventory_serials` names 12 units in it. The application keeps them
 * in step at every write, but an adjustment made against stock alone, or a
 * direct database edit, would separate them silently. Rather than claim that
 * can't happen, this makes it visible -- an unreconciled warehouse is a fact
 * a manager should be able to see, not a bug that hides until an audit.
 *
 * Only serial-tracked items are compared; for everything else a zero serial
 * count is correct, not drift.
 */
export async function findSerialDrift(
  warehouseId: number,
): Promise<SerialDrift[]> {
  const stock = await db
    .select({
      locationId: inventory.locationId,
      locationCode: locations.locationCode,
      itemId: inventory.itemId,
      sku: items.sku,
      batchNumber: inventory.batchNumber,
      lotNumber: inventory.lotNumber,
      stockQuantity: sql<number>`coalesce(${inventory.quantity}, 0)::int`,
      serialCount: sql<number>`(
        select count(*)::int from inventory_serials s
        where s.item_id = ${inventory.itemId}
          and s.location_id = ${inventory.locationId}
          and s.status = 'IN_STOCK'
          and s.batch_number is not distinct from ${inventory.batchNumber}
          and s.lot_number is not distinct from ${inventory.lotNumber}
      )`,
    })
    .from(inventory)
    .innerJoin(items, eq(inventory.itemId, items.itemId))
    .innerJoin(locations, eq(inventory.locationId, locations.locationId))
    .where(
      and(eq(locations.warehouseId, warehouseId), eq(items.isSerialTracked, true)),
    );

  return stock
    .filter((row) => Number(row.stockQuantity) !== Number(row.serialCount))
    .map((row) => ({
      locationId: row.locationId ?? 0,
      locationCode: row.locationCode,
      itemId: row.itemId ?? 0,
      sku: row.sku,
      batchNumber: row.batchNumber,
      lotNumber: row.lotNumber,
      stockQuantity: Number(row.stockQuantity),
      serialCount: Number(row.serialCount),
    }));
}
