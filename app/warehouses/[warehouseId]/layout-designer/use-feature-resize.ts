import { useCallback, useMemo, useRef } from "react";
import type { Point, ResizeAxis, ResizeEnd } from "@/lib/warehouse-map/geometry";
import type { Corner } from "./canvas-render";

// "corner" is the usual free 2-axis resize; "axis" is a single-axis resize
// for a feature kind whose other dimension is locked (see lockedResizeAxisFor
// in feature-kinds.ts) -- axis/end identify which edge was grabbed, the same
// way corner does for the free case.
export type FeatureResizeGrab =
  | { mode: "corner"; corner: Corner }
  | { mode: "axis"; axis: ResizeAxis; end: ResizeEnd };

export type FeatureResizeState = {
  featureId: number;
  originX: number;
  originY: number;
  originW: number;
  originH: number;
  // Snapshotted at grab time: every move event rescales from *these*, not
  // from the live points, otherwise each event would scale the already
  // scaled result and the shape would run away from the cursor.
  originPoints: Point[] | null;
} & FeatureResizeGrab;

/** The single-feature resize's ref lifecycle -- same reasoning as useLocationResize. */
export function useFeatureResize() {
  const resizeRef = useRef<FeatureResizeState | null>(null);

  const isActive = useCallback(() => resizeRef.current != null, []);
  const current = useCallback(() => resizeRef.current, []);

  const start = useCallback((state: FeatureResizeState) => {
    resizeRef.current = state;
  }, []);

  const clear = useCallback(() => {
    resizeRef.current = null;
  }, []);

  return useMemo(
    () => ({ isActive, current, start, clear }),
    [isActive, current, start, clear],
  );
}
