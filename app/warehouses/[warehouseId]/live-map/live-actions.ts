"use server";

import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  assetPositions,
  employees,
  layoutBlockages,
  layoutVersions,
  navEdges,
  navNodes,
  routePlans,
} from "@/drizzle/schema";
import {
  HallScopeError,
  requireLiveMapContext,
  requireLiveMapHall,
  revalidateLiveMap,
} from "@/lib/warehouse-map/context";
import { distanceToSegment } from "@/lib/warehouse-map/geometry";
import type { AssetStatus, PositionSource } from "@/lib/warehouse-map/live-map";
import {
  recordAssetPosition,
  resolveAssetLabel,
} from "@/lib/warehouse-map/asset-positions";

export type BlockageResult = {
  error?: string;
  success?: true;
  blockageId?: number;
  /** Edges the blockage was resolved onto. */
  blockedEdgeIds?: number[];
  /** Routes that crossed them and must be recomputed. */
  invalidatedRoutePlanIds?: number[];
  graphEpoch?: number;
};

/**
 * Raises a blockage over a point, resolving it onto the edges it actually
 * covers and invalidating every route that crosses them.
 *
 * The edge list is resolved once, at report time, rather than left as
 * geometry: invalidation then becomes an array-overlap test instead of a
 * spatial query run against every stored route.
 */
export async function reportBlockage(
  warehouseId: number,
  hallId: number,
  input: {
    xMm: number;
    yMm: number;
    radiusMm: number;
    reason?: string;
    notes?: string;
    floorLevel?: number;
    expiresInMinutes?: number;
  },
): Promise<BlockageResult> {
  let organizationId: number;
  let employeeId: number;
  let canReportBlockages: boolean;
  try {
    ({ organizationId, employeeId, canReportBlockages } =
      await requireLiveMapHall(warehouseId, hallId));
  } catch (err) {
    if (err instanceof HallScopeError) return { error: err.message };
    throw err;
  }
  if (!canReportBlockages) {
    return { error: "You do not have permission to report blockages." };
  }

  const floorLevel = input.floorLevel ?? 1;
  const radius = Math.max(100, Math.round(input.radiusMm));

  // Resolve the covered edges geometrically.
  const [nodeRows, edgeRows] = await Promise.all([
    db
      .select({ nodeId: navNodes.nodeId, xMm: navNodes.xMm, yMm: navNodes.yMm })
      .from(navNodes)
      .where(
        and(
          eq(navNodes.warehouseId, warehouseId),
          eq(navNodes.hallId, hallId),
          eq(navNodes.floorLevel, floorLevel),
        ),
      ),
    db
      .select({
        edgeId: navEdges.edgeId,
        fromNodeId: navEdges.fromNodeId,
        toNodeId: navEdges.toNodeId,
      })
      .from(navEdges)
      .where(
        and(eq(navEdges.warehouseId, warehouseId), eq(navEdges.hallId, hallId)),
      ),
  ]);

  const nodeById = new Map(nodeRows.map((n) => [n.nodeId, n]));
  const centre = { x: input.xMm, y: input.yMm };
  const blockedEdgeIds: number[] = [];
  for (const edge of edgeRows) {
    const from = nodeById.get(edge.fromNodeId);
    const to = nodeById.get(edge.toNodeId);
    if (!from || !to) continue;
    const distance = distanceToSegment(
      centre,
      { x: from.xMm, y: from.yMm },
      { x: to.xMm, y: to.yMm },
    );
    if (distance <= radius) blockedEdgeIds.push(edge.edgeId);
  }

  if (blockedEdgeIds.length === 0) {
    return {
      error:
        "Nothing routable is within that radius, so this would block nothing. Widen it or move it onto an aisle.",
    };
  }

  let blockageId: number | undefined;
  let invalidated: number[] = [];
  let graphEpoch = 0;

  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(layoutBlockages)
        .values({
          organizationId,
          warehouseId,
          hallId,
          floorLevel,
          edgeIds: blockedEdgeIds,
          originXMm: Math.round(input.xMm),
          originYMm: Math.round(input.yMm),
          radiusMm: radius,
          reason: input.reason ?? "OTHER",
          notes: input.notes?.slice(0, 300) ?? null,
          reportedBy: employeeId,
          expiresAt: input.expiresInMinutes
            ? new Date(Date.now() + input.expiresInMinutes * 60_000).toISOString()
            : null,
        })
        .returning({ blockageId: layoutBlockages.blockageId });
      blockageId = row.blockageId;

      graphEpoch = await bumpGraphEpoch(tx, warehouseId);
      invalidated = await findRoutesCrossing(
        tx,
        warehouseId,
        blockedEdgeIds,
        graphEpoch,
      );
    });
  } catch (err) {
    return { error: (err as Error).message || "Failed to raise the blockage." };
  }

  revalidateLiveMap(warehouseId);
  return {
    success: true,
    blockageId,
    blockedEdgeIds,
    invalidatedRoutePlanIds: invalidated,
    graphEpoch,
  };
}

export async function clearBlockage(
  warehouseId: number,
  blockageId: number,
): Promise<BlockageResult> {
  const { canReportBlockages } = await requireLiveMapContext(warehouseId);
  if (!canReportBlockages) {
    return { error: "You do not have permission to clear blockages." };
  }

  let graphEpoch = 0;
  await db.transaction(async (tx) => {
    await tx
      .update(layoutBlockages)
      .set({ isActive: false, clearedAt: new Date().toISOString() })
      .where(
        and(
          eq(layoutBlockages.blockageId, blockageId),
          eq(layoutBlockages.warehouseId, warehouseId),
        ),
      );
    // Clearing invalidates routes too: anything planned the long way round is
    // now needlessly long.
    graphEpoch = await bumpGraphEpoch(tx, warehouseId);
  });

  revalidateLiveMap(warehouseId);
  return { success: true, graphEpoch };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Moves the graph epoch on.
 *
 * Separate from layout_version because it must advance for things that are
 * not a republish -- a blockage being raised or cleared changes what routes
 * are valid without changing the layout at all.
 */
async function bumpGraphEpoch(tx: Tx, warehouseId: number): Promise<number> {
  const [current] = await tx
    .select({
      versionId: layoutVersions.versionId,
      graphEpoch: layoutVersions.graphEpoch,
    })
    .from(layoutVersions)
    .where(eq(layoutVersions.warehouseId, warehouseId))
    .orderBy(desc(layoutVersions.versionNumber))
    .limit(1);
  if (!current) return 0;

  const next = current.graphEpoch + 1;
  await tx
    .update(layoutVersions)
    .set({ graphEpoch: next })
    .where(eq(layoutVersions.versionId, current.versionId));
  return next;
}

/**
 * Finds every live route crossing any of these edges.
 *
 * Note what this does *not* do: it does not mark them. Bumping graph_epoch
 * already invalidates every stored plan, because a plan carries the
 * (layout_version, graph_epoch) it was built against and any mismatch means
 * recompute. Writing a second "stale" marker would be a redundant source of
 * truth that could disagree with the stamp.
 *
 * What this list is for is urgency: these are the routes with someone
 * currently walking into the obstruction, so they get recomputed now rather
 * than lazily on next use.
 *
 * Array overlap (`&&`) rather than a join -- the edge list lives on the plan
 * precisely so this stays a single predicate.
 */
async function findRoutesCrossing(
  tx: Tx,
  warehouseId: number,
  blockedEdgeIds: number[],
  currentEpoch: number,
): Promise<number[]> {
  const affected = await tx
    .select({ routePlanId: routePlans.routePlanId })
    .from(routePlans)
    .where(
      and(
        eq(routePlans.warehouseId, warehouseId),
        isNull(routePlans.supersededBy),
        // Only plans that were valid a moment ago are worth recomputing.
        eq(routePlans.graphEpoch, currentEpoch - 1),
        sql`${routePlans.edgeIds} && ${blockedEdgeIds}`,
      ),
    );
  return affected.map((row) => row.routePlanId);
}

/**
 * Records an asset's position.
 *
 * The live channel carries positions at their true rate; this is the
 * durable snapshot, written on a state change or every ~15s. History is
 * appended only when the asset has actually moved, which is what keeps the
 * trail useful for heatmaps without it becoming a firehose.
 *
 * Authorisation is deliberately stricter than the rest of the live map. Every
 * other action here only reads; this one WRITES the position of a named
 * person, and what it writes feeds the traffic rollup, the learned travel
 * times and the congestion multipliers the router uses. So `can_view_metrics`
 * -- a viewing permission -- is not sufficient on its own:
 *
 *   - Reporting your OWN position is what a barcode scan is, so any live-map
 *     user may do it for themselves.
 *   - Reporting anyone else's position, or an MHE unit's, is directing and
 *     recording floor activity, and needs `can_assign_tasks` -- the same
 *     capability raising a blockage requires, for the same reason.
 *
 * Without this split, anyone who could see the map could fabricate a named
 * colleague's location history.
 */
export async function reportAssetPosition(
  warehouseId: number,
  input: {
    hallId: number;
    assetKind: "EMPLOYEE" | "MHE";
    assetRefId: number;
    xMm: number;
    yMm: number;
    floorLevel?: number;
    headingDeg?: number | null;
    nodeId?: number | null;
    edgeId?: number | null;
    source?: PositionSource;
    confidence?: number;
    status?: string;
    routePlanId?: number | null;
  },
): Promise<{ error?: string; success?: true }> {
  let organizationId: number;
  let employeeId: number;
  let canReportForOthers: boolean;
  try {
    ({
      organizationId,
      employeeId,
      canReportBlockages: canReportForOthers,
    } = await requireLiveMapHall(warehouseId, input.hallId));
  } catch (err) {
    if (err instanceof HallScopeError) return { error: err.message };
    throw err;
  }

  const isSelfReport =
    input.assetKind === "EMPLOYEE" && input.assetRefId === employeeId;
  if (!isSelfReport && !canReportForOthers) {
    return {
      error:
        "You can only report your own position. Recording someone else's, or a vehicle's, needs task-assignment permission.",
    };
  }

  const label = await resolveAssetLabel(input.assetKind, input.assetRefId);
  return recordAssetPosition({
    organizationId,
    warehouseId,
    hallId: input.hallId,
    assetKind: input.assetKind,
    assetRefId: input.assetRefId,
    label,
    xMm: input.xMm,
    yMm: input.yMm,
    floorLevel: input.floorLevel,
    headingDeg: input.headingDeg,
    nodeId: input.nodeId,
    edgeId: input.edgeId,
    source: input.source,
    confidence: input.confidence,
    status: input.status as AssetStatus | undefined,
    routePlanId: input.routePlanId,
  });
}

/** Live snapshot for a hall: current asset positions and active blockages. */
export async function loadLiveSnapshot(warehouseId: number, hallId: number) {
  // Both queries below already carry `warehouse_id`, so a foreign hall would
  // return nothing rather than leak. Gated anyway so the rule has no
  // exceptions: every action naming a hall validates the hall, which is an
  // invariant you can grep for -- "this one is safe for a different reason"
  // is how the next one gets missed.
  await requireLiveMapHall(warehouseId, hallId);

  const [assetRows, blockageRows] = await Promise.all([
    db
      .select({
        assetKind: assetPositions.assetKind,
        assetRefId: assetPositions.assetRefId,
        xMm: assetPositions.xMm,
        yMm: assetPositions.yMm,
        floorLevel: assetPositions.floorLevel,
        headingDeg: assetPositions.headingDeg,
        source: assetPositions.source,
        confidence: assetPositions.confidence,
        status: assetPositions.status,
        routePlanId: assetPositions.routePlanId,
        observedAt: assetPositions.observedAt,
        firstName: employees.firstName,
        lastName: employees.lastName,
      })
      .from(assetPositions)
      .leftJoin(
        employees,
        and(
          eq(assetPositions.assetKind, "EMPLOYEE"),
          eq(assetPositions.assetRefId, employees.employeeId),
        ),
      )
      .where(
        and(
          eq(assetPositions.warehouseId, warehouseId),
          eq(assetPositions.hallId, hallId),
        ),
      ),
    db
      .select({
        blockageId: layoutBlockages.blockageId,
        edgeIds: layoutBlockages.edgeIds,
        originXMm: layoutBlockages.originXMm,
        originYMm: layoutBlockages.originYMm,
        radiusMm: layoutBlockages.radiusMm,
        reason: layoutBlockages.reason,
        notes: layoutBlockages.notes,
        startedAt: layoutBlockages.startedAt,
        expiresAt: layoutBlockages.expiresAt,
      })
      .from(layoutBlockages)
      .where(
        and(
          eq(layoutBlockages.warehouseId, warehouseId),
          eq(layoutBlockages.hallId, hallId),
          eq(layoutBlockages.isActive, true),
          // An expired blockage is stale data, not an obstruction.
          or(
            isNull(layoutBlockages.expiresAt),
            sql`${layoutBlockages.expiresAt} > CURRENT_TIMESTAMP`,
          ),
        ),
      ),
  ]);

  return {
    assets: assetRows.map((row) => ({
      assetKind: row.assetKind as "EMPLOYEE" | "MHE",
      assetRefId: row.assetRefId,
      label:
        [row.firstName, row.lastName].filter(Boolean).join(" ") ||
        `${row.assetKind} ${row.assetRefId}`,
      xMm: row.xMm,
      yMm: row.yMm,
      floorLevel: row.floorLevel,
      headingDeg: row.headingDeg,
      source: row.source as PositionSource,
      confidence: Number(row.confidence),
      status: row.status,
      routePlanId: row.routePlanId,
      observedAt: row.observedAt,
    })),
    blockages: blockageRows,
  };
}
