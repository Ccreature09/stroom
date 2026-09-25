"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { locations, pallets, putawayTasks } from "@/drizzle/schema";
import { requireWarehouseActionAccess } from "@/lib/warehouse-access";
import {
  assignTask,
  cancelTask,
  completeTask,
  createTask,
  startTask,
} from "@/lib/inbound/task-lifecycle";
import { reportEmployeeAtLocation } from "@/lib/warehouse-map/asset-positions";
import {
  parseDepartmentIds,
  validateDepartmentIds,
} from "@/lib/tasks/routing";

function parsePositiveInt(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const parsed = Number(String(value).trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function revalidatePutaway(warehouseId: number) {
  revalidatePath(`/warehouses/${warehouseId}/inbound/putaway`);
}

async function assertLocationInWarehouse(locationId: number, warehouseId: number) {
  const [row] = await db
    .select({ locationId: locations.locationId })
    .from(locations)
    .where(and(eq(locations.locationId, locationId), eq(locations.warehouseId, warehouseId)))
    .limit(1);
  return Boolean(row);
}

export async function createPutawayTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireModifyInventory: true },
  );
  if (!access.ok) return { error: access.error };

  const { warehouseId } = access.context;

  const lpnId = String(formData.get("lpnId") ?? "").trim();
  const sourceLocationId = parsePositiveInt(formData.get("sourceLocationId"));
  const suggestedDestLocationId = parsePositiveInt(
    formData.get("suggestedDestLocationId"),
  );
  const assignedEmployeeId = parsePositiveInt(formData.get("assignedEmployeeId"));

  if (!lpnId) return { error: "Select a pallet." };
  if (!sourceLocationId) return { error: "Select a source location." };
  if (!suggestedDestLocationId) return { error: "Select a suggested destination." };
  if (sourceLocationId === suggestedDestLocationId) {
    return { error: "Source and suggested destination must differ." };
  }

  const [pallet] = await db
    .select({ lpnId: pallets.lpnId, status: pallets.status })
    .from(pallets)
    .where(and(eq(pallets.lpnId, lpnId), eq(pallets.warehouseId, warehouseId)))
    .limit(1);
  if (!pallet) return { error: "Pallet not found in this warehouse." };

  if (
    !(await assertLocationInWarehouse(sourceLocationId, warehouseId)) ||
    !(await assertLocationInWarehouse(suggestedDestLocationId, warehouseId))
  ) {
    return { error: "Location not found in this warehouse." };
  }

  const routing = await validateDepartmentIds(
    warehouseId,
    parseDepartmentIds(formData.get("departmentIds")),
  );
  if (!routing.ok) return { error: routing.error };

  const taskId = await db.transaction(async (tx) => {
    const id = await createTask(tx, {
      warehouseId,
      typeCode: "PUTAWAY",
      assignedEmployeeId,
      departmentIds: routing.ids,
    });
    await tx.insert(putawayTasks).values({
      taskId: id,
      lpnId,
      sourceLocationId,
      suggestedDestLocationId,
    });
    return id;
  });

  revalidatePutaway(warehouseId);
  return { success: true, taskId };
}

/**
 * Assigning someone ELSE needs `canAssignTasks`; claiming an unassigned task
 * for yourself needs only `canModifyInventory` -- see the note on
 * assignBookingTask.
 */
export async function assignPutawayTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireModifyInventory: true },
  );
  if (!access.ok) return { error: access.error };
  const { employee, warehouseId } = access.context;

  const taskId = String(formData.get("taskId") ?? "");
  const assignedEmployeeId = parsePositiveInt(formData.get("assignedEmployeeId"));
  if (!taskId) return { error: "Invalid task." };
  if (!assignedEmployeeId) return { error: "Select an employee." };
  if (assignedEmployeeId !== employee.employeeId && employee.canAssignTasks !== true) {
    return { error: "You can only claim this task for yourself." };
  }

  const result = await db.transaction((tx) =>
    assignTask(tx, taskId, warehouseId, assignedEmployeeId),
  );
  if (result.error) return { error: result.error };

  revalidatePutaway(warehouseId);
  return { success: true };
}

export async function startPutawayTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireModifyInventory: true },
  );
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) return { error: "Invalid task." };

  const result = await db.transaction((tx) => startTask(tx, taskId, warehouseId));
  if (result.error) return { error: result.error };

  revalidatePutaway(warehouseId);
  return { success: true };
}

/**
 * Completing a putaway task is the one place this module does more than a
 * status flip: it is literally the task's job to move the pallet, so the
 * pallet's `current_location_id` moves to wherever it actually landed
 * (which may differ from the suggested destination -- a worker finding the
 * suggested bay full and using the next one over is normal, not an error).
 */
export async function completePutawayTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireModifyInventory: true },
  );
  if (!access.ok) return { error: access.error };
  const { employee, warehouseId } = access.context;

  const taskId = String(formData.get("taskId") ?? "");
  const actualDestLocationIdInput = parsePositiveInt(
    formData.get("actualDestLocationId"),
  );
  if (!taskId) return { error: "Invalid task." };

  const [putaway] = await db
    .select({
      lpnId: putawayTasks.lpnId,
      suggestedDestLocationId: putawayTasks.suggestedDestLocationId,
    })
    .from(putawayTasks)
    .where(eq(putawayTasks.taskId, taskId))
    .limit(1);
  if (!putaway) return { error: "Putaway task not found." };

  const actualDestLocationId =
    actualDestLocationIdInput ?? putaway.suggestedDestLocationId;
  if (!(await assertLocationInWarehouse(actualDestLocationId, warehouseId))) {
    return { error: "Destination location not found in this warehouse." };
  }

  const [destination] = await db
    .select({ isBlocked: locations.isBlocked, locationCode: locations.locationCode })
    .from(locations)
    .where(eq(locations.locationId, actualDestLocationId))
    .limit(1);
  if (destination?.isBlocked) {
    return { error: `Location ${destination.locationCode} is blocked.` };
  }

  const result = await db.transaction(async (tx) => {
    const completion = await completeTask(tx, taskId, warehouseId);
    if (completion.error) return completion;

    await tx
      .update(putawayTasks)
      .set({ actualDestLocationId })
      .where(eq(putawayTasks.taskId, taskId));

    await tx
      .update(pallets)
      .set({ currentLocationId: actualDestLocationId, updatedAt: new Date().toISOString() })
      .where(and(eq(pallets.lpnId, putaway.lpnId), eq(pallets.warehouseId, warehouseId)));

    return { success: true as const };
  });
  if (result.error) return { error: result.error };

  revalidatePutaway(warehouseId);
  revalidatePath(`/warehouses/${warehouseId}/inventory/pallets`);
  await reportEmployeeAtLocation(
    warehouseId,
    employee.organizationId,
    employee,
    actualDestLocationId,
  );

  return { success: true };
}

export async function cancelPutawayTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireAssignTasks: true },
  );
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) return { error: "Invalid task." };

  const result = await db.transaction((tx) => cancelTask(tx, taskId, warehouseId));
  if (result.error) return { error: result.error };

  revalidatePutaway(warehouseId);
  return { success: true };
}
