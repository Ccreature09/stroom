"use server";

import { and, eq, inArray } from "drizzle-orm";
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
import {
  locationTypeFlagsFor,
  readLocationTypeFlag,
  renderLocationTemplate,
  validateTemplate,
} from "./naming";

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
// Locations (manual create/edit)
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
  const row = parseNullableInt(formData.get("row"));
  const heightMm = parseNullableInt(formData.get("heightMm"));
  const maxWeightKg = parseNullableInt(formData.get("maxWeightKg"));
  const floorLevel = parsePositiveInt(formData.get("floorLevel")) ?? 1;

  if (
    [aisle, bay, level, row, heightMm, maxWeightKg].some((v) => Number.isNaN(v))
  ) {
    return {
      error:
        "Aisle, row, bay, level, height, and max weight must be whole numbers.",
    };
  }

  // Manual creation: user picks which single type flag is true; defaults to
  // all-false ("none") if nothing was selected.
  const typeFlag = readLocationTypeFlag(formData);
  const typeFlags = locationTypeFlagsFor(typeFlag);

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
      row,
      ...typeFlags,
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
  const row = parseNullableInt(formData.get("row"));
  const heightMm = parseNullableInt(formData.get("heightMm"));
  const maxWeightKg = parseNullableInt(formData.get("maxWeightKg"));
  const isBlocked = formData.get("isBlocked") === "on";

  if (
    [aisle, bay, level, row, heightMm, maxWeightKg].some((v) => Number.isNaN(v))
  ) {
    return {
      error:
        "Aisle, row, bay, level, height, and max weight must be whole numbers.",
    };
  }

  const typeFlag = readLocationTypeFlag(formData);
  const typeFlags = locationTypeFlagsFor(typeFlag);

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
        row,
        ...typeFlags,
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

// ---------------------------------------------------------------------------
// Multi-select group actions (drag-select move/delete)
// ---------------------------------------------------------------------------

// Groups (Zone + Location Type) and drag-selected sets both resolve to a
// plain list of location ids client-side (see groupKeyFor / locationIdsInGroup
// in ./types.ts) -- these actions operate on whatever ids the caller passes,
// whether that's a drag-selection or every member of a computed group.

export async function moveLocations(
  warehouseId: number,
  locationIds: number[],
  deltaX: number,
  deltaY: number,
): Promise<ActionResult> {
  try {
    await requireLayoutContext(warehouseId);
  } catch (err) {
    return { error: (err as Error).message };
  }
  if (locationIds.length === 0) return { error: "No locations selected." };

  const rows = await db
    .select({
      locationId: locations.locationId,
      physicalX: locations.physicalX,
      physicalY: locations.physicalY,
    })
    .from(locations)
    .where(
      and(
        inArray(locations.locationId, locationIds),
        eq(locations.warehouseId, warehouseId),
      ),
    );

  if (rows.length === 0) return { error: "Selected locations were not found." };

  await db.transaction(async (tx) => {
    for (const row of rows) {
      await tx
        .update(locations)
        .set({
          physicalX: Math.max(0, Math.round(row.physicalX + deltaX)),
          physicalY: Math.max(0, Math.round(row.physicalY + deltaY)),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(locations.locationId, row.locationId));
    }
  });

  revalidateLayout(warehouseId);
  return { success: true };
}

export async function deleteLocations(
  warehouseId: number,
  locationIds: number[],
): Promise<ActionResult> {
  try {
    await requireLayoutContext(warehouseId);
  } catch (err) {
    return { error: (err as Error).message };
  }
  if (locationIds.length === 0) return { error: "No locations selected." };

  await db
    .delete(locations)
    .where(
      and(
        inArray(locations.locationId, locationIds),
        eq(locations.warehouseId, warehouseId),
      ),
    );

  revalidateLayout(warehouseId);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Shared lookups
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Bulk location generation (rackings, floor lines, shelving)
// ---------------------------------------------------------------------------

type BulkGeneratorType = "racking" | "floor_line" | "shelving";
type Orientation = "horizontal" | "vertical";
type Axis1DDirection = "forward" | "reverse";

const GENERATOR_TO_LOCATION_TYPE: Record<
  BulkGeneratorType,
  "racking" | "shelf" | "floor"
> = {
  racking: "racking",
  floor_line: "floor",
  shelving: "shelf",
};

const DEFAULT_TEMPLATES: Record<BulkGeneratorType, string> = {
  racking: "{Aisle:letter}-{Bay:number}-{Level:number}",
  floor_line: "{Bay:number}",
  shelving: "{Bay:number}-{Level:number}",
};

// 1 Row groups every 4 bays within an aisle, and is optional -- only relevant
// to racking. Rows are a labeling/grouping convenience, not a physical change.
const BAYS_PER_ROW = 4;
function rowForBayIndex(
  bayIndexZeroBased: number,
  useRows: boolean,
): number | null {
  if (!useRows) return null;
  return Math.floor(bayIndexZeroBased / BAYS_PER_ROW) + 1;
}

type BulkLocationDraft = {
  locationCode: string;
  zoneId: number | null;
  aisle: number | null;
  bay: number | null;
  level: number | null;
  row: number | null;
  physicalX: number;
  physicalY: number;
  physicalWidthMm: number;
  physicalLengthMm: number;
};

function padNumber(value: number, width: number) {
  return String(value).padStart(width, "0");
}

function readRequiredPositiveInt(
  formData: FormData,
  key: string,
): number | null {
  const raw = formData.get(key);
  if (raw === null || String(raw).trim() === "") return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function readOptionalPositiveInt(
  formData: FormData,
  key: string,
  fallback: number,
): number | null {
  const raw = formData.get(key);
  if (raw === null || String(raw).trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function readOptionalNonNegativeInt(
  formData: FormData,
  key: string,
  fallback: number,
): number | null {
  const raw = formData.get(key);
  if (raw === null || String(raw).trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Racking is a true 2D grid (aisle x bay), so it gets full independent
 * horizontal/vertical directional numbering, per spec. Physical placement on
 * the canvas always proceeds top-to-bottom / left-to-right; only the
 * *numbers* assigned to each bay/aisle are reversed when a direction is
 * flipped, so "RTL" racking still occupies the same physical footprint,
 * just numbered from the other end.
 */
function buildRackingLocations(params: {
  template: string;
  aisleCount: number;
  aisleStart: number;
  bayCount: number;
  bayStart: number;
  levelCount: number;
  levelStart: number;
  bayWidthMm: number;
  bayDepthMm: number;
  aisleGapMm: number;
  bayGapMm: number;
  startX: number;
  startY: number;
  horizontalDirection: "ltr" | "rtl";
  verticalDirection: "utd" | "dtu";
  useRows: boolean;
  zoneId: number | null;
}): BulkLocationDraft[] {
  const drafts: BulkLocationDraft[] = [];

  for (let i = 0; i < params.aisleCount; i++) {
    const aisleIndexForNumber =
      params.verticalDirection === "utd" ? i : params.aisleCount - 1 - i;
    const aisleNum = params.aisleStart + aisleIndexForNumber;

    const y = params.startY + i * (params.bayDepthMm + params.aisleGapMm);

    for (let j = 0; j < params.bayCount; j++) {
      const bayIndexForNumber =
        params.horizontalDirection === "ltr" ? j : params.bayCount - 1 - j;
      const bayNum = params.bayStart + bayIndexForNumber;
      const rowNum = rowForBayIndex(bayIndexForNumber, params.useRows);

      const x = params.startX + j * (params.bayWidthMm + params.bayGapMm);

      for (let k = 0; k < params.levelCount; k++) {
        const levelNum = params.levelStart + k;
        drafts.push({
          locationCode: renderLocationTemplate(params.template, {
            aisle: aisleNum,
            row: rowNum,
            bay: bayNum,
            level: levelNum,
          }),
          zoneId: params.zoneId,
          aisle: aisleNum,
          bay: bayNum,
          level: levelNum,
          row: rowNum,
          physicalX: Math.round(x),
          physicalY: Math.round(y),
          physicalWidthMm: Math.round(params.bayWidthMm),
          physicalLengthMm: Math.round(params.bayDepthMm),
        });
      }
    }
  }
  return drafts;
}

/**
 * Floor lines and shelving are single-axis layouts (one row of slots/bays),
 * so rather than two independent axes we expose one "sequenceDirection"
 * toggle: forward numbers from the start point, reverse numbers from the
 * far end. This is a deliberate simplification of the general 2-axis
 * direction control, since there is no second axis to reverse here.
 */
function buildFloorLineLocations(params: {
  template: string;
  slotCount: number;
  slotStart: number;
  slotWidthMm: number;
  slotDepthMm: number;
  gapMm: number;
  startX: number;
  startY: number;
  orientation: Orientation;
  sequenceDirection: Axis1DDirection;
  zoneId: number | null;
}): BulkLocationDraft[] {
  const drafts: BulkLocationDraft[] = [];
  for (let s = 0; s < params.slotCount; s++) {
    const slotIndexForNumber =
      params.sequenceDirection === "forward" ? s : params.slotCount - 1 - s;
    const slotNum = params.slotStart + slotIndexForNumber;

    const x =
      params.orientation === "horizontal"
        ? params.startX + s * (params.slotWidthMm + params.gapMm)
        : params.startX;
    const y =
      params.orientation === "horizontal"
        ? params.startY
        : params.startY + s * (params.slotDepthMm + params.gapMm);

    drafts.push({
      locationCode: renderLocationTemplate(params.template, {
        aisle: null,
        row: null,
        bay: slotNum,
        level: null,
      }),
      zoneId: params.zoneId,
      aisle: null,
      bay: slotNum,
      level: null,
      row: null,
      physicalX: Math.round(x),
      physicalY: Math.round(y),
      physicalWidthMm: Math.round(params.slotWidthMm),
      physicalLengthMm: Math.round(params.slotDepthMm),
    });
  }
  return drafts;
}

function buildShelvingLocations(params: {
  template: string;
  bayCount: number;
  bayStart: number;
  levelCount: number;
  levelStart: number;
  bayWidthMm: number;
  bayDepthMm: number;
  bayGapMm: number;
  startX: number;
  startY: number;
  orientation: Orientation;
  sequenceDirection: Axis1DDirection;
  zoneId: number | null;
}): BulkLocationDraft[] {
  const drafts: BulkLocationDraft[] = [];
  for (let j = 0; j < params.bayCount; j++) {
    const bayIndexForNumber =
      params.sequenceDirection === "forward" ? j : params.bayCount - 1 - j;
    const bayNum = params.bayStart + bayIndexForNumber;

    let x: number, y: number, width: number, length: number;
    if (params.orientation === "horizontal") {
      x = params.startX + j * (params.bayWidthMm + params.bayGapMm);
      y = params.startY;
      width = params.bayWidthMm;
      length = params.bayDepthMm;
    } else {
      x = params.startX;
      y = params.startY + j * (params.bayWidthMm + params.bayGapMm);
      width = params.bayDepthMm;
      length = params.bayWidthMm;
    }

    for (let k = 0; k < params.levelCount; k++) {
      const levelNum = params.levelStart + k;
      drafts.push({
        locationCode: renderLocationTemplate(params.template, {
          aisle: null,
          row: null,
          bay: bayNum,
          level: levelNum,
        }),
        zoneId: params.zoneId,
        aisle: null,
        bay: bayNum,
        level: levelNum,
        row: null,
        physicalX: Math.round(x),
        physicalY: Math.round(y),
        physicalWidthMm: Math.round(width),
        physicalLengthMm: Math.round(length),
      });
    }
  }
  return drafts;
}

export type BulkGenerateResult = {
  error?: string;
  success?: true;
  created?: number;
  skipped?: number;
  total?: number;
};

export async function bulkGenerateLocations(
  formData: FormData,
): Promise<BulkGenerateResult> {
  const warehouseId = parsePositiveInt(formData.get("warehouseId"));
  const hallId = parsePositiveInt(formData.get("hallId"));
  if (!warehouseId || !hallId) return { error: "Missing warehouse or hall." };

  try {
    await requireLayoutContext(warehouseId);
  } catch (err) {
    return { error: (err as Error).message };
  }

  if (!(await hallBelongsToWarehouse(hallId, warehouseId))) {
    return { error: "Selected hall does not belong to this warehouse." };
  }

  const generatorType = String(
    formData.get("generatorType") ?? "",
  ) as BulkGeneratorType;
  const locationType = GENERATOR_TO_LOCATION_TYPE[generatorType];
  if (!locationType) return { error: "Unknown generator type." };

  const templateInput = String(formData.get("template") ?? "").trim();
  const template = templateInput || DEFAULT_TEMPLATES[generatorType];
  const templateError = validateTemplate(template);
  if (templateError) return { error: templateError };

  const zoneId = parsePositiveInt(formData.get("zoneId"));
  if (zoneId !== null && !(await zoneBelongsToWarehouse(zoneId, warehouseId))) {
    return { error: "Selected zone does not belong to this warehouse." };
  }

  const orientation: Orientation =
    formData.get("orientation") === "vertical" ? "vertical" : "horizontal";

  const startX = readOptionalNonNegativeInt(formData, "startX", 0);
  const startY = readOptionalNonNegativeInt(formData, "startY", 0);
  if (startX === null || startY === null) {
    return { error: "Start X/Y must be whole numbers." };
  }

  let drafts: BulkLocationDraft[] = [];

  if (generatorType === "racking") {
    const aisleCount = readRequiredPositiveInt(formData, "aisleCount");
    const bayCount = readRequiredPositiveInt(formData, "bayCount");
    const levelCount = readRequiredPositiveInt(formData, "levelCount");
    const bayWidthMm = readRequiredPositiveInt(formData, "bayWidthMm");
    const bayDepthMm = readRequiredPositiveInt(formData, "bayDepthMm");
    if (!aisleCount || !bayCount || !levelCount || !bayWidthMm || !bayDepthMm) {
      return {
        error:
          "Aisle count, bay count, level count, and bay dimensions must all be positive whole numbers.",
      };
    }
    const aisleStart = readOptionalPositiveInt(formData, "aisleStart", 1);
    const bayStart = readOptionalPositiveInt(formData, "bayStart", 1);
    const levelStart = readOptionalPositiveInt(formData, "levelStart", 1);
    const aisleGapMm = readOptionalNonNegativeInt(formData, "aisleGapMm", 2000);
    const bayGapMm = readOptionalNonNegativeInt(formData, "bayGapMm", 0);
    if (aisleStart === null || bayStart === null || levelStart === null) {
      return { error: "Start numbers must be positive whole numbers." };
    }
    if (aisleGapMm === null || bayGapMm === null) {
      return { error: "Gap values must be whole numbers." };
    }

    const horizontalDirection =
      formData.get("horizontalDirection") === "rtl" ? "rtl" : "ltr";
    const verticalDirection =
      formData.get("verticalDirection") === "dtu" ? "dtu" : "utd";
    const useRows = formData.get("useRows") === "on";

    drafts = buildRackingLocations({
      template,
      aisleCount,
      aisleStart,
      bayCount,
      bayStart,
      levelCount,
      levelStart,
      bayWidthMm,
      bayDepthMm,
      aisleGapMm,
      bayGapMm,
      startX,
      startY,
      horizontalDirection,
      verticalDirection,
      useRows,
      zoneId,
    });
  } else if (generatorType === "floor_line") {
    const slotCount = readRequiredPositiveInt(formData, "slotCount");
    const slotWidthMm = readRequiredPositiveInt(formData, "slotWidthMm");
    const slotDepthMm = readRequiredPositiveInt(formData, "slotDepthMm");
    if (!slotCount || !slotWidthMm || !slotDepthMm) {
      return {
        error: "Slot count and slot dimensions must be positive whole numbers.",
      };
    }
    const slotStart = readOptionalPositiveInt(formData, "slotStart", 1);
    const gapMm = readOptionalNonNegativeInt(formData, "gapMm", 200);
    if (slotStart === null)
      return { error: "Slot start must be a positive whole number." };
    if (gapMm === null) return { error: "Gap must be a whole number." };

    const sequenceDirection: Axis1DDirection =
      formData.get("sequenceDirection") === "reverse" ? "reverse" : "forward";

    drafts = buildFloorLineLocations({
      template,
      slotCount,
      slotStart,
      slotWidthMm,
      slotDepthMm,
      gapMm,
      startX,
      startY,
      orientation,
      sequenceDirection,
      zoneId,
    });
  } else if (generatorType === "shelving") {
    const bayCount = readRequiredPositiveInt(formData, "bayCount");
    const levelCount = readRequiredPositiveInt(formData, "levelCount");
    const bayWidthMm = readRequiredPositiveInt(formData, "bayWidthMm");
    const bayDepthMm = readRequiredPositiveInt(formData, "bayDepthMm");
    if (!bayCount || !levelCount || !bayWidthMm || !bayDepthMm) {
      return {
        error:
          "Bay count, level count, and shelf dimensions must be positive whole numbers.",
      };
    }
    const bayStart = readOptionalPositiveInt(formData, "bayStart", 1);
    const levelStart = readOptionalPositiveInt(formData, "levelStart", 1);
    const bayGapMm = readOptionalNonNegativeInt(formData, "bayGapMm", 0);
    if (bayStart === null || levelStart === null) {
      return { error: "Start numbers must be positive whole numbers." };
    }
    if (bayGapMm === null) return { error: "Gap must be a whole number." };

    const sequenceDirection: Axis1DDirection =
      formData.get("sequenceDirection") === "reverse" ? "reverse" : "forward";

    drafts = buildShelvingLocations({
      template,
      bayCount,
      bayStart,
      levelCount,
      levelStart,
      bayWidthMm,
      bayDepthMm,
      bayGapMm,
      startX,
      startY,
      orientation,
      sequenceDirection,
      zoneId,
    });
  } else {
    return { error: "Unknown generator type." };
  }

  if (drafts.length === 0) {
    return {
      error: "No locations to generate -- check the counts you entered.",
    };
  }
  if (drafts.length > 2000) {
    return {
      error: `That would generate ${drafts.length} locations in one batch -- please keep batches to 2000 or fewer.`,
    };
  }

  // Guard against duplicate codes colliding within this same batch.
  const seen = new Set<string>();
  for (const draft of drafts) {
    if (!draft.locationCode) {
      return {
        error:
          "The template produced an empty code for at least one location -- check that it includes a tag matching this generator (e.g. {Bay}).",
      };
    }
    if (seen.has(draft.locationCode)) {
      return {
        error: `Generated codes collide (e.g. "${draft.locationCode}"). Adjust the template, start numbers, or prefix.`,
      };
    }
    seen.add(draft.locationCode);
  }

  // Bulk creation: setting one location type automatically sets that flag
  // true and the other two false.
  const typeFlags = locationTypeFlagsFor(locationType);

  // location_code is globally unique, so skip rows that collide with existing
  // locations (e.g. re-running a generator over the same range) instead of
  // failing the whole batch.
  const inserted = await db
    .insert(locations)
    .values(
      drafts.map((draft) => ({
        warehouseId,
        hallId,
        zoneId: draft.zoneId,
        locationCode: draft.locationCode,
        aisle: draft.aisle,
        bay: draft.bay,
        level: draft.level,
        row: draft.row,
        ...typeFlags,
        physicalX: draft.physicalX,
        physicalY: draft.physicalY,
        physicalWidthMm: draft.physicalWidthMm,
        physicalLengthMm: draft.physicalLengthMm,
        rotationDegrees: 0,
      })),
    )
    .onConflictDoNothing({ target: locations.locationCode })
    .returning({ locationId: locations.locationId });

  revalidateLayout(warehouseId);

  const created = inserted.length;
  const skipped = drafts.length - created;

  if (created === 0) {
    return {
      error: `None of the ${drafts.length} location codes could be created -- they already exist. Try a different template, prefix, or start number.`,
    };
  }

  return { success: true, created, skipped, total: drafts.length };
}
