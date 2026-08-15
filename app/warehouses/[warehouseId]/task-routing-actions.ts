"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { tasks } from "@/drizzle/schema";
import { requireWarehouseActionAccess } from "@/lib/warehouse-access";
import {
  parseDepartmentIds,
  setTaskDepartments,
  validateDepartmentIds,
} from "@/lib/tasks/routing";

/**
 * Retargets an existing task at a different set of departments.
 *
 * Gated on `canAssignTasks` rather than the task's own execution permission:
 * changing who a task is routed to is directing other people's work, which
 * is the same call as assigning it to someone.
 */
export async function updateTaskDepartments(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requireAssignTasks: true,
  });
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) return { error: "Invalid task." };

  const [task] = await db
    .select({ taskId: tasks.taskId })
    .from(tasks)
    .where(and(eq(tasks.taskId, taskId), eq(tasks.warehouseId, warehouseId)))
    .limit(1);
  if (!task) return { error: "Task not found in this warehouse." };

  const requested = parseDepartmentIds(formData.get("departmentIds"));
  const validated = await validateDepartmentIds(warehouseId, requested);
  if (!validated.ok) return { error: validated.error };

  await db.transaction((tx) => setTaskDepartments(tx, taskId, validated.ids));

  // Every queue that can show a routing chip, plus the worker list whose
  // contents this directly changes.
  for (const path of [
    "inbound/bookings",
    "inbound/unloading",
    "inbound/putaway",
    "outbound/picking",
    "internal/replenishment",
    "internal/cycle-count",
  ]) {
    revalidatePath(`/warehouses/${warehouseId}/${path}`);
  }
  revalidatePath(`/warehouses/${warehouseId}/floor`);

  return { success: true };
}
