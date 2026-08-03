"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  employees,
  layoutDrafts,
  layoutFeatures,
  layoutVersions,
  locations,
  halls,
} from "@/drizzle/schema";
import {
  LayoutVersionConflictError,
  hallBelongsToWarehouse,
  requireLayoutContext,
  revalidateLayout,
} from "@/lib/warehouse-map/context";
import {
  parseLocationType,
  renderLocationTemplate,
  validateTemplate,
  type LocationType,
} from "@/lib/warehouse-map/naming";
import { validateAttrs } from "@/lib/warehouse-map/feature-kinds";
import {
  computeEnvelope,
  normalizeRotation,
  sanitizePoints,
  type FeatureGeometry,
  type GeometryKind,
} from "@/lib/warehouse-map/geometry";
import { hallStateChangeCount } from "@/lib/warehouse-map/types";
import type { FeaturePatch, HallState, NewFeatureDraft } from "@/lib/warehouse-map/types";

export type PublishConflict = {
  currentVersion: number;
  publishedByName: string | null;
  publishedAt: string | null;
};

export type PublishResult = {
  error?: string;
  success?: true;
  /** Set instead of `error` when the save was built on a stale layout version. */
  conflict?: PublishConflict;
  /** The version number this publish created. */
  versionNumber?: number;
};

function parsePositiveInt(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const parsed = Number(String(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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

// Immediate (not draft-staged) like createHall -- provisioning/removing a
// hall is a distinct, deliberate action, not a routine property edit.
// `locations_hall_id_fkey` is ON DELETE RESTRICT, so this fails with a clear
// error while the hall still has locations; every other hall-scoped table
// (features, nav graph, routes, blockages, underlay, drafts) cascades,
// which the caller should warn about before invoking this.
export async function deleteHall(
  warehouseId: number,
  hallId: number,
): Promise<{ error?: string; success?: true }> {
  try {
    await requireLayoutContext(warehouseId);
  } catch (err) {
    return { error: (err as Error).message };
  }

  try {
    const deleted = await db
      .delete(halls)
      .where(and(eq(halls.hallId, hallId), eq(halls.warehouseId, warehouseId)))
      .returning({ hallId: halls.hallId });

    if (deleted.length === 0) {
      return { error: "Hall not found." };
    }
  } catch {
    return {
      error:
        "This hall still has locations assigned to it -- remove or move them first.",
    };
  }

  revalidateLayout(warehouseId);
  return { success: true };
}

const GEOMETRY_KINDS: readonly GeometryKind[] = [
  "RECT",
  "POLYGON",
  "POLYLINE",
  "POINT",
  "CIRCLE",
];

export type HallBounds = { widthMm: number; lengthMm: number };

/**
 * Clamps an origin so the footprint's envelope lands inside the hall.
 *
 * The canvas clamps as you drag, but that is interaction polish -- this is the
 * copy that decides what gets stored. A draft authored before someone shrank
 * the hall, an older client, or a hand-made payload would all otherwise write
 * geometry straight through the wall, and the compiler would then infer aisles
 * from racking that does not exist in the building.
 *
 * Clamped on the *envelope* rather than (origin, width, length): rotation is
 * about the origin, so a rotated footprint occupies a different rectangle than
 * its nominal one. A footprint bigger than the hall pins to the near edge --
 * the outer Math.max wins when the upper bound falls below the lower one.
 */
function clampOriginToHall(
  geometry: FeatureGeometry,
  bounds: HallBounds,
): { x: number; y: number } {
  const local = computeEnvelope({
    ...geometry,
    originXMm: 0,
    originYMm: 0,
  });
  return {
    x: Math.round(
      Math.max(
        -local.minX,
        Math.min(geometry.originXMm, bounds.widthMm - local.maxX),
      ),
    ),
    y: Math.round(
      Math.max(
        -local.minY,
        Math.min(geometry.originYMm, bounds.lengthMm - local.maxY),
      ),
    ),
  };
}

/** Location geometry in the shape the shared envelope maths expects. */
function locationGeometry(loc: {
  physicalX: number;
  physicalY: number;
  physicalWidthMm: number;
  physicalLengthMm: number;
  rotationDegrees: number;
}): FeatureGeometry {
  return {
    geometryKind: "RECT",
    originXMm: loc.physicalX,
    originYMm: loc.physicalY,
    widthMm: loc.physicalWidthMm,
    lengthMm: loc.physicalLengthMm,
    rotationDegrees: loc.rotationDegrees,
    points: null,
  };
}

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
  bounds: HallBounds,
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

  const origin = clampOriginToHall(geometry, bounds);
  geometry.originXMm = origin.x;
  geometry.originYMm = origin.y;

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
    label: draft.label?.trim() || null,
    color: draft.color ?? null,
    attrs: validated.value,
  };
}

// ---------------------------------------------------------------------------
// Draft engine commit ("Save Map") -- the only place client-staged hall,
// location, and feature drafts ever turn into database mutations. Everything
// else in the layout designer (dragging, resizing, editing fields, creating
// or deleting locations/features) only touches the in-memory draft store in
// layout-designer.tsx until this runs.
// ---------------------------------------------------------------------------

export async function commitHallStates(
  warehouseId: number,
  states: Record<number, HallState>,
  /**
   * The layout version the client had loaded when it built this draft. The
   * publish is rejected if someone else has published since -- last-write-wins
   * on a whole warehouse layout is not a safe default.
   */
  baseVersionNumber: number,
  notes?: string,
): Promise<PublishResult> {
  let organizationId: number;
  let employeeId: number;
  try {
    ({ organizationId, employeeId } = await requireLayoutContext(warehouseId));
  } catch (err) {
    return { error: (err as Error).message };
  }

  const hallIds = Object.keys(states).map(Number);
  if (hallIds.length === 0) return { success: true };

  // Dimensions come back with the ownership check rather than in a second
  // query: every write below has to be clamped against them.
  const owned = await db
    .select({
      hallId: halls.hallId,
      physicalWidthMm: halls.physicalWidthMm,
      physicalLengthMm: halls.physicalLengthMm,
    })
    .from(halls)
    .where(
      and(inArray(halls.hallId, hallIds), eq(halls.warehouseId, warehouseId)),
    );
  const ownedHalls = new Map(owned.map((h) => [h.hallId, h]));
  for (const hallId of hallIds) {
    if (!ownedHalls.has(hallId)) {
      return { error: "One of the halls being saved does not exist." };
    }
  }

  let publishedVersion = 0;
  const totalChanges = Object.values(states).reduce(
    (sum, state) => sum + hallStateChangeCount(state),
    0,
  );

  try {
    await db.transaction(async (tx) => {
      // Optimistic concurrency, checked before any write. The unique key on
      // (warehouse_id, version_number) is what makes this race-safe: if two
      // publishes both read version N and both try to insert N+1, the loser's
      // INSERT fails and its whole transaction rolls back.
      const [current] = await tx
        .select({
          versionNumber: layoutVersions.versionNumber,
          graphEpoch: layoutVersions.graphEpoch,
          publishedAt: layoutVersions.publishedAt,
          firstName: employees.firstName,
          lastName: employees.lastName,
        })
        .from(layoutVersions)
        .leftJoin(
          employees,
          eq(layoutVersions.publishedBy, employees.employeeId),
        )
        .where(eq(layoutVersions.warehouseId, warehouseId))
        .orderBy(desc(layoutVersions.versionNumber))
        .limit(1);

      const currentNumber = current?.versionNumber ?? 0;
      if (currentNumber !== baseVersionNumber) {
        throw new LayoutVersionConflictError({
          currentVersion: currentNumber,
          publishedByName:
            [current?.firstName, current?.lastName]
              .filter(Boolean)
              .join(" ") || null,
          publishedAt: current?.publishedAt ?? null,
        });
      }

      for (const [hallIdStr, state] of Object.entries(states)) {
        const hallId = Number(hallIdStr);

        // Bounds everything in this hall is clamped against. The hall patch is
        // applied last (step 7) but its dimensions are read first, because
        // shrinking a hall and moving a rack in the same save must clamp
        // against the size the hall ends up, not the one it started at.
        const hallRow = ownedHalls.get(hallId)!;
        const bounds: HallBounds = {
          widthMm: Math.max(
            1,
            Math.round(
              state.hallPatch.physicalWidthMm ?? hallRow.physicalWidthMm,
            ),
          ),
          lengthMm: Math.max(
            1,
            Math.round(
              state.hallPatch.physicalLengthMm ?? hallRow.physicalLengthMm,
            ),
          ),
        };

        // 1. New locations.
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
          const geometry = locationGeometry({
            physicalX: Math.round(locDraft.physicalX),
            physicalY: Math.round(locDraft.physicalY),
            physicalWidthMm: Math.max(1, Math.round(locDraft.physicalWidthMm)),
            physicalLengthMm: Math.max(
              1,
              Math.round(locDraft.physicalLengthMm),
            ),
            rotationDegrees:
              ((Math.round(locDraft.rotationDegrees ?? 0) % 360) + 360) % 360,
          });
          const origin = clampOriginToHall(geometry, bounds);

          await tx.insert(locations).values({
            warehouseId,
            hallId,
            locationCode,
            aisle: locDraft.aisle ?? null,
            bay: locDraft.bay ?? null,
            level: locDraft.level ?? null,
            row: locDraft.row ?? null,
            locationType: parseLocationType(locDraft.locationType),
            heightMm: locDraft.heightMm ?? null,
            maxWeightKg: locDraft.maxWeightKg ?? null,
            isBlocked: locDraft.isBlocked ?? false,
            isTemporary: locDraft.isTemporary ?? false,
            floorLevel: locDraft.floorLevel ?? 1,
            physicalX: origin.x,
            physicalY: origin.y,
            physicalWidthMm: geometry.widthMm,
            physicalLengthMm: geometry.lengthMm,
            rotationDegrees: geometry.rotationDegrees,
          });
        }

        // 2. Location patches (existing rows).
        //
        // A patch is partial but the bounds check needs the whole footprint --
        // a pure move carries no width, a pure rotate carries no origin. One
        // batched read gets every patched row's current geometry, rather than
        // a round trip per location (a group drag patches hundreds).
        const patchedLocationIds = Object.keys(state.locationPatches).map(
          Number,
        );
        const currentLocationGeometry = new Map<
          number,
          {
            physicalX: number;
            physicalY: number;
            physicalWidthMm: number;
            physicalLengthMm: number;
            rotationDegrees: number;
          }
        >();
        if (patchedLocationIds.length > 0) {
          const rows = await tx
            .select({
              locationId: locations.locationId,
              physicalX: locations.physicalX,
              physicalY: locations.physicalY,
              physicalWidthMm: locations.physicalWidthMm,
              physicalLengthMm: locations.physicalLengthMm,
              rotationDegrees: locations.rotationDegrees,
            })
            .from(locations)
            .where(
              and(
                inArray(locations.locationId, patchedLocationIds),
                eq(locations.warehouseId, warehouseId),
              ),
            );
          for (const row of rows) {
            currentLocationGeometry.set(row.locationId, row);
          }
        }

        for (const [locationIdStr, patch] of Object.entries(
          state.locationPatches,
        )) {
          const locationId = Number(locationIdStr);
          const rotationUpdate =
            patch.rotationDegrees !== undefined
              ? ((Math.round(patch.rotationDegrees) % 360) + 360) % 360
              : undefined;

          // Growing or rotating a box can push an origin out of bounds that
          // the patch never mentioned, so any geometry edit re-clamps both.
          const geometryTouched =
            patch.physicalX !== undefined ||
            patch.physicalY !== undefined ||
            patch.physicalWidthMm !== undefined ||
            patch.physicalLengthMm !== undefined ||
            rotationUpdate !== undefined;

          // Merge the patch over the stored row, then clamp the result. Skips
          // the clamp entirely for a row that no longer exists -- the UPDATE
          // below will match nothing anyway.
          const existing = currentLocationGeometry.get(locationId);
          let clampedOrigin: { x: number; y: number } | null = null;
          if (existing) {
            const merged = locationGeometry({
              physicalX: Math.round(patch.physicalX ?? existing.physicalX),
              physicalY: Math.round(patch.physicalY ?? existing.physicalY),
              physicalWidthMm: Math.max(
                1,
                Math.round(patch.physicalWidthMm ?? existing.physicalWidthMm),
              ),
              physicalLengthMm: Math.max(
                1,
                Math.round(patch.physicalLengthMm ?? existing.physicalLengthMm),
              ),
              rotationDegrees: rotationUpdate ?? existing.rotationDegrees,
            });
            clampedOrigin = clampOriginToHall(merged, bounds);
          }

          await tx
            .update(locations)
            .set({
              ...(patch.locationCode !== undefined && {
                locationCode: patch.locationCode,
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
              ...(patch.isTemporary !== undefined && {
                isTemporary: patch.isTemporary,
              }),
              ...(patch.floorLevel !== undefined && {
                floorLevel: patch.floorLevel,
              }),
              ...(clampedOrigin && geometryTouched
                ? { physicalX: clampedOrigin.x, physicalY: clampedOrigin.y }
                : {
                    ...(patch.physicalX !== undefined && {
                      physicalX: Math.max(0, Math.round(patch.physicalX)),
                    }),
                    ...(patch.physicalY !== undefined && {
                      physicalY: Math.max(0, Math.round(patch.physicalY)),
                    }),
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

        // 3. Location deletes.
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

        // 4. New layout features. Geometry is re-derived server-side: the
        // envelope is never taken from the client, since it is what spatial
        // queries index and a wrong one silently breaks containment tests.
        for (const featureDraft of state.newFeatures ?? []) {
          const values = buildFeatureInsert(
            featureDraft,
            organizationId,
            warehouseId,
            hallId,
            bounds,
          );
          await tx.insert(layoutFeatures).values(values);
        }

        // 5. Feature patches. A patch is partial, but the envelope depends on
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

          // Same clamp as a new feature, on the merged result -- a patch that
          // only widens a wall can still push its far edge past the hall.
          const clamped = clampOriginToHall(geometry, bounds);
          geometry.originXMm = clamped.x;
          geometry.originYMm = clamped.y;

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

        // 6. Feature deletes. Features are not referenced by inventory or
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

        // 7. Hall patch.
        if (Object.keys(state.hallPatch).length > 0) {
          const patch = state.hallPatch;
          await tx
            .update(halls)
            .set({
              ...(patch.name !== undefined &&
                patch.name.trim() && { name: patch.name.trim() }),
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

      // 11. Record the publish. Same transaction as the writes, so a layout
      // change can never exist without a version marking it.
      publishedVersion = baseVersionNumber + 1;
      await tx.insert(layoutVersions).values({
        organizationId,
        warehouseId,
        versionNumber: publishedVersion,
        status: "PUBLISHED",
        graphEpoch: (current?.graphEpoch ?? 0) + 1,
        changeCount: totalChanges,
        notes: notes?.trim() || null,
        publishedBy: employeeId,
      });

      // 12. The published halls' drafts are now redundant. Only this
      // employee's are cleared -- someone else's in-progress draft for the
      // same hall is still their work to reconcile, and they will be told it
      // is stale the next time they open the designer.
      await tx
        .delete(layoutDrafts)
        .where(
          and(
            inArray(layoutDrafts.hallId, hallIds),
            eq(layoutDrafts.employeeId, employeeId),
          ),
        );
    });
  } catch (err) {
    if (err instanceof LayoutVersionConflictError) {
      return {
        conflict: {
          currentVersion: err.currentVersion,
          publishedByName: err.publishedByName,
          publishedAt: err.publishedAt,
        },
      };
    }
    // 23505 is Postgres's generic unique_violation SQLSTATE -- shared by
    // every unique constraint in the database, not just the version-race one
    // below. Branching on it alone previously reported a colliding location
    // code as "someone else published a newer version", which sent the user
    // looking for a publish race that was never there. constraint_name (a
    // real field on postgres.js's thrown error, not something bolted on)
    // is what tells these apart.
    const pgErr = err as { code?: string; constraint_name?: string };
    if (pgErr.code === "23505") {
      // A unique violation on (warehouse_id, version_number) is the same
      // conflict as above, just lost at commit time instead of at read time.
      if (pgErr.constraint_name === "uq_layout_versions_wh_number") {
        return {
          conflict: {
            currentVersion: baseVersionNumber + 1,
            publishedByName: null,
            publishedAt: null,
          },
        };
      }
      if (pgErr.constraint_name === "uq_locations_wh_code") {
        return {
          error:
            "One of your locations has a code that's already used elsewhere in this warehouse -- often an unrenamed \"NEW-...\" placeholder left over from an earlier session. Rename it in the property panel and save again.",
        };
      }
      if (pgErr.constraint_name === "uq_warehouse_hall_name") {
        return {
          error:
            "Another hall in this warehouse already has that name. Rename it and save again.",
        };
      }
    }
    return { error: (err as Error).message || "Failed to save changes." };
  }

  revalidateLayout(warehouseId);
  return { success: true, versionNumber: publishedVersion };
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

// ---------------------------------------------------------------------------
// Layout patterns -- a repeating rhythm of occupied/empty runs along a
// generator's primary axis (aisles for racking, slots for a floor line, bays
// for shelving), e.g. "1, empty, 2, empty, 2" for a block of single aisles
// followed by wider double blocks, each separated by a cross-aisle gap. This
// is the one thing the plain "N aisles, uniform gap" generator cannot express
// on its own: real racking is laid out in blocks, not one undifferentiated run.
// ---------------------------------------------------------------------------

type PatternPhase = { occupied: boolean; length: number };

const PATTERN_EMPTY_WORDS = new Set(["empty", "gap", "skip", "none"]);

/**
 * Parses "1, empty, 2, empty, 2" into alternating occupied/empty runs. Each
 * comma-separated token is either a positive whole number (an occupied run of
 * that length) or one of empty/gap/skip/none (one empty slot) -- write the
 * word twice for a two-slot gap rather than inventing a count syntax for it.
 */
function parsePattern(input: string): PatternPhase[] | { error: string } {
  const tokens = input
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return { error: "The pattern is empty." };

  const phases: PatternPhase[] = [];
  for (const token of tokens) {
    if (PATTERN_EMPTY_WORDS.has(token.toLowerCase())) {
      phases.push({ occupied: false, length: 1 });
      continue;
    }
    const n = Number(token);
    if (!Number.isInteger(n) || n <= 0) {
      return {
        error: `"${token}" in the pattern isn't a positive whole number or "empty".`,
      };
    }
    phases.push({ occupied: true, length: n });
  }
  if (!phases.some((p) => p.occupied)) {
    return {
      error: "The pattern needs at least one occupied run, not just gaps.",
    };
  }
  return phases;
}

/**
 * Rough worst-case slot count for laying out `targetOccupied` occupied
 * positions under a pattern -- not exact, since the final cycle is usually
 * cut short, but enough to catch a degenerate pattern (mostly gaps) before it
 * tries to walk tens of thousands of empty slots to place a modest count.
 */
const MAX_PATTERN_SLOTS = 20_000;
function estimatePatternSlots(
  phases: PatternPhase[],
  targetOccupied: number,
): number {
  const perCycle = phases.reduce((sum, p) => sum + p.length, 0);
  const occupiedPerCycle = phases.reduce(
    (sum, p) => sum + (p.occupied ? p.length : 0),
    0,
  );
  const cycles = Math.ceil(targetOccupied / occupiedPerCycle);
  return cycles * perCycle;
}

/**
 * Expands a pattern into a flat sequence of occupied/empty slots, cycling
 * until exactly `targetOccupied` occupied slots have been emitted. Stops
 * immediately once that's reached -- even mid-run -- so the last requested
 * position is never followed by a dangling trailing gap.
 */
function expandPattern(
  phases: PatternPhase[],
  targetOccupied: number,
): boolean[] {
  const slots: boolean[] = [];
  let occupied = 0;
  let phaseIndex = 0;
  while (occupied < targetOccupied) {
    const phase = phases[phaseIndex % phases.length];
    for (let i = 0; i < phase.length && occupied < targetOccupied; i++) {
      slots.push(phase.occupied);
      if (phase.occupied) occupied++;
    }
    phaseIndex++;
  }
  return slots;
}

/**
 * Walks one repeating axis under an optional pattern, calling `place` once
 * per occupied position with two indices that deliberately diverge under a
 * pattern: `occupiedIndex` (0-based count of placements so far) is what
 * numbering keys off, so a gap never leaves a hole in the sequence;
 * `slotIndex` (0-based physical position, gaps included) is what spacing
 * keys off, so a gap still consumes its share of floor. With no pattern,
 * every slot is occupied and the two indices are identical -- today's plain
 * contiguous layout, unchanged.
 */
function forEachPatternSlot(
  targetOccupied: number,
  pattern: PatternPhase[] | null,
  place: (occupiedIndex: number, slotIndex: number) => void,
): void {
  const slots = pattern
    ? expandPattern(pattern, targetOccupied)
    : new Array(targetOccupied).fill(true);
  let occupiedIndex = 0;
  for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
    if (!slots[slotIndex]) continue;
    place(occupiedIndex, slotIndex);
    occupiedIndex++;
  }
}

/**
 * Reads an optional pattern field: blank means no pattern (plain contiguous
 * layout, identical to before this feature existed). `axisCount` is only used
 * to reject a pattern that would need an absurd number of physical slots.
 */
function readOptionalPattern(
  formData: FormData,
  key: string,
  axisCount: number,
): { pattern: PatternPhase[] | null; error?: string } {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return { pattern: null };
  const parsed = parsePattern(raw);
  if ("error" in parsed) return { pattern: null, error: parsed.error };
  const estimatedSlots = estimatePatternSlots(parsed, axisCount);
  if (estimatedSlots > MAX_PATTERN_SLOTS) {
    return {
      pattern: null,
      error: `That pattern needs roughly ${estimatedSlots} physical positions to place ${axisCount} -- mostly gaps. Use a smaller gap ratio or a lower count.`,
    };
  }
  return { pattern: parsed };
}

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
  /** Optional rhythm along the aisle axis -- see the "Layout patterns"
   *  section above. Null lays out aisleCount aisles contiguously, exactly as
   *  before this existed. */
  aislePattern: PatternPhase[] | null;
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
}): BulkLocationDraft[] {
  const drafts: BulkLocationDraft[] = [];

  forEachPatternSlot(
    params.aisleCount,
    params.aislePattern,
    (occupiedIndex, slotIndex) => {
      const aisleIndexForNumber =
        params.verticalDirection === "utd"
          ? occupiedIndex
          : params.aisleCount - 1 - occupiedIndex;
      const aisleNum = params.aisleStart + aisleIndexForNumber;

      // slotIndex, not occupiedIndex: an empty slot in the pattern still
      // consumes one aisle-pitch of Y, which is the entire point of it --
      // that's the cross-aisle gap, not a discount on physical space.
      const y =
        params.startY + slotIndex * (params.bayDepthMm + params.aisleGapMm);

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
    },
  );
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
  /** Optional rhythm along the slot axis -- see "Layout patterns" above. */
  slotPattern: PatternPhase[] | null;
  slotWidthMm: number;
  slotDepthMm: number;
  gapMm: number;
  startX: number;
  startY: number;
  orientation: Orientation;
  sequenceDirection: Axis1DDirection;
}): BulkLocationDraft[] {
  const drafts: BulkLocationDraft[] = [];
  forEachPatternSlot(
    params.slotCount,
    params.slotPattern,
    (occupiedIndex, slotIndex) => {
      const slotIndexForNumber =
        params.sequenceDirection === "forward"
          ? occupiedIndex
          : params.slotCount - 1 - occupiedIndex;
      const slotNum = params.slotStart + slotIndexForNumber;

      const x =
        params.orientation === "horizontal"
          ? params.startX + slotIndex * (params.slotWidthMm + params.gapMm)
          : params.startX;
      const y =
        params.orientation === "horizontal"
          ? params.startY
          : params.startY + slotIndex * (params.slotDepthMm + params.gapMm);

      drafts.push({
        locationCode: renderLocationTemplate(params.template, {
          aisle: null,
          row: null,
          bay: slotNum,
          level: null,
        }),
        aisle: null,
        bay: slotNum,
        level: null,
        row: null,
        physicalX: Math.round(x),
        physicalY: Math.round(y),
        physicalWidthMm: Math.round(params.slotWidthMm),
        physicalLengthMm: Math.round(params.slotDepthMm),
      });
    },
  );
  return drafts;
}

function buildShelvingLocations(params: {
  template: string;
  bayCount: number;
  bayStart: number;
  /** Optional rhythm along the bay axis -- see "Layout patterns" above. */
  bayPattern: PatternPhase[] | null;
  levelCount: number;
  levelStart: number;
  bayWidthMm: number;
  bayDepthMm: number;
  bayGapMm: number;
  startX: number;
  startY: number;
  orientation: Orientation;
  sequenceDirection: Axis1DDirection;
}): BulkLocationDraft[] {
  const drafts: BulkLocationDraft[] = [];
  forEachPatternSlot(
    params.bayCount,
    params.bayPattern,
    (occupiedIndex, slotIndex) => {
      const bayIndexForNumber =
        params.sequenceDirection === "forward"
          ? occupiedIndex
          : params.bayCount - 1 - occupiedIndex;
      const bayNum = params.bayStart + bayIndexForNumber;

      let x: number, y: number, width: number, length: number;
      if (params.orientation === "horizontal") {
        x = params.startX + slotIndex * (params.bayWidthMm + params.bayGapMm);
        y = params.startY;
        width = params.bayWidthMm;
        length = params.bayDepthMm;
      } else {
        x = params.startX;
        y = params.startY + slotIndex * (params.bayWidthMm + params.bayGapMm);
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
    },
  );
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

    const { pattern: aislePattern, error: patternError } = readOptionalPattern(
      formData,
      "aislePattern",
      aisleCount,
    );
    if (patternError) return { error: patternError };

    drafts = buildRackingLocations({
      template,
      aisleCount,
      aisleStart,
      aislePattern,
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

    const { pattern: slotPattern, error: patternError } = readOptionalPattern(
      formData,
      "slotPattern",
      slotCount,
    );
    if (patternError) return { error: patternError };

    drafts = buildFloorLineLocations({
      template,
      slotCount,
      slotStart,
      slotPattern,
      slotWidthMm,
      slotDepthMm,
      gapMm,
      startX,
      startY,
      orientation,
      sequenceDirection,
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

    const { pattern: bayPattern, error: patternError } = readOptionalPattern(
      formData,
      "bayPattern",
      bayCount,
    );
    if (patternError) return { error: patternError };

    drafts = buildShelvingLocations({
      template,
      bayCount,
      bayStart,
      bayPattern,
      levelCount,
      levelStart,
      bayWidthMm,
      bayDepthMm,
      bayGapMm,
      startX,
      startY,
      orientation,
      sequenceDirection,
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
