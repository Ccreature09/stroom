import { useCallback, useMemo, useRef } from "react";

export type LocationDragState = {
  locationId: number;
  startWorldX: number;
  startWorldY: number;
  originX: number;
  originY: number;
};

/**
 * The single-location drag's ref lifecycle. Unlike box-select/measure, there
 * is no owned Graphics layer here -- a drag mutates the location's own
 * existing container directly, and that mutation is tightly coupled to the
 * shared node registry (nodesRef) and Pixi render state, so it stays in the
 * component's pointermove dispatcher. This hook only centralizes "is a drag
 * in flight, and what was it grabbed with" instead of leaving a bare ref
 * declaration to be read/written/nulled from five different call sites.
 */
export function useLocationDrag() {
  const dragRef = useRef<LocationDragState | null>(null);

  const isActive = useCallback(() => dragRef.current != null, []);
  const current = useCallback(() => dragRef.current, []);

  const start = useCallback(
    (
      locationId: number,
      startWorldX: number,
      startWorldY: number,
      originX: number,
      originY: number,
    ) => {
      dragRef.current = {
        locationId,
        startWorldX,
        startWorldY,
        originX,
        originY,
      };
    },
    [],
  );

  const clear = useCallback(() => {
    dragRef.current = null;
  }, []);

  return useMemo(
    () => ({ isActive, current, start, clear }),
    [isActive, current, start, clear],
  );
}
