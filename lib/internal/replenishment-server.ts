import "server-only";

import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  inventory,
  inventoryStatuses,
  items,
  locations,
  replenishmentTasks,
  taskStatuses,
  tasks,
} from "@/drizzle/schema";
import type { StockCandidate } from "@/lib/outbound/allocation";
import {
  classifyLocationRole,
  planReplenishment,
  type ReplenishmentNeed,
} from "./replenishment";

/**
 * Builds the replenishment picture for a whole warehouse in one pass.
 *
 * Deliberately one query for all stock rather than a query per item: a
 * warehouse has thousands of items and a handful of them need topping up,
 * so filtering in memory beats issuing thousands of round trips to discover
 * that most of them are fine.
 *
 * Only items with a `min_stock_level` are considered -- that column is the
 * only statement anywhere in this schema of how full a face should be kept,
 * so an item without one has no defined need.
 */
export async function loadReplenishmentNeeds(
  warehouseId: number,
  organizationId: number,
): Promise<ReplenishmentNeed[]> {
  const stockRows = await db
    .select({
      inventoryId: inventory.inventoryId,
      locationId: inventory.locationId,
      locationCode: locations.locationCode,
      locationType: locations.locationType,
      level: locations.level,
      itemId: inventory.itemId,
      quantity: inventory.quantity,
      batchNumber: inventory.batchNumber,
      lotNumber: inventory.lotNumber,
      expiryDate: inventory.expiryDate,
      sku: items.sku,
      itemName: items.name,
      minStockLevel: items.minStockLevel,
    })
    .from(inventory)
    .innerJoin(locations, eq(inventory.locationId, locations.locationId))
    .innerJoin(items, eq(inventory.itemId, items.itemId))
    .innerJoin(inventoryStatuses, eq(inventory.statusId, inventoryStatuses.statusId))
    .where(
      and(
        eq(locations.warehouseId, warehouseId),
        eq(items.organizationId, organizationId),
        eq(locations.isBlocked, false),
        // Stock that cannot be allocated cannot be used to serve picks, so
        // it is not a candidate for filling a pick face either.
        eq(inventoryStatuses.allowAllocation, true),
        gt(inventory.quantity, 0),
      ),
    );

  // Units already promised to open replenishment tasks, so two runs of this
  // planner never both propose moving the same pallet -- the same soft
  // reservation the outbound allocator makes against open pick tasks.
  const committedRows = await db
    .select({
      sourceLocationId: replenishmentTasks.sourceLocationId,
      itemId: replenishmentTasks.itemId,
      batchNumber: replenishmentTasks.batchNumber,
      lotNumber: replenishmentTasks.lotNumber,
      committed: sql<number>`coalesce(sum(${replenishmentTasks.quantity}), 0)::int`,
    })
    .from(replenishmentTasks)
    .innerJoin(tasks, eq(replenishmentTasks.taskId, tasks.taskId))
    .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
    .where(
      and(
        eq(tasks.warehouseId, warehouseId),
        inArray(taskStatuses.code, ["PENDING", "IN_PROGRESS"]),
      ),
    )
    .groupBy(
      replenishmentTasks.sourceLocationId,
      replenishmentTasks.itemId,
      replenishmentTasks.batchNumber,
      replenishmentTasks.lotNumber,
    );

  const committedKey = (
    locationId: number,
    itemId: number,
    batch: string | null,
    lot: string | null,
  ) => `${locationId}:${itemId}:${batch ?? ""}:${lot ?? ""}`;
  const committedByKey = new Map(
    committedRows.map((r) => [
      committedKey(r.sourceLocationId, r.itemId, r.batchNumber, r.lotNumber),
      r.committed,
    ]),
  );

  type Agg = {
    sku: string;
    itemName: string;
    minStockLevel: number;
    pickFaceQuantity: number;
    /** Best pick face to top up: the one already holding the most of it. */
    destination: { locationId: number; locationCode: string; quantity: number } | null;
    reserve: StockCandidate[];
  };
  const byItem = new Map<number, Agg>();

  for (const row of stockRows) {
    if (row.itemId === null || row.locationId === null || row.quantity === null) continue;
    const minStockLevel = row.minStockLevel ?? 0;
    if (minStockLevel <= 0) continue;

    const role = classifyLocationRole(row.locationType, row.level);
    if (role === "OTHER") continue;

    let agg = byItem.get(row.itemId);
    if (!agg) {
      agg = {
        sku: row.sku,
        itemName: row.itemName,
        minStockLevel,
        pickFaceQuantity: 0,
        destination: null,
        reserve: [],
      };
      byItem.set(row.itemId, agg);
    }

    if (role === "PICK_FACE") {
      agg.pickFaceQuantity += row.quantity;
      if (!agg.destination || row.quantity > agg.destination.quantity) {
        agg.destination = {
          locationId: row.locationId,
          locationCode: row.locationCode,
          quantity: row.quantity,
        };
      }
    } else {
      const free =
        row.quantity -
        (committedByKey.get(
          committedKey(row.locationId, row.itemId, row.batchNumber, row.lotNumber),
        ) ?? 0);
      if (free > 0) {
        agg.reserve.push({
          inventoryId: row.inventoryId,
          locationId: row.locationId,
          locationCode: row.locationCode,
          quantity: free,
          batchNumber: row.batchNumber,
          lotNumber: row.lotNumber,
          expiryDate: row.expiryDate,
        });
      }
    }
  }

  const needs: ReplenishmentNeed[] = [];
  for (const [itemId, agg] of byItem) {
    const need = planReplenishment({
      itemId,
      sku: agg.sku,
      itemName: agg.itemName,
      minStockLevel: agg.minStockLevel,
      pickFaceQuantity: agg.pickFaceQuantity,
      destination: agg.destination,
      reserveCandidates: agg.reserve,
    });
    if (need) needs.push(need);
  }

  // Emptiest faces first -- the ones closest to stopping a picker.
  return needs.sort((a, b) => {
    const aRatio = a.pickFaceQuantity / a.minStockLevel;
    const bRatio = b.pickFaceQuantity / b.minStockLevel;
    return aRatio - bRatio;
  });
}
