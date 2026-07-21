"use client";

import { useEffect, useRef } from "react";
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

      viewport
        .drag()
        .pinch()
        .wheel()
        .decelerate({ friction: 0.9 });
      viewport.clampZoom({ minScale: 0.05, maxScale: 8 });
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
      
      // Draw the initial grid based on the starting zoom after fitting
      drawDynamicGrid();

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
            stateRef.current.onDraftDrawn({
              physicalX: snap(Math.max(0, x)),
              physicalY: snap(Math.max(0, y)),
              physicalWidthMm: snap(w),
              physicalLengthMm: snap(h),
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
  }, [locations]);

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
          node.loc = { ...node.loc, physicalX: nextX, physicalY: nextY };
          node.container.position.set(nextX, nextY);
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
      app.stage.off("pointermove", handleMove);
      app.stage.off("pointerup", handleUp);
      app.stage.off("pointerupoutside", handleUp);
      viewport.off("zoomed", updateLabelVisibility);
      viewport.off("zoomed", rebuildHandles);
    };
  }, [locations, selectedLocationId]);

  return <div ref={containerRef} className="h-full w-full overflow-hidden rounded-xl border border-slate-200 bg-white/60" />;
}