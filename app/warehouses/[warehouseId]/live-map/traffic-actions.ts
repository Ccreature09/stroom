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
import { requireLiveMapHall } from "@/lib/warehouse-map/context";
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
 * First argument to `pg_advisory_xact_lock`, so rollup locks can never collide
 * with an advisory lock taken elsewhere for an unrelated purpose that happens
 * to share a hall id.
 */
const ROLLUP_LOCK_NAMESPACE = 4711;

/**
 * Background rollup: turns unprocessed `asset_position_history` into
 * `edge_traversals`, re-aggregates the buckets that touched, and advances
 * each affected edge's damped congestion state.
 *
 * "Background" here means "not on the request path of anything a user is
 * waiting on" -- this app has no queue or cron runner, so it is a plain
 * server action a supervisor (or a scheduled trigger) calls periodically.
 *
 * Three things make repeated and concurrent calls safe, and all three are
 * required:
 *
 *   1. A transaction-scoped advisory lock keyed on the hall. The high-water
 *      mark is read from the data this function writes, so without
 *      serialisation two concurrent runs read the same mark, recompute the
 *      same traversals, and both insert them.
 *   2. One transaction around the whole thing. Traversals used to be written
 *      before the stats were aggregated, so a failure in between left them
 *      committed AND past the high-water mark -- meaning the next run started
 *      after them and those buckets were never aggregated at all. Silent,
 *      permanent, and invisible from the outside.
 *   3. `uq_edge_traversal_event` plus onConflictDoNothing, so even if the lock
 *      is somehow bypassed (a different connection pool, a manual re-run) a
 *      duplicate is discarded by the database rather than double-counted.
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
  await requireLiveMapHall(warehouseId, hallId);

  const bucketMinutes = options.bucketMinutes ?? 15;
  const lookbackMinutes = options.lookbackMinutes ?? 240;

  try {
    return await db.transaction(async (tx) => {
      // Serialises rollups per hall for the life of this transaction. Held
      // across the high-water read AND the writes, because the gap between
      // those two is exactly the race. Released automatically on commit or
      // rollback, so a crashed run cannot wedge the hall.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${ROLLUP_LOCK_NAMESPACE}, ${hallId})`,
      );

      // High-water mark: the latest exit time already recorded for this hall.
      // Nothing before it needs reprocessing. A cold start (no traversals yet)
      // falls back to the lookback window rather than the dawn of history.
      const [latest] = await tx
        .select({ exitedAt: edgeTraversals.exitedAt })
        .from(edgeTraversals)
        .where(
          and(
            eq(edgeTraversals.warehouseId, warehouseId),
            eq(edgeTraversals.hallId, hallId),
          ),
        )
        .orderBy(desc(edgeTraversals.exitedAt))
        .limit(1);

      const sinceMs = latest
        ? new Date(latest.exitedAt).getTime()
        : Date.now() - lookbackMinutes * 60_000;

      const [nodeRows, edgeRows, historyRows] = await Promise.all([
        tx
          .select({ nodeId: navNodes.nodeId, xMm: navNodes.xMm, yMm: navNodes.yMm })
          .from(navNodes)
          .where(
            and(eq(navNodes.warehouseId, warehouseId), eq(navNodes.hallId, hallId)),
          ),
        tx
          .select({
            edgeId: navEdges.edgeId,
            edgeKey: navEdges.edgeKey,
            fromNodeId: navEdges.fromNodeId,
            toNodeId: navEdges.toNodeId,
            lengthMm: navEdges.lengthMm,
          })
          .from(navEdges)
          .where(
            and(eq(navEdges.warehouseId, warehouseId), eq(navEdges.hallId, hallId)),
          ),
        tx
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
              eq(assetPositionHistory.warehouseId, warehouseId),
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
      // Map-matching and aggregation work in live numeric edge ids -- they are
      // valid for the length of one run. Only persistence uses edge_key, so
      // the translation happens at the database boundary and the pure traffic
      // layer stays unaware of it.
      const keyByEdgeId = new Map<number, string>();
      const edgeIdByKey = new Map<string, number>();
      for (const edge of edgeRows) {
        keyByEdgeId.set(edge.edgeId, edge.edgeKey);
        edgeIdByKey.set(edge.edgeKey, edge.edgeId);
      }
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
        const [ctx] = await tx
          .select({ organizationId: navEdges.organizationId })
          .from(navEdges)
          .where(
            and(eq(navEdges.warehouseId, warehouseId), eq(navEdges.hallId, hallId)),
          )
          .limit(1);
        organizationId = ctx?.organizationId ?? 0;
      }

      const bucketMs = bucketMinutes * 60_000;
      const touchedBucketStarts = new Set<number>();
      const touchedEdgeIds = new Set<number>();

      let traversalsWritten = 0;
      if (traversals.length > 0) {
        // onConflictDoNothing rather than a plain insert: a re-run over an
        // overlapping window recomputes traversals that are already stored, and
        // those are the same event, not a second one. `returning` counts what
        // genuinely landed so the caller is not told it wrote rows it discarded.
        const inserted = await tx
          .insert(edgeTraversals)
          .values(
            traversals.map((t) => ({
              organizationId,
              warehouseId,
              hallId,
              edgeKey: keyByEdgeId.get(t.edgeId)!,
              assetKind: t.assetKind,
              assetRefId: t.assetRefId,
              enteredAt: new Date(t.enteredAt).toISOString(),
              exitedAt: new Date(t.exitedAt).toISOString(),
              durationMs: t.durationMs,
            })),
          )
          .onConflictDoNothing({
            target: [
              edgeTraversals.hallId,
              edgeTraversals.edgeKey,
              edgeTraversals.assetKind,
              edgeTraversals.assetRefId,
              edgeTraversals.enteredAt,
            ],
          })
          .returning({ traversalId: edgeTraversals.traversalId });
        traversalsWritten = inserted.length;

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

        const existing = await tx
          .select({
            edgeKey: edgeTraversals.edgeKey,
            assetKind: edgeTraversals.assetKind,
            assetRefId: edgeTraversals.assetRefId,
            enteredAt: edgeTraversals.enteredAt,
            exitedAt: edgeTraversals.exitedAt,
            durationMs: edgeTraversals.durationMs,
          })
          .from(edgeTraversals)
          .where(
            and(
              eq(edgeTraversals.warehouseId, warehouseId),
              eq(edgeTraversals.hallId, hallId),
              inArray(
              edgeTraversals.edgeKey,
              Array.from(touchedEdgeIds, (id) => keyByEdgeId.get(id)!),
            ),
              gte(edgeTraversals.enteredAt, new Date(earliest).toISOString()),
            ),
          );

        const forAggregation = existing
          .filter((t) => new Date(t.enteredAt).getTime() < latestEnd)
          .map((t) => ({
            // Back to a live id for aggregation. The filter above only asked
            // for keys we just matched, so every row here resolves.
            edgeId: edgeIdByKey.get(t.edgeKey)!,
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

        // One statement, not one per bucket. A busy hall touches hundreds of
        // buckets per run and each was its own round trip; inside a transaction
        // that also meant holding the advisory lock for the duration of all of
        // them. `excluded` is the row that failed to insert, so the update takes
        // the new values without restating them per row.
        if (stats.length > 0) {
          await tx
            .insert(edgeTrafficStats)
            .values(
              stats.map((stat) => ({
                organizationId,
                warehouseId,
                hallId,
                edgeKey: keyByEdgeId.get(stat.edgeId)!,
                bucketStart: new Date(stat.bucketStartMs).toISOString(),
                bucketMinutes,
                traversalCount: stat.traversalCount,
                p50DurationMs: stat.p50DurationMs,
                p95DurationMs: stat.p95DurationMs,
                meanOccupancy: stat.meanOccupancy.toFixed(2),
                observedSpeedMms: stat.observedSpeedMms,
              })),
            )
            .onConflictDoUpdate({
              target: [
            edgeTrafficStats.hallId,
            edgeTrafficStats.edgeKey,
            edgeTrafficStats.bucketStart,
          ],
              set: {
                traversalCount: sql`excluded.traversal_count`,
                p50DurationMs: sql`excluded.p50_duration_ms`,
                p95DurationMs: sql`excluded.p95_duration_ms`,
                meanOccupancy: sql`excluded.mean_occupancy`,
                // Keep the stored speed when this batch could not observe one --
                // a bucket re-read for aggregation carries distanceMm 0, so
                // overwriting unconditionally would erase a real measurement.
                observedSpeedMms: sql`coalesce(excluded.observed_speed_mms, ${edgeTrafficStats.observedSpeedMms})`,
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
          const priorStates = await tx
            .select({
              edgeKey: edgeCongestionState.edgeKey,
              smoothedRatio: edgeCongestionState.smoothedRatio,
              activeMultiplier: edgeCongestionState.activeMultiplier,
            })
            .from(edgeCongestionState)
            .where(
              and(
                eq(edgeCongestionState.hallId, hallId),
                inArray(
                  edgeCongestionState.edgeKey,
                  Array.from(latestStatByEdge.keys(), (id) => keyByEdgeId.get(id)!),
                ),
              ),
            );
          const priorByEdge = new Map(
            priorStates.map((s) => [edgeIdByKey.get(s.edgeKey)!, s]),
          );
          const nextStates: Array<{
            edgeKey: string;
            warehouseId: number;
            hallId: number;
            smoothedRatio: string;
            activeMultiplier: string;
            updatedAt: string;
          }> = [];

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

            nextStates.push({
              edgeKey: keyByEdgeId.get(edgeId)!,
              warehouseId,
              hallId,
              smoothedRatio: next.smoothedRatio.toFixed(3),
              activeMultiplier: next.activeMultiplier.toFixed(2),
              updatedAt: new Date().toISOString(),
            });
          }

          if (nextStates.length > 0) {
            await tx
              .insert(edgeCongestionState)
              .values(nextStates)
              .onConflictDoUpdate({
                target: [
                  edgeCongestionState.hallId,
                  edgeCongestionState.edgeKey,
                ],
                set: {
                  smoothedRatio: sql`excluded.smoothed_ratio`,
                  activeMultiplier: sql`excluded.active_multiplier`,
                  updatedAt: sql`excluded.updated_at`,
                },
              });
          }
        }
      }

      return {
        success: true as const,
        traversalsWritten,
        bucketsUpdated,
      };
    });
  } catch (err) {
    // The whole transaction rolled back, so nothing partial was kept: no
    // traversals past an un-aggregated bucket, and the high-water mark is
    // exactly where it was. Re-running is the correct recovery.
    return {
      error:
        (err as Error).message || "The traffic rollup failed and was rolled back.",
      traversalsWritten: 0,
      bucketsUpdated: 0,
    };
  }
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
  await requireLiveMapHall(warehouseId, hallId);

  const since = new Date(Date.now() - lookbackMinutes * 60_000).toISOString();

  // Stats persist against the stable key, so resolving live ids means going
  // through the current graph. A key with no row here belongs to an edge that
  // no longer exists -- its history is retained but there is nothing on the
  // map to point at, so it drops out below.
  const liveEdges = await db
    .select({
      edgeId: navEdges.edgeId,
      edgeKey: navEdges.edgeKey,
      fromNodeId: navEdges.fromNodeId,
      toNodeId: navEdges.toNodeId,
    })
    .from(navEdges)
    .where(and(eq(navEdges.warehouseId, warehouseId), eq(navEdges.hallId, hallId)));
  const edgeIdByKey = new Map(liveEdges.map((e) => [e.edgeKey, e.edgeId]));

  const statRows = await db
    .select({
      edgeKey: edgeTrafficStats.edgeKey,
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
        eq(edgeTrafficStats.warehouseId, warehouseId),
        eq(edgeTrafficStats.hallId, hallId),
        gte(edgeTrafficStats.bucketStart, since),
      ),
    );

  const stats = statRows.flatMap((row) => {
    const edgeId = edgeIdByKey.get(row.edgeKey);
    if (edgeId === undefined) return [];
    return [{
      edgeId,
      bucketStartMs: Math.round(Number(row.bucketStartMs)),
      traversalCount: row.traversalCount,
      p50DurationMs: row.p50DurationMs ?? 0,
      p95DurationMs: row.p95DurationMs ?? 0,
      meanOccupancy: Number(row.meanOccupancy ?? 0),
      observedSpeedMms: row.observedSpeedMms,
    }];
  });

  const bottlenecks = detectBottlenecks(stats);
  if (bottlenecks.length === 0) return [];

  const flagged = new Set(bottlenecks.map((b) => b.edgeId));
  const edgeRows = liveEdges.filter((e) => flagged.has(e.edgeId));

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
  await requireLiveMapHall(warehouseId, hallId);

  const cellSizeMm = options.cellSizeMm ?? 1000;
  const lookbackMinutes = options.lookbackMinutes ?? 120;
  const since = new Date(Date.now() - lookbackMinutes * 60_000).toISOString();

  const rows = await db
    .select({ xMm: assetPositionHistory.xMm, yMm: assetPositionHistory.yMm })
    .from(assetPositionHistory)
    .where(
      and(
        eq(assetPositionHistory.warehouseId, warehouseId),
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
  await requireLiveMapHall(warehouseId, hallId);

  // Joined to the live graph so the caller gets edge ids it can apply to a
  // compiled routing graph. State for an edge that no longer exists is kept in
  // the table -- redrawing that aisle brings its learned congestion back --
  // but has nothing to apply to right now, so the join drops it.
  const rows = await db
    .select({
      edgeId: navEdges.edgeId,
      activeMultiplier: edgeCongestionState.activeMultiplier,
    })
    .from(edgeCongestionState)
    .innerJoin(
      navEdges,
      and(
        eq(navEdges.hallId, edgeCongestionState.hallId),
        eq(navEdges.edgeKey, edgeCongestionState.edgeKey),
      ),
    )
    .where(
      and(
        eq(edgeCongestionState.warehouseId, warehouseId),
        eq(edgeCongestionState.hallId, hallId),
      ),
    );

  const result = new Map<number, number>();
  for (const row of rows) {
    const multiplier = Number(row.activeMultiplier);
    if (multiplier !== 1) result.set(row.edgeId, multiplier);
  }
  return result;
}
