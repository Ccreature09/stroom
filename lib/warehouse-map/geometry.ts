// Shared geometry for layout features. Imported by the canvas (client) and by
// the commit action (server), so it stays free of React and Pixi.
//
// Conventions, matching what the canvas already does for locations:
//   - All coordinates are integer millimetres. Round at every mutation
//     boundary; float world coordinates accumulate drift under repeated
//     drag/rotate and leave sub-millimetre gaps that break adjacency snapping.
//   - Rotation is clockwise in degrees about the feature's *origin* (its
//     top-left anchor), which is what Pixi does for a container positioned at
//     the origin with pivot (0,0).
//   - `points` are stored feature-local (relative to the origin, unrotated).
//     World position = origin + rotate(point, rotation).

export type GeometryKind = "RECT" | "POLYGON" | "POLYLINE" | "POINT" | "CIRCLE";

export type Point = { x: number; y: number };

export type Envelope = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/** The subset of a feature's fields that determine its footprint. */
export type FeatureGeometry = {
  geometryKind: GeometryKind;
  originXMm: number;
  originYMm: number;
  widthMm: number;
  lengthMm: number;
  rotationDegrees: number;
  points: Point[] | null;
};

export function normalizeRotation(degrees: number): number {
  return ((Math.round(degrees) % 360) + 360) % 360;
}

/** Rotate (x, y) clockwise by `degrees` about the origin (0, 0). */
export function rotateAboutOrigin(
  x: number,
  y: number,
  degrees: number,
): Point {
  if (degrees === 0) return { x, y };
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

/**
 * The four corners of a rotated rectangle, in world mm. Used for the envelope
 * and for exact hit testing -- the axis-aligned box is only the broad phase.
 */
export function rectCorners(
  originX: number,
  originY: number,
  width: number,
  length: number,
  rotationDegrees: number,
): Point[] {
  const local: Point[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: length },
    { x: 0, y: length },
  ];
  return local.map((p) => {
    const r = rotateAboutOrigin(p.x, p.y, rotationDegrees);
    return { x: originX + r.x, y: originY + r.y };
  });
}

/** A feature's points converted from feature-local to world mm. */
export function worldPoints(geometry: FeatureGeometry): Point[] {
  const pts = geometry.points ?? [];
  return pts.map((p) => {
    const r = rotateAboutOrigin(p.x, p.y, geometry.rotationDegrees);
    return { x: geometry.originXMm + r.x, y: geometry.originYMm + r.y };
  });
}

/**
 * The vertices that define this feature's footprint in world mm, whatever its
 * geometry kind. POINT returns a single vertex; CIRCLE is treated as its
 * bounding square (widthMm is the diameter).
 */
export function footprintVertices(geometry: FeatureGeometry): Point[] {
  switch (geometry.geometryKind) {
    case "RECT":
    case "CIRCLE":
      return rectCorners(
        geometry.originXMm,
        geometry.originYMm,
        geometry.widthMm,
        geometry.geometryKind === "CIRCLE"
          ? geometry.widthMm
          : geometry.lengthMm,
        geometry.rotationDegrees,
      );
    case "POLYGON":
    case "POLYLINE":
      return worldPoints(geometry);
    case "POINT":
      return [{ x: geometry.originXMm, y: geometry.originYMm }];
  }
}

/**
 * Axis-aligned bounding box *after* rotation. This is what gets persisted and
 * indexed -- indexing origin+width would be wrong for any rotated feature,
 * which is the same defect the locations canvas-render index still has.
 */
export function computeEnvelope(geometry: FeatureGeometry): Envelope {
  const vertices = footprintVertices(geometry);
  if (vertices.length === 0) {
    return {
      minX: geometry.originXMm,
      minY: geometry.originYMm,
      maxX: geometry.originXMm,
      maxY: geometry.originYMm,
    };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of vertices) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    minX: Math.round(minX),
    minY: Math.round(minY),
    maxX: Math.round(maxX),
    maxY: Math.round(maxY),
  };
}

export function envelopesOverlap(a: Envelope, b: Envelope): boolean {
  return (
    a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
  );
}

/** Ray casting. Points on the boundary are not guaranteed either way. */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    const intersects =
      pi.y > point.y !== pj.y > point.y &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

export function distanceToPolyline(point: Point, polyline: Point[]): number {
  if (polyline.length === 0) return Infinity;
  if (polyline.length === 1)
    return Math.hypot(point.x - polyline[0].x, point.y - polyline[0].y);
  let best = Infinity;
  for (let i = 1; i < polyline.length; i++) {
    const d = distanceToSegment(point, polyline[i - 1], polyline[i]);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Exact hit test in world mm. `tolerance` widens line-like and point-like
 * geometry so thin features stay clickable -- callers pass a screen-space
 * tolerance converted to mm at the current zoom, so the grab area stays
 * constant on screen rather than shrinking as you zoom out.
 */
export function hitTestFeature(
  geometry: FeatureGeometry,
  point: Point,
  toleranceMm: number,
): boolean {
  switch (geometry.geometryKind) {
    case "RECT":
    case "CIRCLE":
    case "POLYGON": {
      const vertices = footprintVertices(geometry);
      if (pointInPolygon(point, vertices)) return true;
      // Zero-area or very thin polygons still need to be selectable.
      return distanceToPolyline(point, [...vertices, vertices[0]]) <=
        toleranceMm;
    }
    case "POLYLINE":
      return distanceToPolyline(point, worldPoints(geometry)) <= toleranceMm;
    case "POINT":
      return (
        Math.hypot(
          point.x - geometry.originXMm,
          point.y - geometry.originYMm,
        ) <= toleranceMm
      );
  }
}

export type Segment = { a: Point; b: Point };

/**
 * Proper intersection of two segments, or null. Collinear overlap returns
 * null: the graph compiler handles duplicate/overlapping lanes by node
 * deduping, and splitting on a collinear overlap would produce zero-length
 * edges instead of a useful junction.
 */
export function segmentIntersection(s1: Segment, s2: Segment): Point | null {
  const d1x = s1.b.x - s1.a.x;
  const d1y = s1.b.y - s1.a.y;
  const d2x = s2.b.x - s2.a.x;
  const d2y = s2.b.y - s2.a.y;

  const denominator = d1x * d2y - d1y * d2x;
  if (denominator === 0) return null; // parallel or collinear

  const t = ((s2.a.x - s1.a.x) * d2y - (s2.a.y - s1.a.y) * d2x) / denominator;
  const u = ((s2.a.x - s1.a.x) * d1y - (s2.a.y - s1.a.y) * d1x) / denominator;

  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: s1.a.x + t * d1x, y: s1.a.y + t * d1y };
}

/** Axis-aligned rectangle, used for rack runs and feature envelopes. */
export type Rect = { minX: number; minY: number; maxX: number; maxY: number };

export function rectFromEnvelope(envelope: Envelope): Rect {
  return {
    minX: envelope.minX,
    minY: envelope.minY,
    maxX: envelope.maxX,
    maxY: envelope.maxY,
  };
}

/**
 * Whether a segment touches a rectangle's interior. `inset` shrinks the rect
 * first, so a lane running exactly along a rack face is not treated as
 * passing through it -- which is the normal case for an inferred corridor.
 */
export function segmentIntersectsRect(
  segment: Segment,
  rect: Rect,
  inset = 0,
): boolean {
  const minX = rect.minX + inset;
  const minY = rect.minY + inset;
  const maxX = rect.maxX - inset;
  const maxY = rect.maxY - inset;
  if (minX >= maxX || minY >= maxY) return false;

  // Either endpoint inside is an immediate hit.
  const inside = (p: Point) =>
    p.x > minX && p.x < maxX && p.y > minY && p.y < maxY;
  if (inside(segment.a) || inside(segment.b)) return true;

  const edges: Segment[] = [
    { a: { x: minX, y: minY }, b: { x: maxX, y: minY } },
    { a: { x: maxX, y: minY }, b: { x: maxX, y: maxY } },
    { a: { x: maxX, y: maxY }, b: { x: minX, y: maxY } },
    { a: { x: minX, y: maxY }, b: { x: minX, y: minY } },
  ];
  return edges.some((edge) => segmentIntersection(segment, edge) !== null);
}

/**
 * Whether a segment touches a polygon at all -- either endpoint inside it, or
 * the segment crossing one of its edges.
 *
 * The rect version above is the fast path for axis-aligned footprints; this is
 * for authored polygons (exclusion zones, oddly shaped areas) where the
 * bounding box would reject far too much floor.
 */
export function segmentIntersectsPolygon(
  segment: Segment,
  polygon: Point[],
): boolean {
  if (polygon.length < 3) return false;
  if (pointInPolygon(segment.a, polygon)) return true;
  if (pointInPolygon(segment.b, polygon)) return true;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (segmentIntersection(segment, { a: polygon[j], b: polygon[i] })) {
      return true;
    }
  }
  return false;
}

/** Closest point on a segment to `point`, and how far along it that is. */
export function projectOntoSegment(
  point: Point,
  segment: Segment,
): { point: Point; t: number; distance: number } {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return {
      point: { ...segment.a },
      t: 0,
      distance: Math.hypot(point.x - segment.a.x, point.y - segment.a.y),
    };
  }
  let t =
    ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) /
    lengthSquared;
  t = Math.max(0, Math.min(1, t));
  const projected = { x: segment.a.x + t * dx, y: segment.a.y + t * dy };
  return {
    point: projected,
    t,
    distance: Math.hypot(point.x - projected.x, point.y - projected.y),
  };
}

export function envelopeCenter(envelope: Envelope): Point {
  return {
    x: (envelope.minX + envelope.maxX) / 2,
    y: (envelope.minY + envelope.maxY) / 2,
  };
}

/** Validates and rounds a raw `points` value coming from a client payload. */
export function sanitizePoints(value: unknown): Point[] | null {
  if (!Array.isArray(value)) return null;
  const result: Point[] = [];
  for (const entry of value) {
    let x: unknown;
    let y: unknown;
    if (Array.isArray(entry)) {
      [x, y] = entry;
    } else if (entry && typeof entry === "object") {
      ({ x, y } = entry as { x?: unknown; y?: unknown });
    } else {
      return null;
    }
    if (typeof x !== "number" || typeof y !== "number") return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    result.push({ x: Math.round(x), y: Math.round(y) });
  }
  return result;
}

/**
 * Default points for a newly drawn polygon/polyline, derived from the
 * rectangle the user dragged out. A polygon starts as that rectangle; a
 * polyline starts as its long axis, which is what a wall or conveyor wants.
 */
export type ResizeCorner = "nw" | "ne" | "se" | "sw";

/**
 * Local coordinates of a box corner, given the box's own width/length. `nw` is
 * the origin because rotation is about the origin (see the conventions above).
 */
function localCorner(
  corner: ResizeCorner,
  width: number,
  length: number,
): Point {
  switch (corner) {
    case "nw":
      return { x: 0, y: 0 };
    case "ne":
      return { x: width, y: 0 };
    case "se":
      return { x: width, y: length };
    case "sw":
      return { x: 0, y: length };
  }
}

const OPPOSITE_CORNER: Record<ResizeCorner, ResizeCorner> = {
  nw: "se",
  ne: "sw",
  se: "nw",
  sw: "ne",
};

/** World position of one corner of a (possibly rotated) box. */
export function worldCorner(
  originXMm: number,
  originYMm: number,
  widthMm: number,
  lengthMm: number,
  rotationDegrees: number,
  corner: ResizeCorner,
): Point {
  const local = localCorner(corner, widthMm, lengthMm);
  const rotated = rotateAboutOrigin(local.x, local.y, rotationDegrees);
  return { x: originXMm + rotated.x, y: originYMm + rotated.y };
}

/**
 * Union bounding box of several envelopes. Used to size the outline drawn
 * around a mixed multi-selection and to find the pivot for a group rotate --
 * an empty input returns a degenerate zero-size box at the origin rather than
 * throwing, since a selection can transiently be empty between renders.
 */
export function unionEnvelopes(envelopes: Envelope[]): Envelope {
  if (envelopes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const e of envelopes) {
    if (e.minX < minX) minX = e.minX;
    if (e.minY < minY) minY = e.minY;
    if (e.maxX > maxX) maxX = e.maxX;
    if (e.maxY > maxY) maxY = e.maxY;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Rigid-body rotation of one member of a group: rotates its origin around an
 * external pivot by `deltaDegrees` and adds the same delta to its own
 * rotation. `points` (feature-local, relative to the origin) need no change --
 * only where the origin sits and which way the box now faces.
 *
 * Derivation: a box is the transform T(origin) ∘ Rot(rotation). Rotating that
 * whole rigid body by `delta` about pivot P is Rot_P(delta) ∘ T(origin) ∘
 * Rot(rotation), which expands to T(P + Rot(delta)(origin - P)) ∘
 * Rot(delta + rotation) -- i.e. exactly the origin/rotation update below.
 */
export function rigidRotateAround(
  originXMm: number,
  originYMm: number,
  rotationDegrees: number,
  pivotXMm: number,
  pivotYMm: number,
  deltaDegrees: number,
): { originXMm: number; originYMm: number; rotationDegrees: number } {
  const rel = rotateAboutOrigin(
    originXMm - pivotXMm,
    originYMm - pivotYMm,
    deltaDegrees,
  );
  return {
    originXMm: Math.round(pivotXMm + rel.x),
    originYMm: Math.round(pivotYMm + rel.y),
    rotationDegrees: normalizeRotation(rotationDegrees + deltaDegrees),
  };
}

/**
 * Translation to apply to every member of a group so its combined bounding
 * box sits inside the hall, preserving every member's position relative to
 * the others. A box bigger than the hall on an axis pins to that axis's near
 * edge rather than being left to hang off both sides.
 */
export function clampBBoxOffset(
  bbox: Envelope,
  hallWidthMm: number,
  hallLengthMm: number,
): Point {
  const width = bbox.maxX - bbox.minX;
  const length = bbox.maxY - bbox.minY;

  const dx =
    width > hallWidthMm
      ? -bbox.minX
      : Math.max(-bbox.minX, Math.min(0, hallWidthMm - bbox.maxX));
  const dy =
    length > hallLengthMm
      ? -bbox.minY
      : Math.max(-bbox.minY, Math.min(0, hallLengthMm - bbox.maxY));

  return { x: dx, y: dy };
}

/**
 * Resizes a rotated box by dragging one corner, holding the opposite corner
 * fixed in world space.
 *
 * The naive version -- deriving width from the pointer's world X and length
 * from its world Y -- silently assumes the box is axis-aligned. Once a feature
 * is rotated 90° its local width runs vertically on screen, so dragging
 * sideways stretched it the wrong way. Everything here happens in the box's
 * own rotated frame instead, so a drag along the box's visible long edge
 * always changes the dimension the user is actually pulling.
 */
export function resizeRotatedBox(
  originXMm: number,
  originYMm: number,
  widthMm: number,
  lengthMm: number,
  rotationDegrees: number,
  corner: ResizeCorner,
  pointer: Point,
  minSizeMm: number,
): { originXMm: number; originYMm: number; widthMm: number; lengthMm: number } {
  const anchor = OPPOSITE_CORNER[corner];
  // The anchor's world position is fixed for the whole gesture: it is computed
  // from the geometry as it was when the drag started.
  const anchorWorld = worldCorner(
    originXMm,
    originYMm,
    widthMm,
    lengthMm,
    rotationDegrees,
    anchor,
  );

  // Pointer offset from the anchor, expressed in the box's local frame.
  const local = rotateAboutOrigin(
    pointer.x - anchorWorld.x,
    pointer.y - anchorWorld.y,
    -rotationDegrees,
  );

  // Which way the dragged corner grows along each local axis.
  const signX = corner === "ne" || corner === "se" ? 1 : -1;
  const signY = corner === "sw" || corner === "se" ? 1 : -1;

  const nextWidth = Math.max(minSizeMm, Math.round(local.x * signX));
  const nextLength = Math.max(minSizeMm, Math.round(local.y * signY));

  // Re-anchor: the origin is wherever it has to be for the anchor corner of
  // the *new* box to land back on the same world point.
  const anchorLocal = localCorner(anchor, nextWidth, nextLength);
  const rotatedAnchor = rotateAboutOrigin(
    anchorLocal.x,
    anchorLocal.y,
    rotationDegrees,
  );

  return {
    originXMm: Math.round(anchorWorld.x - rotatedAnchor.x),
    originYMm: Math.round(anchorWorld.y - rotatedAnchor.y),
    widthMm: nextWidth,
    lengthMm: nextLength,
  };
}

export type ResizeAxis = "width" | "length";
export type ResizeEnd = "start" | "end";

/**
 * Resizes a rotated box along a single local axis, holding the other axis's
 * size completely fixed regardless of where the pointer actually is.
 *
 * Some feature kinds have one dimension that is a real physical spec (a dock
 * door's opening width, a wall's thickness) and should never move under a
 * drag -- only a corner handle can offer that, since corner-dragging changes
 * both dimensions from wherever the pointer lands. This is the single-axis
 * counterpart: `axis` says which dimension the drag is allowed to change,
 * `end` says which edge of that axis is being pulled (the opposite edge is
 * the anchor, exactly like resizeRotatedBox's opposite corner).
 */
export function resizeRotatedBoxAlongAxis(
  originXMm: number,
  originYMm: number,
  widthMm: number,
  lengthMm: number,
  rotationDegrees: number,
  axis: ResizeAxis,
  end: ResizeEnd,
  pointer: Point,
  minSizeMm: number,
): { originXMm: number; originYMm: number; widthMm: number; lengthMm: number } {
  // Any corner on the fixed edge works as the anchor, since the locked axis
  // never changes -- the two candidates for a given (axis, end) always agree
  // on where that edge sits.
  const anchor: ResizeCorner =
    axis === "length"
      ? end === "end"
        ? "nw"
        : "sw"
      : end === "end"
        ? "nw"
        : "ne";

  const anchorWorld = worldCorner(
    originXMm,
    originYMm,
    widthMm,
    lengthMm,
    rotationDegrees,
    anchor,
  );

  const local = rotateAboutOrigin(
    pointer.x - anchorWorld.x,
    pointer.y - anchorWorld.y,
    -rotationDegrees,
  );

  let nextWidth = widthMm;
  let nextLength = lengthMm;

  if (axis === "length") {
    const sign = end === "end" ? 1 : -1;
    nextLength = Math.max(minSizeMm, Math.round(local.y * sign));
  } else {
    const sign = end === "end" ? 1 : -1;
    nextWidth = Math.max(minSizeMm, Math.round(local.x * sign));
  }

  const anchorLocal = localCorner(anchor, nextWidth, nextLength);
  const rotatedAnchor = rotateAboutOrigin(
    anchorLocal.x,
    anchorLocal.y,
    rotationDegrees,
  );

  return {
    originXMm: Math.round(anchorWorld.x - rotatedAnchor.x),
    originYMm: Math.round(anchorWorld.y - rotatedAnchor.y),
    widthMm: nextWidth,
    lengthMm: nextLength,
  };
}

/**
 * World position of the midpoint of one edge along the adjustable axis --
 * where a single-axis resize handle sits. For axis "length" this is the
 * midpoint of the box's width at y=0 (end "start") or y=length (end "end");
 * symmetric for axis "width".
 */
export function edgeMidpoint(
  originXMm: number,
  originYMm: number,
  widthMm: number,
  lengthMm: number,
  rotationDegrees: number,
  axis: ResizeAxis,
  end: ResizeEnd,
): Point {
  const local =
    axis === "length"
      ? { x: widthMm / 2, y: end === "end" ? lengthMm : 0 }
      : { x: end === "end" ? widthMm : 0, y: lengthMm / 2 };
  const rotated = rotateAboutOrigin(local.x, local.y, rotationDegrees);
  return { x: originXMm + rotated.x, y: originYMm + rotated.y };
}

/**
 * Footprint for a feature dropped by a single click: centred on the cursor and
 * pulled back inside the hall if it would hang over an edge.
 *
 * Shared by the drag-free placement gesture and the ghost preview that
 * preceded it, so what you see under the cursor is exactly what gets created.
 * A footprint larger than the hall pins to the near edge rather than jumping.
 */
export function centredPlacement(
  centreXMm: number,
  centreYMm: number,
  widthMm: number,
  lengthMm: number,
  hallWidthMm: number,
  hallLengthMm: number,
): { x: number; y: number; width: number; height: number } {
  const width = Math.min(Math.max(0, widthMm), hallWidthMm);
  const height = Math.min(Math.max(0, lengthMm), hallLengthMm);
  const x = Math.max(
    0,
    Math.min(Math.round(centreXMm - width / 2), hallWidthMm - width),
  );
  const y = Math.max(
    0,
    Math.min(Math.round(centreYMm - height / 2), hallLengthMm - height),
  );
  return { x, y, width, height };
}

export function defaultPointsForDrawnRect(
  geometryKind: GeometryKind,
  widthMm: number,
  lengthMm: number,
): Point[] | null {
  if (geometryKind === "POLYGON") {
    return [
      { x: 0, y: 0 },
      { x: widthMm, y: 0 },
      { x: widthMm, y: lengthMm },
      { x: 0, y: lengthMm },
    ];
  }
  if (geometryKind === "POLYLINE") {
    return widthMm >= lengthMm
      ? [
          { x: 0, y: Math.round(lengthMm / 2) },
          { x: widthMm, y: Math.round(lengthMm / 2) },
        ]
      : [
          { x: Math.round(widthMm / 2), y: 0 },
          { x: Math.round(widthMm / 2), y: lengthMm },
        ];
  }
  return null;
}

/**
 * Rescales a feature into a new bounding box. Rect-like geometry just takes
 * the new width/length; point/line/polygon geometry scales its local points
 * proportionally so a dragged handle behaves the same for every kind.
 */
export function scaleGeometry(
  geometry: FeatureGeometry,
  newWidthMm: number,
  newLengthMm: number,
): { widthMm: number; lengthMm: number; points: Point[] | null } {
  const width = Math.max(1, Math.round(newWidthMm));
  const length = Math.max(1, Math.round(newLengthMm));

  if (
    geometry.geometryKind === "RECT" ||
    geometry.geometryKind === "CIRCLE" ||
    geometry.geometryKind === "POINT" ||
    !geometry.points ||
    geometry.points.length === 0
  ) {
    return { widthMm: width, lengthMm: length, points: geometry.points };
  }

  const oldWidth = geometry.widthMm || 1;
  const oldLength = geometry.lengthMm || 1;
  const scaleX = width / oldWidth;
  const scaleY = length / oldLength;

  return {
    widthMm: width,
    lengthMm: length,
    points: geometry.points.map((p) => ({
      x: Math.round(p.x * scaleX),
      y: Math.round(p.y * scaleY),
    })),
  };
}
