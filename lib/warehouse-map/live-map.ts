// Live map core: turning sparse position reports into something that reads as
// continuous motion, and turning that motion back into congestion numbers.
//
// Pure functions, no React and no Pixi, for the same reason as the compiler
// and the router: this is where the subtle errors live and a browser is a
// terrible place to find them.
//
// The central idea (docs §4.1): most warehouses have no RTLS, so do not
// architect as though they do. A barcode scan pins someone to a known
// location exactly; between scans, animate them along the route they were
// given and let confidence decay. That produces a map that looks and behaves
// correctly on infrastructure the customer already has, and degrades into
// real RTLS later by swapping the source.

import { distanceToSegment, projectOntoSegment, type Point } from "./geometry";

// --- Tuning ---------------------------------------------------------------

/** A scan fix is certain at the moment it happens. */
export const CONFIDENCE_AT_FIX = 1;
/** Confidence halves every this many ms without a new fix. */
export const CONFIDENCE_HALF_LIFE_MS = 45_000;
/** Below this, the asset is drawn as a ghost rather than a position. */
export const CONFIDENCE_STALE = 0.25;
/** Past this with no report at all, stop drawing the asset. */
export const ASSET_EXPIRY_MS = 10 * 60_000;
/** How far a reported point may be from an edge and still map-match to it. */
export const MAP_MATCH_TOLERANCE_MM = 3000;
/** Congestion window. Long enough to damp, short enough to react. */
export const CONGESTION_WINDOW_MS = 60_000;
/** Occupancy ratio above which an edge counts as congested. */
export const CONGESTION_THRESHOLD = 0.75;

export type PositionSource =
  | "SCAN"
  | "TASK_INFERRED"
  | "MHE_TELEMETRY"
  | "RTLS_UWB"
  | "WIFI_RSSI"
  | "BLE"
  | "MANUAL";

export type AssetStatus =
  | "IDLE"
  | "TRAVELLING"
  | "PICKING"
  | "PUTAWAY"
  | "CHARGING"
  | "BREAK"
  | "OFFLINE";

/** One asset as the live map knows it. */
export type LiveAsset = {
  assetKind: "EMPLOYEE" | "MHE";
  assetRefId: number;
  label: string;
  /** Last confirmed position, in world mm. */
  fixX: number;
  fixY: number;
  floorLevel: number;
  /** Epoch ms of that fix, on the server clock. */
  fixedAt: number;
  source: PositionSource;
  status: AssetStatus;
  headingDeg: number | null;
  /** Route the asset is following, if any, as a world-mm polyline. */
  routePoints?: Point[] | null;
  /** How fast we believe they move along it, mm/s. */
  speedMms?: number | null;
};

export type RenderedAsset = {
  assetKind: "EMPLOYEE" | "MHE";
  assetRefId: number;
  label: string;
  x: number;
  y: number;
  floorLevel: number;
  headingDeg: number | null;
  status: AssetStatus;
  confidence: number;
  /** True when the position is a guess along a route, not a real fix. */
  isInterpolated: boolean;
  ageMs: number;
};

/**
 * Confidence in a position, given how long ago it was fixed.
 *
 * Exponential decay rather than a cliff: a supervisor should see certainty
 * fade, not flip. A scan five seconds old and one five minutes old are both
 * "the last thing we know", but only one of them should be trusted.
 */
export function confidenceAt(
  ageMs: number,
  source: PositionSource = "SCAN",
): number {
  if (ageMs <= 0) return CONFIDENCE_AT_FIX;
  // A continuous telemetry source stays trustworthy far longer than a scan,
  // because silence from it means "not moving", not "we lost them".
  const halfLife =
    source === "RTLS_UWB" || source === "MHE_TELEMETRY"
      ? CONFIDENCE_HALF_LIFE_MS * 4
      : CONFIDENCE_HALF_LIFE_MS;
  return Math.max(0, Math.min(1, Math.pow(0.5, ageMs / halfLife)));
}

/** Total length of a polyline, and the cumulative length at each vertex. */
export function polylineMetrics(points: Point[]): {
  total: number;
  cumulative: number[];
} {
  const cumulative: number[] = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    cumulative.push(total);
  }
  return { total, cumulative };
}

/** The point a given distance along a polyline, plus the heading there. */
export function pointAlongPolyline(
  points: Point[],
  distanceMm: number,
): { point: Point; headingDeg: number } | null {
  if (points.length === 0) return null;
  if (points.length === 1) return { point: points[0], headingDeg: 0 };

  const { total, cumulative } = polylineMetrics(points);
  const clamped = Math.max(0, Math.min(distanceMm, total));

  for (let i = 1; i < points.length; i++) {
    if (cumulative[i] < clamped) continue;
    const segmentLength = cumulative[i] - cumulative[i - 1];
    const t = segmentLength > 0 ? (clamped - cumulative[i - 1]) / segmentLength : 0;
    const a = points[i - 1];
    const b = points[i];
    return {
      point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
      headingDeg: ((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 360) % 360,
    };
  }

  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  return {
    point: last,
    headingDeg: ((Math.atan2(last.y - prev.y, last.x - prev.x) * 180) / Math.PI + 360) % 360,
  };
}

/**
 * Where to draw an asset right now.
 *
 * If it has a route and is travelling, walk it forward from its last fix at
 * its nominal speed -- the projection never runs past the end of the route,
 * because arriving early and waiting is a much smaller lie than sailing
 * through the far wall.
 */
export function renderAssetAt(
  asset: LiveAsset,
  nowMs: number,
): RenderedAsset | null {
  const ageMs = Math.max(0, nowMs - asset.fixedAt);
  if (ageMs > ASSET_EXPIRY_MS) return null;

  const confidence = confidenceAt(ageMs, asset.source);
  const base: RenderedAsset = {
    assetKind: asset.assetKind,
    assetRefId: asset.assetRefId,
    label: asset.label,
    x: asset.fixX,
    y: asset.fixY,
    floorLevel: asset.floorLevel,
    headingDeg: asset.headingDeg,
    status: asset.status,
    confidence,
    isInterpolated: false,
    ageMs,
  };

  const route = asset.routePoints;
  if (
    asset.status !== "TRAVELLING" ||
    !route ||
    route.length < 2 ||
    !asset.speedMms ||
    asset.speedMms <= 0
  ) {
    return base;
  }

  // Anchor the projection at wherever on the route the fix actually was,
  // rather than assuming the fix was at the route's start.
  const anchor = nearestPointOnPolyline(route, { x: asset.fixX, y: asset.fixY });
  if (!anchor) return base;

  const travelled = anchor.distanceAlong + (asset.speedMms * ageMs) / 1000;
  const projected = pointAlongPolyline(route, travelled);
  if (!projected) return base;

  return {
    ...base,
    x: projected.point.x,
    y: projected.point.y,
    headingDeg: projected.headingDeg,
    isInterpolated: true,
  };
}

/** Closest point on a polyline, with how far along it that is. */
export function nearestPointOnPolyline(
  points: Point[],
  target: Point,
): { point: Point; distance: number; distanceAlong: number } | null {
  if (points.length === 0) return null;
  if (points.length === 1) {
    return {
      point: points[0],
      distance: Math.hypot(target.x - points[0].x, target.y - points[0].y),
      distanceAlong: 0,
    };
  }

  const { cumulative } = polylineMetrics(points);
  let best: { point: Point; distance: number; distanceAlong: number } | null = null;

  for (let i = 1; i < points.length; i++) {
    const projection = projectOntoSegment(target, {
      a: points[i - 1],
      b: points[i],
    });
    const segmentLength = cumulative[i] - cumulative[i - 1];
    const along = cumulative[i - 1] + projection.t * segmentLength;
    if (!best || projection.distance < best.distance) {
      best = {
        point: projection.point,
        distance: projection.distance,
        distanceAlong: along,
      };
    }
  }
  return best;
}

// --- Map matching and congestion ------------------------------------------

export type MatchableEdge = {
  edgeId: number;
  a: Point;
  b: Point;
  lengthMm: number;
  /** Concurrent occupants before the edge is considered full. */
  capacity: number;
};

/**
 * Snaps a position onto the edge it is most likely travelling.
 *
 * This is the input to every traffic number: without it a position is just a
 * dot, and with it becomes a traversal that can be counted, timed and
 * compared against free-flow.
 */
export function matchToEdge(
  point: Point,
  edges: MatchableEdge[],
  toleranceMm: number = MAP_MATCH_TOLERANCE_MM,
): { edgeId: number; distance: number } | null {
  let best: { edgeId: number; distance: number } | null = null;
  for (const edge of edges) {
    const distance = distanceToSegment(point, edge.a, edge.b);
    if (distance > toleranceMm) continue;
    if (!best || distance < best.distance) {
      best = { edgeId: edge.edgeId, distance };
    }
  }
  return best;
}

export type EdgeCongestion = {
  edgeId: number;
  occupants: number;
  capacity: number;
  /** occupants / capacity, uncapped -- 2 means twice as full as intended. */
  ratio: number;
  isCongested: boolean;
};

/**
 * Current occupancy per edge, from live positions.
 *
 * Feeding this back into edge impedance is what produces dynamic re-routing,
 * but the caller must damp it: naive congestion routing oscillates, because
 * everyone reroutes onto the empty aisle, which promptly becomes the
 * congested one (docs §4.5).
 */
export function computeCongestion(
  assets: RenderedAsset[],
  edges: MatchableEdge[],
  toleranceMm: number = MAP_MATCH_TOLERANCE_MM,
): EdgeCongestion[] {
  const occupancy = new Map<number, number>();
  for (const asset of assets) {
    // A stale guess should not be counted as a body in an aisle.
    if (asset.confidence < CONFIDENCE_STALE) continue;
    const match = matchToEdge({ x: asset.x, y: asset.y }, edges, toleranceMm);
    if (!match) continue;
    occupancy.set(match.edgeId, (occupancy.get(match.edgeId) ?? 0) + 1);
  }

  return edges.map((edge) => {
    const occupants = occupancy.get(edge.edgeId) ?? 0;
    const capacity = Math.max(1, edge.capacity);
    const ratio = occupants / capacity;
    return {
      edgeId: edge.edgeId,
      occupants,
      capacity,
      ratio,
      isCongested: ratio >= CONGESTION_THRESHOLD,
    };
  });
}

/**
 * Impedance multiplier for an edge at a given occupancy.
 *
 * Deliberately gentle and capped. An uncapped penalty makes the router treat
 * a busy aisle as impassable and send everyone the long way round, which is
 * usually worse than queueing for three seconds.
 */
export function congestionImpedance(ratio: number): number {
  if (ratio <= CONGESTION_THRESHOLD) return 1;
  return Math.min(3, 1 + (ratio - CONGESTION_THRESHOLD) * 2);
}

// --- Event stream ---------------------------------------------------------

export type MapEventKind =
  | "POSITION"
  | "TASK"
  | "ROUTE"
  | "BLOCKAGE"
  | "ALERT"
  | "LAYOUT";

export type MapEvent = {
  /** Server-assigned, monotonic per warehouse. Ordering uses this, never ts. */
  seq: number;
  /** Server clock. Device clocks in a warehouse are routinely minutes out. */
  ts: number;
  warehouseId: number;
  kind: MapEventKind;
  payload: unknown;
};

export type StreamState = {
  lastSeq: number;
  /** Set when a gap is detected -- the caller should refetch the snapshot. */
  needsResync: boolean;
};

/**
 * Applies an event to the stream cursor, detecting gaps.
 *
 * On a gap we refetch the whole snapshot rather than trying to reconcile:
 * a live map that is subtly wrong is worse than one that blinks.
 */
export function advanceStream(
  state: StreamState,
  event: MapEvent,
): StreamState {
  // Replays and out-of-order deliveries are ignored, not applied backwards.
  if (event.seq <= state.lastSeq) return state;
  if (state.lastSeq > 0 && event.seq !== state.lastSeq + 1) {
    return { lastSeq: event.seq, needsResync: true };
  }
  return { lastSeq: event.seq, needsResync: state.needsResync };
}

/**
 * Collapses a burst of position events down to the latest per asset.
 *
 * Sending one frame per asset per tick is what makes a live map fall over:
 * 200 forklifts at 5 Hz is 1,000 messages a second and the browser simply
 * drops them.
 */
export function coalescePositions<
  T extends { assetKind: string; assetRefId: number; fixedAt: number },
>(events: T[]): T[] {
  const latest = new Map<string, T>();
  for (const event of events) {
    const key = `${event.assetKind}:${event.assetRefId}`;
    const existing = latest.get(key);
    if (!existing || event.fixedAt >= existing.fixedAt) {
      latest.set(key, event);
    }
  }
  return Array.from(latest.values());
}
