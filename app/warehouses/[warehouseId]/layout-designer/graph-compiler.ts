// Compiles a hall's layout into a navigation graph.
//   1. ingest authored lane features
//   2. infer corridors between adjacent rack runs
//   3. connect corridor ends that can see each other
//   4. split every segment at its intersections
//   5. dedupe nodes onto a snap grid
//   6. attach portals (doors, gates, lifts)
//   7. attach location access points, splitting corridors at each pick face
//   8. validate connectivity and aisle widths

import type { FeatureDTO, LocationDTO } from "./types";
import {
  computeEnvelope,
  projectOntoSegment,
  segmentIntersection,
  segmentIntersectsRect,
  type Point,
  type Rect,
  type Segment,
} from "./geometry";
export { segmentIntersectsRect };

// --- Tuning ---------------------------------------------------------------

/** Nodes closer than this collapse into one. Also the endpoint-alignment
 *  tolerance when looking for cross-aisle candidates. */
export const SNAP_MM = 250;
/**
 * Radius within which two points become one node. Must be strictly greater
 * than twice SNAP_MM, and that relationship is load-bearing.
 *
 * `applyCuts` drops a cut that lands within SNAP_MM of a segment end, because
 * splitting there would emit a zero-length stub. When two segments cross near
 * one of their endpoints, the cut is therefore dropped on both -- and each
 * endpoint can be up to SNAP_MM from the true intersection, so they can end up
 * 2 x SNAP_MM apart. If the merge radius were not wider than that, the two
 * lanes would look joined on the canvas and be disconnected in the graph.
 **/
export const MERGE_RADIUS_MM = SNAP_MM * 2 + 50;
/** A gap narrower than this is a rack-to-rack tolerance, not a corridor. */
export const MIN_CORRIDOR_MM = 800;
/** Wider than this is open floor, not an aisle; inferring a single centerline
 *  down the middle of it would be a guess rather than a deduction. */
export const MAX_CORRIDOR_MM = 8000;
/** Two runs must face each other over at least this much length to imply a
 *  corridor between them. */
export const MIN_OVERLAP_MM = 2000;
/** Bays further apart than this along a band are separate runs. */
export const RUN_BREAK_MM = 1500;
/** Perimeter corridors are offset this far from the outermost rack face. */
export const PERIMETER_OFFSET_MM = 1500;
/** Longest cross-aisle the compiler will invent between corridor ends. */
export const MAX_CONNECTOR_MM = 20000;
/** Fixed cost of servicing a pick face, before any lifting. */
export const HANDLING_BASE_MS = 15000;
/** Extra handling cost per rack level above the first. Level changes lift
 *  time, never travel distance -- level 4 is at the same (x, y) as level 1. */
export const HANDLING_PER_LEVEL_MS = 8000;
/** Default clear height assumed for a traveller when a hall has none set. */
export const DEFAULT_TRAVELLER_HEIGHT_MM = 2200;

const LANE_FEATURE_KINDS = new Set([
  "TRAVEL_LANE",
  "MAIN_ROAD",
  "CROSS_AISLE",
  "PEDESTRIAN_WALKWAY",
]);
const PORTAL_FEATURE_KINDS = new Set([
  "DOOR_PERSONNEL",
  "GATE",
  "ROLLER_SHUTTER",
  "DOCK_DOOR",
  "RAMP",
  "STAIRS",
  "GOODS_LIFT",
]);
const DOCK_FEATURE_KINDS = new Set(["DOCK_DOOR"]);

// --- Types ----------------------------------------------------------------

export type VehicleProfile = {
  mheTypeId: number;
  name: string;
  classBit: number;
  isPedestrian: boolean;
  minAisleWidthMm: number | null;
  maxSpeedLadenMms: number | null;
  heightMm: number | null;
};

export type CompiledNode = {
  key: string;
  xMm: number;
  yMm: number;
  floorLevel: number;
  nodeKind:
    | "WAYPOINT"
    | "INTERSECTION"
    | "ACCESS"
    | "DOCK"
    | "PORTAL"
    | "CHARGE"
    | "PARK"
    | "STAGE";
  sourceFeatureId: number | null;
  portalGroupId: number | null;
};

export type CompiledEdge = {
  fromKey: string;
  toKey: string;
  edgeKind: "LANE" | "AISLE" | "CROSS_AISLE" | "WALKWAY" | "PORTAL" | "ACCESS";
  traversal: "BIDIRECTIONAL" | "FORWARD_ONLY" | "REVERSE_ONLY";
  lengthMm: number;
  widthMm: number | null;
  maxSpeedMms: number | null;
  minClearanceMm: number | null;
  allowedVehicleMask: number;
  sourceFeatureId: number | null;
};

export type CompiledAccessPoint = {
  locationId: number;
  nodeKey: string;
  face: "FRONT" | "BACK" | "LEFT" | "RIGHT";
  approachHeadingDeg: number;
  offsetMm: number;
  handlingTimeMs: number;
  allowedVehicleMask: number;
  isPrimary: boolean;
};

export type CompileWarning = {
  code:
    | "NO_RACKING"
    | "NO_CORRIDORS"
    | "LANE_CROSSES_OBSTACLE"
    | "DISCONNECTED_GRAPH"
    | "UNREACHABLE_LOCATIONS"
    | "AISLE_TOO_NARROW"
    | "PORTAL_UNLINKED"
    | "LOCATION_WITHOUT_ACCESS";
  message: string;
  featureIds?: number[];
  locationIds?: number[];
};

export type CompileResult = {
  nodes: CompiledNode[];
  edges: CompiledEdge[];
  accessPoints: CompiledAccessPoint[];
  warnings: CompileWarning[];
  stats: {
    rackRuns: number;
    inferredCorridors: number;
    authoredLanes: number;
    connectors: number;
    componentCount: number;
    reachableLocationCount: number;
    unreachableLocationCount: number;
  };
};

export type CompilerInput = {
  hall: {
    hallId: number;
    physicalWidthMm: number;
    physicalLengthMm: number;
    clearHeightMm: number | null;
  };
  locations: LocationDTO[];
  features: FeatureDTO[];
  vehicles: VehicleProfile[];
  floorLevel?: number;
};

// --- Rack runs ------------------------------------------------------------

type RackRun = {
  axis: "H" | "V";
  /** Extent across the run (the rack's depth). */
  bandMin: number;
  bandMax: number;
  /** Extent along the run. */
  spanMin: number;
  spanMax: number;
  rect: Rect;
};

type BayFootprint = {
  rect: Rect;
  locationIds: number[];
  levels: Map<number, number[]>;
};

/**
 * Collapses storage locations into distinct physical footprints. Multiple
 * rows share one footprint (one per rack level), and the graph only cares
 * about the floor plan.
 */
export function collectBayFootprints(
  locations: LocationDTO[],
  floorLevel: number,
): BayFootprint[] {
  const byRect = new Map<string, BayFootprint>();

  for (const loc of locations) {
    if (loc.floorLevel !== floorLevel) continue;
    if (loc.locationType === "NONE") continue;

    const envelope = computeEnvelope({
      geometryKind: "RECT",
      originXMm: loc.physicalX,
      originYMm: loc.physicalY,
      widthMm: loc.physicalWidthMm,
      lengthMm: loc.physicalLengthMm,
      rotationDegrees: loc.rotationDegrees,
      points: null,
    });
    const key = `${envelope.minX}:${envelope.minY}:${envelope.maxX}:${envelope.maxY}`;

    let footprint = byRect.get(key);
    if (!footprint) {
      footprint = {
        rect: {
          minX: envelope.minX,
          minY: envelope.minY,
          maxX: envelope.maxX,
          maxY: envelope.maxY,
        },
        locationIds: [],
        levels: new Map(),
      };
      byRect.set(key, footprint);
    }
    footprint.locationIds.push(loc.locationId);
    const level = loc.level ?? 1;
    const atLevel = footprint.levels.get(level) ?? [];
    atLevel.push(loc.locationId);
    footprint.levels.set(level, atLevel);
  }

  return Array.from(byRect.values());
}

/**
 * Groups footprints into contiguous rack runs.
 *
 * Runs are derived from geometry, not from the `aisle` column: once a
 * supervisor drags half an aisle somewhere else, the aisle number no longer
 * describes a contiguous physical run. Real edited layouts do exactly that.
 */
export function inferRackRuns(footprints: BayFootprint[]): RackRun[] {
  const runs: RackRun[] = [];

  for (const axis of ["H", "V"] as const) {
    // Band = the cross-axis interval a footprint occupies. Identical bands
    // (within snap tolerance) are candidates for the same run.
    const bands = new Map<string, BayFootprint[]>();
    for (const footprint of footprints) {
      const width = footprint.rect.maxX - footprint.rect.minX;
      const height = footprint.rect.maxY - footprint.rect.minY;
      // A footprint joins the horizontal pass if it is wider than tall, and
      // the vertical pass otherwise; square ones try both.
      if (axis === "H" && height > width) continue;
      if (axis === "V" && width > height) continue;

      const bandLow = axis === "H" ? footprint.rect.minY : footprint.rect.minX;
      const bandHigh = axis === "H" ? footprint.rect.maxY : footprint.rect.maxX;
      const key = `${Math.round(bandLow / SNAP_MM)}:${Math.round(bandHigh / SNAP_MM)}`;
      const list = bands.get(key) ?? [];
      list.push(footprint);
      bands.set(key, list);
    }

    for (const members of bands.values()) {
      const sorted = [...members].sort((a, b) =>
        axis === "H" ? a.rect.minX - b.rect.minX : a.rect.minY - b.rect.minY,
      );

      let current: BayFootprint[] = [];
      const flush = () => {
        if (current.length === 0) return;
        const rect = current.reduce<Rect>(
          (acc, f) => ({
            minX: Math.min(acc.minX, f.rect.minX),
            minY: Math.min(acc.minY, f.rect.minY),
            maxX: Math.max(acc.maxX, f.rect.maxX),
            maxY: Math.max(acc.maxY, f.rect.maxY),
          }),
          { ...current[0].rect },
        );
        runs.push({
          axis,
          bandMin: axis === "H" ? rect.minY : rect.minX,
          bandMax: axis === "H" ? rect.maxY : rect.maxX,
          spanMin: axis === "H" ? rect.minX : rect.minY,
          spanMax: axis === "H" ? rect.maxX : rect.maxY,
          rect,
        });
        current = [];
      };

      for (const footprint of sorted) {
        if (current.length === 0) {
          current.push(footprint);
          continue;
        }
        const previous = current[current.length - 1];
        const gap =
          axis === "H"
            ? footprint.rect.minX - previous.rect.maxX
            : footprint.rect.minY - previous.rect.maxY;
        if (gap > RUN_BREAK_MM) flush();
        current.push(footprint);
      }
      flush();
    }
  }

  // A lone footprint is a pallet spot, not a run worth inferring aisles from.
  return runs.filter((run) => run.spanMax - run.spanMin > RUN_BREAK_MM);
}

function runSegment(run: RackRun, position: number, from: number, to: number) {
  return run.axis === "H"
    ? { a: { x: from, y: position }, b: { x: to, y: position } }
    : { a: { x: position, y: from }, b: { x: position, y: to } };
}

/**
 * Lays a centerline down every gap between two rack runs that actually face
 * each other, plus one along each outer face so the ends of the block are
 * reachable.
 */
export type InferredCorridor = Segment & {
  widthMm: number;
  /**
   * INNER runs between two rack runs that face each other; PERIMETER serves a
   * single outward-facing rack face. They are genuinely different things: an
   * inner aisle's width is a real measured gap, a perimeter one's is a chosen
   * clearance.
   */
  kind: "INNER" | "PERIMETER";
};

export function inferCorridors(
  runs: RackRun[],
  hall: CompilerInput["hall"],
): InferredCorridor[] {
  const corridors: InferredCorridor[] = [];

  for (const axis of ["H", "V"] as const) {
    const axisRuns = runs.filter((r) => r.axis === axis);
    if (axisRuns.length === 0) continue;

    for (let i = 0; i < axisRuns.length; i++) {
      for (let j = 0; j < axisRuns.length; j++) {
        if (i === j) continue;
        const a = axisRuns[i];
        const b = axisRuns[j];
        if (a.bandMax > b.bandMin) continue; // only consider a below b

        const gap = b.bandMin - a.bandMax;
        if (gap < MIN_CORRIDOR_MM || gap > MAX_CORRIDOR_MM) continue;

        const overlapMin = Math.max(a.spanMin, b.spanMin);
        const overlapMax = Math.min(a.spanMax, b.spanMax);
        if (overlapMax - overlapMin < MIN_OVERLAP_MM) continue;

        // Reject if a third run sits between them over the same span -- then
        // a and b are not actually facing each other.
        const blocked = axisRuns.some(
          (c) =>
            c !== a &&
            c !== b &&
            c.bandMin >= a.bandMax - SNAP_MM &&
            c.bandMax <= b.bandMin + SNAP_MM &&
            Math.min(c.spanMax, overlapMax) - Math.max(c.spanMin, overlapMin) >
              MIN_OVERLAP_MM,
        );
        if (blocked) continue;

        const centre = (a.bandMax + b.bandMin) / 2;
        corridors.push({
          ...runSegment(a, centre, overlapMin, overlapMax),
          widthMm: gap,
          kind: "INNER",
        });
      }
    }

    // Perimeter corridors, decided per run face rather than per block.
    //
    // Using the block's global min/max would leave a second, separated block
    // with no corridor on its inner-facing side -- every one of its bays then
    // has no reachable pick face. Asking "does this particular face already
    // have an aisle?" handles any number of blocks.
    const hallExtent =
      axis === "H" ? hall.physicalLengthMm : hall.physicalWidthMm;

    for (const run of axisRuns) {
      for (const [face, direction] of [
        [run.bandMin, -1],
        [run.bandMax, 1],
      ] as const) {
        // Already served by an inferred corridor on this side?
        const served = corridors.some((corridor) => {
          const position = axis === "H" ? corridor.a.y : corridor.a.x;
          const onThisSide =
            direction < 0
              ? position < face + SNAP_MM
              : position > face - SNAP_MM;
          if (!onThisSide) return false;
          if (Math.abs(position - face) > MAX_CORRIDOR_MM) return false;
          const from = axis === "H" ? corridor.a.x : corridor.a.y;
          const to = axis === "H" ? corridor.b.x : corridor.b.y;
          const overlap =
            Math.min(Math.max(from, to), run.spanMax) -
            Math.max(Math.min(from, to), run.spanMin);
          return overlap > MIN_OVERLAP_MM;
        });
        if (served) continue;

        const position = face + direction * PERIMETER_OFFSET_MM;
        if (position < 0 || position > hallExtent) continue;
        if (run.spanMax - run.spanMin < MIN_OVERLAP_MM) continue;

        // Do not lay a perimeter aisle straight through another rack run.
        const candidate = runSegment(run, position, run.spanMin, run.spanMax);
        const blocked = axisRuns.some(
          (other) =>
            other !== run &&
            segmentIntersectsRect(candidate, other.rect, SNAP_MM),
        );
        if (blocked) continue;

        corridors.push({
          ...candidate,
          widthMm: PERIMETER_OFFSET_MM * 2,
          kind: "PERIMETER",
        });
      }
    }
  }

  return corridors;
}

// --- Graph assembly -------------------------------------------------------

function snapKey(point: Point, floorLevel: number): string {
  return `${floorLevel}:${Math.round(point.x / SNAP_MM)}:${Math.round(point.y / SNAP_MM)}`;
}

type WorkingSegment = {
  a: Point;
  b: Point;
  edgeKind: CompiledEdge["edgeKind"];
  widthMm: number | null;
  maxSpeedMms: number | null;
  minClearanceMm: number | null;
  allowedVehicleMask: number;
  sourceFeatureId: number | null;
  traversal: CompiledEdge["traversal"];
};

/**
 * Rewrites each segment as a chain through its cut points.
 *
 * This is what makes an attachment a real junction rather than a node that
 * merely sits on top of a line. A node placed on an edge without splitting it
 * is geometrically right and topologically isolated -- it looks connected on
 * the canvas and is unreachable to a router.
 */
export function applyCuts(
  segments: WorkingSegment[],
  cutsBySegment: Map<number, Point[]>,
): WorkingSegment[] {
  const output: WorkingSegment[] = [];

  segments.forEach((segment, index) => {
    const cuts = cutsBySegment.get(index);
    if (!cuts || cuts.length === 0) {
      output.push(segment);
      return;
    }
    const length = Math.hypot(
      segment.b.x - segment.a.x,
      segment.b.y - segment.a.y,
    );
    if (length === 0) {
      output.push(segment);
      return;
    }

    const ordered = [...cuts]
      .map((p) => ({
        p,
        t: Math.hypot(p.x - segment.a.x, p.y - segment.a.y) / length,
      }))
      .filter((c) => c.t > SNAP_MM / length && c.t < 1 - SNAP_MM / length)
      .sort((x, y) => x.t - y.t);

    let previous = segment.a;
    for (const cut of ordered) {
      if (Math.hypot(cut.p.x - previous.x, cut.p.y - previous.y) > SNAP_MM) {
        output.push({ ...segment, a: previous, b: cut.p });
        previous = cut.p;
      }
    }
    if (
      Math.hypot(segment.b.x - previous.x, segment.b.y - previous.y) > SNAP_MM
    ) {
      output.push({ ...segment, a: previous, b: segment.b });
    }
  });

  return output;
}

/** Splits every segment at each point where it properly crosses another. */
export function splitAtIntersections(
  segments: WorkingSegment[],
): WorkingSegment[] {
  const cutsBySegment = new Map<number, Point[]>();

  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const hit = segmentIntersection(segments[i], segments[j]);
      if (!hit) continue;
      for (const index of [i, j]) {
        const list = cutsBySegment.get(index) ?? [];
        list.push(hit);
        cutsBySegment.set(index, list);
      }
    }
  }

  return applyCuts(segments, cutsBySegment);
}

function fullVehicleMask(vehicles: VehicleProfile[]): number {
  let mask = 0;
  for (const vehicle of vehicles) mask |= 1 << vehicle.classBit;
  return mask;
}

function pedestrianMask(vehicles: VehicleProfile[]): number {
  let mask = 0;
  for (const vehicle of vehicles) {
    if (vehicle.isPedestrian) mask |= 1 << vehicle.classBit;
  }
  return mask;
}

/** Obstacle rectangles a traveller at floor level would actually collide with. */
export function obstacleRects(
  features: FeatureDTO[],
  floorLevel: number,
  travellerHeightMm: number,
): Array<{ rect: Rect; featureId: number }> {
  const result: Array<{ rect: Rect; featureId: number }> = [];
  for (const feature of features) {
    if (feature.floorLevel !== floorLevel) continue;
    if (!feature.isObstacle || feature.isVisualOnly) continue;

    // Vertical extent is the whole point of storing elevation: a conveyor at
    // 2400mm is not an obstacle to someone walking underneath it.
    const base = feature.elevationMm;
    if (base >= travellerHeightMm) continue;

    const envelope = computeEnvelope({
      geometryKind: feature.geometryKind,
      originXMm: feature.originXMm,
      originYMm: feature.originYMm,
      widthMm: feature.widthMm,
      lengthMm: feature.lengthMm,
      rotationDegrees: feature.rotationDegrees,
      points: feature.points,
    });
    result.push({
      rect: {
        minX: envelope.minX,
        minY: envelope.minY,
        maxX: envelope.maxX,
        maxY: envelope.maxY,
      },
      featureId: feature.featureId,
    });
  }
  return result;
}

/** Union-find over node keys, used for the connectivity report. */
function connectedComponents(
  nodeKeys: string[],
  edges: Array<{ fromKey: string; toKey: string }>,
): Map<string, string> {
  const parent = new Map<string, string>();
  for (const key of nodeKeys) parent.set(key, key);

  function find(key: string): string {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cursor = key;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  }

  for (const edge of edges) {
    if (!parent.has(edge.fromKey) || !parent.has(edge.toKey)) continue;
    const a = find(edge.fromKey);
    const b = find(edge.toKey);
    if (a !== b) parent.set(a, b);
  }

  const roots = new Map<string, string>();
  for (const key of nodeKeys) roots.set(key, find(key));
  return roots;
}

// --- The compiler ---------------------------------------------------------

export function compileNavigationGraph(input: CompilerInput): CompileResult {
  const floorLevel = input.floorLevel ?? 1;
  const warnings: CompileWarning[] = [];
  const vehicles = input.vehicles;
  const allVehicles = fullVehicleMask(vehicles);
  const footVehicles = pedestrianMask(vehicles);
  const travellerHeight =
    input.hall.clearHeightMm ?? DEFAULT_TRAVELLER_HEIGHT_MM;

  // 1. Rack runs and inferred corridors.
  const footprints = collectBayFootprints(input.locations, floorLevel);
  const runs = inferRackRuns(footprints);
  if (footprints.length === 0) {
    warnings.push({
      code: "NO_RACKING",
      message:
        "This hall has no storage locations on this floor, so no aisles could be inferred.",
    });
  }

  const corridors = inferCorridors(runs, input.hall);
  const segments: WorkingSegment[] = corridors.map((corridor) => ({
    a: corridor.a,
    b: corridor.b,
    edgeKind: "AISLE",
    widthMm: Math.round(corridor.widthMm),
    maxSpeedMms: null,
    minClearanceMm: null,
    allowedVehicleMask: allVehicles,
    sourceFeatureId: null,
    traversal: "BIDIRECTIONAL",
  }));
  const inferredCorridorCount = segments.length;

  // 2. Authored lane features. These are explicit intent and are never
  //    second-guessed, only checked against obstacles.
  const obstacles = obstacleRects(input.features, floorLevel, travellerHeight);
  let authoredLaneCount = 0;
  const crossingLanes: number[] = [];

  for (const feature of input.features) {
    if (feature.floorLevel !== floorLevel) continue;
    if (!LANE_FEATURE_KINDS.has(feature.kind)) continue;
    const points = feature.points;
    if (!points || points.length < 2) continue;

    const isWalkway = feature.kind === "PEDESTRIAN_WALKWAY";
    const mask = isWalkway ? footVehicles || allVehicles : allVehicles;
    const world = points.map((p) => ({
      x: feature.originXMm + p.x,
      y: feature.originYMm + p.y,
    }));

    for (let i = 1; i < world.length; i++) {
      const segment = { a: world[i - 1], b: world[i] };
      const hitsObstacle = obstacles.some((o) =>
        segmentIntersectsRect(segment, o.rect, SNAP_MM),
      );
      if (hitsObstacle) crossingLanes.push(feature.featureId);

      segments.push({
        ...segment,
        edgeKind: isWalkway
          ? "WALKWAY"
          : feature.kind === "CROSS_AISLE"
            ? "CROSS_AISLE"
            : "LANE",
        widthMm: Number(feature.attrs.widthMm) || null,
        maxSpeedMms: Number(feature.attrs.maxSpeedMms) || null,
        minClearanceMm: feature.heightMm,
        allowedVehicleMask: mask,
        sourceFeatureId: feature.featureId,
        traversal:
          feature.attrs.direction === "FORWARD"
            ? "FORWARD_ONLY"
            : feature.attrs.direction === "REVERSE"
              ? "REVERSE_ONLY"
              : "BIDIRECTIONAL",
      });
      authoredLaneCount++;
    }
  }

  if (crossingLanes.length > 0) {
    warnings.push({
      code: "LANE_CROSSES_OBSTACLE",
      message: `${new Set(crossingLanes).size} authored lane(s) pass through an obstacle. Columns in aisles are common — check these rather than assuming the lane is wrong.`,
      featureIds: Array.from(new Set(crossingLanes)),
    });
  }

  // 3. Cross-aisles between corridor ends that can see each other. Candidates
  //    are endpoint pairs aligned on the perpendicular axis; a candidate is
  //    kept only if nothing solid lies between them.
  const runRects = runs.map((run) => run.rect);
  const endpoints: Array<{ point: Point; index: number }> = [];
  segments.forEach((segment, index) => {
    if (segment.edgeKind !== "AISLE") return;
    endpoints.push({ point: segment.a, index });
    endpoints.push({ point: segment.b, index });
  });

  let connectorCount = 0;
  for (let i = 0; i < endpoints.length; i++) {
    for (let j = i + 1; j < endpoints.length; j++) {
      const p = endpoints[i].point;
      const q = endpoints[j].point;
      if (endpoints[i].index === endpoints[j].index) continue;

      const dx = Math.abs(p.x - q.x);
      const dy = Math.abs(p.y - q.y);
      const aligned = dx <= SNAP_MM * 6 || dy <= SNAP_MM * 6;
      if (!aligned) continue;

      const distance = Math.hypot(p.x - q.x, p.y - q.y);
      if (distance < SNAP_MM || distance > MAX_CONNECTOR_MM) continue;

      const candidate = { a: p, b: q };
      const blockedByRack = runRects.some((rect) =>
        segmentIntersectsRect(candidate, rect, SNAP_MM),
      );
      if (blockedByRack) continue;
      const blockedByFeature = obstacles.some((o) =>
        segmentIntersectsRect(candidate, o.rect, SNAP_MM),
      );
      if (blockedByFeature) continue;

      segments.push({
        ...candidate,
        edgeKind: "CROSS_AISLE",
        widthMm: null,
        maxSpeedMms: null,
        minClearanceMm: null,
        allowedVehicleMask: allVehicles,
        sourceFeatureId: null,
        traversal: "BIDIRECTIONAL",
      });
      connectorCount++;
    }
  }

  if (inferredCorridorCount === 0 && authoredLaneCount === 0) {
    warnings.push({
      code: "NO_CORRIDORS",
      message:
        "No aisles could be inferred and no travel lanes are drawn, so there is nothing to route on. Draw a travel lane, or check that racking runs face each other across a gap of 0.8–8 m.",
    });
  }

  // 4. Split at intersections.
  let working = splitAtIntersections(segments);

  // 5. Project attachments (portals and pick faces) onto the network, then
  //    split the segments they landed on. Both must be done before nodes are
  //    materialised so each attachment becomes a genuine junction.
  const attachmentCuts = new Map<number, Point[]>();

  function projectOntoNetwork(
    target: Point,
    maxDistance: number,
  ): Point | null {
    let bestPoint: Point | null = null;
    let bestDistance = Infinity;
    let bestIndex = -1;

    working.forEach((segment, index) => {
      const projection = projectOntoSegment(target, segment);
      if (projection.distance < bestDistance) {
        bestDistance = projection.distance;
        bestPoint = projection.point;
        bestIndex = index;
      }
    });

    if (!bestPoint || bestDistance > maxDistance) return null;
    const list = attachmentCuts.get(bestIndex) ?? [];
    list.push(bestPoint);
    attachmentCuts.set(bestIndex, list);
    return bestPoint;
  }

  const portalAttachments: Array<{
    feature: FeatureDTO;
    centre: Point;
    attachPoint: Point;
  }> = [];
  const unlinkedPortals: number[] = [];

  for (const feature of input.features) {
    if (feature.floorLevel !== floorLevel) continue;
    if (!PORTAL_FEATURE_KINDS.has(feature.kind)) continue;

    const envelope = computeEnvelope({
      geometryKind: feature.geometryKind,
      originXMm: feature.originXMm,
      originYMm: feature.originYMm,
      widthMm: feature.widthMm,
      lengthMm: feature.lengthMm,
      rotationDegrees: feature.rotationDegrees,
      points: feature.points,
    });
    const centre = {
      x: (envelope.minX + envelope.maxX) / 2,
      y: (envelope.minY + envelope.maxY) / 2,
    };

    const attachPoint = projectOntoNetwork(centre, MAX_CONNECTOR_MM);
    if (!attachPoint) {
      unlinkedPortals.push(feature.featureId);
      continue;
    }
    portalAttachments.push({ feature, centre, attachPoint });
  }

  const footprintAttachments: Array<{
    footprint: BayFootprint;
    centre: Point;
    attachPoint: Point;
    distance: number;
  }> = [];
  const locationsWithoutAccess: number[] = [];

  for (const footprint of footprints) {
    const centre = {
      x: (footprint.rect.minX + footprint.rect.maxX) / 2,
      y: (footprint.rect.minY + footprint.rect.maxY) / 2,
    };
    const attachPoint = projectOntoNetwork(centre, MAX_CORRIDOR_MM);
    if (!attachPoint) {
      locationsWithoutAccess.push(...footprint.locationIds);
      continue;
    }
    footprintAttachments.push({
      footprint,
      centre,
      attachPoint,
      distance: Math.hypot(attachPoint.x - centre.x, attachPoint.y - centre.y),
    });
  }

  working = applyCuts(working, attachmentCuts);

  // 6. Materialise nodes and edges.
  const split = working;

  const nodes = new Map<string, CompiledNode>();
  const edges: CompiledEdge[] = [];

  // Grid cell -> node keys, so node lookup can be radius-based rather than
  // exact-cell. Pure cell snapping has a boundary artifact: two points 200mm
  // apart can round into different cells and become two nodes, which is how
  // a pick face ends up as an isolated island next to the aisle it sits on.
  // Cell size is the merge radius, so scanning the 3x3 neighbourhood is
  // guaranteed to find any node within that radius.
  const nodesByCell = new Map<string, string[]>();
  function cellKey(cx: number, cy: number) {
    return `${cx}:${cy}`;
  }

  function findNearbyNode(point: Point): string | null {
    const cx = Math.round(point.x / MERGE_RADIUS_MM);
    const cy = Math.round(point.y / MERGE_RADIUS_MM);
    let best: string | null = null;
    let bestDistance = MERGE_RADIUS_MM;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const key of nodesByCell.get(cellKey(cx + dx, cy + dy)) ?? []) {
          const node = nodes.get(key);
          if (!node || node.floorLevel !== floorLevel) continue;
          const distance = Math.hypot(node.xMm - point.x, node.yMm - point.y);
          if (distance <= bestDistance) {
            bestDistance = distance;
            best = key;
          }
        }
      }
    }
    return best;
  }

  function ensureNode(
    point: Point,
    kind: CompiledNode["nodeKind"],
    sourceFeatureId: number | null = null,
    portalGroupId: number | null = null,
  ): string {
    const nearby = findNearbyNode(point);
    const key = nearby ?? snapKey(point, floorLevel);
    const existing = nodes.get(key);
    if (existing) {
      // An access or portal role is more specific than a plain waypoint and
      // should win when several roles land on the same snapped point.
      if (existing.nodeKind === "WAYPOINT" && kind !== "WAYPOINT") {
        existing.nodeKind = kind;
        existing.sourceFeatureId = sourceFeatureId ?? existing.sourceFeatureId;
        existing.portalGroupId = portalGroupId ?? existing.portalGroupId;
      }
      return key;
    }
    nodes.set(key, {
      key,
      xMm: Math.round(point.x),
      yMm: Math.round(point.y),
      floorLevel,
      nodeKind: kind,
      sourceFeatureId,
      portalGroupId,
    });
    const cx = Math.round(point.x / MERGE_RADIUS_MM);
    const cy = Math.round(point.y / MERGE_RADIUS_MM);
    const cell = cellKey(cx, cy);
    nodesByCell.set(cell, [...(nodesByCell.get(cell) ?? []), key]);
    return key;
  }

  const seenEdges = new Set<string>();
  function addEdge(
    fromKey: string,
    toKey: string,
    template: Omit<CompiledEdge, "fromKey" | "toKey" | "lengthMm">,
    lengthMm?: number,
  ) {
    if (fromKey === toKey) return;
    const pairKey =
      fromKey < toKey ? `${fromKey}|${toKey}` : `${toKey}|${fromKey}`;
    if (seenEdges.has(pairKey)) return;
    seenEdges.add(pairKey);

    const from = nodes.get(fromKey)!;
    const to = nodes.get(toKey)!;
    edges.push({
      ...template,
      fromKey,
      toKey,
      lengthMm:
        lengthMm ??
        Math.round(Math.hypot(to.xMm - from.xMm, to.yMm - from.yMm)),
    });
  }

  for (const segment of split) {
    const fromKey = ensureNode(segment.a, "WAYPOINT");
    const toKey = ensureNode(segment.b, "WAYPOINT");
    addEdge(fromKey, toKey, {
      edgeKind: segment.edgeKind,
      traversal: segment.traversal,
      widthMm: segment.widthMm,
      maxSpeedMms: segment.maxSpeedMms,
      minClearanceMm: segment.minClearanceMm,
      allowedVehicleMask: segment.allowedVehicleMask,
      sourceFeatureId: segment.sourceFeatureId,
    });
  }

  // Nodes where three or more edges meet are junctions, which is what turn
  // penalties will key off later.
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.fromKey, (degree.get(edge.fromKey) ?? 0) + 1);
    degree.set(edge.toKey, (degree.get(edge.toKey) ?? 0) + 1);
  }
  for (const [key, count] of degree) {
    const node = nodes.get(key);
    if (node && node.nodeKind === "WAYPOINT" && count >= 3) {
      node.nodeKind = "INTERSECTION";
    }
  }

  // 7. Portal nodes and their links. The attachment point is already a node
  //    because the segment was cut there above.
  for (const { feature, centre, attachPoint } of portalAttachments) {
    const kind: CompiledNode["nodeKind"] = DOCK_FEATURE_KINDS.has(feature.kind)
      ? "DOCK"
      : "PORTAL";
    const portalKey = ensureNode(centre, kind, feature.featureId);
    const attachKey = ensureNode(attachPoint, "WAYPOINT");

    const clearWidth = Number(feature.attrs.clearWidthMm) || null;
    const clearHeight =
      Number(feature.attrs.clearHeightMm) || feature.heightMm || null;
    addEdge(portalKey, attachKey, {
      edgeKind: "PORTAL",
      traversal: "BIDIRECTIONAL",
      widthMm: clearWidth,
      maxSpeedMms: null,
      minClearanceMm: clearHeight,
      allowedVehicleMask: allVehicles,
      sourceFeatureId: feature.featureId,
    });
  }

  if (unlinkedPortals.length > 0) {
    warnings.push({
      code: "PORTAL_UNLINKED",
      message: `${unlinkedPortals.length} door/dock/lift could not be joined to the network — nothing routable is within ${MAX_CONNECTOR_MM / 1000} m of it.`,
      featureIds: unlinkedPortals,
    });
  }

  // 8. Access points. Each pick face already has a node on the network from
  //    the cut above, so this only has to record who reaches it and at what
  //    handling cost.
  const accessPoints: CompiledAccessPoint[] = [];

  for (const {
    footprint,
    centre,
    attachPoint,
    distance,
  } of footprintAttachments) {
    const accessKey = ensureNode(attachPoint, "ACCESS");
    const dx = attachPoint.x - centre.x;
    const dy = attachPoint.y - centre.y;
    const heading = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    const face: CompiledAccessPoint["face"] =
      Math.abs(dx) > Math.abs(dy)
        ? dx > 0
          ? "RIGHT"
          : "LEFT"
        : dy > 0
          ? "BACK"
          : "FRONT";

    for (const [level, locationIds] of footprint.levels) {
      for (const locationId of locationIds) {
        accessPoints.push({
          locationId,
          nodeKey: accessKey,
          face,
          approachHeadingDeg: Math.round(heading),
          offsetMm: Math.round(distance),
          // Travel is identical for every level of a bay; only the lift
          // differs, which is exactly what this term represents.
          handlingTimeMs:
            HANDLING_BASE_MS + Math.max(0, level - 1) * HANDLING_PER_LEVEL_MS,
          allowedVehicleMask: allVehicles,
          isPrimary: true,
        });
      }
    }
  }

  if (locationsWithoutAccess.length > 0) {
    warnings.push({
      code: "LOCATION_WITHOUT_ACCESS",
      message: `${locationsWithoutAccess.length} location(s) have no aisle within reach and cannot be picked from.`,
      locationIds: locationsWithoutAccess.slice(0, 50),
    });
  }

  // 7. Aisle width against vehicle profiles. This is the check that catches
  //    "we bought reach trucks for a VNA aisle" at design time.
  const narrow: string[] = [];
  for (const edge of edges) {
    if (edge.edgeKind !== "AISLE" || edge.widthMm == null) continue;
    for (const vehicle of vehicles) {
      if (vehicle.minAisleWidthMm == null) continue;
      if ((edge.allowedVehicleMask & (1 << vehicle.classBit)) === 0) continue;
      if (edge.widthMm < vehicle.minAisleWidthMm) {
        narrow.push(
          `${vehicle.name} needs ${vehicle.minAisleWidthMm}mm but an aisle is ${edge.widthMm}mm`,
        );
      }
    }
  }
  if (narrow.length > 0) {
    warnings.push({
      code: "AISLE_TOO_NARROW",
      message: `Aisle width is below what some equipment needs: ${Array.from(new Set(narrow)).slice(0, 5).join("; ")}.`,
    });
  }

  // 8. Connectivity. An unreachable pick face is a production incident
  //    waiting to happen, so it is reported at compile time rather than
  //    discovered by a picker standing in front of a wall.
  const nodeKeys = Array.from(nodes.keys());
  const roots = connectedComponents(nodeKeys, edges);
  const componentSizes = new Map<string, number>();
  for (const root of roots.values()) {
    componentSizes.set(root, (componentSizes.get(root) ?? 0) + 1);
  }
  const componentCount = componentSizes.size;

  let largestRoot: string | null = null;
  let largestSize = 0;
  for (const [root, size] of componentSizes) {
    if (size > largestSize) {
      largestSize = size;
      largestRoot = root;
    }
  }

  const unreachable = new Set<number>(locationsWithoutAccess);
  for (const accessPoint of accessPoints) {
    if (roots.get(accessPoint.nodeKey) !== largestRoot) {
      unreachable.add(accessPoint.locationId);
    }
  }

  if (componentCount > 1) {
    warnings.push({
      code: "DISCONNECTED_GRAPH",
      message: `The network has ${componentCount} separate pieces. Anything outside the largest one cannot be routed to — add a travel lane joining them.`,
    });
  }
  if (unreachable.size > 0) {
    warnings.push({
      code: "UNREACHABLE_LOCATIONS",
      message: `${unreachable.size} location(s) are not reachable from the main network.`,
      locationIds: Array.from(unreachable).slice(0, 50),
    });
  }

  const totalLocations = footprints.reduce(
    (sum, f) => sum + f.locationIds.length,
    0,
  );

  return {
    nodes: Array.from(nodes.values()),
    edges,
    accessPoints,
    warnings,
    stats: {
      rackRuns: runs.length,
      inferredCorridors: inferredCorridorCount,
      authoredLanes: authoredLaneCount,
      connectors: connectorCount,
      componentCount,
      reachableLocationCount: totalLocations - unreachable.size,
      unreachableLocationCount: unreachable.size,
    },
  };
}
