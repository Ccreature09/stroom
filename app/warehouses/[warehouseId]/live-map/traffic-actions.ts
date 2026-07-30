"use server";

import { and, asc, desc, eq, gt, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  assetPositionHistory,
  edgeCongestionState,
  edgeTraversals,
  edgeTrafficStats,
  navEdges,
  navNodes,
} from "@/drizzle/schema";
import { requireLiveMapContext } from "@/lib/warehouse-map/context";
import type { MatchableEdge } from "@/lib/warehouse-map/live-map";
import {
  advanceCongestionState,
  aggregateEdgeStats,
  binPositionsForHeatmap,
  detectBottlenecks,
  matchTraversalsForStream,
  type Bottleneck,
  type HeatmapCell,
  type PositionSample,
} from "@/lib/warehouse-map/traffic";

/**
 * Background rollup: turns unprocessed `asset_position_history` into
 * `edge_traversals`, re-aggregates the buckets that touched, and advances
 * each affected edge's damped congestion state.
 *
 * "Background" here means "not on the request path of anything a user is
 * waiting on" -- this app has no queue or cron runner, so it is a plain
 * idempotent server action a supervisor (or a scheduled trigger) calls
 * periodically. It is safe to call repeatedly: the high-water mark is read
 * from the data already written, not tracked in a separate cursor table, so
 * a re-run after a partial failure just reprocesses a small overlap rather
 * than corrupting anything.
 */
export async function runTrafficRollup(
  warehouseId: number,
  hallId: number,
  options: { lookbackMinutes?: number; bucketMinutes?: number } = {},
): Promise<{
  error?: string;
  success?: true;
  traversalsWritten: number;
  bucketsUpdated: number;
}> {
  await requireLiveMapContext(warehouseId);

  const bucketMinutes = options.bucketMinutes ?? 15;
  const lookbackMinutes = options.lookbackMinutes ?? 240;

  // High-water mark: the latest exit time already recorded for this hall.
  // Nothing before it needs reprocessing. A cold start (no traversals yet)
  // falls back to the lookback window rather than the dawn of history.
  const [latest] = await db
    .select({ exitedAt: edgeTraversals.exitedAt })
    .from(edgeTraversals)
    .where(eq(edgeTraversals.hallId, hallId))
    .orderBy(desc(edgeTraversals.exitedAt))
    .limit(1);

  const sinceMs = latest
    ? new Date(latest.exitedAt).getTime()
    : Date.now() - lookbackMinutes * 60_000;

  const [nodeRows, edgeRows, historyRows] = await Promise.all([
    db
      .select({ nodeId: navNodes.nodeId, xMm: navNodes.xMm, yMm: navNodes.yMm })
      .from(navNodes)
      .where(eq(navNodes.hallId, hallId)),
    db
      .select({
        edgeId: navEdges.edgeId,
        fromNodeId: navEdges.fromNodeId,
        toNodeId: navEdges.toNodeId,
        lengthMm: navEdges.lengthMm,
      })
      .from(navEdges)
      .where(eq(navEdges.hallId, hallId)),
    db
      .select({
        assetKind: assetPositionHistory.assetKind,
        assetRefId: assetPositionHistory.assetRefId,
        xMm: assetPositionHistory.xMm,
        yMm: assetPositionHistory.yMm,
        observedAt: assetPositionHistory.observedAt,
      })
      .from(assetPositionHistory)
      .where(
        and(
          eq(assetPositionHistory.hallId, hallId),
          gt(assetPositionHistory.observedAt, new Date(sinceMs).toISOString()),
        ),
      )
      .orderBy(asc(assetPositionHistory.observedAt)),
  ]);

  if (edgeRows.length === 0) {
    return { error: "This hall has no compiled navigation graph yet.", traversalsWritten: 0, bucketsUpdated: 0 };
  }
  if (historyRows.length === 0) {
    return { success: true, traversalsWritten: 0, bucketsUpdated: 0 };
  }

  const nodeById = new Map(nodeRows.map((n) => [n.nodeId, n]));
  const matchableEdges: MatchableEdge[] = [];
  for (const edge of edgeRows) {
    const from = nodeById.get(edge.fromNodeId);
    const to = nodeById.get(edge.toNodeId);
    if (!from || !to) continue;
    matchableEdges.push({
      edgeId: edge.edgeId,
      a: { x: from.xMm, y: from.yMm },
      b: { x: to.xMm, y: to.yMm },
      lengthMm: edge.lengthMm,
      // No stored per-edge capacity -- see docs on why the congestion signal
      // is duration-variance-based rather than occupancy/capacity-based.
      capacity: 1,
    });
  }

  const samples: PositionSample[] = historyRows.map((row) => ({
    assetKind: row.assetKind,
    assetRefId: row.assetRefId,
    x: row.xMm,
    y: row.yMm,
    observedAt: new Date(row.observedAt).getTime(),
  }));

  const traversals = matchTraversalsForStream(samples, matchableEdges);

  let organizationId: number;
  {
    const [ctx] = await db
      .select({ organizationId: navEdges.organizationId })
      .from(navEdges)
      .where(eq(navEdges.hallId, hallId))
      .limit(1);
    organizationId = ctx?.organizationId ?? 0;
  }

  const bucketMs = bucketMinutes * 60_000;
  const touchedBucketStarts = new Set<number>();
  const touchedEdgeIds = new Set<number>();

  if (traversals.length > 0) {
    await db.insert(edgeTraversals).values(
      traversals.map((t) => ({
        organizationId,
        warehouseId,
        hallId,
        edgeId: t.edgeId,
        assetKind: t.assetKind,
        assetRefId: t.assetRefId,
        enteredAt: new Date(t.enteredAt).toISOString(),
        exitedAt: new Date(t.exitedAt).toISOString(),
        durationMs: t.durationMs,
      })),
    );

    for (const t of traversals) {
      touchedBucketStarts.add(Math.floor(t.enteredAt / bucketMs) * bucketMs);
      touchedEdgeIds.add(t.edgeId);
    }
  }

  // Re-aggregate every bucket the new traversals touched, from the FULL set
  // of traversals in that bucket -- not just the new slice -- so a bucket
  // that gets traversals added across two rollup runs still ends up with a
  // correct percentile rather than one biased by whichever slice arrived
  // when.
  let bucketsUpdated = 0;
  if (touchedBucketStarts.size > 0) {
    const bucketRanges = Array.from(touchedBucketStarts).map((start) => ({
      start,
      end: start + bucketMs,
    }));
    const earliest = Math.min(...bucketRanges.map((r) => r.start));
    const latestEnd = Math.max(...bucketRanges.map((r) => r.end));

    const existing = await db
      .select({
        edgeId: edgeTraversals.edgeId,
        assetKind: edgeTraversals.assetKind,
        assetRefId: edgeTraversals.assetRefId,
        enteredAt: edgeTraversals.enteredAt,
        exitedAt: edgeTraversals.exitedAt,
        durationMs: edgeTraversals.durationMs,
      })
      .from(edgeTraversals)
      .where(
        and(
          eq(edgeTraversals.hallId, hallId),
          inArray(edgeTraversals.edgeId, Array.from(touchedEdgeIds)),
          gte(edgeTraversals.enteredAt, new Date(earliest).toISOString()),
        ),
      );

    const forAggregation = existing
      .filter((t) => new Date(t.enteredAt).getTime() < latestEnd)
      .map((t) => ({
        edgeId: t.edgeId,
        assetKind: t.assetKind,
        assetRefId: t.assetRefId,
        enteredAt: new Date(t.enteredAt).getTime(),
        exitedAt: new Date(t.exitedAt).getTime(),
        durationMs: t.durationMs,
        // distanceMm is only used to derive observedSpeedMms, which stats
        // already computed on first insert don't need recomputed from a
        // re-read -- 0 here simply means "no speed contribution" for rows
        // read back this way, which is acceptable since count/percentiles
        // (the numbers bottleneck detection and congestion actually use)
        // are unaffected by it.
        distanceMm: 0,
      }));

    const stats = aggregateEdgeStats(forAggregation, bucketMinutes);
    bucketsUpdated = stats.length;

    for (const stat of stats) {
      await db
        .insert(edgeTrafficStats)
        .values({
          organizationId,
          warehouseId,
          hallId,
          edgeId: stat.edgeId,
          bucketStart: new Date(stat.bucketStartMs).toISOString(),
          bucketMinutes,
          traversalCount: stat.traversalCount,
          p50DurationMs: stat.p50DurationMs,
          p95DurationMs: stat.p95DurationMs,
          meanOccupancy: stat.meanOccupancy.toFixed(2),
          observedSpeedMms: stat.observedSpeedMms,
        })
        .onConflictDoUpdate({
          target: [edgeTrafficStats.edgeId, edgeTrafficStats.bucketStart],
          set: {
            traversalCount: stat.traversalCount,
            p50DurationMs: stat.p50DurationMs,
            p95DurationMs: stat.p95DurationMs,
            meanOccupancy: stat.meanOccupancy.toFixed(2),
            ...(stat.observedSpeedMms != null && {
              observedSpeedMms: stat.observedSpeedMms,
            }),
            updatedAt: new Date().toISOString(),
          },
        });
    }

    // Advance the damped congestion state for every touched edge, using its
    // most recent bucket's duration-variance ratio as the observation. This
    // is what makes the EWMA genuinely incremental across rollup runs rather
    // than a fresh (and therefore un-damped) recompute each time.
    const latestStatByEdge = new Map<number, (typeof stats)[number]>();
    for (const stat of stats) {
      const existingLatest = latestStatByEdge.get(stat.edgeId);
      if (!existingLatest || stat.bucketStartMs > existingLatest.bucketStartMs) {
        latestStatByEdge.set(stat.edgeId, stat);
      }
    }

    if (latestStatByEdge.size > 0) {
      const priorStates = await db
        .select({
          edgeId: edgeCongestionState.edgeId,
          smoothedRatio: edgeCongestionState.smoothedRatio,
          activeMultiplier: edgeCongestionState.activeMultiplier,
        })
        .from(edgeCongestionState)
        .where(
          inArray(edgeCongestionState.edgeId, Array.from(latestStatByEdge.keys())),
        );
      const priorByEdge = new Map(priorStates.map((s) => [s.edgeId, s]));

      for (const [edgeId, stat] of latestStatByEdge) {
        if (stat.p50DurationMs <= 0) continue;
        // Duration-variance ratio, not occupancy/capacity: how much slower
        // the slow trips are than the typical trip, as a fraction. 0 means
        // uniform; this is the same quantity bottleneck detection judges.
        const ratio = stat.p95DurationMs / stat.p50DurationMs - 1;

        const prior = priorByEdge.get(edgeId);
        const next = advanceCongestionState(
          prior
            ? {
                edgeId,
                smoothedRatio: Number(prior.smoothedRatio),
                activeMultiplier: Number(prior.activeMultiplier),
              }
            : null,
          edgeId,
          ratio,
        );

        await db
          .insert(edgeCongestionState)
          .values({
            edgeId,
            warehouseId,
            hallId,
            smoothedRatio: next.smoothedRatio.toFixed(3),
            activeMultiplier: next.activeMultiplier.toFixed(2),
            updatedAt: new Date().toISOString(),
          })
          .onConflictDoUpdate({
            target: edgeCongestionState.edgeId,
            set: {
              smoothedRatio: next.smoothedRatio.toFixed(3),
              activeMultiplier: next.activeMultiplier.toFixed(2),
              updatedAt: new Date().toISOString(),
            },
          });
      }
    }
  }

  return {
    success: true,
    traversalsWritten: traversals.length,
    bucketsUpdated,
  };
}

export type BottleneckDTO = Bottleneck & {
  fromXMm: number;
  fromYMm: number;
  toXMm: number;
  toYMm: number;
};

/** Reads recent edge_traffic_stats and flags the edges worth a look. */
export async function getBottlenecks(
  warehouseId: number,
  hallId: number,
  lookbackMinutes = 120,
): Promise<BottleneckDTO[]> {
  await requireLiveMapContext(warehouseId);

  const since = new Date(Date.now() - lookbackMinutes * 60_000).toISOString();
  const statRows = await db
    .select({
      edgeId: edgeTrafficStats.edgeId,
      bucketStartMs: sql<string>`extract(epoch from ${edgeTrafficStats.bucketStart}) * 1000`,
      traversalCount: edgeTrafficStats.traversalCount,
      p50DurationMs: edgeTrafficStats.p50DurationMs,
      p95DurationMs: edgeTrafficStats.p95DurationMs,
      meanOccupancy: edgeTrafficStats.meanOccupancy,
      observedSpeedMms: edgeTrafficStats.observedSpeedMms,
    })
    .from(edgeTrafficStats)
    .where(
      and(
        eq(edgeTrafficStats.hallId, hallId),
        gte(edgeTrafficStats.bucketStart, since),
      ),
    );

  const stats = statRows.map((row) => ({
    edgeId: row.edgeId,
    bucketStartMs: Math.round(Number(row.bucketStartMs)),
    traversalCount: row.traversalCount,
    p50DurationMs: row.p50DurationMs ?? 0,
    p95DurationMs: row.p95DurationMs ?? 0,
    meanOccupancy: Number(row.meanOccupancy ?? 0),
    observedSpeedMms: row.observedSpeedMms,
  }));

  const bottlenecks = detectBottlenecks(stats);
  if (bottlenecks.length === 0) return [];

  const edgeIds = bottlenecks.map((b) => b.edgeId);
  const edgeRows = await db
    .select({
      edgeId: navEdges.edgeId,
      fromNodeId: navEdges.fromNodeId,
      toNodeId: navEdges.toNodeId,
    })
    .from(navEdges)
    .where(inArray(navEdges.edgeId, edgeIds));

  const nodeIds = Array.from(
    new Set(edgeRows.flatMap((e) => [e.fromNodeId, e.toNodeId])),
  );
  const nodeRows =
    nodeIds.length > 0
      ? await db
          .select({ nodeId: navNodes.nodeId, xMm: navNodes.xMm, yMm: navNodes.yMm })
          .from(navNodes)
          .where(inArray(navNodes.nodeId, nodeIds))
      : [];
  const nodeById = new Map(nodeRows.map((n) => [n.nodeId, n]));
  const edgeById = new Map(edgeRows.map((e) => [e.edgeId, e]));

  return bottlenecks
    .map((b) => {
      const edge = edgeById.get(b.edgeId);
      const from = edge ? nodeById.get(edge.fromNodeId) : undefined;
      const to = edge ? nodeById.get(edge.toNodeId) : undefined;
      if (!from || !to) return null;
      return {
        ...b,
        fromXMm: from.xMm,
        fromYMm: from.yMm,
        toXMm: to.xMm,
        toYMm: to.yMm,
      };
    })
    .filter((b): b is BottleneckDTO => b !== null);
}

/** Traffic-density heatmap over recent position history. */
export async function getHeatmapCells(
  warehouseId: number,
  hallId: number,
  options: { cellSizeMm?: number; lookbackMinutes?: number } = {},
): Promise<HeatmapCell[]> {
  await requireLiveMapContext(warehouseId);

  const cellSizeMm = options.cellSizeMm ?? 1000;
  const lookbackMinutes = options.lookbackMinutes ?? 120;
  const since = new Date(Date.now() - lookbackMinutes * 60_000).toISOString();

  const rows = await db
    .select({ xMm: assetPositionHistory.xMm, yMm: assetPositionHistory.yMm })
    .from(assetPositionHistory)
    .where(
      and(
        eq(assetPositionHistory.hallId, hallId),
        gte(assetPositionHistory.observedAt, since),
      ),
    );

  return binPositionsForHeatmap(
    rows.map((r) => ({ x: r.xMm, y: r.yMm })),
    cellSizeMm,
  );
}

/**
 * Current per-edge congestion multiplier, for merging into a routing graph's
 * impedance via `withImpedanceOverrides`. Not itself a routing call --
 * kept as a plain read so a caller can cache or batch it independently of
 * any specific route request.
 */
export async function getCongestionMultipliers(
  warehouseId: number,
  hallId: number,
): Promise<Map<number, number>> {
  await requireLiveMapContext(warehouseId);

  const rows = await db
    .select({
      edgeId: edgeCongestionState.edgeId,
      activeMultiplier: edgeCongestionState.activeMultiplier,
    })
    .from(edgeCongestionState)
    .where(eq(edgeCongestionState.hallId, hallId));

  const result = new Map<number, number>();
  for (const row of rows) {
    const multiplier = Number(row.activeMultiplier);
    if (multiplier !== 1) result.set(row.edgeId, multiplier);
  }
  return result;
}
