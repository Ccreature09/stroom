"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  employees,
  layoutFeatures,
  locations,
  positionTypes,
  halls,
  warehouses,
  zoneTypes,
} from "@/drizzle/schema";
import { createClient } from "@/lib/server";
import {
  parseLocationType,
  renderLocationTemplate,
  validateTemplate,
  type LocationType,
} from "./naming";
import { validateAttrs } from "./feature-kinds";
import {
  computeEnvelope,
  normalizeRotation,
  sanitizePoints,
  type GeometryKind,
} from "./geometry";
import type { FeaturePatch, HallState, NewFeatureDraft } from "./types";

type ActionResult = { error?: string; success?: true };

function parsePositiveInt(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const parsed = Number(String(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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

  if (!warehouse) redirect("/warehouses");

  return { organizationId: employee.organizationId };
}

function revalidateLayout(warehouseId: number) {
  revalidatePath(`/warehouses/${warehouseId}/layout-designer`);
}

// ---------------------------------------------------------------------------
// Halls
// ---------------------------------------------------------------------------

export async function createHall(formData: FormData) {
  const warehouseId = parsePositiveInt(formData.get("warehouseId"));
  if (!warehouseId) redirect("/warehouses");

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
    `/warehouses/${warehouseId}/layout-designer?hall=${hall.hallId}`,
  );
}

const GEOMETRY_KINDS: readonly GeometryKind[] = [
  "RECT",
  "POLYGON",
  "POLYLINE",
  "POINT",
  "CIRCLE",
];

/**
 * Turns a client-side new-feature draft into a row. Everything derived --
 * envelope, rotation range, rounding -- is computed here rather than trusted
 * from the payload, and attrs are validated against the kind's spec because a
 * jsonb column enforces nothing on its own.
 */
function buildFeatureInsert(
  draft: NewFeatureDraft,
  organizationId: number,
  warehouseId: number,
  hallId: number,
  remapZoneId: (zoneId: number | null | undefined) => number | null,
) {
  const kind = String(draft.kind ?? "").trim();
  if (!kind) throw new Error("A new map feature is missing its kind.");

  const geometryKind = draft.geometryKind;
  if (!GEOMETRY_KINDS.includes(geometryKind)) {
    throw new Error(`Feature "${kind}" has an unknown geometry kind.`);
  }

  const geometry = {
    geometryKind,
    originXMm: Math.round(draft.originXMm ?? 0),
    originYMm: Math.round(draft.originYMm ?? 0),
    widthMm: Math.max(0, Math.round(draft.widthMm ?? 0)),
    lengthMm: Math.max(0, Math.round(draft.lengthMm ?? 0)),
    rotationDegrees: normalizeRotation(draft.rotationDegrees ?? 0),
    points: sanitizePoints(draft.points),
  };

  if (
    (geometryKind === "POLYGON" || geometryKind === "POLYLINE") &&
    (!geometry.points || geometry.points.length < 2)
  ) {
    throw new Error(`Feature "${kind}" needs at least two points.`);
  }

  const validated = validateAttrs(kind, draft.attrs);
  if (!validated.ok) throw new Error(validated.error);

  const envelope = computeEnvelope(geometry);

  return {
    organizationId,
    warehouseId,
    hallId,
    floorLevel: Math.max(1, Math.round(draft.floorLevel ?? 1)),
    kind,
    geometryKind,
    originXMm: geometry.originXMm,
    originYMm: geometry.originYMm,
    widthMm: geometry.widthMm,
    lengthMm: geometry.lengthMm,
    rotationDegrees: geometry.rotationDegrees,
    points: geometry.points,
    envelopeMinXMm: envelope.minX,
    envelopeMinYMm: envelope.minY,
    envelopeMaxXMm: envelope.maxX,
    envelopeMaxYMm: envelope.maxY,
    elevationMm: Math.round(draft.elevationMm ?? 0),
    heightMm:
      draft.heightMm == null ? null : Math.max(0, Math.round(draft.heightMm)),
    layerIndex: Math.round(draft.layerIndex ?? 0),
    isObstacle: draft.isObstacle ?? true,
    isVisualOnly: draft.isVisualOnly ?? false,
    zoneId: remapZoneId(draft.zoneId),
    label: draft.label?.trim() || null,
    color: draft.color ?? null,
    attrs: validated.value,
  };
}

// ---------------------------------------------------------------------------
// Draft engine commit ("Save Map") -- the only place client-staged hall,
// location, and zone drafts ever turn into database mutations. Everything
// else in the layout designer (dragging, resizing, editing fields, creating
// or deleting locations/zones) only touches the in-memory draft store in
// layout-designer.tsx until this runs.
// ---------------------------------------------------------------------------

export async function commitHallStates(
  warehouseId: number,
  states: Record<number, HallState>,
): Promise<ActionResult> {
  let organizationId: number;
  try {
    ({ organizationId } = await requireLayoutContext(warehouseId));
  } catch (err) {
    return { error: (err as Error).message };
  }

  const hallIds = Object.keys(states).map(Number);
  if (hallIds.length === 0) return { success: true };

  const owned = await db
    .select({ hallId: halls.hallId })
    .from(halls)
    .where(
      and(inArray(halls.hallId, hallIds), eq(halls.warehouseId, warehouseId)),
    );
  const ownedHallIds = new Set(owned.map((h) => h.hallId));
  for (const hallId of hallIds) {
    if (!ownedHallIds.has(hallId)) {
      return { error: "One of the halls being saved does not exist." };
    }
  }

  try {
    await db.transaction(async (tx) => {
      for (const [hallIdStr, state] of Object.entries(states)) {
        const hallId = Number(hallIdStr);

        // 1. New zones first -- locations created/edited in this same batch
        // may reference one of them by temp id.
        const tempZoneIdToReal = new Map<number, number>();
        for (const zoneDraft of state.newZones) {
          const { tempId, ...patch } = zoneDraft;
          const name = patch.name?.trim();
          if (!name) throw new Error("A new zone is missing a name.");
          const [inserted] = await tx
            .insert(zoneTypes)
            .values({
              warehouseId,
              name,
              isPickable: patch.isPickable ?? true,
              isTemperatureControlled: patch.isTemperatureControlled ?? false,
              requiresHazmatClearance: patch.requiresHazmatClearance ?? false,
              requiresBarcodeScan: patch.requiresBarcodeScan ?? true,
              storagePermanence: patch.storagePermanence ?? "PERMANENT",
              color: patch.color ?? null,
            })
            .returning({ zoneId: zoneTypes.zoneId });
          tempZoneIdToReal.set(tempId, inserted.zoneId);
        }

        const remapZoneId = (
          zoneId: number | null | undefined,
        ): number | null => {
          if (zoneId == null) return null;
          if (zoneId < 0) return tempZoneIdToReal.get(zoneId) ?? null;
          return zoneId;
        };

        // 2. Zone patches (existing rows).
        for (const [zoneIdStr, patch] of Object.entries(state.zonePatches)) {
          const zoneId = Number(zoneIdStr);
          await tx
            .update(zoneTypes)
            .set({
              ...(patch.name !== undefined && { name: patch.name }),
              ...(patch.isPickable !== undefined && {
                isPickable: patch.isPickable,
              }),
              ...(patch.isTemperatureControlled !== undefined && {
                isTemperatureControlled: patch.isTemperatureControlled,
              }),
              ...(patch.requiresHazmatClearance !== undefined && {
                requiresHazmatClearance: patch.requiresHazmatClearance,
              }),
              ...(patch.requiresBarcodeScan !== undefined && {
                requiresBarcodeScan: patch.requiresBarcodeScan,
              }),
              ...(patch.storagePermanence !== undefined && {
                storagePermanence: patch.storagePermanence,
              }),
              ...(patch.color !== undefined && { color: patch.color }),
            })
            .where(
              and(
                eq(zoneTypes.zoneId, zoneId),
                eq(zoneTypes.warehouseId, warehouseId),
              ),
            );
        }

        // 3. Zone deletes.
        if (state.deletedZoneIds.length > 0) {
          await tx
            .delete(zoneTypes)
            .where(
              and(
                inArray(zoneTypes.zoneId, state.deletedZoneIds),
                eq(zoneTypes.warehouseId, warehouseId),
              ),
            );
        }

        // 4. New locations (zoneId remapped through the temp-zone map above).
        for (const locDraft of state.newLocations) {
          const locationCode = locDraft.locationCode?.trim();
          if (!locationCode) {
            throw new Error("A new location is missing a code.");
          }
          if (
            locDraft.physicalWidthMm === undefined ||
            locDraft.physicalLengthMm === undefined ||
            locDraft.physicalX === undefined ||
            locDraft.physicalY === undefined
          ) {
            throw new Error(
              `Location "${locationCode}" is missing geometry.`,
            );
          }
          await tx.insert(locations).values({
            warehouseId,
            hallId,
            zoneId: remapZoneId(locDraft.zoneId),
            locationCode,
            aisle: locDraft.aisle ?? null,
            bay: locDraft.bay ?? null,
            level: locDraft.level ?? null,
            row: locDraft.row ?? null,
            locationType: parseLocationType(locDraft.locationType),
            heightMm: locDraft.heightMm ?? null,
            maxWeightKg: locDraft.maxWeightKg ?? null,
            isBlocked: locDraft.isBlocked ?? false,
            floorLevel: locDraft.floorLevel ?? 1,
            physicalX: Math.max(0, Math.round(locDraft.physicalX)),
            physicalY: Math.max(0, Math.round(locDraft.physicalY)),
            physicalWidthMm: Math.max(1, Math.round(locDraft.physicalWidthMm)),
            physicalLengthMm: Math.max(
              1,
              Math.round(locDraft.physicalLengthMm),
            ),
            rotationDegrees:
              ((Math.round(locDraft.rotationDegrees ?? 0) % 360) + 360) % 360,
          });
        }

        // 5. Location patches (existing rows).
        for (const [locationIdStr, patch] of Object.entries(
          state.locationPatches,
        )) {
          const locationId = Number(locationIdStr);
          const rotationUpdate =
            patch.rotationDegrees !== undefined
              ? ((Math.round(patch.rotationDegrees) % 360) + 360) % 360
              : undefined;
          await tx
            .update(locations)
            .set({
              ...(patch.locationCode !== undefined && {
                locationCode: patch.locationCode,
              }),
              ...(patch.zoneId !== undefined && {
                zoneId: remapZoneId(patch.zoneId),
              }),
              ...(patch.aisle !== undefined && { aisle: patch.aisle }),
              ...(patch.bay !== undefined && { bay: patch.bay }),
              ...(patch.level !== undefined && { level: patch.level }),
              ...(patch.row !== undefined && { row: patch.row }),
              ...(patch.locationType !== undefined && {
                locationType: parseLocationType(patch.locationType),
              }),
              ...(patch.heightMm !== undefined && { heightMm: patch.heightMm }),
              ...(patch.maxWeightKg !== undefined && {
                maxWeightKg: patch.maxWeightKg,
              }),
              ...(patch.isBlocked !== undefined && {
                isBlocked: patch.isBlocked,
              }),
              ...(patch.floorLevel !== undefined && {
                floorLevel: patch.floorLevel,
              }),
              ...(patch.physicalX !== undefined && {
                physicalX: Math.max(0, Math.round(patch.physicalX)),
              }),
              ...(patch.physicalY !== undefined && {
                physicalY: Math.max(0, Math.round(patch.physicalY)),
              }),
              ...(patch.physicalWidthMm !== undefined && {
                physicalWidthMm: Math.max(
                  1,
                  Math.round(patch.physicalWidthMm),
                ),
              }),
              ...(patch.physicalLengthMm !== undefined && {
                physicalLengthMm: Math.max(
                  1,
                  Math.round(patch.physicalLengthMm),
                ),
              }),
              ...(rotationUpdate !== undefined && {
                rotationDegrees: rotationUpdate,
              }),
              updatedAt: new Date().toISOString(),
            })
            .where(
              and(
                eq(locations.locationId, locationId),
                eq(locations.warehouseId, warehouseId),
              ),
            );
        }

        // 6. Location deletes.
        if (state.deletedLocationIds.length > 0) {
          await tx
            .delete(locations)
            .where(
              and(
                inArray(locations.locationId, state.deletedLocationIds),
                eq(locations.warehouseId, warehouseId),
              ),
            );
        }

        // 7. New layout features. Geometry is re-derived server-side: the
        // envelope is never taken from the client, since it is what spatial
        // queries index and a wrong one silently breaks containment tests.
        for (const featureDraft of state.newFeatures ?? []) {
          const values = buildFeatureInsert(
            featureDraft,
            organizationId,
            warehouseId,
            hallId,
            remapZoneId,
          );
          await tx.insert(layoutFeatures).values(values);
        }

        // 8. Feature patches. A patch is partial, but the envelope depends on
        // every geometry field at once, so the current row is read back and
        // merged before recomputing it.
        for (const [featureIdStr, patch] of Object.entries(
          state.featurePatches ?? {},
        )) {
          const featureId = Number(featureIdStr);
          const [existing] = await tx
            .select({
              kind: layoutFeatures.kind,
              geometryKind: layoutFeatures.geometryKind,
              originXMm: layoutFeatures.originXMm,
              originYMm: layoutFeatures.originYMm,
              widthMm: layoutFeatures.widthMm,
              lengthMm: layoutFeatures.lengthMm,
              rotationDegrees: layoutFeatures.rotationDegrees,
              points: layoutFeatures.points,
            })
            .from(layoutFeatures)
            .where(
              and(
                eq(layoutFeatures.featureId, featureId),
                eq(layoutFeatures.warehouseId, warehouseId),
                eq(layoutFeatures.hallId, hallId),
              ),
            )
            .limit(1);
          if (!existing) continue;

          const geometry = {
            geometryKind: existing.geometryKind as GeometryKind,
            originXMm: patch.originXMm ?? existing.originXMm,
            originYMm: patch.originYMm ?? existing.originYMm,
            widthMm: patch.widthMm ?? existing.widthMm,
            lengthMm: patch.lengthMm ?? existing.lengthMm,
            rotationDegrees: normalizeRotation(
              patch.rotationDegrees ?? existing.rotationDegrees,
            ),
            points:
              patch.points !== undefined
                ? sanitizePoints(patch.points)
                : sanitizePoints(existing.points),
          };
          const envelope = computeEnvelope(geometry);

          let attrs: FeaturePatch["attrs"];
          if (patch.attrs !== undefined) {
            const validated = validateAttrs(existing.kind, patch.attrs);
            if (!validated.ok) throw new Error(validated.error);
            attrs = validated.value;
          }

          await tx
            .update(layoutFeatures)
            .set({
              originXMm: Math.round(geometry.originXMm),
              originYMm: Math.round(geometry.originYMm),
              widthMm: Math.max(0, Math.round(geometry.widthMm)),
              lengthMm: Math.max(0, Math.round(geometry.lengthMm)),
              rotationDegrees: geometry.rotationDegrees,
              points: geometry.points,
              envelopeMinXMm: envelope.minX,
              envelopeMinYMm: envelope.minY,
              envelopeMaxXMm: envelope.maxX,
              envelopeMaxYMm: envelope.maxY,
              ...(patch.floorLevel !== undefined && {
                floorLevel: Math.max(1, Math.round(patch.floorLevel)),
              }),
              ...(patch.elevationMm !== undefined && {
                elevationMm: Math.round(patch.elevationMm),
              }),
              ...(patch.heightMm !== undefined && {
                heightMm:
                  patch.heightMm === null
                    ? null
                    : Math.max(0, Math.round(patch.heightMm)),
              }),
              ...(patch.layerIndex !== undefined && {
                layerIndex: Math.round(patch.layerIndex),
              }),
              ...(patch.isObstacle !== undefined && {
                isObstacle: patch.isObstacle,
              }),
              ...(patch.isVisualOnly !== undefined && {
                isVisualOnly: patch.isVisualOnly,
              }),
              ...(patch.zoneId !== undefined && {
                zoneId: remapZoneId(patch.zoneId),
              }),
              ...(patch.label !== undefined && {
                label: patch.label?.trim() || null,
              }),
              ...(patch.color !== undefined && { color: patch.color }),
              ...(attrs !== undefined && { attrs }),
              updatedAt: new Date().toISOString(),
            })
            .where(
              and(
                eq(layoutFeatures.featureId, featureId),
                eq(layoutFeatures.warehouseId, warehouseId),
              ),
            );
        }

        // 9. Feature deletes. Features are not referenced by inventory or
        // movement history yet, so a hard delete is still safe here -- once
        // nav edges reference them this must become a soft delete
        // (is_active = false) instead.
        if ((state.deletedFeatureIds ?? []).length > 0) {
          await tx
            .delete(layoutFeatures)
            .where(
              and(
                inArray(layoutFeatures.featureId, state.deletedFeatureIds),
                eq(layoutFeatures.warehouseId, warehouseId),
                eq(layoutFeatures.hallId, hallId),
              ),
            );
        }

        // 10. Hall patch.
        if (Object.keys(state.hallPatch).length > 0) {
          const patch = state.hallPatch;
          await tx
            .update(halls)
            .set({
              ...(patch.physicalWidthMm !== undefined && {
                physicalWidthMm: Math.max(1, Math.round(patch.physicalWidthMm)),
              }),
              ...(patch.physicalLengthMm !== undefined && {
                physicalLengthMm: Math.max(
                  1,
                  Math.round(patch.physicalLengthMm),
                ),
              }),
              ...(patch.clearHeightMm !== undefined && {
                clearHeightMm:
                  patch.clearHeightMm === null
                    ? null
                    : Math.max(1, Math.round(patch.clearHeightMm)),
              }),
              ...(patch.isActive !== undefined && {
                isActive: patch.isActive,
              }),
              updatedAt: new Date().toISOString(),
            })
            .where(eq(halls.hallId, hallId));
        }
      }
    });
  } catch (err) {
    return { error: (err as Error).message || "Failed to save changes." };
  }

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
// Bulk location generation (rackings, floor lines, shelving) -- left as an
// immediate, separately-confirmed action outside the draft engine (per
// product decision): it's already a deliberate, reviewed, atomic operation,
// and staging hundreds of generated rows as drafts would add a lot of
// complexity for little benefit.
// ---------------------------------------------------------------------------

type BulkGeneratorType = "racking" | "floor_line" | "shelving";
type Orientation = "horizontal" | "vertical";
type Axis1DDirection = "forward" | "reverse";

const GENERATOR_TO_LOCATION_TYPE: Record<BulkGeneratorType, LocationType> = {
  racking: "RACKING",
  floor_line: "FLOOR",
  shelving: "SHELF",
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

  // Location codes are unique per warehouse, so skip rows that collide with
  // existing locations in *this* warehouse (e.g. re-running a generator over
  // the same range) instead of failing the whole batch.
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
        locationType,
        physicalX: draft.physicalX,
        physicalY: draft.physicalY,
        physicalWidthMm: draft.physicalWidthMm,
        physicalLengthMm: draft.physicalLengthMm,
        rotationDegrees: 0,
      })),
    )
    .onConflictDoNothing({
      target: [locations.warehouseId, locations.locationCode],
    })
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
