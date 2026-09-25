import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  assetPositionHistory,
  assetPositions,
  employees,
  locations,
} from "@/drizzle/schema";
import { broadcastMapEvent } from "./realtime-broadcast";
import type { AssetStatus, LiveAsset, PositionSource } from "./live-map";

/**
 * The DB write + live broadcast behind every asset position report, shared by
 * the live map's own `reportAssetPosition` action (client-invoked, gated by
 * `requireLiveMapHall`) and by other server code that wants to record a
 * position as a side effect of something else entirely -- a stock movement
 * implies "someone was standing at this location a moment ago" just as much
 * as an explicit scan does.
 *
 * Deliberately NOT exported from a "use server" file, and takes
 * `organizationId` as a plain argument rather than deriving it: everything a
 * "use server" file exports becomes a directly callable, unauthenticated RPC
 * target (see the note in `context.ts`), and this function does no
 * authorization of its own. Every caller is responsible for deciding who is
 * allowed to report whose position -- this only knows how to write it down
 * once that's been decided.
 */
export type RecordAssetPositionInput = {
  organizationId: number;
  warehouseId: number;
  hallId: number;
  assetKind: "EMPLOYEE" | "MHE";
  assetRefId: number;
  label: string;
  xMm: number;
  yMm: number;
  floorLevel?: number;
  headingDeg?: number | null;
  nodeId?: number | null;
  edgeId?: number | null;
  source?: PositionSource;
  confidence?: number;
  status?: AssetStatus;
  routePlanId?: number | null;
};

export async function recordAssetPosition(
  input: RecordAssetPositionInput,
): Promise<{ error?: string; success?: true }> {
  if (!Number.isFinite(input.xMm) || !Number.isFinite(input.yMm)) {
    return { error: "Position must be a pair of finite coordinates." };
  }

  const now = new Date().toISOString();
  const values = {
    organizationId: input.organizationId,
    warehouseId: input.warehouseId,
    hallId: input.hallId,
    assetKind: input.assetKind,
    assetRefId: input.assetRefId,
    xMm: Math.round(input.xMm),
    yMm: Math.round(input.yMm),
    floorLevel: input.floorLevel ?? 1,
    headingDeg: input.headingDeg ?? null,
    nodeId: input.nodeId ?? null,
    edgeId: input.edgeId ?? null,
    source: input.source ?? "SCAN",
    confidence: String(
      Math.min(1, Math.max(0, input.confidence ?? 1)).toFixed(2),
    ),
    status: input.status ?? "IDLE",
    routePlanId: input.routePlanId ?? null,
    observedAt: now,
    updatedAt: now,
  };

  const [previous] = await db
    .select({ xMm: assetPositions.xMm, yMm: assetPositions.yMm })
    .from(assetPositions)
    .where(
      and(
        eq(assetPositions.assetKind, input.assetKind),
        eq(assetPositions.assetRefId, input.assetRefId),
      ),
    )
    .limit(1);

  await db
    .insert(assetPositions)
    .values(values)
    .onConflictDoUpdate({
      target: [assetPositions.assetKind, assetPositions.assetRefId],
      set: values,
    });

  // History is appended only when the asset has actually moved, which is
  // what keeps the trail useful for heatmaps without it becoming a firehose.
  const moved =
    !previous ||
    Math.hypot(previous.xMm - values.xMm, previous.yMm - values.yMm) > 500;
  if (moved) {
    await db.insert(assetPositionHistory).values({
      organizationId: input.organizationId,
      warehouseId: input.warehouseId,
      hallId: input.hallId,
      assetKind: input.assetKind,
      assetRefId: input.assetRefId,
      xMm: values.xMm,
      yMm: values.yMm,
      floorLevel: values.floorLevel,
      edgeId: values.edgeId,
      source: values.source,
      observedAt: now,
    });
  }

  // The durable row above is what a page load reads; this is what makes an
  // already-open live map move without the viewer refreshing -- the same
  // broadcast channel INVENTORY events ride, and one `use-live-map.ts` has
  // been listening for since the live map was first built.
  const liveAsset: LiveAsset = {
    assetKind: input.assetKind,
    assetRefId: input.assetRefId,
    label: input.label,
    fixX: values.xMm,
    fixY: values.yMm,
    floorLevel: values.floorLevel,
    fixedAt: Date.now(),
    source: values.source as PositionSource,
    status: values.status as AssetStatus,
    headingDeg: values.headingDeg,
    routePoints: null,
    speedMms: null,
  };
  await broadcastMapEvent(
    input.warehouseId,
    input.hallId,
    "POSITION",
    liveAsset,
  );

  return { success: true };
}

/** Best-effort display name for an asset, falling back to "KIND id" the same
 *  way the live map's own snapshot query does. */
export async function resolveAssetLabel(
  assetKind: "EMPLOYEE" | "MHE",
  assetRefId: number,
): Promise<string> {
  if (assetKind === "EMPLOYEE") {
    const [row] = await db
      .select({
        firstName: employees.firstName,
        lastName: employees.lastName,
      })
      .from(employees)
      .where(eq(employees.employeeId, assetRefId))
      .limit(1);
    const name = [row?.firstName, row?.lastName].filter(Boolean).join(" ");
    if (name) return name;
  }
  return `${assetKind} ${assetRefId}`;
}

/**
 * Reports an employee's position as a SCAN fix at a location's centre --
 * the shared shape behind "this warehouse action implies someone was
 * standing here a moment ago," used by every inbound module (stock receipt,
 * PO receiving, unloading, putaway) that wants that side effect without
 * repeating the lookup + best-effort try/catch each time.
 *
 * Most warehouses have no RTLS, so a physical warehouse action is itself a
 * real, honest position signal -- no less so than a barcode scan and free of
 * any hardware integration. See live-map.ts's confidence decay and the "not
 * RTLS" disclaimer in live-map-view.tsx: this is a point-in-time fix that
 * fades, not continuous tracking.
 */
export async function reportEmployeeAtLocation(
  warehouseId: number,
  organizationId: number,
  employee: {
    employeeId: number;
    firstName: string | null;
    lastName: string | null;
  },
  locationId: number,
): Promise<void> {
  try {
    const [location] = await db
      .select({
        hallId: locations.hallId,
        floorLevel: locations.floorLevel,
        physicalX: locations.physicalX,
        physicalY: locations.physicalY,
        physicalWidthMm: locations.physicalWidthMm,
        physicalLengthMm: locations.physicalLengthMm,
      })
      .from(locations)
      .where(eq(locations.locationId, locationId))
      .limit(1);
    if (!location?.hallId) return;

    const label =
      [employee.firstName, employee.lastName].filter(Boolean).join(" ") ||
      `EMPLOYEE ${employee.employeeId}`;

    await recordAssetPosition({
      organizationId,
      warehouseId,
      hallId: location.hallId,
      assetKind: "EMPLOYEE",
      assetRefId: employee.employeeId,
      label,
      xMm: location.physicalX + location.physicalWidthMm / 2,
      yMm: location.physicalY + location.physicalLengthMm / 2,
      floorLevel: location.floorLevel ?? undefined,
      source: "SCAN",
      confidence: 1,
      status: "IDLE",
    });
  } catch (err) {
    console.error("Position report failed:", err);
  }
}
