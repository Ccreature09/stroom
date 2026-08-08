// Free-roam navigable areas: drive zones and work zones.
//
// A lane is a centreline -- one line that says "travel here". An open area
// has no such line, the whole surface is travel space, which is exactly why
// the graph compiler's corridor inference refuses to guess one for gaps
// wider than MAX_CORRIDOR_MM. This module is the compiler's answer for that
// case: fill the area with routable structure instead of a guessed line.
//
// Two strategies, tried in order:
//   1. A visibility mesh -- a node on every corner a path could bend around,
//      with straight lines between any two that can see each other. Exact
//      paths, cheap for a normal number of obstacles.
//   2. A grid lattice -- sample the area on a fixed pitch, keep what is
//      clear, connect 8-way. Falls back to this when the mesh would need too
//      many sightline tests to stay affordable.
//
// Depends only on `./geometry` (the dependency-free foundation) and, for one
// shared shape, an `import type` from `./graph-compiler` -- which TypeScript
// erases entirely, so this module has no runtime dependency on the compiler
// that imports it back. That keeps the relationship one-directional: the
// compiler depends on this file, never the other way around.

import {
  MERGE_RADIUS_MM,
  SNAP_MM,
  connectedComponents,
  distanceToPolyline,
  pointInPolygon,
  projectOntoSegment,
  segmentIntersection,
  segmentIntersectsPolygon,
  segmentIntersectsRect,
  type Point,
  type Rect,
  type Segment,
} from "./geometry";
import type { WorkingSegment } from "./graph-compiler";

// --- Tuning -----------------------------------------------------------

/** Areas where the whole surface is navigable rather than a centreline. */
export const ZONE_FEATURE_KINDS = new Set(["DRIVE_ZONE", "WORK_ZONE"]);
/**
 * Areas nothing may be routed through. These are not `isObstacle` features --
 * an exclusion is about who may travel, not about something physically in the
 * way -- so the lattice has to honour them explicitly.
 */
export const EXCLUSION_FEATURE_KINDS = new Set([
  "VEHICLE_EXCLUSION",
  "PEDESTRIAN_EXCLUSION",
  "NO_ENTRY_ZONE",
]);

/** Lattice spacing for a free-roam zone that does not state its own. */
export const ZONE_DEFAULT_PITCH_MM = 2000;
/**
 * Hard floor on lattice spacing. Must stay above MERGE_RADIUS_MM: node
 * dedup fuses anything closer than that into one node, so a finer pitch would
 * collapse neighbouring lattice points together and produce a mesh full of
 * self-edges that get dropped -- a lattice that looks dense and routes worse
 * than a coarse one.
 */
export const ZONE_MIN_PITCH_MM = MERGE_RADIUS_MM * 2;
/**
 * Ceiling on lattice points per zone, enforced by coarsening the pitch rather
 * than truncating the area (half a zone is worse than a coarse whole one).
 *
 * The binding constraint is the compiler's intersection splitting, which is
 * O(segments^2) before its own spatial index, and worse still without one.
 * 8-connectivity emits close to 4 segments per node, so 1200 nodes is already
 * ~4800 segments. Raising this is not free.
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

// --- Types ------------------------------------------------------------

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
 * corridor inference refuses to guess one for gaps wider than MAX_CORRIDOR_MM.
 * A lattice is the cheapest honest answer: sample the area, keep what is
 * actually clear, and let the router pick its way across.
 *
 * 8-connected, not 4. With only the axis neighbours a diagonal crossing
 * becomes a staircase, and the router's turn penalty charges a full
 * 90-degree turn at every single step of it -- a 20 m diagonal would cost
 * more than going the long way round. The diagonals make that one straight
 * arc.
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
 * intersection-splitting pass runs over the whole network later. A segment
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
 * geometrically right and topologically isolated. Rather than cutting it
 * here, a short stub is added from the graze point back onto the existing
 * segment: it crosses the segment for real, so the same intersection-split
 * pass that handles every other crossing in the network makes the cut, and
 * the stub's zone-side end becomes a mesh portal.
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
