"use client";

import { useEffect,useState, useRef } from "react";
import { Application, Container, Graphics, Text, TextStyle, type FederatedPointerEvent } from "pixi.js";
import { Viewport } from "pixi-viewport";
import type { HallDTO, LocationDTO } from "./types";
import { colorForZone } from "./types";

const MIN_LOCATION_MM = 200;
const HANDLE_SCREEN_SIZE = 9;
const LABEL_ZOOM_THRESHOLD = 0.55;
const GRID_STEP_MM = 1000;
const GRID_MAJOR_EVERY = 5;

export type Tool = "select" | "draw";
export type Geometry = { physicalX: number; physicalY: number; physicalWidthMm: number; physicalLengthMm: number };
export type GeometryWithRotation = Geometry & { rotationDegrees: number };

type Props = {
  hall: HallDTO;
  locations: LocationDTO[];
  selectedLocationId: number | null;
  tool: Tool;
  onSelect: (locationId: number | null) => void;
  onDraftDrawn: (geometry: Geometry) => void;
  onGeometryChange: (locationId: number, geometry: GeometryWithRotation) => void;
};

type LocationNode = {
  container: Container;
  box: Graphics;
  label: Text;
  loc: LocationDTO;
};

const HANDLE_CORNERS = ["nw", "ne", "se", "sw"] as const;
type Corner = (typeof HANDLE_CORNERS)[number];

function clampLocation(
  x: number,
  y: number,
  width: number,
  height: number,
  hallWidth: number,
  hallHeight: number
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

export default function LayoutDesignerCanvas({
  hall,
  locations,
  selectedLocationId,
  tool,
  onSelect,
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

  // Keep latest callbacks/props in refs so the Pixi event handlers (attached
  // once) never see stale closures without having to tear the app down.
  const stateRef = useRef({ tool, selectedLocationId, onSelect, onDraftDrawn, onGeometryChange, hall });
  stateRef.current = { tool, selectedLocationId, onSelect, onDraftDrawn, onGeometryChange, hall };

  const dragRef = useRef<null | { locationId: number; startWorldX: number; startWorldY: number; originX: number; originY: number }>(null);
  const drawRef = useRef<null | { startWorldX: number; startWorldY: number; rect: Graphics }>(null);
  const resizeRef = useRef<null | {
    locationId: number;
    corner: Corner;
    originX: number;
    originY: number;
    originW: number;
    originH: number;
  }>(null);

  // ---------------------------------------------------------------------
  // One-time setup: create the Pixi application + viewport for this hall.
  // Re-runs only when the hall itself changes (switching halls resets the
  // canvas entirely, which is the right behavior since bounds differ).
  // ---------------------------------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let destroyed = false;
    const app = new Application();

    (async () => {
      await app.init({
        resizeTo: el,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
      });
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

      // 1. Calculate the exact scale needed to fit the hall perfectly
      const scaleX = el.clientWidth / hall.physicalWidthMm;
      const scaleY = el.clientHeight / hall.physicalLengthMm;
      const minFitScale = Math.min(scaleX, scaleY);
      minFitScaleRef.current = minFitScale;

      viewport
        .drag()
        .pinch()
        .wheel()
        .decelerate({ friction: 0.9 });
      
      // 2. Ensure maxScale is NEVER smaller than minFitScale to prevent silent Pixi errors
      const safeMaxScale = Math.max(8, minFitScale * 1.5);
      viewport.clampZoom({ minScale: minFitScale, maxScale: safeMaxScale });
      viewport.clamp({ direction: "all", underflow: "center" });

      // --- static background: hall floor ---
      const floor = new Graphics()
        .rect(0, 0, hall.physicalWidthMm, hall.physicalLengthMm)
        .fill({ color: 0xffffff })
        .stroke({ width: 60, color: 0x1e293b });
      viewport.addChild(floor);

      // --- dynamic grid ---
      const grid = new Graphics();
      viewport.addChild(grid);

      function drawDynamicGrid() {
        grid.clear();
        
        // 1. Get current zoom level
        const scale = viewport.scale.x;
        
        // 2. Define grid density thresholds based on zoom
        let stepMm = 10000; // Zoomed out: 10m grid lines
        if (scale > 1.0) {
          stepMm = 100;     // Zoomed far in: 10cm grid lines
        } else if (scale > 0.2) {
          stepMm = 1000;    // Standard view: 1m grid lines
        }

        const majorEvery = 5;

        // 3. Keep line thickness consistent on screen regardless of world zoom
        const majorStrokeWidth = 3 / scale;
        const minorStrokeWidth = 1 / scale;

        // Draw vertical lines
        for (let x = 0; x <= hall.physicalWidthMm; x += stepMm) {
          const isMajor = Math.round(x / stepMm) % majorEvery === 0;
          grid.moveTo(x, 0).lineTo(x, hall.physicalLengthMm).stroke({
            width: isMajor ? majorStrokeWidth : minorStrokeWidth,
            color: isMajor ? 0xcbd5e1 : 0xe2e8f0,
            alpha: 0.8
          });
        }
        
        // Draw horizontal lines
        for (let y = 0; y <= hall.physicalLengthMm; y += stepMm) {
          const isMajor = Math.round(y / stepMm) % majorEvery === 0;
          grid.moveTo(0, y).lineTo(hall.physicalWidthMm, y).stroke({
            width: isMajor ? majorStrokeWidth : minorStrokeWidth,
            color: isMajor ? 0xcbd5e1 : 0xe2e8f0,
            alpha: 0.8
          });
        }
      }

      function updateScaleUI() {
        if (!viewportRef.current || !scaleTextRef.current || !scaleBarRef.current) return;
        const currentScale = viewportRef.current.scale.x;

        // Target an approximate visual width on screen (e.g., ~80 pixels)
        const targetPx = 80;
        const worldMm = targetPx / currentScale;
        const worldMeters = worldMm / 1000;

        // Find the closest "round" map scale step (1m, 2m, 5m, 10m, etc.)
        const steps = [0.1, 0.5, 1, 2, 5, 10, 20, 50, 100];
        let bestStep = steps[0];
        let minDiff = Infinity;
        for (const step of steps) {
          const diff = Math.abs(Math.log(worldMeters / step));
          if (diff < minDiff) {
            minDiff = diff;
            bestStep = step;
          }
        }

        // Calculate exact pixel width for this rounded step
        const actualPx = (bestStep * 1000) * currentScale;

        scaleTextRef.current.innerText = bestStep >= 1 ? `${bestStep}m` : `${bestStep * 100}cm`;
        scaleBarRef.current.style.width = `${actualPx}px`;
      }

      viewport.on("zoomed", drawDynamicGrid);
      viewport.on("zoomed", updateScaleUI); // Attach to zoom events

      // Redraw grid dynamically on zoom
      viewport.on("zoomed", drawDynamicGrid);

      const locationLayer = new Container();
      viewport.addChild(locationLayer);
      locationLayerRef.current = locationLayer;

      const handleLayer = new Container();
      viewport.addChild(handleLayer);
      handleLayerRef.current = handleLayer;

      viewport.fit(true);
      viewport.moveCenter(hall.physicalWidthMm / 2, hall.physicalLengthMm / 2);

      viewport.on("zoomed", () => updateScaleBar(viewport!));
      viewport.on("moved", () => updateScaleBar(viewport!));
      
      // Draw the initial grid based on the starting zoom after fitting
      drawDynamicGrid();
      updateScaleUI();
      setIsReady(true);

      // --- draw-new-location interactions (rubber-band rectangle) ---
      viewport.eventMode = "static";
      viewport.on("pointerdown", (e: FederatedPointerEvent) => {
        if (stateRef.current.tool !== "draw") return;
        if (e.button !== 0) return;
        const world = viewport.toWorld(e.global);
        const rect = new Graphics();
        viewport.addChild(rect);
        drawRef.current = { startWorldX: world.x, startWorldY: world.y, rect };
      });

      viewport.on("pointermove", (e: FederatedPointerEvent) => {
        const draw = drawRef.current;
        if (!draw) return;
        const world = viewport.toWorld(e.global);
        const x = Math.min(draw.startWorldX, world.x);
        const y = Math.min(draw.startWorldY, world.y);
        const w = Math.abs(world.x - draw.startWorldX);
        const h = Math.abs(world.y - draw.startWorldY);
        draw.rect.clear().rect(x, y, w, h).fill({ color: 0x0891b2, alpha: 0.2 }).stroke({ width: 15, color: 0x0891b2 });
      });

      // Pointer released outside the canvas while drawing -> cancel the draft.
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
              hall.physicalLengthMm
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
        // Empty-space click in select mode clears selection.
        if (stateRef.current.tool === "select") {
          stateRef.current.onSelect(null);
        }
      });
      viewport.on("pointerupoutside", cancelDraw);
    })();


    return () => {
      destroyed = true;
      setIsReady(false);
      nodesRef.current.clear();
      handlesRef.current = [];
      const app = appRef.current;
      appRef.current = null;
      viewportRef.current = null;
      locationLayerRef.current = null;
      handleLayerRef.current = null;
      if (app) {
        try {
          app.destroy(true, { children: true });
        } catch {
          // no-op: app was already torn down
        }
      }
      if (el) el.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hall.hallId, hall.physicalWidthMm, hall.physicalLengthMm]);

  // ---------------------------------------------------------------------
  // Pause/resume viewport panning depending on the active tool so drawing
  // a new location doesn't also drag the camera.
  // ---------------------------------------------------------------------
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (tool === "draw") viewport.plugins.pause("drag");
    else viewport.plugins.resume("drag");
  }, [tool]);

  // ---------------------------------------------------------------------
  // Sync location data into Pixi display objects: add new, update moved,
  // remove deleted. Runs whenever the location list changes (after any
  // create/update/delete server action revalidates the page).
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!isReady) return;

    const layer = locationLayerRef.current;
    if (!layer) return;

    const nodes = nodesRef.current;
    const seen = new Set<number>();

    for (const loc of locations) {
      seen.add(loc.locationId);
      let node = nodes.get(loc.locationId);
      if (!node) {
        const container = new Container();
        const box = new Graphics();
        const label = new Text({
          text: loc.locationCode,
          style: new TextStyle({ fontSize: 220, fill: 0x0f172a, fontWeight: "600" }),
        });
        label.anchor.set(0.5);
        container.addChild(box, label);
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

        // Properly clear drag state and save geometry when releasing the mouse over the location
        container.on("pointerup", (e: FederatedPointerEvent) => {
          if (stateRef.current.tool !== "select") return;
          e.stopPropagation();
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
        });

        container.on("pointerupoutside", (e: FederatedPointerEvent) => {
          if (stateRef.current.tool !== "select") return;
          e.stopPropagation();
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
        });
        node = { container, box, label, loc };
        nodes.set(loc.locationId, node);
      }

      node.loc = loc;
      const isSelected = loc.locationId === selectedLocationId;
      const color = colorForZone(loc.zoneId);
      node.box
        .clear()
        .rect(0, 0, loc.physicalWidthMm, loc.physicalLengthMm)
        .fill({ color, alpha: loc.isBlocked ? 0.25 : 0.55 })
        .stroke({ width: isSelected ? 45 : 18, color: isSelected ? 0x0f172a : 0x1e293b });
      node.container.position.set(loc.physicalX, loc.physicalY);
      node.container.pivot.set(0, 0);
      node.container.angle = loc.rotationDegrees;
      node.label.text = loc.locationCode;
      node.label.position.set(loc.physicalWidthMm / 2, loc.physicalLengthMm / 2);
    }

    for (const [id, node] of nodes) {
      if (!seen.has(id)) {
        node.container.destroy({ children: true });
        nodes.delete(id);
      }
    }

    updateLabelVisibility();
    rebuildHandles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations, isReady]);

  // ---------------------------------------------------------------------
  // Selection change -> rebuild resize handles for the selected location.
  // ---------------------------------------------------------------------
  useEffect(() => {
    rebuildHandles();
    for (const [id, node] of nodesRef.current) {
      const isSelected = id === selectedLocationId;
      const color = colorForZone(node.loc.zoneId);
      node.box
        .clear()
        .rect(0, 0, node.loc.physicalWidthMm, node.loc.physicalLengthMm)
        .fill({ color, alpha: node.loc.isBlocked ? 0.25 : 0.55 })
        .stroke({ width: isSelected ? 45 : 18, color: isSelected ? 0x0f172a : 0x1e293b });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLocationId]);

  function updateLabelVisibility() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const visible = viewport.scale.x >= LABEL_ZOOM_THRESHOLD;
    for (const node of nodesRef.current.values()) {
      node.label.visible = visible;
    }
  }

  function rebuildHandles() {
    const handleLayer = handleLayerRef.current;
    const viewport = viewportRef.current;
    if (!handleLayer || !viewport) return;

    for (const h of handlesRef.current) h.destroy();
    handlesRef.current = [];

    const node = selectedLocationId ? nodesRef.current.get(selectedLocationId) : undefined;
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
      handle.cursor = corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize";

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

      // Clear resize state and trigger geometry save when releasing the mouse
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

  // ---------------------------------------------------------------------
  // Global pointer move/up: drives active drag or resize interactions.
  // Attached once to the app stage so drags keep tracking even if the
  // pointer leaves the original hit area.
  // ---------------------------------------------------------------------

  const updateScaleBar = (vp: Viewport) => {
    if (!scaleTextRef.current || !scaleBarRef.current) return;
    const scale = vp.scale.x;
    
    const targetPx = 80;
    const mmAtTarget = targetPx / scale;

    const niceValuesMm = [10, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
    
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
    // Effect body re-runs after every location sync; app may not exist yet
    // on the very first render pass, so bail out and let the setup effect's
    // own listeners (added after init) cover the first paint.
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
            hall.physicalLengthMm
          );

          node.loc = { ...node.loc, physicalX: clamped.x, physicalY: clamped.y };
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
          node.loc = { ...node.loc, physicalX: x, physicalY: y, physicalWidthMm: w, physicalLengthMm: h };
          node.container.position.set(x, y);
          node.box.clear().rect(0, 0, w, h).fill({ color: colorForZone(node.loc.zoneId), alpha: 0.55 }).stroke({ width: 45, color: 0x0f172a });
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
  }, [locations, selectedLocationId]);

  return (
    <div className="relative flex h-full w-full overflow-hidden rounded-xl border border-slate-200 bg-white/60">
      
      {/* CANVAS LAYER: Strictly confined to the background context */}
      <div ref={containerRef} className="relative z-0 h-full w-full" />

      {/* UI OVERLAY: Strictly forced to the top layer */}
      <div className="pointer-events-none absolute right-4 top-4 z-50 flex flex-col items-end gap-3">
        
        {/* Dynamic Map Scale */}
        <div className="flex flex-col items-end gap-1 rounded-md bg-white/90 p-1.5 shadow-sm backdrop-blur-md">
          <span ref={scaleTextRef} className="text-[10px] font-bold leading-none text-slate-700">
            {/* Populated by Pixi zoomed event */}
          </span>
          <div
            ref={scaleBarRef}
            className="h-1.5 border-x-2 border-b-2 border-slate-800"
            style={{ width: "80px" }}
          />
        </div>

        {/* Zoom Controls */}
        <div className="pointer-events-auto flex flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-md">
          <button
            onClick={handleZoomIn}
            className="flex h-8 w-8 items-center justify-center text-slate-700 transition-colors hover:bg-slate-100 active:bg-slate-200"
            title="Zoom In"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <div className="h-px w-full bg-slate-200" />
          <button
            onClick={handleZoomOut}
            className="flex h-8 w-8 items-center justify-center text-slate-700 transition-colors hover:bg-slate-100 active:bg-slate-200"
            title="Zoom Out"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
            </svg>
          </button>
        </div>
        
      </div>
    </div>
  );
}