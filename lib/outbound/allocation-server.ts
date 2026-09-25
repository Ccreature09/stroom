import "server-only";

import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  inventory,
  inventoryStatuses,
  locations,
  pickingTasks,
  taskStatuses,
  tasks,
} from "@/drizzle/schema";
import {
  planAllocation,
  stockKey,
  subtractCommitted,
  type AllocationPlan,
  type StockCandidate,
} from "./allocation";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = typeof db | Tx;

/**
 * On-hand stock for an item that is genuinely free to promise: in this
 * warehouse, at an unblocked location, under a status whose
 * `allow_allocation` flag is set (that column is the whole point of
 * QUARANTINE/DAMAGED existing), and not already promised to an open pick.
 */
export async function loadAllocatableStock(
  tx: DbOrTx,
  warehouseId: number,
  itemId: number,
): Promise<StockCandidate[]> {
  const rows = await tx
    .select({
      inventoryId: inventory.inventoryId,
      locationId: inventory.locationId,
      locationCode: locations.locationCode,
      quantity: inventory.quantity,
      batchNumber: inventory.batchNumber,
      lotNumber: inventory.lotNumber,
      expiryDate: inventory.expiryDate,
    })
    .from(inventory)
    .innerJoin(locations, eq(inventory.locationId, locations.locationId))
    .innerJoin(inventoryStatuses, eq(inventory.statusId, inventoryStatuses.statusId))
    .where(
      and(
        eq(locations.warehouseId, warehouseId),
        eq(inventory.itemId, itemId),
        eq(locations.isBlocked, false),
        eq(inventoryStatuses.allowAllocation, true),
        gt(inventory.quantity, 0),
      ),
    );

  const candidates: StockCandidate[] = rows.flatMap((row) =>
    row.locationId === null || row.quantity === null
      ? []
      : [
          {
            inventoryId: row.inventoryId,
            locationId: row.locationId,
            locationCode: row.locationCode,
            quantity: row.quantity,
            batchNumber: row.batchNumber,
            lotNumber: row.lotNumber,
            expiryDate: row.expiryDate,
          },
        ],
  );
  if (candidates.length === 0) return [];

  // Everything an open pick task still owes, keyed the same way the pure
  // helper keys a candidate.
  const committedRows = await tx
    .select({
      pickLocationId: pickingTasks.pickLocationId,
      batchNumber: pickingTasks.batchNumber,
      lotNumber: pickingTasks.lotNumber,
      committed: sql<number>`coalesce(sum(${pickingTasks.pickQuantity}), 0)::int`,
    })
    .from(pickingTasks)
    .innerJoin(tasks, eq(pickingTasks.taskId, tasks.taskId))
    .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
    .where(
      and(
        eq(tasks.warehouseId, warehouseId),
        eq(pickingTasks.itemId, itemId),
        inArray(taskStatuses.code, ["PENDING", "IN_PROGRESS"]),
      ),
    )
    .groupBy(pickingTasks.pickLocationId, pickingTasks.batchNumber, pickingTasks.lotNumber);

  const committedByKey = new Map<string, number>(
    committedRows.map((row) => [
      stockKey(row.pickLocationId, itemId, row.batchNumber, row.lotNumber),
      row.committed,
    ]),
  );

  return subtractCommitted(candidates, itemId, committedByKey);
}

/** Plans (but does not write) the picks that would cover one demand line. */
export async function planLineAllocation(
  tx: DbOrTx,
  warehouseId: number,
  itemId: number,
  quantity: number,
): Promise<AllocationPlan> {
  const candidates = await loadAllocatableStock(tx, warehouseId, itemId);
  return planAllocation(candidates, quantity);
}
