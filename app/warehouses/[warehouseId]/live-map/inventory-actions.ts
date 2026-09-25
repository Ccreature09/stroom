"use server";

import { and, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { inventory, items, locations } from "@/drizzle/schema";
import { HallScopeError, requireLiveMapHall } from "@/lib/warehouse-map/context";
import type {
  InventoryLocationDTO,
  ItemSearchResultDTO,
} from "@/lib/warehouse-map/types";

const SEARCH_RESULT_LIMIT = 50;

/**
 * Live occupancy per location for a hall, aggregated across every item/batch
 * line -- what the map overlay tints on first load, before any broadcast
 * event has landed. Mirrors the aggregate `notifyLocationInventoryChanged`
 * recomputes in the stock actions after a mutation, so the snapshot and the
 * first live patch never disagree about what "current" means.
 */
export async function getHallInventorySnapshot(
  warehouseId: number,
  hallId: number,
): Promise<InventoryLocationDTO[]> {
  try {
    await requireLiveMapHall(warehouseId, hallId);
  } catch (err) {
    if (err instanceof HallScopeError) return [];
    throw err;
  }

  const rows = await db
    .select({
      locationId: locations.locationId,
      totalQuantity: sql<number>`coalesce(sum(${inventory.quantity}), 0)::int`,
      lineCount: sql<number>`count(${inventory.inventoryId})::int`,
    })
    .from(locations)
    .innerJoin(inventory, eq(inventory.locationId, locations.locationId))
    .where(
      and(eq(locations.warehouseId, warehouseId), eq(locations.hallId, hallId)),
    )
    .groupBy(locations.locationId);

  return rows;
}

/**
 * "Find item" search for the live map's routing panel: which locations in
 * this hall currently hold stock matching a SKU, item name, batch, or lot,
 * and how much. This is what turns "route to item X" into a set of concrete
 * destination locations `previewLiveRoute` can target.
 */
export async function searchWarehouseItems(
  warehouseId: number,
  hallId: number,
  query: string,
): Promise<ItemSearchResultDTO[]> {
  try {
    await requireLiveMapHall(warehouseId, hallId);
  } catch (err) {
    if (err instanceof HallScopeError) return [];
    throw err;
  }

  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const pattern = `%${trimmed}%`;
  const rows = await db
    .select({
      locationId: inventory.locationId,
      locationCode: locations.locationCode,
      itemId: inventory.itemId,
      sku: items.sku,
      itemName: items.name,
      quantity: inventory.quantity,
      batchNumber: inventory.batchNumber,
      lotNumber: inventory.lotNumber,
    })
    .from(inventory)
    .innerJoin(locations, eq(inventory.locationId, locations.locationId))
    .innerJoin(items, eq(inventory.itemId, items.itemId))
    .where(
      and(
        eq(locations.warehouseId, warehouseId),
        eq(locations.hallId, hallId),
        or(
          ilike(items.sku, pattern),
          ilike(items.name, pattern),
          ilike(inventory.batchNumber, pattern),
          ilike(inventory.lotNumber, pattern),
        ),
      ),
    )
    .orderBy(locations.locationCode)
    .limit(SEARCH_RESULT_LIMIT);

  return rows
    .filter(
      (row): row is typeof row & { locationId: number; itemId: number } =>
        row.locationId !== null && row.itemId !== null,
    )
    .map((row) => ({
      locationId: row.locationId,
      locationCode: row.locationCode,
      itemId: row.itemId,
      sku: row.sku,
      itemName: row.itemName,
      quantity: row.quantity ?? 0,
      batchNumber: row.batchNumber,
      lotNumber: row.lotNumber,
    }));
}
