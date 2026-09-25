import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { inventory, locations, stockMovements } from "@/drizzle/schema";
import { broadcastMapEvent } from "@/lib/warehouse-map/realtime-broadcast";

export const MOVEMENT_RECEIPT = "RECEIPT";

export type StockKey = {
  locationId: number;
  itemId: number;
  batchNumber: string | null;
  lotNumber: string | null;
};

// The unique constraint on (location, item, batch, lot) treats NULLs as
// distinct, so onConflict can't be used to upsert -- a NULL batch would
// insert a duplicate row instead of merging. Match explicitly with IS NULL
// instead.
export function stockKeyCondition(key: StockKey) {
  return and(
    eq(inventory.locationId, key.locationId),
    eq(inventory.itemId, key.itemId),
    key.batchNumber === null
      ? isNull(inventory.batchNumber)
      : eq(inventory.batchNumber, key.batchNumber),
    key.lotNumber === null
      ? isNull(inventory.lotNumber)
      : eq(inventory.lotNumber, key.lotNumber),
  );
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Books received units into a location, merging into an existing line for
 * the same location+item+batch+lot or creating a new one, and writes the
 * matching `stock_movements` audit row. Shared by ad-hoc stock receiving
 * (`inventory/stock/actions.ts`) and purchase-order receiving so the
 * merge/status-mismatch rule can't drift between the two entry points --
 * they are the same physical event (units arriving at a location) with
 * different paperwork behind them.
 *
 * Runs inside the caller's transaction rather than opening its own: PO
 * receiving needs the `purchase_order_lines.quantity_received` bump and this
 * insert to commit or fail together.
 */
export async function receiveIntoInventory(
  tx: Tx,
  input: {
    employeeId: number;
    locationId: number;
    itemId: number;
    quantity: number;
    batchNumber: string | null;
    lotNumber: string | null;
    expiryDate: string | null;
    statusId: number;
    reasonCode: string | null;
    movementType?: string;
  },
): Promise<"status-mismatch" | "ok"> {
  const key: StockKey = {
    locationId: input.locationId,
    itemId: input.itemId,
    batchNumber: input.batchNumber,
    lotNumber: input.lotNumber,
  };

  const [existing] = await tx
    .select({
      inventoryId: inventory.inventoryId,
      quantity: inventory.quantity,
      statusId: inventory.statusId,
    })
    .from(inventory)
    .where(stockKeyCondition(key))
    .limit(1);

  if (existing) {
    // One row per location+item+batch+lot, so status is a property of that
    // line. Merging stock of a different status would silently reclassify
    // what's already there.
    if (existing.statusId !== input.statusId) return "status-mismatch";

    await tx
      .update(inventory)
      .set({
        quantity: (existing.quantity ?? 0) + input.quantity,
        expiryDate: input.expiryDate ?? undefined,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(inventory.inventoryId, existing.inventoryId));
  } else {
    await tx.insert(inventory).values({
      locationId: input.locationId,
      itemId: input.itemId,
      quantity: input.quantity,
      batchNumber: input.batchNumber,
      lotNumber: input.lotNumber,
      expiryDate: input.expiryDate,
      statusId: input.statusId,
    });
  }

  await tx.insert(stockMovements).values({
    employeeId: input.employeeId,
    itemId: input.itemId,
    batchNumber: input.batchNumber,
    lotNumber: input.lotNumber,
    expiryDate: input.expiryDate,
    quantity: input.quantity,
    destinationLocationId: input.locationId,
    movementType: input.movementType ?? MOVEMENT_RECEIPT,
    reasonCode: input.reasonCode,
  });

  return "ok";
}

/**
 * Tells the live map's inventory overlay a location's stock just changed.
 *
 * Re-reads the aggregate rather than threading a delta through every caller
 * -- ad-hoc receiving, PO receiving, an adjustment, and a transfer each touch
 * the row differently, so recomputing from the table is the one definition
 * of "current total" that can't drift from what a page load would show.
 * Best-effort: a lost broadcast only delays the overlay refreshing, it never
 * affects the stock mutation that already committed.
 */
export async function notifyLocationInventoryChanged(
  warehouseId: number,
  locationId: number,
) {
  try {
    const [location] = await db
      .select({ hallId: locations.hallId })
      .from(locations)
      .where(eq(locations.locationId, locationId))
      .limit(1);
    if (!location?.hallId) return;

    const [totals] = await db
      .select({
        totalQuantity: sql<number>`coalesce(sum(${inventory.quantity}), 0)::int`,
        lineCount: sql<number>`count(*)::int`,
      })
      .from(inventory)
      .where(eq(inventory.locationId, locationId));

    await broadcastMapEvent(warehouseId, location.hallId, "INVENTORY", {
      locationId,
      totalQuantity: totals?.totalQuantity ?? 0,
      lineCount: totals?.lineCount ?? 0,
    });
  } catch (err) {
    console.error("Inventory broadcast failed:", err);
  }
}
