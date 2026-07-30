// Traffic analytics: turning a position stream into edge traversals, and
// traversals into the numbers that matter -- bottlenecks, learned travel
// time, and a congestion signal the router can actually use.
//
// Pure functions, no DB, no React -- same rule as the compiler and the
// router, and for the same reason: this is where a subtle averaging or
// windowing bug hides, and a background job is a worse place to find it than
// a unit test.
//
// The pipeline (docs §4.6):
//   position history --map-match--> traversal segments --aggregate--> stats
//   stats --> bottleneck detection, EWMA travel time, damped congestion

import type { Point } from "./geometry";
import {
  MAP_MATCH_TOLERANCE_MM,
  matchToEdge,
  type MatchableEdge,
} from "./live-map";

// --- Tuning -----------------------------------------------------------

/** Default rollup bucket. Coarse enough that traversal counts per bucket are
 *  large enough to make a percentile meaningful on a normal shift's traffic. */
export const DEFAULT_BUCKET_MINUTES = 15;
/** A p95/p50 ratio above this means high variance, not just high traffic --
 *  variance is the bottleneck signal, not raw count (docs §4.6). */
export const BOTTLENECK_RATIO_THRESHOLD = 1.8;
/** Below this many traversals in the window, a ratio is noise, not a signal. */
export const BOTTLENECK_MIN_TRAVERSALS = 8;
/** EWMA smoothing for observed edge speed. Low alpha: the graph should learn
 *  slowly, not swing on one forklift having a bad lap. */
export const SPEED_EWMA_ALPHA = 0.2;
/** EWMA smoothing for the congestion ratio that feeds routing impedance.
 *  Deliberately much slower than the speed EWMA: the doc's explicit warning
 *  is that naive congestion routing oscillates -- everyone reroutes onto the
 *  empty aisle, which becomes the congested one. A slow-moving signal is
 *  what prevents that. */
export const CONGESTION_EWMA_ALPHA = 0.1;
/** A new congestion multiplier only replaces the old one if it is at least
 *  this much better/worse -- the hysteresis band that stops a router from
 *  flip-flopping between two routes of nearly equal cost. */
export const CONGESTION_HYSTERESIS_MARGIN = 0.15;

// --- Map-matched traversals ---------------------------------------------

export type PositionSample = {
  assetKind: string;
  assetRefId: number;
  x: number;
  y: number;
  observedAt: number; // epoch ms
};

export type EdgeTraversal = {
  edgeId: number;
  assetKind: string;
  assetRefId: number;
  enteredAt: number;
  exitedAt: number;
  durationMs: number;
  distanceMm: number;
};

/**
 * Converts one asset's position stream into traversal segments.
 *
 * A traversal is a maximal run of consecutive samples that map-match to the
 * same edge. Samples must already be in time order for one asset; callers
 * group by (assetKind, assetRefId) before calling this, because grouping
 * here would silently interleave two assets' history into one traversal.
 *
 * A single stray sample that briefly matches a different edge (a scan noise
 * point, a corner cutting close to a neighbouring aisle) breaks the run
 * rather than being smoothed over -- smoothing it away would hide exactly
 * the kind of map-matching error you want surfaced, not buried in an average.
 */
export function matchTraversals(
  samples: PositionSample[],
  edges: MatchableEdge[],
  toleranceMm: number = MAP_MATCH_TOLERANCE_MM,
): EdgeTraversal[] {
  if (samples.length === 0) return [];

  const traversals: EdgeTraversal[] = [];
  let current: {
    edgeId: number;
    assetKind: string;
    assetRefId: number;
    enteredAt: number;
    lastAt: number;
    lastPoint: Point;
    distanceMm: number;
  } | null = null;

  function flush(exitedAt: number) {
    if (!current) return;
    traversals.push({
      edgeId: current.edgeId,
      assetKind: current.assetKind,
      assetRefId: current.assetRefId,
      enteredAt: current.enteredAt,
      exitedAt,
      durationMs: Math.max(0, exitedAt - current.enteredAt),
      distanceMm: current.distanceMm,
    });
    current = null;
  }

  for (const sample of samples) {
    const match = matchToEdge(
      { x: sample.x, y: sample.y },
      edges,
      toleranceMm,
    );

    if (!match) {
      flush(sample.observedAt);
      continue;
    }

    if (current && current.edgeId === match.edgeId) {
      current.distanceMm += Math.hypot(
        sample.x - current.lastPoint.x,
        sample.y - current.lastPoint.y,
      );
      current.lastAt = sample.observedAt;
      current.lastPoint = { x: sample.x, y: sample.y };
      continue;
    }

    // Edge changed (or this is the first sample): the previous run ends at
    // this sample's time -- the asset was still "in transit" between the two
    // right up until it was seen on the new edge.
    flush(sample.observedAt);
    current = {
      edgeId: match.edgeId,
      assetKind: sample.assetKind,
      assetRefId: sample.assetRefId,
      enteredAt: sample.observedAt,
      lastAt: sample.observedAt,
      lastPoint: { x: sample.x, y: sample.y },
      distanceMm: 0,
    };
  }

  if (current) flush((current as typeof current).lastAt);

  // A traversal with no measurable duration (a single sample, or two samples
  // at the same timestamp) tells us an edge was touched, not how long it took
  // -- it would corrupt a duration percentile, so it is dropped here rather
  // than downstream.
  return traversals.filter((t) => t.durationMs > 0);
}

/**
 * Groups a mixed stream by asset and runs matchTraversals per asset.
 *
 * This is the entry point a caller with raw, unsorted position_history rows
 * actually wants -- it does the grouping and ordering that matchTraversals
 * requires, so a caller cannot forget it and silently interleave assets.
 */
export function matchTraversalsForStream(
  samples: PositionSample[],
  edges: MatchableEdge[],
  toleranceMm: number = MAP_MATCH_TOLERANCE_MM,
): EdgeTraversal[] {
  const byAsset = new Map<string, PositionSample[]>();
  for (const sample of samples) {
    const key = `${sample.assetKind}:${sample.assetRefId}`;
    const list = byAsset.get(key) ?? [];
    list.push(sample);
    byAsset.set(key, list);
  }

  const result: EdgeTraversal[] = [];
  for (const list of byAsset.values()) {
    list.sort((a, b) => a.observedAt - b.observedAt);
    result.push(...matchTraversals(list, edges, toleranceMm));
  }
  return result;
}

// --- Aggregation ----------------------------------------------------------

export type EdgeBucketStats = {
  edgeId: number;
  bucketStartMs: number;
  traversalCount: number;
  p50DurationMs: number;
  p95DurationMs: number;
  /** Mean concurrent occupants, estimated from traversal overlap within the
   *  bucket -- not a live headcount, a historical average. */
  meanOccupancy: number;
  /** mm/s, from the traversals actually observed in this bucket. */
  observedSpeedMms: number | null;
};

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const index = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

/**
 * Rolls traversals up into fixed-width time buckets per edge.
 *
 * Bucket boundaries are aligned to epoch time (floor to bucket width), not to
 * the first traversal seen -- so re-running this over overlapping windows of
 * history always produces the same bucket boundaries and upserts land on the
 * same row instead of creating fragments.
 */
export function aggregateEdgeStats(
  traversals: EdgeTraversal[],
  bucketMinutes: number = DEFAULT_BUCKET_MINUTES,
): EdgeBucketStats[] {
  const bucketMs = bucketMinutes * 60_000;
  const groups = new Map<string, EdgeTraversal[]>();

  for (const traversal of traversals) {
    const bucketStart = Math.floor(traversal.enteredAt / bucketMs) * bucketMs;
    const key = `${traversal.edgeId}:${bucketStart}`;
    const list = groups.get(key) ?? [];
    list.push(traversal);
    groups.set(key, list);
  }

  const stats: EdgeBucketStats[] = [];
  for (const [key, group] of groups) {
    const [edgeIdStr, bucketStartStr] = key.split(":");
    const edgeId = Number(edgeIdStr);
    const bucketStartMs = Number(bucketStartStr);
    const bucketEndMs = bucketStartMs + bucketMs;

    const durations = group.map((t) => t.durationMs).sort((a, b) => a - b);

    // Mean occupancy: total "asset-time" spent on this edge within the
    // bucket, clipped to the bucket's own window, divided by the bucket
    // length. This is an average over history, so clipping at the boundary
    // (rather than counting a traversal's full duration in every bucket it
    // touches) is what keeps neighbouring buckets from double-counting it.
    let occupantMs = 0;
    for (const t of group) {
      const clippedStart = Math.max(t.enteredAt, bucketStartMs);
      const clippedEnd = Math.min(t.exitedAt, bucketEndMs);
      occupantMs += Math.max(0, clippedEnd - clippedStart);
    }
    const meanOccupancy = occupantMs / bucketMs;

    const speeds = group
      .filter((t) => t.distanceMm > 0 && t.durationMs > 0)
      .map((t) => (t.distanceMm / t.durationMs) * 1000);
    const observedSpeedMms =
      speeds.length > 0
        ? Math.round(speeds.reduce((sum, s) => sum + s, 0) / speeds.length)
        : null;

    stats.push({
      edgeId,
      bucketStartMs,
      traversalCount: group.length,
      p50DurationMs: Math.round(percentile(durations, 50)),
      p95DurationMs: Math.round(percentile(durations, 95)),
      meanOccupancy: Math.round(meanOccupancy * 100) / 100,
      observedSpeedMms,
    });
  }

  return stats;
}

// --- Bottleneck detection --------------------------------------------------

export type Bottleneck = {
  edgeId: number;
  ratio: number;
  traversalCount: number;
  p50DurationMs: number;
  p95DurationMs: number;
};

/**
 * Flags edges whose p95/p50 ratio is high AND whose traversal count is
 * meaningful.
 *
 * High variance is the signal, not high count (docs §4.6): a busy main road
 * with consistent travel time is working as designed, while a moderately
 * used aisle where some trips take twice as long as others is where people
 * are actually getting stuck -- congestion, a blind corner, a bay someone
 * parked in front of.
 */
export function detectBottlenecks(
  stats: EdgeBucketStats[],
  options: {
    ratioThreshold?: number;
    minTraversals?: number;
  } = {},
): Bottleneck[] {
  const ratioThreshold = options.ratioThreshold ?? BOTTLENECK_RATIO_THRESHOLD;
  const minTraversals = options.minTraversals ?? BOTTLENECK_MIN_TRAVERSALS;

  // Multiple buckets per edge are merged before judging it, so a single busy
  // 15-minute window does not get flagged (or missed) in isolation.
  const byEdge = new Map<number, EdgeBucketStats[]>();
  for (const stat of stats) {
    const list = byEdge.get(stat.edgeId) ?? [];
    list.push(stat);
    byEdge.set(stat.edgeId, list);
  }

  const results: Bottleneck[] = [];
  for (const [edgeId, group] of byEdge) {
    const traversalCount = group.reduce((sum, s) => sum + s.traversalCount, 0);
    if (traversalCount < minTraversals) continue;

    // Traversal-count-weighted average of each bucket's percentiles, rather
    // than re-deriving a percentile across buckets (which would need the raw
    // durations this function deliberately does not carry).
    const weightedP50 =
      group.reduce((sum, s) => sum + s.p50DurationMs * s.traversalCount, 0) /
      traversalCount;
    const weightedP95 =
      group.reduce((sum, s) => sum + s.p95DurationMs * s.traversalCount, 0) /
      traversalCount;

    if (weightedP50 <= 0) continue;
    const ratio = weightedP95 / weightedP50;
    if (ratio < ratioThreshold) continue;

    results.push({
      edgeId,
      ratio: Math.round(ratio * 100) / 100,
      traversalCount,
      p50DurationMs: Math.round(weightedP50),
      p95DurationMs: Math.round(weightedP95),
    });
  }

  return results.sort((a, b) => b.ratio - a.ratio);
}

// --- Learned travel time ----------------------------------------------

/**
 * Exponential moving average update, generic over any single running signal.
 *
 * Used both for observed edge speed and for the congestion ratio -- same
 * shape, deliberately different alphas, because the two decisions have
 * different tolerances for reacting to a single new sample.
 */
export function ewmaUpdate(
  previous: number | null,
  sample: number,
  alpha: number,
): number {
  if (previous === null || !Number.isFinite(previous)) return sample;
  return previous + alpha * (sample - previous);
}

// --- Damped congestion multiplier ------------------------------------------

export type CongestionState = {
  edgeId: number;
  /** Smoothed occupancy ratio, [0, +inf). */
  smoothedRatio: number;
  /** The multiplier actually in effect, which may lag smoothedRatio because
   *  of the hysteresis band below. */
  activeMultiplier: number;
};

/**
 * Advances one edge's congestion state by one observation.
 *
 * Two dampers, both required (docs §4.5 / §5.9):
 *   1. EWMA on the ratio itself, so one crowded moment doesn't spike the
 *      multiplier.
 *   2. A hysteresis band on the multiplier: it only moves once the smoothed
 *      ratio implies a multiplier at least CONGESTION_HYSTERESIS_MARGIN away
 *      from the one currently in effect.
 *
 * Without both, congestion-aware routing oscillates: everyone reroutes onto
 * the aisle that just went quiet, which promptly becomes the congested one,
 * which reroutes everyone back.
 */
export function advanceCongestionState(
  previous: CongestionState | null,
  edgeId: number,
  observedRatio: number,
  alpha: number = CONGESTION_EWMA_ALPHA,
  hysteresisMargin: number = CONGESTION_HYSTERESIS_MARGIN,
): CongestionState {
  const smoothedRatio = ewmaUpdate(
    previous?.smoothedRatio ?? null,
    observedRatio,
    alpha,
  );

  const candidateMultiplier = congestionMultiplierFor(smoothedRatio);
  const currentMultiplier = previous?.activeMultiplier ?? 1;
  const delta = Math.abs(candidateMultiplier - currentMultiplier);

  return {
    edgeId,
    smoothedRatio,
    activeMultiplier:
      delta >= hysteresisMargin ? candidateMultiplier : currentMultiplier,
  };
}

/** Same curve as live-map.ts's congestionImpedance -- capped, so a busy
 *  aisle is discouraged, never treated as impassable. */
function congestionMultiplierFor(ratio: number): number {
  const threshold = 0.75;
  if (ratio <= threshold) return 1;
  return Math.min(3, 1 + (ratio - threshold) * 2);
}

// --- Heatmap ----------------------------------------------------------

export type HeatmapCell = {
  cellX: number;
  cellY: number;
  count: number;
};

/**
 * Bins a position stream into a grid for a traffic-density heatmap.
 *
 * Deliberately count-based, not a KDE or other smoothed density: a
 * supervisor reading the map wants "how many observations landed here",
 * which is what the mesh colour ramp on the live map actually renders.
 */
export function binPositionsForHeatmap(
  points: Point[],
  cellSizeMm: number,
): HeatmapCell[] {
  if (cellSizeMm <= 0) return [];
  const counts = new Map<string, HeatmapCell>();

  for (const point of points) {
    const cellX = Math.floor(point.x / cellSizeMm);
    const cellY = Math.floor(point.y / cellSizeMm);
    const key = `${cellX}:${cellY}`;
    const existing = counts.get(key);
    if (existing) existing.count++;
    else counts.set(key, { cellX, cellY, count: 1 });
  }

  return Array.from(counts.values());
}
