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
  distanceToPolyline,
  footprintVertices,
  pointInPolygon,
  projectOntoSegment,
  segmentIntersection,
  segmentIntersectsPolygon,
  segmentIntersectsRect,
  worldPoints,
  type Point,
  type Rect,
  type Segment,
} from "./geometry";
import { pathWidthMmFor } from "./feature-kinds";
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
/** Lattice spacing for a free-roam zone that does not state its own. */
export const ZONE_DEFAULT_PITCH_MM = 2000;
/**
 * Hard floor on lattice spacing. Must stay above MERGE_RADIUS_MM: `ensureNode`
 * fuses anything closer than that into one node, so a finer pitch would
 * collapse neighbouring lattice points together and produce a mesh full of
 * self-edges that get dropped -- a lattice that looks dense and routes worse
 * than a coarse one.
 */
export const ZONE_MIN_PITCH_MM = MERGE_RADIUS_MM * 2;
/**
 * Ceiling on lattice points per zone, enforced by coarsening the pitch rather
 * than truncating the area (half a zone is worse than a coarse whole one).
 *
 * The binding constraint is `splitAtIntersections`, which is O(segments^2).
 * 8-connectivity emits close to 4 segments per node, so 1200 nodes is already
 * ~4800 segments and ~11M pair tests. Raising this is not free.
 */
export const MAX_ZONE_NODES = 1200;
/**
 * Smallest island of lattice worth keeping. Below this it is a sliver left by
 * clipping -- a couple of points wedged in a rack gap -- not floor anyone can
 * work on, and keeping it does active harm (see `buildZoneLattice`).
 */
export const MIN_ZONE_POCKET_NODES = 4;
/**
 * How far a mesh node stands off the thing it belongs to -- a zone corner is
 * pulled this far inside the zone, an obstacle corner this far out from the
 * obstacle. Nodes sitting exactly on a boundary are the single largest source
 * of trouble in a visibility graph: `pointInPolygon` gives no guarantee for
 * them, and every sightline that starts on an edge grazes that edge.
 */
export const ZONE_MESH_STANDOFF_MM = SNAP_MM;
/**
 * Sightlines are tested against obstacles shrunk by this much, having already
 * been grown by ZONE_MESH_STANDOFF_MM to place the corner nodes. The gap is
 * what lets a path hug an obstacle: without it, the sightline between two
 * corners of the same obstacle runs exactly along the rectangle it is being
 * tested against and is rejected, so paths could never round a column.
 */
export const ZONE_MESH_GRAZE_MM = 5;
/**
 * Above this many candidate nodes a zone compiles as a grid instead.
 *
 * Visibility is O(N^2) sightlines, each tested against every obstacle in the
 * hall -- fine at N = 12, not at N = 200. An area chopped up by dozens of
 * small obstacles is exactly where the grid is both faster and simpler, so
 * that is where it gets used.
 */
export const MAX_ZONE_MESH_NODES = 120;
/** How close an existing segment may sit to a zone's boundary and still be
 *  treated as touching it, for stitching. Reuses SNAP_MM, the same "close
 *  enough to be the same point" tolerance the rest of the compiler already
 *  uses for node dedup and endpoint alignment. */
export const ZONE_TOUCH_TOLERANCE_MM = SNAP_MM;
/**
 * Zone travel costs slightly more than an equivalent lane. Open floor is
 * shared with people, pallets and parked equipment, so a router that treats it
 * as identical to a marked aisle will cut diagonally across a pack area to
 * save two metres -- which is not how anyone actually drives.
 */
export const ZONE_IMPEDANCE = 1.15;
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
/** Areas where the whole surface is navigable rather than a centreline. */
const ZONE_FEATURE_KINDS = new Set(["DRIVE_ZONE", "WORK_ZONE"]);
/**
 * Areas nothing may be routed through. These are not `isObstacle` features --
 * an exclusion is about who may travel, not about something physically in the
 * way -- so the lattice has to honour them explicitly.
 */
const EXCLUSION_FEATURE_KINDS = new Set([
  "VEHICLE_EXCLUSION",
  "PEDESTRIAN_EXCLUSION",
  "NO_ENTRY_ZONE",
]);

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
  edgeKind:
    | "LANE"
    | "AISLE"
    | "CROSS_AISLE"
    | "WALKWAY"
    | "PORTAL"
    | "ACCESS"
    | "ZONE";
  traversal: "BIDIRECTIONAL" | "FORWARD_ONLY" | "REVERSE_ONLY";
  lengthMm: number;
  widthMm: number | null;
  maxSpeedMms: number | null;
  minClearanceMm: number | null;
  allowedVehicleMask: number;
  /** Cost multiplier on travel time. 1 is "as fast as the geometry allows". */
  impedance: number;
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
    | "LOCATION_WITHOUT_ACCESS"
    | "ZONE_UNUSABLE"
    | "ZONE_COARSENED"
    | "ZONE_MESH_FALLBACK";
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
    navigableZones: number;
    zoneNodes: number;
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
    // Corridors laid by *this* pass. `corridors` accumulates across both
    // passes, and asking "is this face already served?" of a corridor running
    // the other way is a category error -- its position is measured on the
    // other axis entirely.
    const axisCorridors: InferredCorridor[] = [];

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
        const inner: InferredCorridor = {
          ...runSegment(a, centre, overlapMin, overlapMax),
          widthMm: gap,
          kind: "INNER",
        };
        corridors.push(inner);
        axisCorridors.push(inner);
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
        const served = axisCorridors.some((corridor) => {
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
        // Every run, not just this axis's: a block of vertical racking is
        // just as solid to a horizontal perimeter aisle as another horizontal
        // run would be, and scoping this to axisRuns drove an aisle straight
        // through the perpendicular block whenever a hall mixed the two.
        const candidate = runSegment(run, position, run.spanMin, run.spanMax);
        const blocked = runs.some(
          (other) =>
            other !== run &&
            segmentIntersectsRect(candidate, other.rect, SNAP_MM),
        );
        if (blocked) continue;

        const perimeter: InferredCorridor = {
          ...candidate,
          widthMm: PERIMETER_OFFSET_MM * 2,
          kind: "PERIMETER",
        };
        corridors.push(perimeter);
        axisCorridors.push(perimeter);
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
  impedance: number;
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
      // Two lattice edges never need cutting against each other. They are
      // built to meet only at lattice points, and the one place they do cross
      // -- the two diagonals of a cell, which meet at its centre -- is a
      // crossing with no junction at it: splitting there would invent a node
      // per cell, roughly tripling the lattice and putting a kink in every
      // diagonal run. Lattice-vs-lane crossings still split, which is what
      // actually stitches an authored lane into the mesh.
      if (
        segments[i].edgeKind === "ZONE" &&
        segments[j].edgeKind === "ZONE"
      ) {
        continue;
      }
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

// --- Free-roam zones ------------------------------------------------------

export type NavigableZone = {
  featureId: number;
  /** Boundary in world mm, already rotated. */
  polygon: Point[];
  pitchMm: number;
  allowedVehicleMask: number;
  maxSpeedMms: number | null;
};

export type ZoneLattice = {
  segments: WorkingSegment[];
  /** Every lattice point that survived clipping, for stitching lanes on. */
  nodes: Point[];
  /** What the pitch ended up being after the MAX_ZONE_NODES clamp. */
  pitchUsedMm: number;
  coarsened: boolean;
};

function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x > rect.minX &&
    point.x < rect.maxX &&
    point.y > rect.minY &&
    point.y < rect.maxY
  );
}

/**
 * Fills a navigable area with a grid of nodes and the edges between them.
 *
 * A lane is a centreline: one line that says "travel here". An open area has
 * no such line -- the whole surface is travel space -- which is exactly why
 * `inferCorridors` refuses to guess one for gaps wider than MAX_CORRIDOR_MM.
 * A lattice is the cheapest honest answer: sample the area, keep what is
 * actually clear, and let the router pick its way across.
 *
 * 8-connected, not 4. With only the axis neighbours a diagonal crossing
 * becomes a staircase, and `turnPenaltyMs` charges a full 90-degree turn at
 * every single step of it -- a 20 m diagonal would cost more than going the
 * long way round. The diagonals make that one straight arc.
 */
export function buildZoneLattice(
  zone: NavigableZone,
  blocked: { rects: Rect[]; polygons: Point[][] },
): ZoneLattice {
  const empty: ZoneLattice = {
    segments: [],
    nodes: [],
    pitchUsedMm: zone.pitchMm,
    coarsened: false,
  };
  if (zone.polygon.length < 3) return empty;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of zone.polygon) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  let pitch = Math.max(ZONE_MIN_PITCH_MM, Math.round(zone.pitchMm));
  const area = (maxX - minX) * (maxY - minY);
  let coarsened = false;
  if (area / (pitch * pitch) > MAX_ZONE_NODES) {
    pitch = Math.ceil(Math.sqrt(area / MAX_ZONE_NODES));
    coarsened = true;
  }

  // Sample the *cell centres* of one absolute grid: (k + 0.5) * pitch.
  //
  // Two properties matter here. Anchoring to absolute multiples rather than to
  // the zone's own corner means two zones sharing a pitch interlock, instead
  // of producing offset lattices that pass through each other without ever
  // meeting. And the half-pitch offset keeps samples off the boundary itself:
  // a zone dragged out to round coordinates has edges on exact pitch
  // multiples, `pointInPolygon` gives no guarantee for a point sitting on an
  // edge, and the result was whole boundary rows flickering in and out and
  // splitting the lattice into pieces.
  const firstIndex = (low: number) => Math.ceil(low / pitch - 0.5);
  const sample = (index: number) => (index + 0.5) * pitch;
  const ix0 = firstIndex(minX);
  const iy0 = firstIndex(minY);
  const startX = sample(ix0);
  const startY = sample(iy0);
  const columns = Math.floor((maxX - startX) / pitch) + 1;
  const rows = Math.floor((maxY - startY) / pitch) + 1;
  if (columns < 1 || rows < 1) return { ...empty, pitchUsedMm: pitch, coarsened };

  // Keep the lattice off the face of anything solid. A sample landing exactly
  // on a rack's boundary passes a strict inside-test and survives, which lays
  // a row of nodes flush against the racking -- floor no truck can occupy, and
  // the source of most of the slivers the pocket-pruning below has to clean
  // up. Standing back by the snap tolerance removes them at the sampling step.
  const clear = (rect: Rect): Rect => ({
    minX: rect.minX - SNAP_MM,
    minY: rect.minY - SNAP_MM,
    maxX: rect.maxX + SNAP_MM,
    maxY: rect.maxY + SNAP_MM,
  });
  const blockedRects = blocked.rects.map(clear);

  const usable = (point: Point): boolean => {
    if (!pointInPolygon(point, zone.polygon)) return false;
    for (const rect of blockedRects) if (pointInRect(point, rect)) return false;
    for (const poly of blocked.polygons) {
      if (pointInPolygon(point, poly)) return false;
    }
    return true;
  };

  const grid: (Point | null)[][] = [];
  const nodes: Point[] = [];
  for (let iy = 0; iy < rows; iy++) {
    const row: (Point | null)[] = [];
    for (let ix = 0; ix < columns; ix++) {
      const point = { x: startX + ix * pitch, y: startY + iy * pitch };
      if (usable(point)) {
        row.push(point);
        nodes.push(point);
      } else {
        row.push(null);
      }
    }
    grid.push(row);
  }

  const crossesBoundary = (segment: Segment): boolean => {
    // Both ends are already known to be inside, so any boundary crossing means
    // the segment leaves and re-enters -- which only a concave zone can do,
    // and which would cut a corner through floor that is not part of the zone.
    for (let i = 0, j = zone.polygon.length - 1; i < zone.polygon.length; j = i++) {
      if (segmentIntersection(segment, { a: zone.polygon[j], b: zone.polygon[i] })) {
        return true;
      }
    }
    return false;
  };

  const passable = (a: Point, b: Point): boolean => {
    const segment = { a, b };
    for (const rect of blockedRects) {
      if (segmentIntersectsRect(segment, rect)) return false;
    }
    for (const poly of blocked.polygons) {
      if (segmentIntersectsPolygon(segment, poly)) return false;
    }
    return !crossesBoundary(segment);
  };

  const template = {
    edgeKind: "ZONE" as const,
    widthMm: null,
    maxSpeedMms: zone.maxSpeedMms,
    minClearanceMm: null,
    allowedVehicleMask: zone.allowedVehicleMask,
    impedance: ZONE_IMPEDANCE,
    sourceFeatureId: zone.featureId,
    traversal: "BIDIRECTIONAL" as const,
  };

  // E, SE, S, SW covers all eight directions exactly once per pair.
  const NEIGHBOURS: Array<[number, number]> = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
  ];

  const segments: WorkingSegment[] = [];
  for (let iy = 0; iy < rows; iy++) {
    for (let ix = 0; ix < columns; ix++) {
      const from = grid[iy][ix];
      if (!from) continue;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = ix + dx;
        const ny = iy + dy;
        if (nx < 0 || nx >= columns || ny < 0 || ny >= rows) continue;
        const to = grid[ny][nx];
        if (!to) continue;
        if (!passable(from, to)) continue;
        segments.push({ ...template, a: from, b: to });
      }
    }
  }

  const pruned = pruneZonePockets(segments, nodes);
  return { ...pruned, pitchUsedMm: pitch, coarsened };
}

/**
 * Splits a lattice or mesh into connected pieces and drops the ones too small
 * to be usable floor.
 *
 * Slivers matter beyond being untidy: access points attach to the *nearest*
 * segment, so two points stranded in a rack gap can capture a bay's pick face
 * onto an island and compile that bay as unreachable.
 */
function pruneZonePockets(
  segments: WorkingSegment[],
  nodes: Point[],
): { segments: WorkingSegment[]; nodes: Point[] } {
  const pointKey = (p: Point) => `${p.x}:${p.y}`;
  const componentOf = connectedComponents(
    nodes.map(pointKey),
    segments.map((s) => ({ fromKey: pointKey(s.a), toKey: pointKey(s.b) })),
  );
  const componentSize = new Map<string, number>();
  for (const root of componentOf.values()) {
    componentSize.set(root, (componentSize.get(root) ?? 0) + 1);
  }
  const isKept = (p: Point) => {
    const root = componentOf.get(pointKey(p));
    return (
      root !== undefined &&
      (componentSize.get(root) ?? 0) >= MIN_ZONE_POCKET_NODES
    );
  };
  return {
    segments: segments.filter((s) => isKept(s.a)),
    nodes: nodes.filter(isKept),
  };
}

/** Grows a rect outwards on every side. */
function expandRect(rect: Rect, by: number): Rect {
  return {
    minX: rect.minX - by,
    minY: rect.minY - by,
    maxX: rect.maxX + by,
    maxY: rect.maxY + by,
  };
}

/**
 * Visibility mesh over a navigable area.
 *
 * The insight a lattice misses is that a shortest path across open floor is
 * straight except where something forces it to bend, and the only places it
 * can bend are corners. So rather than sampling the whole surface, put a node
 * on each corner a path could turn on -- the area's own corners, the corners
 * of anything standing inside it -- plus wherever the outside network reaches
 * the area, and join every pair that can see each other. A 40 x 20 m apron
 * comes out around a dozen nodes instead of several hundred, and the paths
 * are exact rather than quantised to 45 degrees.
 *
 * Obstacle corners are the part that cannot be skipped. A path through a
 * region with holes in it bends around the corners of those holes, and those
 * corners are not on the outer boundary -- so a mesh built from boundary nodes
 * alone is not merely coarse, it is wrong the moment there is a column in the
 * middle of the floor, which in a warehouse is most of the time.
 */
export function buildZoneVisibilityMesh(
  zone: NavigableZone,
  blocked: { rects: Rect[]; polygons: Point[][] },
  /** Where the existing network touches this zone: lane ends inside it, and
   *  the points at which lanes cross its boundary. */
  portals: Point[],
): { segments: WorkingSegment[]; nodes: Point[]; overflowed: boolean } {
  const polygon = zone.polygon;
  const none = { segments: [], nodes: [], overflowed: false };
  if (polygon.length < 3) return none;

  const standoff = ZONE_MESH_STANDOFF_MM;
  const grown = blocked.rects.map((r) => expandRect(r, standoff));

  const insideZone = (p: Point) => pointInPolygon(p, polygon);
  const clearOfBlockers = (p: Point) => {
    for (const rect of grown) if (pointInRect(p, rect)) return false;
    for (const poly of blocked.polygons) if (pointInPolygon(p, poly)) return false;
    return true;
  };

  const candidates: Point[] = [];
  const seen = new Set<string>();
  const add = (p: Point) => {
    const point = { x: Math.round(p.x), y: Math.round(p.y) };
    const key = `${point.x}:${point.y}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(point);
  };

  // The zone's own corners, pulled inside along the angle bisector. Which way
  // the bisector points depends on whether the corner is convex or reflex, so
  // rather than working that out, try it and flip if it landed outside.
  for (let i = 0; i < polygon.length; i++) {
    const vertex = polygon[i];
    const previous = polygon[(i - 1 + polygon.length) % polygon.length];
    const next = polygon[(i + 1) % polygon.length];
    const unit = (from: Point, to: Point) => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy) || 1;
      return { x: dx / length, y: dy / length };
    };
    const a = unit(vertex, previous);
    const b = unit(vertex, next);
    let dx = a.x + b.x;
    let dy = a.y + b.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) {
      // Straight-through vertex: no bisector, and nothing to turn on either.
      continue;
    }
    dx /= length;
    dy /= length;
    let inward = { x: vertex.x + dx * standoff, y: vertex.y + dy * standoff };
    if (!insideZone(inward)) {
      inward = { x: vertex.x - dx * standoff, y: vertex.y - dy * standoff };
    }
    if (insideZone(inward) && clearOfBlockers(inward)) add(inward);
  }

  // Corners of everything standing in the zone, taken from the grown rect so
  // they already carry their clearance.
  for (const rect of grown) {
    for (const corner of [
      { x: rect.minX, y: rect.minY },
      { x: rect.maxX, y: rect.minY },
      { x: rect.maxX, y: rect.maxY },
      { x: rect.minX, y: rect.maxY },
    ]) {
      if (insideZone(corner) && clearOfBlockers(corner)) add(corner);
    }
  }

  // Where the outside network reaches in. Not standing these off: they have to
  // land on the lane node they are joining, not near it.
  for (const portal of portals) {
    if (clearOfBlockers(portal)) add(portal);
  }

  if (candidates.length < 2) return none;
  if (candidates.length > MAX_ZONE_MESH_NODES) {
    return { segments: [], nodes: [], overflowed: true };
  }

  const nearlyAt = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y) < 2;

  const visible = (a: Point, b: Point): boolean => {
    const segment = { a, b };

    // Must not leave the zone. Touching the boundary at an endpoint is normal
    // (a portal sits on it), so only a crossing away from both ends counts.
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const hit = segmentIntersection(segment, { a: polygon[j], b: polygon[i] });
      if (!hit) continue;
      if (nearlyAt(hit, a) || nearlyAt(hit, b)) continue;
      return false;
    }
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (!insideZone(midpoint)) return false;

    for (const rect of grown) {
      if (segmentIntersectsRect(segment, rect, ZONE_MESH_GRAZE_MM)) return false;
    }
    for (const poly of blocked.polygons) {
      if (segmentIntersectsPolygon(segment, poly)) return false;
    }
    return true;
  };

  const template = {
    edgeKind: "ZONE" as const,
    widthMm: null,
    maxSpeedMms: zone.maxSpeedMms,
    minClearanceMm: null,
    allowedVehicleMask: zone.allowedVehicleMask,
    impedance: ZONE_IMPEDANCE,
    sourceFeatureId: zone.featureId,
    traversal: "BIDIRECTIONAL" as const,
  };

  const segments: WorkingSegment[] = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      if (Math.hypot(b.x - a.x, b.y - a.y) <= MERGE_RADIUS_MM) continue;
      if (!visible(a, b)) continue;
      segments.push({ ...template, a, b });
    }
  }

  const pruned = pruneZonePockets(segments, candidates);
  return { ...pruned, overflowed: false };
}

/**
 * Where the existing network reaches into, or merely touches, a zone.
 *
 * Three cases, and only the third is subtle. A segment ending inside the
 * zone, or crossing properly into it, both register on `pointInPolygon` /
 * `segmentIntersection` directly and get a real node once the ordinary
 * `splitAtIntersections` pass runs over the whole network later. A segment
 * that only *grazes* a zone edge -- runs flush along it, or stops a few
 * millimetres short of it after snapping -- registers on neither:
 * `segmentIntersection` explicitly excludes the parallel case (see its own
 * comment; that exclusion exists for a different reason and has this side
 * effect here), and an endpoint sitting just outside the polygon fails
 * `pointInPolygon` outright. This is not a rare shape for a zone specifically
 * -- a road bordering a work cell, or a drive area's edge landing exactly on
 * an aisle mouth, is the ordinary way these get drawn, not a mistake.
 *
 * A graze still needs a genuine cut on the existing segment, not just a node
 * dropped near it -- a node placed on a line without splitting it is
 * geometrically right and topologically isolated (see `applyCuts`). Rather
 * than cutting it here, a short stub is added from the graze point back onto
 * the existing segment: it crosses the segment for real, so the same
 * `splitAtIntersections` pass that handles every other crossing in the
 * network makes the cut, and the stub's zone-side end becomes a mesh portal.
 */
export function findZoneTouches(
  existing: WorkingSegment[],
  polygon: Point[],
  blocked: { rects: Rect[]; polygons: Point[][] },
  stubTemplate: Omit<WorkingSegment, "a" | "b">,
  tolerance: number = ZONE_TOUCH_TOLERANCE_MM,
): { portals: Point[]; stubs: WorkingSegment[] } {
  const portals: Point[] = [];
  const stubs: WorkingSegment[] = [];
  const closed = [...polygon, polygon[0]];

  const blockedByObstacle = (segment: Segment): boolean => {
    for (const rect of blocked.rects) {
      if (segmentIntersectsRect(segment, rect)) return true;
    }
    for (const poly of blocked.polygons) {
      if (segmentIntersectsPolygon(segment, poly)) return true;
    }
    return false;
  };

  for (const segment of existing) {
    for (const end of [segment.a, segment.b]) {
      if (
        pointInPolygon(end, polygon) ||
        distanceToPolyline(end, closed) <= tolerance
      ) {
        portals.push(end);
      }
    }

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const hit = segmentIntersection(segment, {
        a: polygon[j],
        b: polygon[i],
      });
      if (hit) portals.push(hit);
    }

    // Graze: a zone corner sits close to the *middle* of this segment without
    // the two ever crossing. `proj.point` is real geometry already on the
    // segment, so a stub out to the corner is enough to force the cut.
    for (const corner of polygon) {
      const proj = projectOntoSegment(corner, segment);
      if (proj.distance > tolerance) continue;
      const stub = { a: proj.point, b: corner };
      if (blockedByObstacle(stub)) continue;
      portals.push(proj.point);
      stubs.push({ ...stubTemplate, ...stub });
    }
  }

  return { portals, stubs };
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

/**
 * Union-find over node keys. Used for the connectivity report at compile
 * time, and reused client-side (layout-designer-canvas.tsx) to colour
 * disconnected pieces on the canvas -- both need the exact same notion of
 * "same component" or the warning text and what's drawn red could disagree.
 */
export function connectedComponents(
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

  // Human-readable names for warning messages -- a bare count ("7 separate
  // pieces", "3 locations unreachable") tells you nothing you don't already
  // know from the map; the code/label is what actually lets you go find the
  // thing on the canvas instead of guessing from a screenshot.
  const locationCodeById = new Map(
    input.locations.map((l) => [l.locationId, l.locationCode]),
  );
  const featureNameById = new Map(
    input.features.map((f) => [f.featureId, f.label || f.kind]),
  );
  function namesFor(
    ids: number[],
    lookup: Map<number, string>,
    limit = 5,
  ): string {
    const unique = Array.from(new Set(ids));
    const shown = unique
      .slice(0, limit)
      .map((id) => lookup.get(id) ?? `#${id}`);
    const rest = unique.length - shown.length;
    return rest > 0 ? `${shown.join(", ")}, and ${rest} more` : shown.join(", ");
  }

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
    impedance: 1,
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
    // Rotation matters: `points` are feature-local and unrotated, so origin+p
    // is only the world position of an unrotated lane. Every lane the designer
    // places starts out horizontal, and the "Rotate 90°" button is the only
    // way to get a vertical one -- so ignoring rotation here compiled every
    // vertical lane back into a horizontal one at the wrong coordinates,
    // which is why they appeared on the canvas but never in the graph.
    const world = worldPoints(feature);

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
        // Attribute keys must match FEATURE_ATTR_SPECS -- these read
        // `widthMm`/`maxSpeedMms`/`FORWARD` before, none of which the panel
        // ever writes, so an authored lane's width, speed limit and one-way
        // flag were all silently dropped. `pathWidthMmFor` is the same
        // resolver the canvas draws the band with, so the routed width and
        // the drawn width cannot drift apart.
        widthMm: pathWidthMmFor(feature.kind, feature.attrs),
        maxSpeedMms: Number(feature.attrs.speedLimitMms) || null,
        minClearanceMm: feature.heightMm,
        allowedVehicleMask: mask,
        impedance: 1,
        sourceFeatureId: feature.featureId,
        // A one-way lane runs in the direction it was drawn, first point to
        // last. Reversing it is a matter of redrawing, so there is no
        // REVERSE_ONLY case to read here.
        traversal:
          feature.attrs.direction === "ONE_WAY"
            ? "FORWARD_ONLY"
            : "BIDIRECTIONAL",
      });
      authoredLaneCount++;
    }
  }

  if (crossingLanes.length > 0) {
    warnings.push({
      code: "LANE_CROSSES_OBSTACLE",
      message: `${new Set(crossingLanes).size} authored lane(s) pass through an obstacle: ${namesFor(crossingLanes, featureNameById)}. Columns in aisles are common — check these rather than assuming the lane is wrong.`,
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
        impedance: 1,
        sourceFeatureId: null,
        traversal: "BIDIRECTIONAL",
      });
      connectorCount++;
    }
  }

  // 3b. Free-roam zones. These come after the connector pass on purpose: that
  //     pass scans every AISLE endpoint pairwise, and a lattice would flood it
  //     with thousands of candidates that could never be cross-aisles anyway.
  const exclusionPolygons: Point[][] = [];
  for (const feature of input.features) {
    if (feature.floorLevel !== floorLevel) continue;
    if (!EXCLUSION_FEATURE_KINDS.has(feature.kind)) continue;
    const polygon = footprintVertices(feature);
    if (polygon.length >= 3) exclusionPolygons.push(polygon);
  }

  const blockedForZones = {
    rects: [...runRects, ...obstacles.map((o) => o.rect)],
    polygons: exclusionPolygons,
  };

  let zoneCount = 0;
  let zoneNodeCount = 0;
  const coarsenedZones: number[] = [];
  const emptyZones: number[] = [];
  const overflowedZones: number[] = [];

  for (const feature of input.features) {
    if (feature.floorLevel !== floorLevel) continue;
    if (!ZONE_FEATURE_KINDS.has(feature.kind)) continue;

    const polygon = footprintVertices(feature);
    if (polygon.length < 3) continue;
    zoneCount++;

    // Who may travel here. A work zone is pedestrian-only unless it says
    // otherwise; a drive zone is the reverse. Falling back to the full mask
    // when a warehouse has no pedestrian class keeps a zone routable rather
    // than silently unreachable.
    const isWorkZone = feature.kind === "WORK_ZONE";
    let mask: number;
    if (isWorkZone) {
      mask = feature.attrs.allowsVehicles
        ? allVehicles
        : footVehicles || allVehicles;
    } else {
      mask = feature.attrs.allowsPedestrians
        ? allVehicles
        : allVehicles & ~footVehicles || allVehicles;
    }

    const zone: NavigableZone = {
      featureId: feature.featureId,
      polygon,
      pitchMm: Number(feature.attrs.nodePitchMm) || ZONE_DEFAULT_PITCH_MM,
      allowedVehicleMask: mask,
      maxSpeedMms: Number(feature.attrs.speedLimitMms) || null,
    };

    // Snapshot before adding anything: a zone attaches to the network as it
    // stood, never to itself, and never twice to an earlier zone's mesh.
    const priorSegments = segments.slice();

    // Where the existing network reaches, or merely touches, this zone.
    const { portals, stubs } = findZoneTouches(priorSegments, polygon, blockedForZones, {
      edgeKind: "ZONE",
      widthMm: null,
      maxSpeedMms: null,
      minClearanceMm: null,
      allowedVehicleMask: mask,
      impedance: ZONE_IMPEDANCE,
      sourceFeatureId: feature.featureId,
      traversal: "BIDIRECTIONAL",
    });
    // Pushed immediately, not deferred to `built`: a stub cuts a segment that
    // belongs to the network at large (a lane, or an earlier zone's mesh),
    // and splitAtIntersections (step 4) runs on the whole `segments` array
    // once, after every zone has had its turn.
    segments.push(...stubs);

    const wantsGrid = feature.attrs.meshMode === "GRID";
    let built: { segments: WorkingSegment[]; nodes: Point[] } | null = null;

    if (!wantsGrid) {
      const mesh = buildZoneVisibilityMesh(zone, blockedForZones, portals);
      if (mesh.overflowed) {
        // Too cluttered for sightlines to stay affordable. Fall through to the
        // grid, which does not care how many obstacles there are.
        overflowedZones.push(feature.featureId);
      } else {
        built = mesh;
      }
    }

    if (!built) {
      const lattice = buildZoneLattice(zone, blockedForZones);
      if (lattice.coarsened) coarsenedZones.push(feature.featureId);
      built = lattice;

      // The lattice samples a grid and so has no node at a lane's end -- it
      // needs joining up explicitly. The visibility mesh took its portals as
      // node seeds, so it is already attached and this would only duplicate.
      const reach = lattice.pitchUsedMm;
      for (const point of portals) {
        let nearest: Point | null = null;
        let nearestDistance = reach;
        for (const node of lattice.nodes) {
          const distance = Math.hypot(node.x - point.x, node.y - point.y);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearest = node;
          }
        }
        if (!nearest || nearestDistance <= SNAP_MM) continue;
        built.segments.push({
          a: point,
          b: nearest,
          edgeKind: "ZONE",
          widthMm: null,
          maxSpeedMms: null,
          minClearanceMm: null,
          allowedVehicleMask: mask,
          impedance: ZONE_IMPEDANCE,
          sourceFeatureId: feature.featureId,
          traversal: "BIDIRECTIONAL",
        });
      }
    }

    if (built.segments.length === 0) {
      emptyZones.push(feature.featureId);
      continue;
    }

    zoneNodeCount += built.nodes.length;
    segments.push(...built.segments);
  }

  if (emptyZones.length > 0) {
    warnings.push({
      code: "ZONE_UNUSABLE",
      message: `${emptyZones.length} free-roam area(s) produced no routable floor: ${namesFor(emptyZones, featureNameById)}. Either the area is smaller than its grid pitch, or racking and obstacles cover all of it.`,
      featureIds: emptyZones,
    });
  }
  if (overflowedZones.length > 0) {
    warnings.push({
      code: "ZONE_MESH_FALLBACK",
      message: `${overflowedZones.length} free-roam area(s) have too many obstacles in them for straight-line routing and were compiled as a grid instead: ${namesFor(overflowedZones, featureNameById)}. Paths across them follow the grid rather than running straight.`,
      featureIds: overflowedZones,
    });
  }
  if (coarsenedZones.length > 0) {
    warnings.push({
      code: "ZONE_COARSENED",
      message: `${coarsenedZones.length} free-roam area(s) were too large for their grid pitch and were routed on a coarser one: ${namesFor(coarsenedZones, featureNameById)}. Raise the pitch, or split the area up, if you need the detail.`,
      featureIds: coarsenedZones,
    });
  }

  if (
    inferredCorridorCount === 0 &&
    authoredLaneCount === 0 &&
    zoneNodeCount === 0
  ) {
    warnings.push({
      code: "NO_CORRIDORS",
      message:
        "No aisles could be inferred, and no travel lanes or free-roam areas are drawn, so there is nothing to route on. Draw a travel lane or a drive/work area, or check that racking runs face each other across a gap of 0.8–8 m.",
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
      impedance: segment.impedance,
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
      impedance: 1,
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
      message: `${locationsWithoutAccess.length} location(s) have no aisle within reach and cannot be picked from: ${namesFor(locationsWithoutAccess, locationCodeById)}.`,
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

  // The "main" network is the one that serves the most pick faces, not the one
  // with the most nodes.
  //
  // Node count was a fine proxy while every node came from an aisle or a lane.
  // A free-roam zone breaks it: one 30 x 16 m area compiles to more nodes than
  // an entire rack block, so an unconnected zone would be declared the main
  // network and every real location in the hall reported as unreachable. What
  // actually makes a component the main one is how much of the warehouse you
  // can pick from it; node count only breaks ties (and covers a hall that has
  // no locations yet, where every component scores zero).
  const accessPointsPerComponent = new Map<string, number>();
  for (const accessPoint of accessPoints) {
    const root = roots.get(accessPoint.nodeKey);
    if (root === undefined) continue;
    accessPointsPerComponent.set(
      root,
      (accessPointsPerComponent.get(root) ?? 0) + 1,
    );
  }

  let largestRoot: string | null = null;
  let largestServed = -1;
  let largestSize = 0;
  for (const [root, size] of componentSizes) {
    const served = accessPointsPerComponent.get(root) ?? 0;
    if (served > largestServed || (served === largestServed && size > largestSize)) {
      largestServed = served;
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
    // Name every stray piece, not just the largest-vs-rest count: a piece
    // with no location on it at all (an isolated walkway, say) would
    // otherwise never appear in any warning, leaving no way to find it on
    // the canvas except by eye.
    const strayRoots = Array.from(componentSizes)
      .filter(([root]) => root !== largestRoot)
      .sort(([, a], [, b]) => b - a);

    const pieceDescriptions = strayRoots.map(([root, size]) => {
      const featureIds = new Set<number>();
      let sampleNode: CompiledNode | undefined;
      for (const edge of edges) {
        if (roots.get(edge.fromKey) !== root) continue;
        if (edge.sourceFeatureId != null) featureIds.add(edge.sourceFeatureId);
      }
      for (const key of nodeKeys) {
        if (roots.get(key) === root) {
          sampleNode = nodes.get(key);
          break;
        }
      }
      const label =
        featureIds.size > 0
          ? namesFor(Array.from(featureIds), featureNameById, 3)
          : sampleNode
            ? `an inferred aisle near (${Math.round(sampleNode.xMm)}, ${Math.round(sampleNode.yMm)})`
            : "an unnamed piece";
      return `${label} (${size} node${size === 1 ? "" : "s"})`;
    });

    const shownPieces = pieceDescriptions.slice(0, 5);
    const morePieces = pieceDescriptions.length - shownPieces.length;
    const pieceSuffix =
      morePieces > 0 ? `; and ${morePieces} more piece(s)` : "";

    warnings.push({
      code: "DISCONNECTED_GRAPH",
      message: `The network has ${componentCount} separate pieces. Besides the main one: ${shownPieces.join("; ")}${pieceSuffix}. Anything in these cannot be routed to — add a travel lane joining them to the rest.`,
    });
  }
  if (unreachable.size > 0) {
    const ids = Array.from(unreachable);
    warnings.push({
      code: "UNREACHABLE_LOCATIONS",
      message: `${ids.length} location(s) are not reachable from the main network: ${namesFor(ids, locationCodeById)}.`,
      locationIds: ids.slice(0, 50),
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
      navigableZones: zoneCount,
      zoneNodes: zoneNodeCount,
      componentCount,
      reachableLocationCount: totalLocations - unreachable.size,
      unreachableLocationCount: unreachable.size,
    },
  };
}
