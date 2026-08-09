import { useCallback, useMemo, useRef } from "react";
import type { Corner } from "./canvas-render";

export type LocationResizeState = {
  locationId: number;
  corner: Corner;
  originX: number;
  originY: number;
  originW: number;
  originH: number;
};

/**
 * The single-location resize's ref lifecycle -- same reasoning as
 * useLocationDrag. The actual resize math (resizeRotatedBox) and the node
 * mutation it drives stay in the component, since both are tied to the
 * shared node registry and the handle Graphics that live alongside it.
 */
export function useLocationResize() {
  const resizeRef = useRef<LocationResizeState | null>(null);

  const isActive = useCallback(() => resizeRef.current != null, []);
  const current = useCallback(() => resizeRef.current, []);

  const start = useCallback(
    (
      locationId: number,
      corner: Corner,
      originX: number,
      originY: number,
      originW: number,
      originH: number,
    ) => {
      resizeRef.current = {
        locationId,
        corner,
        originX,
        originY,
        originW,
        originH,
      };
    },
    [],
  );

  const clear = useCallback(() => {
    resizeRef.current = null;
  }, []);

  return useMemo(
    () => ({ isActive, current, start, clear }),
    [isActive, current, start, clear],
  );
}
