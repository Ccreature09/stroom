"use client";

import { useEffect, useState, useRef } from "react";
import {
  Application,
  Container,
  Graphics,
  Text,
  TextStyle,
  type FederatedPointerEvent,
} from "pixi.js";
import { Viewport } from "pixi-viewport";
import type { HallDTO, LocationDTO } from "./types";
import { colorForZone, groupByBayFootprint } from "./types";

import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut } from "lucide-react";

const MIN_LOCATION_MM = 200;
const HANDLE_SCREEN_SIZE = 9;
const LABEL_ZOOM_THRESHOLD = 0.55;

export type Tool = "select" | "draw";
export type Geometry = {
  physicalX: number;
  physicalY: number;
  physicalWidthMm: number;
  physicalLengthMm: number;
};
export type GeometryWithRotation = Geometry & { rotationDegrees: number };

type Props = {
  hall: HallDTO;
  locations: LocationDTO[];
  selectedLocationId: number | null;
  selectedLocationIds: number[];
  activeLevel: number | null;
  tool: Tool;
  onSelect: (locationId: number | null) => void;
  onMultiSelect: (locationIds: number[]) => void;
  onDraftDrawn: (geometry: Geometry) => void;
  onGeometryChange: (
    locationId: number,
    geometry: GeometryWithRotation,
  ) => void;
};

type LocationNode = {
  container: Container;
  box: Graphics;
  label: Text;
  badge: Text;
  loc: LocationDTO;
  memberCount: number; // how many levels this node aggregates (bay aggregation)
};

const HANDLE_CORNERS = ["nw", "ne", "se", "sw"] as const;
type Corner = (typeof HANDLE_CORNERS)[number];

function clampLocation(
  x: number,
  y: number,
  width: number,
  height: number,
  hallWidth: number,
  hallHeight: number,
) {
  const clampedWidth = Math.min(width, hallWidth);
  const clampedHeight = Math.min(height, hallHeight);
  return {
    x: Math.max(0, Math.min(x, hallWidth - clampedWidth)),
    y: Math.max(0, Math.min(y, hallHeight - clampedHeight)),
    width: clampedWidth,
    height: clampedHeight,
  };
}

/**
 * Bay Aggregation: for racking/shelf locations, multiple DB rows can share
 * the same physical footprint (aisle+bay), one per level. On the top-level
 * canvas we only want to render ONE node per footprint -- preferring the
 * currently active level if it has a member there, otherwise falling back to
 * the lowest level present -- plus every other location (floor storage, or
 * anything without aisle/bay) rendered as-is.
 */
function resolveVisibleLocations(
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

export default function LayoutDesignerCanvas({
  hall,
  locations,
  selectedLocationId,
  selectedLocationIds,
  activeLevel,
  tool,
  onSelect,
  onMultiSelect,
  onDraftDrawn,
  onGeometryChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const locationLayerRef = useRef<Container | null>(null);
  const handleLayerRef = useRef<Container | null>(null);
  const nodesRef = useRef<Map<number, LocationNode>>(new Map());
  const handlesRef = useRef<Graphics[]>([]);
  const scaleTextRef = useRef<HTMLSpanElement>(null);
  const scaleBarRef = useRef<HTMLDivElement>(null);
  const minFitScaleRef = useRef<number>(0.05);
  const [isReady, setIsReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  function handleZoomIn() {
    const vp = viewportRef.current;
    if (!vp) return;
    const absoluteMax = Math.max(8, minFitScaleRef.current * 1.5);
    const targetScale = Math.min(vp.scale.x * 1.5, absoluteMax);
    vp.setZoom(targetScale);
    updateScaleBar(vp);
  }

  function handleZoomOut() {
    const vp = viewportRef.current;
    if (!vp) return;
    const targetScale = Math.max(vp.scale.x / 1.5, minFitScaleRef.current);
    vp.setZoom(targetScale);
    updateScaleBar(vp);
  }

  const stateRef = useRef({
    tool,
    selectedLocationId,
    selectedLocationIds,
    onSelect,
    onMultiSelect,
    onDraftDrawn,
    onGeometryChange,
    hall,
  });
  stateRef.current = {
    tool,
    selectedLocationId,
    selectedLocationIds,
    onSelect,
    onMultiSelect,
    onDraftDrawn,
    onGeometryChange,
    hall,
  };

  const locationsRef = useRef(locations);
  locationsRef.current = locations;

  const activeLevelRef = useRef(activeLevel);
  activeLevelRef.current = activeLevel;

  const dragRef = useRef<null | {
    locationId: number;
    startWorldX: number;
    startWorldY: number;
    originX: number;
    originY: number;
  }>(null);
  const drawRef = useRef<null | {
    startWorldX: number;
    startWorldY: number;
    rect: Graphics;
  }>(null);
  const resizeRef = useRef<null | {
    locationId: number;
    corner: Corner;
    originX: number;
    originY: number;
    originW: number;
    originH: number;
  }>(null);
  // Drag-to-select box (only active in "select" tool, when the pointer-down
  // did not land on an existing location container).
  const boxSelectRef = useRef<null | {
    startWorldX: number;
    startWorldY: number;
    rect: Graphics;
  }>(null);

  function fittedFontSize(widthMm: number, lengthMm: number) {
    // Adaptive label sizing: scale with the smaller box dimension so text
    // never overflows a narrow bay, but stays readable in larger footprints.
    const raw = Math.min(widthMm, lengthMm) * 0.28;
    return Math.max(90, Math.min(raw, 420));
  }

  function syncLocationNodes(
    allLocs: LocationDTO[],
    selectedId: number | null,
  ) {
    const layer = locationLayerRef.current;
    if (!layer) return;

    const { visible, memberCountByLocationId } = resolveVisibleLocations(
      allLocs,
      activeLevelRef.current,
    );

    const nodes = nodesRef.current;
    const seen = new Set<number>();

    for (const loc of visible) {
      seen.add(loc.locationId);
      let node = nodes.get(loc.locationId);
      if (!node) {
        const container = new Container();
        const box = new Graphics();
        const label = new Text({
          text: loc.locationCode,
          style: new TextStyle({
            fontSize: 220,
            fill: 0x0f172a,
            fontWeight: "600",
          }),
        });
        label.anchor.set(0.5);

        const badge = new Text({
          text: "",
          style: new TextStyle({
            fontSize: 140,
            fill: 0xffffff,
            fontWeight: "700",
          }),
        });
        badge.anchor.set(1, 0);

        container.addChild(box, label, badge);
        layer.addChild(container);

        container.eventMode = "static";
        container.cursor = "pointer";
        container.on("pointerdown", (e: FederatedPointerEvent) => {
          if (stateRef.current.tool !== "select") return;
          e.stopPropagation();
          stateRef.current.onSelect(loc.locationId);
          const viewport = viewportRef.current;
          if (!viewport) return;
          const world = viewport.toWorld(e.global);
          const current = nodesRef.current.get(loc.locationId);
          if (!current) return;
          dragRef.current = {
            locationId: loc.locationId,
            startWorldX: world.x,
            startWorldY: world.y,
            originX: current.loc.physicalX,
            originY: current.loc.physicalY,
          };
        });

        container.on("pointerup", (e: FederatedPointerEvent) => {
          if (stateRef.current.tool !== "select") return;
          e.stopPropagation();
          const drag = dragRef.current;
          if (drag) {
            dragRef.current = null;
            const draggedNode = nodesRef.current.get(drag.locationId);
            if (draggedNode) {
              stateRef.current.onGeometryChange(drag.locationId, {
                physicalX: draggedNode.loc.physicalX,
                physicalY: draggedNode.loc.physicalY,
                physicalWidthMm: draggedNode.loc.physicalWidthMm,
                physicalLengthMm: draggedNode.loc.physicalLengthMm,
                rotationDegrees: draggedNode.loc.rotationDegrees,
              });
            }
          }
        });

        container.on("pointerupoutside", (e: FederatedPointerEvent) => {
          if (stateRef.current.tool !== "select") return;
          e.stopPropagation();
          const drag = dragRef.current;
          if (drag) {
            dragRef.current = null;
            const draggedNode = nodesRef.current.get(drag.locationId);
            if (draggedNode) {
              stateRef.current.onGeometryChange(drag.locationId, {
                physicalX: draggedNode.loc.physicalX,
                physicalY: draggedNode.loc.physicalY,
                physicalWidthMm: draggedNode.loc.physicalWidthMm,
                physicalLengthMm: draggedNode.loc.physicalLengthMm,
                rotationDegrees: draggedNode.loc.rotationDegrees,
              });
            }
          }
        });
        node = {
          container,
          box,
          label,
          badge,
          loc,
          memberCount: memberCountByLocationId.get(loc.locationId) ?? 1,
        };
        nodes.set(loc.locationId, node);
      }

      node.loc = loc;
      node.memberCount = memberCountByLocationId.get(loc.locationId) ?? 1;

      const isSelected =
        loc.locationId === selectedId ||
        stateRef.current.selectedLocationIds.includes(loc.locationId);
      const color = colorForZone(loc.zoneId);
      node.box
        .clear()
        .rect(0, 0, loc.physicalWidthMm, loc.physicalLengthMm)
        .fill({ color, alpha: loc.isBlocked ? 0.25 : 0.55 })
        .stroke({
          width: isSelected ? 45 : 18,
          color: isSelected ? 0x0f172a : 0x1e293b,
        });
      node.container.position.set(loc.physicalX, loc.physicalY);
      node.container.pivot.set(0, 0);
      node.container.angle = loc.rotationDegrees;

      node.label.text = loc.locationCode;
      node.label.style.fontSize = fittedFontSize(
        loc.physicalWidthMm,
        loc.physicalLengthMm,
      );
      node.label.position.set(
        loc.physicalWidthMm / 2,
        loc.physicalLengthMm / 2,
      );

      // Bay aggregation badge: show "×N" in the corner when this node
      // represents more than one stacked level.
      if (node.memberCount > 1) {
        node.badge.text = `×${node.memberCount}`;
        node.badge.visible = true;
        node.badge.position.set(loc.physicalWidthMm - 20, 20);
      } else {
        node.badge.visible = false;
      }
    }

    for (const [id, node] of nodes) {
      if (!seen.has(id)) {
        node.container.destroy({ children: true });
        nodes.delete(id);
      }
    }

    updateLabelVisibility();
    rebuildHandles();
  }

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let destroyed = false;
    const app = new Application();

    (async () => {
      try {
        await app.init({
          resizeTo: el,
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
        });
      } catch (err) {
        console.error("Failed to initialize layout designer canvas:", err);
        if (!destroyed)
          setInitError(
            "The layout canvas couldn't start. Try reloading the page.",
          );
        return;
      }
      if (destroyed) {
        app.destroy(true);
        return;
      }
      el.appendChild(app.canvas);
      appRef.current = app;

      const viewport = new Viewport({
        screenWidth: el.clientWidth,
        screenHeight: el.clientHeight,
        worldWidth: hall.physicalWidthMm,
        worldHeight: hall.physicalLengthMm,
        events: app.renderer.events,
      });
      app.stage.addChild(viewport);
      viewportRef.current = viewport;

      const scaleX = el.clientWidth / hall.physicalWidthMm;
      const scaleY = el.clientHeight / hall.physicalLengthMm;
      const minFitScale = Math.min(scaleX, scaleY);
      minFitScaleRef.current = minFitScale;

      viewport.drag().pinch().wheel().decelerate({ friction: 0.9 });

      const safeMaxScale = Math.max(8, minFitScale * 1.5);
      viewport.clampZoom({ minScale: minFitScale, maxScale: safeMaxScale });
      viewport.clamp({ direction: "all", underflow: "center" });

      const floor = new Graphics()
        .rect(0, 0, hall.physicalWidthMm, hall.physicalLengthMm)
        .fill({ color: 0xffffff })
        .stroke({ width: 60, color: 0x1e293b });
      viewport.addChild(floor);

      const grid = new Graphics();
      viewport.addChild(grid);

      function drawDynamicGrid() {
        grid.clear();
        const scale = viewport.scale.x;

        let stepMm = 10000;
        if (scale > 1.0) {
          stepMm = 100;
        } else if (scale > 0.2) {
          stepMm = 1000;
        }

        const majorEvery = 5;
        const majorStrokeWidth = 3 / scale;
        const minorStrokeWidth = 1 / scale;

        for (let x = 0; x <= hall.physicalWidthMm; x += stepMm) {
          const isMajor = Math.round(x / stepMm) % majorEvery === 0;
          grid
            .moveTo(x, 0)
            .lineTo(x, hall.physicalLengthMm)
            .stroke({
              width: isMajor ? majorStrokeWidth : minorStrokeWidth,
              color: isMajor ? 0xcbd5e1 : 0xe2e8f0,
              alpha: 0.8,
            });
        }

        for (let y = 0; y <= hall.physicalLengthMm; y += stepMm) {
          const isMajor = Math.round(y / stepMm) % majorEvery === 0;
          grid
            .moveTo(0, y)
            .lineTo(hall.physicalWidthMm, y)
            .stroke({
              width: isMajor ? majorStrokeWidth : minorStrokeWidth,
              color: isMajor ? 0xcbd5e1 : 0xe2e8f0,
              alpha: 0.8,
            });
        }
      }

      const updateScale = () => updateScaleBar(viewport);

      viewport.on("zoomed", drawDynamicGrid);
      viewport.on("zoomed", updateScale);
      viewport.on("moved", updateScale);

      const locationLayer = new Container();
      viewport.addChild(locationLayer);
      locationLayerRef.current = locationLayer;

      const handleLayer = new Container();
      viewport.addChild(handleLayer);
      handleLayerRef.current = handleLayer;

      viewport.fit(true);
      viewport.moveCenter(hall.physicalWidthMm / 2, hall.physicalLengthMm / 2);

      drawDynamicGrid();
      updateScale();

      viewport.eventMode = "static";

      // A pointerdown that lands on the bare viewport (not a location
      // container, which calls e.stopPropagation()) starts either a draw
      // rectangle (in "draw" mode) or a drag-select box (in "select" mode).
      viewport.on("pointerdown", (e: FederatedPointerEvent) => {
        if (e.button !== 0) return;
        const world = viewport.toWorld(e.global);

        if (stateRef.current.tool === "draw") {
          const rect = new Graphics();
          viewport.addChild(rect);
          drawRef.current = {
            startWorldX: world.x,
            startWorldY: world.y,
            rect,
          };
          return;
        }

        if (stateRef.current.tool === "select") {
          const rect = new Graphics();
          viewport.addChild(rect);
          boxSelectRef.current = {
            startWorldX: world.x,
            startWorldY: world.y,
            rect,
          };
          viewport.plugins.pause("drag");
        }
      });

      viewport.on("pointermove", (e: FederatedPointerEvent) => {
        const draw = drawRef.current;
        if (draw) {
          const world = viewport.toWorld(e.global);
          const x = Math.min(draw.startWorldX, world.x);
          const y = Math.min(draw.startWorldY, world.y);
          const w = Math.abs(world.x - draw.startWorldX);
          const h = Math.abs(world.y - draw.startWorldY);
          draw.rect
            .clear()
            .rect(x, y, w, h)
            .fill({ color: 0x0891b2, alpha: 0.2 })
            .stroke({ width: 15, color: 0x0891b2 });
          return;
        }

        const box = boxSelectRef.current;
        if (box) {
          const world = viewport.toWorld(e.global);
          const x = Math.min(box.startWorldX, world.x);
          const y = Math.min(box.startWorldY, world.y);
          const w = Math.abs(world.x - box.startWorldX);
          const h = Math.abs(world.y - box.startWorldY);
          box.rect
            .clear()
            .rect(x, y, w, h)
            .fill({ color: 0x2563eb, alpha: 0.15 })
            .stroke({ width: 15, color: 0x2563eb });
        }
      });

      const cancelDraw = () => {
        const draw = drawRef.current;
        drawRef.current = null;
        if (draw) draw.rect.destroy();
      };

      viewport.on("pointerup", (e: FederatedPointerEvent) => {
        const draw = drawRef.current;
        if (draw) {
          const world = viewport.toWorld(e.global);
          const x = Math.min(draw.startWorldX, world.x);
          const y = Math.min(draw.startWorldY, world.y);
          const w = Math.abs(world.x - draw.startWorldX);
          const h = Math.abs(world.y - draw.startWorldY);
          draw.rect.destroy();
          drawRef.current = null;
          if (w >= MIN_LOCATION_MM && h >= MIN_LOCATION_MM) {
            const snap = (v: number) => Math.round(v / 100) * 100;
            const clamped = clampLocation(
              snap(x),
              snap(y),
              snap(w),
              snap(h),
              hall.physicalWidthMm,
              hall.physicalLengthMm,
            );

            stateRef.current.onDraftDrawn({
              physicalX: clamped.x,
              physicalY: clamped.y,
              physicalWidthMm: clamped.width,
              physicalLengthMm: clamped.height,
            });
          }
          return;
        }

        const box = boxSelectRef.current;
        if (box) {
          const world = viewport.toWorld(e.global);
          const x0 = Math.min(box.startWorldX, world.x);
          const y0 = Math.min(box.startWorldY, world.y);
          const x1 = Math.max(box.startWorldX, world.x);
          const y1 = Math.max(box.startWorldY, world.y);
          box.rect.destroy();
          boxSelectRef.current = null;
          viewport.plugins.resume("drag");

          // Zero-area drags (a simple click that missed every container)
          // clear selection instead of running a hit test.
          if (x1 - x0 < 5 && y1 - y0 < 5) {
            stateRef.current.onSelect(null);
            return;
          }

          const hits: number[] = [];
          for (const [id, node] of nodesRef.current) {
            const {
              physicalX: lx,
              physicalY: ly,
              physicalWidthMm: lw,
              physicalLengthMm: lh,
            } = node.loc;
            const withinBox =
              lx >= x0 && ly >= y0 && lx + lw <= x1 && ly + lh <= y1;
            if (withinBox) hits.push(id);
          }

          if (hits.length > 1) stateRef.current.onMultiSelect(hits);
          else if (hits.length === 1) stateRef.current.onSelect(hits[0]);
          else stateRef.current.onSelect(null);
          return;
        }

        if (stateRef.current.tool === "select") {
          stateRef.current.onSelect(null);
        }
      });
      viewport.on("pointerupoutside", cancelDraw);

      setIsReady(true);

      syncLocationNodes(
        locationsRef.current,
        stateRef.current.selectedLocationId,
      );
    })();

    return () => {
      destroyed = true;
      setIsReady(false);
      setInitError(null);
      nodesRef.current.clear();
      handlesRef.current = [];
      const app = appRef.current;
      const viewport = viewportRef.current;
      appRef.current = null;
      viewportRef.current = null;
      locationLayerRef.current = null;
      handleLayerRef.current = null;
      if (viewport) {
        try {
          viewport.destroy();
        } catch {
          // no-op
        }
      }
      if (app) {
        try {
          app.destroy(true, { children: true });
        } catch {
          // no-op
        }
      }
      if (el) el.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hall.hallId, hall.physicalWidthMm, hall.physicalLengthMm]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (tool === "draw") viewport.plugins.pause("drag");
    else viewport.plugins.resume("drag");
  }, [tool]);

  useEffect(() => {
    if (!isReady) return;
    syncLocationNodes(locations, selectedLocationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations, isReady, activeLevel]);

  useEffect(() => {
    rebuildHandles();
    for (const [id, node] of nodesRef.current) {
      const isSelected =
        id === selectedLocationId || selectedLocationIds.includes(id);
      const color = colorForZone(node.loc.zoneId);
      node.box
        .clear()
        .rect(0, 0, node.loc.physicalWidthMm, node.loc.physicalLengthMm)
        .fill({ color, alpha: node.loc.isBlocked ? 0.25 : 0.55 })
        .stroke({
          width: isSelected ? 45 : 18,
          color: isSelected ? 0x0f172a : 0x1e293b,
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLocationId, selectedLocationIds]);

  function updateLabelVisibility() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const visible = viewport.scale.x >= LABEL_ZOOM_THRESHOLD;
    for (const node of nodesRef.current.values()) {
      node.label.visible = visible;
      node.badge.visible = visible && node.memberCount > 1;
    }
  }

  function rebuildHandles() {
    const handleLayer = handleLayerRef.current;
    const viewport = viewportRef.current;
    if (!handleLayer || !viewport) return;

    for (const h of handlesRef.current) h.destroy();
    handlesRef.current = [];

    // Resize handles only make sense for a single selected location -- multi-
    // select is restricted to move/delete, per spec.
    if (selectedLocationIds.length > 1) return;

    const node = selectedLocationId
      ? nodesRef.current.get(selectedLocationId)
      : undefined;
    if (!node) return;

    const worldSize = HANDLE_SCREEN_SIZE / viewport.scale.x;
    const { physicalWidthMm: w, physicalLengthMm: h } = node.loc;
    const corners: Record<Corner, [number, number]> = {
      nw: [0, 0],
      ne: [w, 0],
      se: [w, h],
      sw: [0, h],
    };

    for (const corner of HANDLE_CORNERS) {
      const [cx, cy] = corners[corner];
      const handle = new Graphics()
        .rect(-worldSize, -worldSize, worldSize * 2, worldSize * 2)
        .fill({ color: 0xffffff })
        .stroke({ width: worldSize * 0.3, color: 0x0f172a });
      handle.position.set(cx, cy);
      handle.eventMode = "static";
      handle.cursor =
        corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize";

      handle.on("pointerdown", (e: FederatedPointerEvent) => {
        e.stopPropagation();
        resizeRef.current = {
          locationId: node.loc.locationId,
          corner,
          originX: node.loc.physicalX,
          originY: node.loc.physicalY,
          originW: node.loc.physicalWidthMm,
          originH: node.loc.physicalLengthMm,
        };
      });

      const handleResizeUp = (e: FederatedPointerEvent) => {
        e.stopPropagation();
        const resize = resizeRef.current;
        if (resize) {
          resizeRef.current = null;
          const targetNode = nodesRef.current.get(resize.locationId);
          if (targetNode) {
            stateRef.current.onGeometryChange(resize.locationId, {
              physicalX: targetNode.loc.physicalX,
              physicalY: targetNode.loc.physicalY,
              physicalWidthMm: targetNode.loc.physicalWidthMm,
              physicalLengthMm: targetNode.loc.physicalLengthMm,
              rotationDegrees: targetNode.loc.rotationDegrees,
            });
          }
        }
      };

      handle.on("pointerup", handleResizeUp);
      handle.on("pointerupoutside", handleResizeUp);

      node.container.addChild(handle);
      handlesRef.current.push(handle);
    }
  }

  const updateScaleBar = (vp: Viewport) => {
    if (!scaleTextRef.current || !scaleBarRef.current) return;
    const scale = vp.scale.x;

    const targetPx = 80;
    const mmAtTarget = targetPx / scale;

    const niceValuesMm = [
      10, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000,
    ];

    let bestMm = niceValuesMm[0];
    let minDiff = Math.abs(mmAtTarget - bestMm);
    for (const val of niceValuesMm) {
      const diff = Math.abs(mmAtTarget - val);
      if (diff < minDiff) {
        minDiff = diff;
        bestMm = val;
      }
    }

    const actualPx = bestMm * scale;
    scaleBarRef.current.style.width = `${actualPx}px`;

    if (bestMm >= 1000) {
      scaleTextRef.current.innerText = `${bestMm / 1000}m`;
    } else if (bestMm >= 10) {
      scaleTextRef.current.innerText = `${bestMm / 10}cm`;
    } else {
      scaleTextRef.current.innerText = `${bestMm}mm`;
    }
  };

  useEffect(() => {
    const app = appRef.current;
    const viewport = viewportRef.current;
    if (!app || !viewport) return;

    function handleMove(e: FederatedPointerEvent) {
      const world = viewport!.toWorld(e.global);

      const drag = dragRef.current;
      if (drag) {
        const node = nodesRef.current.get(drag.locationId);
        if (node) {
          const dx = world.x - drag.startWorldX;
          const dy = world.y - drag.startWorldY;
          const nextX = Math.max(0, drag.originX + dx);
          const nextY = Math.max(0, drag.originY + dy);
          const clamped = clampLocation(
            nextX,
            nextY,
            node.loc.physicalWidthMm,
            node.loc.physicalLengthMm,
            hall.physicalWidthMm,
            hall.physicalLengthMm,
          );

          node.loc = {
            ...node.loc,
            physicalX: clamped.x,
            physicalY: clamped.y,
          };
          node.container.position.set(clamped.x, clamped.y);
        }
        return;
      }

      const resize = resizeRef.current;
      if (resize) {
        const node = nodesRef.current.get(resize.locationId);
        if (node) {
          let { originX: x, originY: y, originW: w, originH: h } = resize;
          const farX = resize.originX + resize.originW;
          const farY = resize.originY + resize.originH;
          if (resize.corner === "nw") {
            w = Math.max(MIN_LOCATION_MM, farX - world.x);
            h = Math.max(MIN_LOCATION_MM, farY - world.y);
            x = farX - w;
            y = farY - h;
          } else if (resize.corner === "ne") {
            w = Math.max(MIN_LOCATION_MM, world.x - resize.originX);
            h = Math.max(MIN_LOCATION_MM, farY - world.y);
            y = farY - h;
          } else if (resize.corner === "se") {
            w = Math.max(MIN_LOCATION_MM, world.x - resize.originX);
            h = Math.max(MIN_LOCATION_MM, world.y - resize.originY);
          } else if (resize.corner === "sw") {
            w = Math.max(MIN_LOCATION_MM, farX - world.x);
            h = Math.max(MIN_LOCATION_MM, world.y - resize.originY);
            x = farX - w;
          }
          node.loc = {
            ...node.loc,
            physicalX: x,
            physicalY: y,
            physicalWidthMm: w,
            physicalLengthMm: h,
          };
          node.container.position.set(x, y);
          node.box
            .clear()
            .rect(0, 0, w, h)
            .fill({ color: colorForZone(node.loc.zoneId), alpha: 0.55 })
            .stroke({ width: 45, color: 0x0f172a });
          node.label.style.fontSize = fittedFontSize(w, h);
          node.label.position.set(w / 2, h / 2);
          rebuildHandles();
        }
      }
    }

    function handleUp() {
      const drag = dragRef.current;
      if (drag) {
        dragRef.current = null;
        const node = nodesRef.current.get(drag.locationId);
        if (node) {
          stateRef.current.onGeometryChange(drag.locationId, {
            physicalX: node.loc.physicalX,
            physicalY: node.loc.physicalY,
            physicalWidthMm: node.loc.physicalWidthMm,
            physicalLengthMm: node.loc.physicalLengthMm,
            rotationDegrees: node.loc.rotationDegrees,
          });
        }
      }
      const resize = resizeRef.current;
      if (resize) {
        resizeRef.current = null;
        const node = nodesRef.current.get(resize.locationId);
        if (node) {
          stateRef.current.onGeometryChange(resize.locationId, {
            physicalX: node.loc.physicalX,
            physicalY: node.loc.physicalY,
            physicalWidthMm: node.loc.physicalWidthMm,
            physicalLengthMm: node.loc.physicalLengthMm,
            rotationDegrees: node.loc.rotationDegrees,
          });
        }
      }
    }

    app.stage.eventMode = "static";
    app.stage.hitArea = app.screen;
    app.stage.on("pointermove", handleMove);
    app.stage.on("pointerup", handleUp);
    app.stage.on("pointerupoutside", handleUp);
    viewport.on("zoomed", updateLabelVisibility);
    viewport.on("zoomed", rebuildHandles);

    return () => {
      const currentApp = appRef.current;
      const currentViewport = viewportRef.current;

      if (currentApp && currentApp.stage) {
        currentApp.stage.off("pointermove", handleMove);
        currentApp.stage.off("pointerup", handleUp);
        currentApp.stage.off("pointerupoutside", handleUp);
      }
      if (currentViewport) {
        currentViewport.off("zoomed", updateLabelVisibility);
        currentViewport.off("zoomed", rebuildHandles);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations, selectedLocationId, selectedLocationIds, isReady]);

  return (
    <div className="relative flex h-full w-full overflow-hidden rounded-xl border bg-background/60">
      {/* CANVAS LAYER */}
      <div ref={containerRef} className="relative z-0 h-full w-full" />

      {initError && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/90 p-4 text-center text-sm font-medium text-destructive">
          {initError}
        </div>
      )}

      {/* UI OVERLAY */}
      <div className="pointer-events-none absolute right-4 top-4 z-50 flex flex-col items-end gap-3">
        {/* Dynamic Map Scale */}
        <div className="flex flex-col items-end gap-1 rounded-md bg-background/90 p-1.5 shadow-sm backdrop-blur-md border">
          <span
            ref={scaleTextRef}
            className="text-[10px] font-bold leading-none text-foreground"
          >
            {/* Populated by Pixi zoomed event */}
          </span>
          <div
            ref={scaleBarRef}
            className="h-1.5 border-x-2 border-b-2 border-foreground"
            style={{ width: "80px" }}
          />
        </div>

        {/* Zoom Controls */}
        <div className="pointer-events-auto flex flex-col rounded-lg border bg-background shadow-md overflow-hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleZoomIn}
            className="h-8 w-8 rounded-none border-b"
            title="Zoom In"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleZoomOut}
            className="h-8 w-8 rounded-none"
            title="Zoom Out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
