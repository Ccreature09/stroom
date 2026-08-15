import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { pickingTasks, salesOrders, taskStatuses, tasks } from "@/drizzle/schema";
import { getTaskLookups } from "@/lib/inbound/task-lookups";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = typeof db | Tx;

/**
 * The pick container for an order.
 *
 * `picking_tasks` has no `so_id` column -- the schema links a pick to a
 * pallet (`lpn_id`, NOT NULL) and nothing else -- so the order pallet's LPN
 * *is* the link back to the order. Deriving it from the order number rather
 * than storing the association keeps that link in one place instead of
 * scattering `LIKE 'PICK-%'` string surgery across the module.
 *
 * Worth knowing this is the weakest joint in the outbound model: a proper
 * fix is an `so_id` column on `picking_tasks`, which is a small additive
 * migration. Until then, every lookup goes through here.
 */
export function orderPickLpn(soNumber: string): string {
  return `PICK-${soNumber}`.slice(0, 50);
}

export type PickProgress = {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  cancelled: number;
};

/** How far along the picking is for one order. */
export async function loadOrderPickProgress(
  tx: DbOrTx,
  warehouseId: number,
  soNumber: string,
): Promise<PickProgress> {
  const rows = await tx
    .select({
      code: taskStatuses.code,
      n: sql<number>`count(*)::int`,
    })
    .from(pickingTasks)
    .innerJoin(tasks, eq(pickingTasks.taskId, tasks.taskId))
    .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
    .where(
      and(
        eq(tasks.warehouseId, warehouseId),
        eq(pickingTasks.lpnId, orderPickLpn(soNumber)),
      ),
    )
    .groupBy(taskStatuses.code);

  const byCode = Object.fromEntries(rows.map((r) => [r.code, r.n]));
  const pending = byCode.PENDING ?? 0;
  const inProgress = byCode.IN_PROGRESS ?? 0;
  const completed = byCode.COMPLETED ?? 0;
  const cancelled = byCode.CANCELLED ?? 0;

  return {
    total: pending + inProgress + completed + cancelled,
    pending,
    inProgress,
    completed,
    cancelled,
  };
}

/**
 * Rolls an order's status forward from its pick tasks' aggregate progress,
 * the same way a purchase order's status is derived from its lines'
 * receipts rather than set by hand.
 *
 * Only ever moves RELEASED -> PICKING -> PICKED. SHIPPED is set by
 * dispatching a shipment and must not be walked backwards by a late pick
 * update, and a CANCELLED order has no business being revived by one.
 */
export async function syncSalesOrderStatus(
  tx: DbOrTx,
  warehouseId: number,
  soId: number,
  soNumber: string,
): Promise<void> {
  const [current] = await tx
    .select({ status: salesOrders.status })
    .from(salesOrders)
    .where(and(eq(salesOrders.soId, soId), eq(salesOrders.warehouseId, warehouseId)))
    .limit(1);
  if (!current) return;
  if (!["RELEASED", "PICKING", "PICKED"].includes(current.status ?? "")) return;

  const progress = await loadOrderPickProgress(tx, warehouseId, soNumber);
  const outstanding = progress.pending + progress.inProgress;

  let next: string;
  if (progress.total === 0) next = "RELEASED";
  else if (outstanding === 0) next = "PICKED";
  else if (progress.completed > 0 || progress.inProgress > 0) next = "PICKING";
  else next = "RELEASED";

  if (next !== current.status) {
    await tx
      .update(salesOrders)
      .set({ status: next, updatedAt: new Date().toISOString() })
      .where(eq(salesOrders.soId, soId));
  }
}

/**
 * Cancels every still-open pick for an order.
 *
 * Availability is derived from open pick tasks (see allocation-server.ts),
 * so an abandoned order whose picks are left open would hold its stock
 * hostage indefinitely. Cancelling the order and freeing the reservation
 * have to be the same operation.
 */
export async function cancelOpenPicksForOrder(
  tx: Tx,
  warehouseId: number,
  soNumber: string,
): Promise<number> {
  const { statusIdByCode } = await getTaskLookups();

  const open = await tx
    .select({ taskId: pickingTasks.taskId })
    .from(pickingTasks)
    .innerJoin(tasks, eq(pickingTasks.taskId, tasks.taskId))
    .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
    .where(
      and(
        eq(tasks.warehouseId, warehouseId),
        eq(pickingTasks.lpnId, orderPickLpn(soNumber)),
        inArray(taskStatuses.code, ["PENDING", "IN_PROGRESS"]),
      ),
    );
  if (open.length === 0) return 0;

  await tx
    .update(tasks)
    .set({ statusId: statusIdByCode.CANCELLED })
    .where(
      inArray(
        tasks.taskId,
        open.map((t) => t.taskId),
      ),
    );
  return open.length;
}
