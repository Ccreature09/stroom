"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  employees,
  locations,
  positionTypes,
  halls,
  warehouses,
  zoneTypes,
} from "@/drizzle/schema";
import { createClient } from "@/lib/server";

type ActionResult = { error?: string; success?: true };

function parsePositiveInt(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const parsed = Number(String(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseNonNegativeInt(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const parsed = Number(String(value));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseNullableInt(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

// Every mutation below is scoped to the caller's organization and requires
// the "can modify locations" permission -- redirects on auth failure, throws
// on permission failure so it surfaces as an error to the calling form.
async function requireLayoutContext(warehouseId: number) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/sign-in");

  const [employee] = await db
    .select({
      organizationId: employees.organizationId,
      canModifyLocations: positionTypes.canModifyLocations,
    })
    .from(employees)
    .innerJoin(
      positionTypes,
      eq(employees.positionId, positionTypes.positionId),
    )
    .where(and(eq(employees.authUserId, userId), eq(employees.isActive, true)))
    .limit(1);

  if (!employee) redirect("/sign-in");
  if (employee.canModifyLocations !== true) {
    throw new Error(
      "You do not have permission to modify the warehouse layout.",
    );
  }

  const [warehouse] = await db
    .select({ warehouseId: warehouses.warehouseId })
    .from(warehouses)
    .where(
      and(
        eq(warehouses.warehouseId, warehouseId),
        eq(warehouses.organizationId, employee.organizationId),
      ),
    )
    .limit(1);

  if (!warehouse) redirect("/dashboard/warehouses");

  return { organizationId: employee.organizationId };
}

function revalidateLayout(warehouseId: number) {
  revalidatePath(`/dashboard/warehouses/${warehouseId}/layout-designer`);
}

// ---------------------------------------------------------------------------
// Halls
// ---------------------------------------------------------------------------

export async function createHall(formData: FormData) {
  const warehouseId = parsePositiveInt(formData.get("warehouseId"));
  if (!warehouseId) redirect("/dashboard/warehouses");

  const { organizationId } = await requireLayoutContext(warehouseId);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Hall name is required.");

  const widthMm = parsePositiveInt(formData.get("physicalWidthMm")) ?? 80_000;
  const lengthMm = parsePositiveInt(formData.get("physicalLengthMm")) ?? 60_000;
  const clearHeightMm = parsePositiveInt(formData.get("clearHeightMm"));

  const [hall] = await db
    .insert(halls)
    .values({
      organizationId,
      warehouseId,
      name,
      physicalWidthMm: widthMm,
      physicalLengthMm: lengthMm,
      clearHeightMm: clearHeightMm ?? 12_000,
    })
    .returning({ hallId: halls.hallId });

  revalidateLayout(warehouseId);
  redirect(
    `/dashboard/warehouses/${warehouseId}/layout-designer?hall=${hall.hallId}`,
  );
}

// ---------------------------------------------------------------------------
// Zone types
// ---------------------------------------------------------------------------

export async function createZoneType(
  formData: FormData,
): Promise<ActionResult> {
  const warehouseId = parsePositiveInt(formData.get("warehouseId"));
  if (!warehouseId) return { error: "Missing warehouse." };

  try {
    await requireLayoutContext(warehouseId);
  } catch (err) {
    return { error: (err as Error).message };
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Zone name is required." };

  try {
    await db.insert(zoneTypes).values({
      warehouseId,
      name,
      isPickable: formData.get("isPickable") === "on",
      isTemperatureControlled: formData.get("isTemperatureControlled") === "on",
      requiresHazmatClearance: formData.get("requiresHazmatClearance") === "on",
      requiresBarcodeScan: formData.get("requiresBarcodeScan") === "on",
      storagePermanence: String(
        formData.get("storagePermanence") ?? "PERMANENT",
      ),
    });
  } catch {
    return { error: "A zone with that name already exists in this warehouse." };
  }

  revalidateLayout(warehouseId);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export async function createLocation(
  formData: FormData,
): Promise<ActionResult> {
  const warehouseId = parsePositiveInt(formData.get("warehouseId"));
  const hallId = parsePositiveInt(formData.get("hallId"));
  if (!warehouseId || !hallId) return { error: "Missing warehouse or hall." };

  try {
    await requireLayoutContext(warehouseId);
  } catch (err) {
    return { error: (err as Error).message };
  }

  const locationCode = String(formData.get("locationCode") ?? "").trim();
  if (!locationCode) return { error: "Location code is required." };

  const zoneId = parsePositiveInt(formData.get("zoneId"));
  const physicalX = parseNonNegativeInt(formData.get("physicalX"));
  const physicalY = parseNonNegativeInt(formData.get("physicalY"));
  const physicalWidthMm = parsePositiveInt(formData.get("physicalWidthMm"));
  const physicalLengthMm = parsePositiveInt(formData.get("physicalLengthMm"));

  if (
    physicalX === null ||
    physicalY === null ||
    !physicalWidthMm ||
    !physicalLengthMm
  ) {
    return {
      error: "Location geometry is invalid -- redraw it on the canvas.",
    };
  }

  const aisle = parseNullableInt(formData.get("aisle"));
  const bay = parseNullableInt(formData.get("bay"));
  const level = parseNullableInt(formData.get("level"));
  const heightMm = parseNullableInt(formData.get("heightMm"));
  const maxWeightKg = parseNullableInt(formData.get("maxWeightKg"));
  const floorLevel = parsePositiveInt(formData.get("floorLevel")) ?? 1;

  if ([aisle, bay, level, heightMm, maxWeightKg].some((v) => Number.isNaN(v))) {
    return {
      error: "Aisle, bay, level, height, and max weight must be whole numbers.",
    };
  }

  if (!(await hallBelongsToWarehouse(hallId, warehouseId))) {
    return { error: "Selected hall does not belong to this warehouse." };
  }
  if (zoneId !== null && !(await zoneBelongsToWarehouse(zoneId, warehouseId))) {
    return { error: "Selected zone does not belong to this warehouse." };
  }

  try {
    await db.insert(locations).values({
      warehouseId,
      hallId,
      zoneId,
      locationCode,
      aisle,
      bay,
      level,
      heightMm,
      maxWeightKg,
      floorLevel,
      physicalX,
      physicalY,
      physicalWidthMm,
      physicalLengthMm,
      rotationDegrees: 0,
    });
  } catch {
    return { error: `Location code "${locationCode}" is already in use.` };
  }

  revalidateLayout(warehouseId);
  return { success: true };
}

export async function updateLocationDetails(
  formData: FormData,
): Promise<ActionResult> {
  const warehouseId = parsePositiveInt(formData.get("warehouseId"));
  const locationId = parsePositiveInt(formData.get("locationId"));
  if (!warehouseId || !locationId)
    return { error: "Missing warehouse or location." };

  try {
    await requireLayoutContext(warehouseId);
  } catch (err) {
    return { error: (err as Error).message };
  }

  const locationCode = String(formData.get("locationCode") ?? "").trim();
  if (!locationCode) return { error: "Location code is required." };

  const zoneId = parsePositiveInt(formData.get("zoneId"));
  const aisle = parseNullableInt(formData.get("aisle"));
  const bay = parseNullableInt(formData.get("bay"));
  const level = parseNullableInt(formData.get("level"));
  const heightMm = parseNullableInt(formData.get("heightMm"));
  const maxWeightKg = parseNullableInt(formData.get("maxWeightKg"));
  const isBlocked = formData.get("isBlocked") === "on";

  if ([aisle, bay, level, heightMm, maxWeightKg].some((v) => Number.isNaN(v))) {
    return {
      error: "Aisle, bay, level, height, and max weight must be whole numbers.",
    };
  }

  if (zoneId !== null && !(await zoneBelongsToWarehouse(zoneId, warehouseId))) {
    return { error: "Selected zone does not belong to this warehouse." };
  }

  try {
    await db
      .update(locations)
      .set({
        locationCode,
        zoneId,
        aisle,
        bay,
        level,
        heightMm,
        maxWeightKg,
        isBlocked,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(locations.locationId, locationId),
          eq(locations.warehouseId, warehouseId),
        ),
      );
  } catch {
    return { error: `Location code "${locationCode}" is already in use.` };
  }

  revalidateLayout(warehouseId);
  return { success: true };
}

// Called after a drag/resize/rotate ends on the canvas -- no form involved,
// so it takes a plain typed argument instead of FormData.
export async function updateLocationGeometry(
  warehouseId: number,
  locationId: number,
  geometry: {
    physicalX: number;
    physicalY: number;
    physicalWidthMm: number;
    physicalLengthMm: number;
    rotationDegrees: number;
  },
): Promise<ActionResult> {
  try {
    await requireLayoutContext(warehouseId);
  } catch (err) {
    return { error: (err as Error).message };
  }

  const normalizedRotation =
    ((Math.round(geometry.rotationDegrees) % 360) + 360) % 360;

  await db
    .update(locations)
    .set({
      physicalX: Math.max(0, Math.round(geometry.physicalX)),
      physicalY: Math.max(0, Math.round(geometry.physicalY)),
      physicalWidthMm: Math.max(1, Math.round(geometry.physicalWidthMm)),
      physicalLengthMm: Math.max(1, Math.round(geometry.physicalLengthMm)),
      rotationDegrees: normalizedRotation,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(locations.locationId, locationId),
        eq(locations.warehouseId, warehouseId),
      ),
    );

  revalidateLayout(warehouseId);
  return { success: true };
}

export async function deleteLocation(
  formData: FormData,
): Promise<ActionResult> {
  const warehouseId = parsePositiveInt(formData.get("warehouseId"));
  const locationId = parsePositiveInt(formData.get("locationId"));
  if (!warehouseId || !locationId)
    return { error: "Missing warehouse or location." };

  try {
    await requireLayoutContext(warehouseId);
  } catch (err) {
    return { error: (err as Error).message };
  }

  await db
    .delete(locations)
    .where(
      and(
        eq(locations.locationId, locationId),
        eq(locations.warehouseId, warehouseId),
      ),
    );

  revalidateLayout(warehouseId);
  return { success: true };
}

async function hallBelongsToWarehouse(hallId: number, warehouseId: number) {
  const [row] = await db
    .select({ hallId: halls.hallId })
    .from(halls)
    .where(and(eq(halls.hallId, hallId), eq(halls.warehouseId, warehouseId)))
    .limit(1);
  return Boolean(row);
}

async function zoneBelongsToWarehouse(zoneId: number, warehouseId: number) {
  const [row] = await db
    .select({ zoneId: zoneTypes.zoneId })
    .from(zoneTypes)
    .where(
      and(eq(zoneTypes.zoneId, zoneId), eq(zoneTypes.warehouseId, warehouseId)),
    )
    .limit(1);
  return Boolean(row);
}
