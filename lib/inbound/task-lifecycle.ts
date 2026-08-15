import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tasks } from "@/drizzle/schema";
import { getTaskLookups, type TaskTypeCode } from "./task-lookups";
import { resolveTaskDepartments, setTaskDepartments } from "@/lib/tasks/routing";

/**
 * Status/timestamp transitions shared by every task-subtype module (booking,
 * unloading, putaway, and whatever picks up picking/loading/replenishment/
 * cycle-count later) -- they all sit on the same `tasks` base table, and
 * "what does it mean to start or complete a task" is one rule, not one per
 * subtype.
 *
 * Deliberately NOT "use server" exports: these do no authorization of their
 * own (see the note on `recordAssetPosition` in `asset-positions.ts` for why
 * that split matters) and take a caller-supplied transaction client so a
 * module can atomically create the base task row alongside its own subtype
 * row, or complete a task alongside whatever physical-world side effect
 * completing it implies (moving a pallet, for putaway).
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = typeof db | Tx;

export type TaskResult = { error?: string; success?: true };

/** Inserts the base `tasks` row for a new task of the given type, PENDING by
 *  default. Returns the new task's id for the caller to attach a subtype row
 *  (booking_tasks, unloading_tasks, ...) to in the same transaction.
 *
 *  Department routing is resolved and written here rather than by each
 *  caller: this is the one function every task in the system passes
 *  through, so applying the standing routing rule at this point is what
 *  makes "automatic" actually mean automatic. A caller that passes explicit
 *  `departmentIds` overrides the rule; one that passes nothing gets it. */
export async function createTask(
  tx: DbOrTx,
  input: {
    warehouseId: number;
    typeCode: TaskTypeCode;
    priority?: number;
    assignedEmployeeId?: number | null;
    mheTypeRequired?: number | null;
    departmentIds?: number[];
  },
): Promise<string> {
  const { typeIdByCode, statusIdByCode } = await getTaskLookups();
  const [row] = await tx
    .insert(tasks)
    .values({
      warehouseId: input.warehouseId,
      taskTypeId: typeIdByCode[input.typeCode],
      statusId: statusIdByCode.PENDING,
      priority: input.priority ?? 100,
      assignedEmployeeId: input.assignedEmployeeId ?? null,
      mheTypeRequired: input.mheTypeRequired ?? null,
    })
    .returning({ taskId: tasks.taskId });

  const departmentIds = await resolveTaskDepartments(
    tx,
    input.warehouseId,
    input.typeCode,
    input.departmentIds,
  );
  if (departmentIds.length > 0) {
    await setTaskDepartments(tx, row.taskId, departmentIds);
  }

  return row.taskId;
}

async function loadTaskInWarehouse(tx: DbOrTx, taskId: string, warehouseId: number) {
  const [row] = await tx
    .select({ statusId: tasks.statusId, assignedEmployeeId: tasks.assignedEmployeeId })
    .from(tasks)
    .where(and(eq(tasks.taskId, taskId), eq(tasks.warehouseId, warehouseId)))
    .limit(1);
  return row ?? null;
}

/** Hands a pending task to an employee without changing its status --
 *  claiming a task and starting it are different moments (you can be handed
 *  something now and get to it in ten minutes). */
export async function assignTask(
  tx: DbOrTx,
  taskId: string,
  warehouseId: number,
  employeeId: number,
): Promise<TaskResult> {
  const task = await loadTaskInWarehouse(tx, taskId, warehouseId);
  if (!task) return { error: "Task not found in this warehouse." };

  await tx
    .update(tasks)
    .set({ assignedEmployeeId: employeeId })
    .where(eq(tasks.taskId, taskId));
  return { success: true };
}

export async function startTask(
  tx: DbOrTx,
  taskId: string,
  warehouseId: number,
): Promise<TaskResult> {
  const { statusIdByCode } = await getTaskLookups();
  const task = await loadTaskInWarehouse(tx, taskId, warehouseId);
  if (!task) return { error: "Task not found in this warehouse." };
  if (task.statusId !== statusIdByCode.PENDING) {
    return { error: "Only a pending task can be started." };
  }

  await tx
    .update(tasks)
    .set({ statusId: statusIdByCode.IN_PROGRESS, startedAt: new Date().toISOString() })
    .where(eq(tasks.taskId, taskId));
  return { success: true };
}

export async function completeTask(
  tx: DbOrTx,
  taskId: string,
  warehouseId: number,
): Promise<TaskResult> {
  const { statusIdByCode } = await getTaskLookups();
  const task = await loadTaskInWarehouse(tx, taskId, warehouseId);
  if (!task) return { error: "Task not found in this warehouse." };
  if (task.statusId === statusIdByCode.COMPLETED) {
    return { error: "This task is already completed." };
  }
  if (task.statusId === statusIdByCode.CANCELLED) {
    return { error: "This task was cancelled." };
  }

  await tx
    .update(tasks)
    .set({ statusId: statusIdByCode.COMPLETED, completedAt: new Date().toISOString() })
    .where(eq(tasks.taskId, taskId));
  return { success: true };
}

export async function cancelTask(
  tx: DbOrTx,
  taskId: string,
  warehouseId: number,
): Promise<TaskResult> {
  const { statusIdByCode } = await getTaskLookups();
  const task = await loadTaskInWarehouse(tx, taskId, warehouseId);
  if (!task) return { error: "Task not found in this warehouse." };
  if (task.statusId === statusIdByCode.COMPLETED) {
    return { error: "A completed task cannot be cancelled." };
  }

  await tx
    .update(tasks)
    .set({ statusId: statusIdByCode.CANCELLED })
    .where(eq(tasks.taskId, taskId));
  return { success: true };
}
