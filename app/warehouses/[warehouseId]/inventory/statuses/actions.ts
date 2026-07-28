"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { inventory, inventoryStatuses } from "@/drizzle/schema";
import { requireWarehouseActionAccess } from "@/lib/warehouse-access";

// The standard set most warehouses start from. Offered as a one-click seed
// because inventory rows cannot exist without a status, so a brand-new
// organization would otherwise hit a dead end on its first stock entry.
const DEFAULT_STATUSES = [
  {
    name: "Available",
    allowAllocation: true,
    allowMovement: true,
    isSellable: true,
  },
  {
    name: "Quarantine",
    allowAllocation: false,
    allowMovement: true,
    isSellable: false,
  },
  {
    name: "Damaged",
    allowAllocation: false,
    allowMovement: true,
    isSellable: false,
  },
  {
    name: "Expired",
    allowAllocation: false,
    allowMovement: false,
    isSellable: false,
  },
] as const;

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  );
}

function readFlags(formData: FormData) {
  return {
    allowAllocation: formData.get("allowAllocation") === "on",
    allowMovement: formData.get("allowMovement") === "on",
    isSellable: formData.get("isSellable") === "on",
  };
}

export async function seedDefaultStatuses(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireModifyInventory: true },
  );
  if (!access.ok) return { error: access.error };

  const { employee, warehouseId } = access.context;

  const existing = await db
    .select({ statusId: inventoryStatuses.statusId })
    .from(inventoryStatuses)
    .where(eq(inventoryStatuses.organizationId, employee.organizationId));

  if (existing.length > 0) {
    return { error: "Statuses already exist for this organization." };
  }

  await db.insert(inventoryStatuses).values(
    DEFAULT_STATUSES.map((status) => ({
      organizationId: employee.organizationId,
      ...status,
    })),
  );

  revalidatePath(`/warehouses/${warehouseId}/inventory/statuses`);
  return { success: true };
}

export async function createInventoryStatus(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireModifyInventory: true },
  );
  if (!access.ok) return { error: access.error };

  const { employee, warehouseId } = access.context;
  const name = String(formData.get("name") ?? "").trim();

  if (!name) return { error: "Status name is required." };
  if (name.length > 50) {
    return { error: "Status name must be 50 characters or fewer." };
  }

  try {
    await db.insert(inventoryStatuses).values({
      organizationId: employee.organizationId,
      name,
      ...readFlags(formData),
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { error: "A status with that name already exists." };
    }
    throw error;
  }

  revalidatePath(`/warehouses/${warehouseId}/inventory/statuses`);
  return { success: true };
}

export async function updateInventoryStatus(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireModifyInventory: true },
  );
  if (!access.ok) return { error: access.error };

  const { employee, warehouseId } = access.context;
  const statusId = Number(formData.get("statusId"));
  const name = String(formData.get("name") ?? "").trim();

  if (!statusId) return { error: "Invalid status selected." };
  if (!name) return { error: "Status name is required." };
  if (name.length > 50) {
    return { error: "Status name must be 50 characters or fewer." };
  }

  try {
    await db
      .update(inventoryStatuses)
      .set({ name, ...readFlags(formData) })
      .where(
        and(
          eq(inventoryStatuses.statusId, statusId),
          eq(inventoryStatuses.organizationId, employee.organizationId),
        ),
      );
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { error: "A status with that name already exists." };
    }
    throw error;
  }

  revalidatePath(`/warehouses/${warehouseId}/inventory/statuses`);
  return { success: true };
}

export async function deleteInventoryStatus(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireModifyInventory: true },
  );
  if (!access.ok) return { error: access.error };

  const { employee, warehouseId } = access.context;
  const statusId = Number(formData.get("statusId"));
  if (!statusId) return { error: "Invalid status selected." };

  // inventory.status_id is ON DELETE RESTRICT, so a delete with stock attached
  // would fail at the database with an opaque error. Check first and explain.
  const [inUse] = await db
    .select({ inventoryId: inventory.inventoryId })
    .from(inventory)
    .where(eq(inventory.statusId, statusId))
    .limit(1);

  if (inUse) {
    return { error: "This status is in use by existing stock and cannot be deleted." };
  }

  await db
    .delete(inventoryStatuses)
    .where(
      and(
        eq(inventoryStatuses.statusId, statusId),
        eq(inventoryStatuses.organizationId, employee.organizationId),
      ),
    );

  revalidatePath(`/warehouses/${warehouseId}/inventory/statuses`);
  return { success: true };
}
