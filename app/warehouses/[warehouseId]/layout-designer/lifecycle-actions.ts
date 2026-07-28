"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { hallUnderlays, layoutDrafts } from "@/drizzle/schema";
import {
  UNDERLAY_BUCKET,
  createStorageClient,
  hallBelongsToWarehouse,
  requireLayoutContext,
  revalidateLayout,
} from "./layout-context";
import type { HallState } from "./types";
import { DRAFT_STATE_VERSION, hallStateChangeCount } from "./types";

const MAX_UNDERLAY_BYTES = 25 * 1024 * 1024;
const ALLOWED_UNDERLAY_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
];

export type SimpleResult = { error?: string; success?: true };

// ---------------------------------------------------------------------------
// Server-persisted drafts
// ---------------------------------------------------------------------------

/**
 * Autosave target for the designer's in-progress HallState. Called on a
 * debounce, so it must be cheap and idempotent: it upserts one row per
 * (hall, employee) and never touches the published layout.
 */
export async function saveHallDraft(
  warehouseId: number,
  hallId: number,
  state: HallState,
  baseVersionNumber: number,
): Promise<SimpleResult> {
  let organizationId: number;
  let employeeId: number;
  try {
    ({ organizationId, employeeId } = await requireLayoutContext(warehouseId));
  } catch (err) {
    return { error: (err as Error).message };
  }

  if (!(await hallBelongsToWarehouse(hallId, warehouseId))) {
    return { error: "That hall does not belong to this warehouse." };
  }

  const changeCount = hallStateChangeCount(state);

  // An emptied draft is a discard, not a save -- otherwise "undo everything"
  // would leave a zero-change row that still reads as unsaved work.
  if (changeCount === 0) {
    await db
      .delete(layoutDrafts)
      .where(
        and(
          eq(layoutDrafts.hallId, hallId),
          eq(layoutDrafts.employeeId, employeeId),
        ),
      );
    return { success: true };
  }

  await db
    .insert(layoutDrafts)
    .values({
      organizationId,
      warehouseId,
      hallId,
      employeeId,
      state,
      stateVersion: DRAFT_STATE_VERSION,
      baseVersionNumber,
      changeCount,
    })
    .onConflictDoUpdate({
      target: [layoutDrafts.hallId, layoutDrafts.employeeId],
      set: {
        state,
        stateVersion: DRAFT_STATE_VERSION,
        baseVersionNumber,
        changeCount,
        updatedAt: new Date().toISOString(),
      },
    });

  return { success: true };
}

export async function discardHallDraft(
  warehouseId: number,
  hallId: number,
): Promise<SimpleResult> {
  let employeeId: number;
  try {
    ({ employeeId } = await requireLayoutContext(warehouseId));
  } catch (err) {
    return { error: (err as Error).message };
  }

  await db
    .delete(layoutDrafts)
    .where(
      and(
        eq(layoutDrafts.hallId, hallId),
        eq(layoutDrafts.employeeId, employeeId),
      ),
    );

  revalidateLayout(warehouseId);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Underlays
// ---------------------------------------------------------------------------

export type UnderlayResult = SimpleResult & { underlayId?: number };

/**
 * Uploads a floorplan raster for a hall floor. The bucket is private, so the
 * stored value is an object path -- reads go through a short-lived signed URL
 * minted server-side, never a public URL. A floorplan is commercially
 * sensitive and a public bucket would make every one of them world-readable
 * to anyone who guessed the path.
 */
export async function uploadHallUnderlay(
  formData: FormData,
): Promise<UnderlayResult> {
  const warehouseId = Number(formData.get("warehouseId"));
  const hallId = Number(formData.get("hallId"));
  const floorLevel = Number(formData.get("floorLevel") ?? 1) || 1;
  if (!Number.isInteger(warehouseId) || !Number.isInteger(hallId)) {
    return { error: "Missing warehouse or hall." };
  }

  let organizationId: number;
  let employeeId: number;
  try {
    ({ organizationId, employeeId } = await requireLayoutContext(warehouseId));
  } catch (err) {
    return { error: (err as Error).message };
  }

  if (!(await hallBelongsToWarehouse(hallId, warehouseId))) {
    return { error: "That hall does not belong to this warehouse." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose an image to upload." };
  }
  if (!ALLOWED_UNDERLAY_TYPES.includes(file.type)) {
    return { error: "Underlay must be a PNG, JPEG, WebP, or SVG image." };
  }
  if (file.size > MAX_UNDERLAY_BYTES) {
    return { error: "Underlay must be 25 MB or smaller." };
  }

  const imageWidthPx = Number(formData.get("imageWidthPx")) || null;
  const imageHeightPx = Number(formData.get("imageHeightPx")) || null;

  // A sane opening scale beats making the user calibrate before they can see
  // anything: assume the image spans the hall's width, then let them correct
  // it with the two-click measure.
  const hallWidthMm = Number(formData.get("hallWidthMm")) || null;
  const initialScale =
    hallWidthMm && imageWidthPx ? hallWidthMm / imageWidthPx : 10;

  const extension = (file.name.split(".").pop() ?? "png")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  const storagePath = `${organizationId}/${warehouseId}/${hallId}/${floorLevel}-${Date.now()}.${extension}`;

  const supabase = createStorageClient();
  const upload = await supabase.storage
    .from(UNDERLAY_BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: false });

  if (upload.error) {
    return { error: `Upload failed: ${upload.error.message}` };
  }

  // Replacing an existing underlay for this floor: remember the old object so
  // it can be removed once the row no longer points at it.
  const [previous] = await db
    .select({ storagePath: hallUnderlays.storagePath })
    .from(hallUnderlays)
    .where(
      and(
        eq(hallUnderlays.hallId, hallId),
        eq(hallUnderlays.floorLevel, floorLevel),
      ),
    )
    .limit(1);

  const [row] = await db
    .insert(hallUnderlays)
    .values({
      organizationId,
      warehouseId,
      hallId,
      floorLevel,
      storagePath,
      originalFilename: file.name.slice(0, 255),
      mimeType: file.type,
      fileSizeBytes: file.size,
      imageWidthPx,
      imageHeightPx,
      scaleMmPerPx: initialScale.toFixed(6),
      uploadedBy: employeeId,
    })
    .onConflictDoUpdate({
      target: [hallUnderlays.hallId, hallUnderlays.floorLevel],
      set: {
        storagePath,
        originalFilename: file.name.slice(0, 255),
        mimeType: file.type,
        fileSizeBytes: file.size,
        imageWidthPx,
        imageHeightPx,
        scaleMmPerPx: initialScale.toFixed(6),
        uploadedBy: employeeId,
        updatedAt: new Date().toISOString(),
      },
    })
    .returning({ underlayId: hallUnderlays.underlayId });

  if (previous?.storagePath && previous.storagePath !== storagePath) {
    await supabase.storage.from(UNDERLAY_BUCKET).remove([previous.storagePath]);
  }

  revalidateLayout(warehouseId);
  return { success: true, underlayId: row.underlayId };
}

export type UnderlayPlacementPatch = Partial<{
  offsetXMm: number;
  offsetYMm: number;
  rotationDegrees: number;
  opacity: number;
  isVisible: boolean;
  scaleMmPerPx: number;
  calibMeasuredMm: number;
  calibKnownMm: number;
}>;

export async function updateHallUnderlay(
  warehouseId: number,
  underlayId: number,
  patch: UnderlayPlacementPatch,
): Promise<SimpleResult> {
  try {
    await requireLayoutContext(warehouseId);
  } catch (err) {
    return { error: (err as Error).message };
  }

  if (patch.scaleMmPerPx !== undefined && !(patch.scaleMmPerPx > 0)) {
    return { error: "Scale must be greater than zero." };
  }

  await db
    .update(hallUnderlays)
    .set({
      ...(patch.offsetXMm !== undefined && {
        offsetXMm: Math.round(patch.offsetXMm),
      }),
      ...(patch.offsetYMm !== undefined && {
        offsetYMm: Math.round(patch.offsetYMm),
      }),
      ...(patch.rotationDegrees !== undefined && {
        rotationDegrees: ((Math.round(patch.rotationDegrees) % 360) + 360) % 360,
      }),
      ...(patch.opacity !== undefined && {
        opacity: Math.min(1, Math.max(0, patch.opacity)).toFixed(2),
      }),
      ...(patch.isVisible !== undefined && { isVisible: patch.isVisible }),
      ...(patch.scaleMmPerPx !== undefined && {
        scaleMmPerPx: patch.scaleMmPerPx.toFixed(6),
      }),
      ...(patch.calibMeasuredMm !== undefined && {
        calibMeasuredMm: Math.round(patch.calibMeasuredMm),
      }),
      ...(patch.calibKnownMm !== undefined && {
        calibKnownMm: Math.round(patch.calibKnownMm),
      }),
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(hallUnderlays.underlayId, underlayId),
        eq(hallUnderlays.warehouseId, warehouseId),
      ),
    );

  revalidateLayout(warehouseId);
  return { success: true };
}

/**
 * Applies a two-click measurement. The user measures a distance on the canvas
 * and states what it really is; the correction is relative, so it works no
 * matter what the current scale happens to be and never needs image pixel
 * coordinates.
 */
export async function calibrateHallUnderlay(
  warehouseId: number,
  underlayId: number,
  measuredMm: number,
  knownMm: number,
): Promise<SimpleResult> {
  try {
    await requireLayoutContext(warehouseId);
  } catch (err) {
    return { error: (err as Error).message };
  }

  if (!(measuredMm > 0) || !(knownMm > 0)) {
    return { error: "Both the measured and real distances must be positive." };
  }

  const [existing] = await db
    .select({ scaleMmPerPx: hallUnderlays.scaleMmPerPx })
    .from(hallUnderlays)
    .where(
      and(
        eq(hallUnderlays.underlayId, underlayId),
        eq(hallUnderlays.warehouseId, warehouseId),
      ),
    )
    .limit(1);
  if (!existing) return { error: "That underlay no longer exists." };

  const nextScale = Number(existing.scaleMmPerPx) * (knownMm / measuredMm);
  if (!Number.isFinite(nextScale) || nextScale <= 0) {
    return { error: "That measurement produces an invalid scale." };
  }

  return updateHallUnderlay(warehouseId, underlayId, {
    scaleMmPerPx: nextScale,
    calibMeasuredMm: measuredMm,
    calibKnownMm: knownMm,
  });
}

export async function deleteHallUnderlay(
  warehouseId: number,
  underlayId: number,
): Promise<SimpleResult> {
  try {
    await requireLayoutContext(warehouseId);
  } catch (err) {
    return { error: (err as Error).message };
  }

  const [row] = await db
    .delete(hallUnderlays)
    .where(
      and(
        eq(hallUnderlays.underlayId, underlayId),
        eq(hallUnderlays.warehouseId, warehouseId),
      ),
    )
    .returning({ storagePath: hallUnderlays.storagePath });

  if (row?.storagePath) {
    const supabase = createStorageClient();
    await supabase.storage.from(UNDERLAY_BUCKET).remove([row.storagePath]);
  }

  revalidateLayout(warehouseId);
  return { success: true };
}
