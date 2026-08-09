import { useCallback, useMemo, useRef } from "react";
import { Graphics } from "pixi.js";
import type { Point } from "@/lib/warehouse-map/geometry";

/**
 * The Measure tool's two-click gesture: first click drops an anchor, the
 * rubber-band line follows the cursor, second click reads the distance back
 * and clears the overlay. Unlike the drag gestures this needs no pointerdown
 * "start" ref beyond the anchor itself -- there's no drag in progress between
 * clicks, just a marker waiting for its second point.
 */
export function useMeasureGesture() {
  const anchorRef = useRef<Point | null>(null);
  const layerRef = useRef<Graphics | null>(null);

  const setLayer = useCallback((layer: Graphics | null) => {
    layerRef.current = layer;
  }, []);

  const hasAnchor = useCallback(() => anchorRef.current != null, []);

  // Anchor marker plus the rubber-band line to the cursor. `scale` is the
  // viewport's current zoom -- markers are drawn in world units but sized to
  // stay a constant 6px/2px on screen regardless of zoom level.
  const draw = useCallback((cursor: Point | null, scale: number) => {
    const g = layerRef.current;
    if (!g) return;
    g.clear();
    const anchor = anchorRef.current;
    if (!anchor) return;

    const markerRadius = 6 / scale;
    const lineWidth = 2 / scale;
    g.circle(anchor.x, anchor.y, markerRadius).fill({ color: 0x7c3aed });
    if (cursor) {
      g.moveTo(anchor.x, anchor.y)
        .lineTo(cursor.x, cursor.y)
        .stroke({ width: lineWidth, color: 0x7c3aed });
      g.circle(cursor.x, cursor.y, markerRadius).stroke({
        width: lineWidth,
        color: 0x7c3aed,
      });
    }
  }, []);

  // First click of the pair.
  const start = useCallback(
    (worldX: number, worldY: number, scale: number) => {
      anchorRef.current = { x: worldX, y: worldY };
      draw(null, scale);
    },
    [draw],
  );

  // Distance from the anchor to a point, without ending the gesture --
  // what the pointermove coordinate readout shows.
  const distanceTo = useCallback((worldX: number, worldY: number) => {
    const anchor = anchorRef.current;
    if (!anchor) return null;
    return Math.hypot(worldX - anchor.x, worldY - anchor.y);
  }, []);

  // Second click: reads the distance back and clears the overlay.
  const finish = useCallback((worldX: number, worldY: number) => {
    const anchor = anchorRef.current;
    if (!anchor) return null;
    const distance = Math.hypot(worldX - anchor.x, worldY - anchor.y);
    anchorRef.current = null;
    layerRef.current?.clear();
    return distance;
  }, []);

  // Abandons a half-finished measurement -- leaving Measure mode.
  const reset = useCallback(() => {
    anchorRef.current = null;
    layerRef.current?.clear();
  }, []);

  // Setup effect teardown: drops both refs without touching the (about to be
  // destroyed) Graphics object, mirroring how every other layer ref in the
  // canvas is torn down.
  const teardown = useCallback(() => {
    anchorRef.current = null;
    layerRef.current = null;
  }, []);

  return useMemo(
    () => ({
      setLayer,
      hasAnchor,
      draw,
      start,
      distanceTo,
      finish,
      reset,
      teardown,
    }),
    [setLayer, hasAnchor, draw, start, distanceTo, finish, reset, teardown],
  );
}
