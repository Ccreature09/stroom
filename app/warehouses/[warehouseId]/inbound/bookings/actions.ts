"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { bookingTasks, items, locations } from "@/drizzle/schema";
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

function revalidateBookings(warehouseId: number) {
  revalidatePath(`/warehouses/${warehouseId}/inbound/bookings`);
}

export async function createBooking(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireBook: true },
  );
  if (!access.ok) return { error: access.error };

  const { employee, warehouseId } = access.context;

  const dockDoorLocationId = parsePositiveInt(formData.get("dockDoorLocationId"));
  const itemId = parsePositiveInt(formData.get("itemId"));
  const productType = parseOptionalText(formData.get("productType"));
  const productQuantity = parsePositiveInt(formData.get("productQuantity"));
  const palletHeightCm = parsePositiveInt(formData.get("palletHeightCm"));
  const batchNumber = parseOptionalText(formData.get("batchNumber"));
  const lotNumber = parseOptionalText(formData.get("lotNumber"));
  const expiryDate = parseOptionalText(formData.get("expiryDate"));
  const assignedEmployeeId = parsePositiveInt(formData.get("assignedEmployeeId"));

  if (!dockDoorLocationId) return { error: "Select a dock door location." };
  if (!itemId) return { error: "Select an item." };
  if (!productType) return { error: "Enter a product type." };
  if (!productQuantity) return { error: "Quantity must be a positive whole number." };
  if (!palletHeightCm) return { error: "Pallet height must be a positive whole number." };

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

  const [item] = await db
    .select({ itemId: items.itemId })
    .from(items)
    .where(
      and(eq(items.itemId, itemId), eq(items.organizationId, employee.organizationId)),
    )
    .limit(1);
  if (!item) return { error: "Item not found for your organization." };

  const routing = await validateDepartmentIds(
    warehouseId,
    parseDepartmentIds(formData.get("departmentIds")),
  );
  if (!routing.ok) return { error: routing.error };

  const taskId = await db.transaction(async (tx) => {
    const id = await createTask(tx, {
      warehouseId,
      typeCode: "BOOKING",
      assignedEmployeeId,
      departmentIds: routing.ids,
    });
    await tx.insert(bookingTasks).values({
      taskId: id,
      dockDoorLocationId,
      palletHeightCm,
      itemId,
      productType,
      productQuantity,
      batchNumber,
      lotNumber,
      expiryDate,
    });
    return id;
  });

  revalidateBookings(warehouseId);
  return { success: true, taskId };
}

/**
 * Assigning someone ELSE to a task is directing their work and needs
 * `canAssignTasks`, same as everywhere else in this codebase. Claiming an
 * unassigned task for YOURSELF is not directing anyone -- it needs only the
 * base `canBook` permission, the same self/other split the live map's
 * position reporting already uses.
 */
export async function assignBookingTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireBook: true },
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

  revalidateBookings(warehouseId);
  return { success: true };
}

export async function startBookingTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireBook: true },
  );
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) return { error: "Invalid task." };

  const result = await db.transaction((tx) => startTask(tx, taskId, warehouseId));
  if (result.error) return { error: result.error };

  revalidateBookings(warehouseId);
  return { success: true };
}

export async function completeBookingTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireBook: true },
  );
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) return { error: "Invalid task." };

  const result = await db.transaction((tx) => completeTask(tx, taskId, warehouseId));
  if (result.error) return { error: result.error };

  revalidateBookings(warehouseId);
  return { success: true };
}

export async function cancelBookingTask(formData: FormData) {
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

  revalidateBookings(warehouseId);
  return { success: true };
}
