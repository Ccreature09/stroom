// Pure rendering helpers for the layout designer canvas.
//
// Everything here is a function of its arguments only -- no refs, no Pixi
// app/viewport lifecycle, no pointer events. That is what makes this safe to
// split out of layout-designer-canvas.tsx on code review alone: nothing here
// can change what a drag, resize or click does, only how a shape or a cursor
// is computed from data that is already decided. The gesture state machines
// (drag, resize, marquee, and the rest) stay in the component itself, since
// splitting *those* safely needs to be verified interactively, one at a time.

import type { Graphics } from "pixi.js";
import {
  groupByBayFootprint,
  type LocationDTO,
} from "@/lib/warehouse-map/types";
import {
  centredPlacement,
  computeEnvelope,
  normalizeRotation,
  rotateAboutOrigin,
  type FeatureGeometry,
  type GeometryKind,
  type Point,
  type ResizeAxis,
} from "@/lib/warehouse-map/geometry";
import {
  LOCATION_TYPE_DEFAULT_SIZE_MM,
  type LocationType,
} from "@/lib/warehouse-map/naming";

/**
 * Clamps a proposed origin so the geometry's *rendered envelope* stays inside
 * the hall.
 *
 * The envelope rather than (origin, width, length) is what has to fit:
 * rotation is about the origin, so a rotated box occupies a different
 * rectangle than its nominal one, and a polyline's local points can legally
 * run outside its nominal box as well. Clamping the nominal box would let a
 * rotated rack hang through the wall while its numbers still looked in range.
 *
 * A footprint larger than the hall pins to the near edge rather than jumping:
 * when the upper bound falls below the lower one, the outer Math.max wins.
 */
export function clampOriginToHall(
  geometry: FeatureGeometry,
  nextX: number,
  nextY: number,
  hallWidth: number,
  hallHeight: number,
): Point {
  // Measured with the origin at (0, 0), the envelope is the set of offsets
  // from the origin to each edge of the footprint -- which is exactly what the
  // hall bounds have to be applied against.
  const local = computeEnvelope({
    ...geometry,
    originXMm: 0,
    originYMm: 0,
  });
  return {
    x: Math.max(-local.minX, Math.min(nextX, hallWidth - local.maxX)),
    y: Math.max(-local.minY, Math.min(nextY, hallHeight - local.maxY)),
  };
}

/**
 * Pins a pointer position to the hall.
 *
 * Every resize gesture holds one corner fixed and follows the pointer with the
 * opposite one, so confining the pointer is enough to confine the result --
 * the anchor corner is already inside the hall by induction.
 */
export function clampPointToHall(
  world: Point,
  hallWidth: number,
  hallHeight: number,
): Point {
  return {
    x: Math.max(0, Math.min(world.x, hallWidth)),
    y: Math.max(0, Math.min(world.y, hallHeight)),
  };
}

export const HANDLE_CORNERS = ["nw", "ne", "se", "sw"] as const;
export type Corner = (typeof HANDLE_CORNERS)[number];

/** Amber used everywhere a not-yet-published location or feature is drawn,
 *  so a pending create reads consistently across every shape kind. */
export const PENDING_CREATE_COLOR = 0xf59e0b;

/**
 * Walks a polyline and emits dash segments into `g`. Pixi has no dashed-stroke
 * primitive, and the dashed centre line is what makes a travel lane read as a
 * road rather than a solid painted block.
 */
export function dashPath(
  g: Graphics,
  points: Point[],
  dashMm: number,
  gapMm: number,
) {
  const period = dashMm + gapMm;
  if (period <= 0) return;
  let carry = 0;

  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const segment = Math.hypot(dx, dy);
    if (segment <= 0) continue;
    const ux = dx / segment;
    const uy = dy / segment;

    // `carry` keeps the dash rhythm continuous across corners instead of
    // restarting the pattern at every vertex.
    let cursor = -carry;
    while (cursor < segment) {
      const start = Math.max(cursor, 0);
      const end = Math.min(cursor + dashMm, segment);
      if (end > start) {
        g.moveTo(from.x + ux * start, from.y + uy * start);
        g.lineTo(from.x + ux * end, from.y + uy * end);
      }
      cursor += period;
    }
    carry = (carry + segment) % period;
  }
}

export function parseHexToInt(hex: string | null | undefined, fallback: number) {
  if (!hex) return fallback;
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  return match ? parseInt(match[1], 16) : fallback;
}

/**
 * Diagonal resize cursor for a corner, accounting for rotation. A "nw" corner
 * on a box rotated 90° sits where "ne" visually is, so the unrotated cursor
 * would point across the drag rather than along it.
 */
export function resizeCursorFor(corner: Corner, rotationDegrees: number) {
  const quarterTurns = Math.round(normalizeRotation(rotationDegrees) / 90) % 2;
  const isPrimaryDiagonal = corner === "nw" || corner === "se";
  const flipped = quarterTurns === 1 ? !isPrimaryDiagonal : isPrimaryDiagonal;
  return flipped ? "nwse-resize" : "nesw-resize";
}

/**
 * Resize cursor for a single-axis (edge midpoint) handle. Unlike a corner --
 * which is diagonal in the local frame at every rotation, so only nwse/nesw
 * ever apply -- an edge handle is axis-aligned locally and can land exactly
 * horizontal or vertical on screen, so this also picks the plain ns/ew
 * cursors when the rotation puts it there.
 */
export function axisResizeCursorFor(axis: ResizeAxis, rotationDegrees: number) {
  const AXIS_CURSORS = [
    "ew-resize",
    "nwse-resize",
    "ns-resize",
    "nesw-resize",
  ] as const;
  const local = axis === "length" ? { x: 0, y: 1 } : { x: 1, y: 0 };
  const world = rotateAboutOrigin(local.x, local.y, rotationDegrees);
  const angleDeg = ((Math.atan2(world.y, world.x) * 180) / Math.PI + 360) % 360;
  // The cursor is undirected (dragging either way along the same line looks
  // the same), so fold to a half-turn before snapping to the nearest of the
  // 4 orientations 45 degrees apart.
  const sector = Math.round((angleDeg % 180) / 45) % 4;
  return AXIS_CURSORS[sector];
}

/**
 * Bay Aggregation: for racking/shelf locations, multiple DB rows can share
 * the same physical footprint (aisle+bay), one per level. On the top-level
 * canvas we only want to render ONE node per footprint -- preferring the
 * currently active level if it has a member there, otherwise falling back to
 * the lowest level present -- plus every other location (floor storage, or
 * anything without aisle/bay) rendered as-is.
 */
export function resolveVisibleLocations(
  allLocations: LocationDTO[],
  activeLevel: number | null,
): { visible: LocationDTO[]; memberCountByLocationId: Map<number, number> } {
  const memberCountByLocationId = new Map<number, number>();
  const bayGroups = groupByBayFootprint(allLocations);
  const aggregatedIds = new Set<number>();
  for (const group of bayGroups.values()) {
    for (const loc of group) aggregatedIds.add(loc.locationId);
  }

  const visible: LocationDTO[] = [];

  for (const group of bayGroups.values()) {
    if (group.length === 0) continue;
    const sorted = [...group].sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
    const preferred =
      (activeLevel != null && sorted.find((l) => l.level === activeLevel)) ||
      sorted[0];
    visible.push(preferred);
    memberCountByLocationId.set(preferred.locationId, sorted.length);
  }

  for (const loc of allLocations) {
    if (!aggregatedIds.has(loc.locationId)) {
      visible.push(loc);
      memberCountByLocationId.set(loc.locationId, 1);
    }
  }

  return { visible, memberCountByLocationId };
}

export function strokeForNode(locationId: number, isSelected: boolean) {
  if (locationId < 0) {
    return { width: isSelected ? 45 : 24, color: PENDING_CREATE_COLOR };
  }
  return {
    width: isSelected ? 45 : 18,
    color: isSelected ? 0x0f172a : 0x1e293b,
  };
}

const POINT_MARKER_MM = 350;

export type ArmedFeature = {
  kind: string;
  label: string;
  color: string;
  geometryKind: GeometryKind;
  widthMm: number;
  lengthMm: number;
};

/**
 * Outline of the armed feature at its real size, centred on the cursor.
 * Click-to-place is only trustworthy if you can see what you are about to
 * drop and how big it is before committing.
 */
export function drawFeatureGhost(
  g: Graphics,
  world: Point | null,
  armed: ArmedFeature | null,
  tool: string,
  hallWidthMm: number,
  hallLengthMm: number,
) {
  g.clear();
  if (!armed || !world || tool !== "feature") return;

  const color = parseHexToInt(armed.color, 0x0891b2);
  const { x, y, width, height } = centredPlacement(
    world.x,
    world.y,
    armed.widthMm,
    armed.lengthMm,
    hallWidthMm,
    hallLengthMm,
  );

  if (armed.geometryKind === "POINT") {
    g.circle(world.x, world.y, POINT_MARKER_MM)
      .fill({ color, alpha: 0.35 })
      .stroke({ width: 60, color, alpha: 0.9 });
    return;
  }

  if (armed.geometryKind === "CIRCLE") {
    const r = Math.min(width, height) / 2;
    g.circle(x + width / 2, y + height / 2, r)
      .fill({ color, alpha: 0.2 })
      .stroke({ width: 60, color, alpha: 0.9 });
    return;
  }

  if (armed.geometryKind === "POLYLINE") {
    const midY = y + height / 2;
    g.moveTo(x, midY).lineTo(x + width, midY);
    g.stroke({
      width: Math.max(60, height),
      color,
      alpha: 0.4,
      cap: "round",
    });
    return;
  }

  g.rect(x, y, width, height)
    .fill({ color, alpha: 0.2 })
    .stroke({ width: 60, color, alpha: 0.9 });
}

const LOCATION_GHOST_COLOR = 0x0891b2;

/**
 * Outline of the armed location type at its stock size, centred on the
 * cursor -- the click-to-place counterpart of a feature ghost: you should
 * see what you are about to drop before committing.
 */
export function drawLocationGhost(
  g: Graphics,
  world: Point | null,
  armed: LocationType | null,
  tool: string,
  hallWidthMm: number,
  hallLengthMm: number,
) {
  g.clear();
  if (!armed || !world || tool !== "draw") return;

  const size = LOCATION_TYPE_DEFAULT_SIZE_MM[armed];
  const { x, y, width, height } = centredPlacement(
    world.x,
    world.y,
    size.widthMm,
    size.lengthMm,
    hallWidthMm,
    hallLengthMm,
  );

  g.rect(x, y, width, height)
    .fill({ color: LOCATION_GHOST_COLOR, alpha: 0.2 })
    .stroke({ width: 60, color: LOCATION_GHOST_COLOR, alpha: 0.9 });
}

export function formatFootprint(
  w: number,
  h: number,
  x: number,
  y: number,
  rotation: number,
) {
  return `${Math.round(w)}mm × ${Math.round(h)}mm at (${Math.round(x)}, ${Math.round(y)}) · ${rotation}°`;
}
