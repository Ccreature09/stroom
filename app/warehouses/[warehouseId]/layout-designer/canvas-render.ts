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
  normalizeRotation,
  rotateAboutOrigin,
  type Point,
  type ResizeAxis,
} from "@/lib/warehouse-map/geometry";

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

export function formatFootprint(
  w: number,
  h: number,
  x: number,
  y: number,
  rotation: number,
) {
  return `${Math.round(w)}mm × ${Math.round(h)}mm at (${Math.round(x)}, ${Math.round(y)}) · ${rotation}°`;
}
