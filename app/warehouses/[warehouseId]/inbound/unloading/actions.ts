"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { carriers, locations, unloadingTasks } from "@/drizzle/schema";
import { requireWarehouseActionAccess } from "@/lib/warehouse-access";
import {
  assignTask,
  cancelTask,
  completeTask,
  createTask,
  startTask,
} from "@/lib/inbound/task-lifecycle";
import {
  parseDepartmentIds,
  validateDepartmentIds,
} from "@/lib/tasks/routing";

function parsePositiveInt(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const parsed = Number(String(value).trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseOptionalText(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const raw = String(value).trim();
  return raw ? raw : null;
}

function revalidateUnloading(warehouseId: number) {
  revalidatePath(`/warehouses/${warehouseId}/inbound/unloading`);
}

export async function createUnloadingTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireUnload: true },
  );
  if (!access.ok) return { error: access.error };

  const { employee, warehouseId } = access.context;

  const dockDoorLocationId = parsePositiveInt(formData.get("dockDoorLocationId"));
  const trailerNumber = parseOptionalText(formData.get("trailerNumber"));
  const expectedPallets = parsePositiveInt(formData.get("expectedPallets"));
  const carrierId = parsePositiveInt(formData.get("carrierId"));
  const assignedEmployeeId = parsePositiveInt(formData.get("assignedEmployeeId"));

  if (!dockDoorLocationId) return { error: "Select a dock door location." };
  if (!expectedPallets) return { error: "Expected pallets must be a positive whole number." };

  const [location] = await db
    .select({ locationId: locations.locationId })
    .from(locations)
    .where(
      and(
        eq(locations.locationId, dockDoorLocationId),
        eq(locations.warehouseId, warehouseId),
      ),
    )
    .limit(1);
  if (!location) return { error: "Location not found in this warehouse." };

  if (carrierId) {
    const [carrier] = await db
      .select({ carrierId: carriers.carrierId })
      .from(carriers)
      .where(
        and(
          eq(carriers.carrierId, carrierId),
          eq(carriers.organizationId, employee.organizationId),
        ),
      )
      .limit(1);
    if (!carrier) return { error: "Carrier not found for your organization." };
  }

  const routing = await validateDepartmentIds(
    warehouseId,
    parseDepartmentIds(formData.get("departmentIds")),
  );
  if (!routing.ok) return { error: routing.error };

  const taskId = await db.transaction(async (tx) => {
    const id = await createTask(tx, {
      warehouseId,
      typeCode: "UNLOADING",
      assignedEmployeeId,
      departmentIds: routing.ids,
    });
    await tx.insert(unloadingTasks).values({
      taskId: id,
      dockDoorLocationId,
      trailerNumber,
      expectedPallets,
      carrierId,
    });
    return id;
  });

  revalidateUnloading(warehouseId);
  return { success: true, taskId };
}

/**
 * Assigning someone ELSE needs `canAssignTasks`; claiming an unassigned task
 * for yourself needs only `canUnload` -- see the note on assignBookingTask.
 */
export async function assignUnloadingTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireUnload: true },
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

  revalidateUnloading(warehouseId);
  return { success: true };
}

export async function startUnloadingTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireUnload: true },
  );
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) return { error: "Invalid task." };

  const result = await db.transaction((tx) => startTask(tx, taskId, warehouseId));
  if (result.error) return { error: result.error };

  revalidateUnloading(warehouseId);
  return { success: true };
}

export async function completeUnloadingTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireUnload: true },
  );
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) return { error: "Invalid task." };

  const result = await db.transaction((tx) => completeTask(tx, taskId, warehouseId));
  if (result.error) return { error: result.error };

  revalidateUnloading(warehouseId);
  return { success: true };
}

export async function cancelUnloadingTask(formData: FormData) {
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

  revalidateUnloading(warehouseId);
  return { success: true };
}
