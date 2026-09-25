"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { taskRoutingRules, taskTypes } from "@/drizzle/schema";
import { requireWarehouseActionAccess } from "@/lib/warehouse-access";
import { validateDepartmentIds } from "@/lib/tasks/routing";
import { getTaskLookups, type TaskTypeCode } from "@/lib/inbound/task-lookups";

/**
 * Replaces the standing routing rule for one task type in this warehouse.
 *
 * Whole-set replace rather than add/remove: "this kind of work goes to these
 * teams" is one statement, and editing it as a set is both simpler to reason
 * about and impossible to leave half-applied.
 *
 * Only affects tasks created *after* the change. Retargeting work already on
 * the floor is the per-task editor's job -- silently re-routing tasks
 * someone may already be walking toward would be a surprise, not a feature.
 */
export async function setRoutingRule(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requireAssignTasks: true,
  });
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const typeCode = String(formData.get("typeCode") ?? "") as TaskTypeCode;
  if (!typeCode) return { error: "Invalid task type." };

  const { typeIdByCode } = await getTaskLookups();
  const taskTypeId = typeIdByCode[typeCode];
  if (!taskTypeId) return { error: "Unknown task type." };

  const requested = String(formData.get("departmentIds") ?? "")
    .split(",")
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);

  const validated = await validateDepartmentIds(warehouseId, requested);
  if (!validated.ok) return { error: validated.error };

  await db.transaction(async (tx) => {
    await tx
      .delete(taskRoutingRules)
      .where(
        and(
          eq(taskRoutingRules.warehouseId, warehouseId),
          eq(taskRoutingRules.taskTypeId, taskTypeId),
        ),
      );
    if (validated.ids.length > 0) {
      await tx.insert(taskRoutingRules).values(
        validated.ids.map((departmentId) => ({
          warehouseId,
          taskTypeId,
          departmentId,
        })),
      );
    }
  });

  revalidatePath(`/warehouses/${warehouseId}/task-routing`);
  return { success: true };
}

/** Current rules, keyed by task type code, for the settings page. */
export async function loadRoutingRules(warehouseId: number) {
  const rows = await db
    .select({
      code: taskTypes.code,
      departmentId: taskRoutingRules.departmentId,
    })
    .from(taskRoutingRules)
    .innerJoin(taskTypes, eq(taskRoutingRules.taskTypeId, taskTypes.taskTypeId))
    .where(
      and(
        eq(taskRoutingRules.warehouseId, warehouseId),
        eq(taskRoutingRules.isActive, true),
      ),
    );

  const byCode: Record<string, number[]> = {};
  for (const row of rows) {
    byCode[row.code] = [...(byCode[row.code] ?? []), row.departmentId];
  }
  return byCode;
}
