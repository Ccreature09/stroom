import { useCallback, useMemo, useRef } from "react";

export type FeatureDragState = {
  featureId: number;
  startWorldX: number;
  startWorldY: number;
  originX: number;
  originY: number;
};

/**
 * The single-feature drag's ref lifecycle -- same shape as useLocationDrag,
 * kept as a separate hook because a feature and a location are different
 * node registries (featureNodesRef vs nodesRef) with different commit
 * callbacks, not because the gesture itself differs.
 */
export function useFeatureDrag() {
  const dragRef = useRef<FeatureDragState | null>(null);

  const isActive = useCallback(() => dragRef.current != null, []);
  const current = useCallback(() => dragRef.current, []);

  const start = useCallback(
    (
      featureId: number,
      startWorldX: number,
      startWorldY: number,
      originX: number,
      originY: number,
    ) => {
      dragRef.current = {
        featureId,
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
