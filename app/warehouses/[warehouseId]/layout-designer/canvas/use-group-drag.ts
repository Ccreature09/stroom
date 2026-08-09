import { useCallback, useMemo, useRef } from "react";

export type GroupDragState = {
  locationIds: number[];
  featureIds: number[];
  startWorldX: number;
  startWorldY: number;
  locOrigins: Map<number, { x: number; y: number }>;
  featOrigins: Map<number, { x: number; y: number }>;
  originBBox: { x: number; y: number; w: number; h: number };
  // Updated every pointermove tick with the same clamped delta already being
  // applied to the canvas -- see the note on commitGroupDrag (in the canvas
  // component) for why it, not a node lookup, is what commit reads back.
  lastDx: number;
  lastDy: number;
};

export type GroupDragStart = Omit<GroupDragState, "lastDx" | "lastDy">;

/**
 * The mixed location+feature group drag's ref lifecycle. Unlike the other
 * gesture refs, its per-tick update (lastDx/lastDy) isn't a full
 * reassignment -- it mutates the in-flight state -- so this exposes
 * updateDelta instead of forcing the caller to reconstruct the whole object
 * on every pointermove.
 */
export function useGroupDrag() {
  const dragRef = useRef<GroupDragState | null>(null);

  const isActive = useCallback(() => dragRef.current != null, []);
  const current = useCallback(() => dragRef.current, []);

  const start = useCallback((state: GroupDragStart) => {
    dragRef.current = { ...state, lastDx: 0, lastDy: 0 };
  }, []);

  const updateDelta = useCallback((dx: number, dy: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.lastDx = dx;
    drag.lastDy = dy;
  }, []);

  const clear = useCallback(() => {
    dragRef.current = null;
  }, []);

  return useMemo(
    () => ({ isActive, current, start, updateDelta, clear }),
    [isActive, current, start, updateDelta, clear],
  );
}
