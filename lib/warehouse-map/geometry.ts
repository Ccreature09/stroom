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
