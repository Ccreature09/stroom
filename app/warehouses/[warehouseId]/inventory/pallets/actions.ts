"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { locations, pallets } from "@/drizzle/schema";
import { requireWarehouseActionAccess } from "@/lib/warehouse-access";
import { PALLET_STATUSES } from "./constants";

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  );
}

function isForeignKeyViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23503"
  );
}

function parseStatus(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  return PALLET_STATUSES.includes(raw as never) ? raw : null;
}

function parseOptionalLocationId(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Location must be in this warehouse -- a pallet cannot sit in another site. */
async function assertLocationInWarehouse(
  locationId: number,
  warehouseId: number,
) {
  const [row] = await db
    .select({ locationId: locations.locationId })
    .from(locations)
    .where(
      and(
        eq(locations.locationId, locationId),
        eq(locations.warehouseId, warehouseId),
      ),
    )
    .limit(1);

  return Boolean(row);
}

export async function createPallet(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireModifyInventory: true },
  );
  if (!access.ok) return { error: access.error };

  const { warehouseId } = access.context;

  const lpnId = String(formData.get("lpnId") ?? "").trim().toUpperCase();
  const status = parseStatus(formData.get("status")) ?? "ACTIVE";
  const currentLocationId = parseOptionalLocationId(
    formData.get("currentLocationId"),
  );

  if (!lpnId) return { error: "LPN is required." };
  if (lpnId.length > 50) {
    return { error: "LPN must be 50 characters or fewer." };
  }

  if (
    currentLocationId !== null &&
    !(await assertLocationInWarehouse(currentLocationId, warehouseId))
  ) {
    return { error: "Location not found in this warehouse." };
  }

  try {
    await db.insert(pallets).values({
      lpnId,
      warehouseId,
      currentLocationId,
      status,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { error: "That LPN already exists." };
    }
    throw error;
  }

  revalidatePath(`/warehouses/${warehouseId}/inventory/pallets`);
  return { success: true };
}

export async function updatePallet(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireModifyInventory: true },
  );
  if (!access.ok) return { error: access.error };

  const { warehouseId } = access.context;

  const lpnId = String(formData.get("lpnId") ?? "").trim();
  const status = parseStatus(formData.get("status"));
  const currentLocationId = parseOptionalLocationId(
    formData.get("currentLocationId"),
  );

  if (!lpnId) return { error: "Invalid pallet." };
  if (!status) return { error: "Select a valid pallet status." };

  if (
    currentLocationId !== null &&
    !(await assertLocationInWarehouse(currentLocationId, warehouseId))
  ) {
    return { error: "Location not found in this warehouse." };
  }

  const updated = await db
    .update(pallets)
    .set({
      status,
      currentLocationId,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(pallets.lpnId, lpnId), eq(pallets.warehouseId, warehouseId)))
    .returning({ lpnId: pallets.lpnId });

  if (updated.length === 0) {
    return { error: "Pallet not found in this warehouse." };
  }

  revalidatePath(`/warehouses/${warehouseId}/inventory/pallets`);
  return { success: true };
}

export async function deletePallet(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireModifyInventory: true },
  );
  if (!access.ok) return { error: access.error };

  const { warehouseId } = access.context;
  const lpnId = String(formData.get("lpnId") ?? "").trim();
  if (!lpnId) return { error: "Invalid pallet." };

  try {
    await db
      .delete(pallets)
      .where(
        and(eq(pallets.lpnId, lpnId), eq(pallets.warehouseId, warehouseId)),
      );
  } catch (error) {
    // Putaway, picking, and loading tasks reference pallets with ON DELETE
    // RESTRICT, so a pallet in an open task cannot be removed.
    if (isForeignKeyViolation(error)) {
      return {
        error: "This pallet is referenced by existing tasks and cannot be deleted.",
      };
    }
    throw error;
  }

  revalidatePath(`/warehouses/${warehouseId}/inventory/pallets`);
  return { success: true };
}
