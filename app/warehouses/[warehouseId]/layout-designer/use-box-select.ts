import { useCallback, useRef } from "react";
import { Graphics } from "pixi.js";
import { Viewport } from "pixi-viewport";

type BoxSelectState = {
  startWorldX: number;
  startWorldY: number;
  rect: Graphics;
};

export type BoxSelectBounds = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

/**
 * The marquee/drag-select rectangle: a Pixi Graphics child added to the
 * viewport on pointerdown, redrawn on every pointermove, and torn down on
 * release or cancel. Deciding what a commit *selects* stays in the caller --
 * that hit-testing shares helpers (resolveSelectionForHits,
 * featureIdsInMarquee) with plain click selection, so it isn't this gesture's
 * own concern.
 */
export function useBoxSelect() {
  const boxSelectRef = useRef<BoxSelectState | null>(null);

  const isActive = useCallback(() => boxSelectRef.current != null, []);

  const start = useCallback(
    (viewport: Viewport, worldX: number, worldY: number) => {
      const rect = new Graphics();
      viewport.addChild(rect);
      boxSelectRef.current = { startWorldX: worldX, startWorldY: worldY, rect };
    },
    [],
  );

  const update = useCallback((worldX: number, worldY: number) => {
    const box = boxSelectRef.current;
    if (!box) return;
    const x = Math.min(box.startWorldX, worldX);
    const y = Math.min(box.startWorldY, worldY);
    const w = Math.abs(worldX - box.startWorldX);
    const h = Math.abs(worldY - box.startWorldY);
    box.rect
      .clear()
      .rect(x, y, w, h)
      .fill({ color: 0x2563eb, alpha: 0.15 })
      .stroke({ width: 15, color: 0x2563eb });
  }, []);

  // Abandons the box without reading its bounds -- pointer left the canvas,
  // or the global force-cancel safety net fired.
  const cancel = useCallback(() => {
    const box = boxSelectRef.current;
    if (box) {
      box.rect.destroy();
      boxSelectRef.current = null;
    }
  }, []);

  // Reads out the final bounds and tears down the rect -- the box commits to
  // a selection instead of being abandoned. Returns null if no box was in
  // flight (pointerup with no corresponding pointerdown-started drag).
  const commit = useCallback(
    (worldX: number, worldY: number): BoxSelectBounds | null => {
      const box = boxSelectRef.current;
      if (!box) return null;
      const bounds: BoxSelectBounds = {
        x0: Math.min(box.startWorldX, worldX),
        y0: Math.min(box.startWorldY, worldY),
        x1: Math.max(box.startWorldX, worldX),
        y1: Math.max(box.startWorldY, worldY),
      };
      box.rect.destroy();
      boxSelectRef.current = null;
      return bounds;
    },
    [],
  );

  return { isActive, start, update, cancel, commit };
}
