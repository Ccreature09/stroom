"use client";

import { useEffect, useRef, useState } from "react";
import {
  Application,
  Container,
  Graphics,
  type FederatedPointerEvent,
} from "pixi.js";
import { Viewport } from "pixi-viewport";
import type {
  BlockageDTO,
  FeatureDTO,
  FeatureKindDTO,
  HallDTO,
  LocationDTO,
  NavGraphDTO,
  ZoneTypeDTO,
} from "@/lib/warehouse-map/types";
import { resolveZoneColor, sortFeaturesForRender } from "@/lib/warehouse-map/types";
import { footprintVertices, type Point } from "@/lib/warehouse-map/geometry";
import {
  CONFIDENCE_STALE,
  renderAssetAt,
  type LiveAsset,
} from "@/lib/warehouse-map/live-map";

import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut } from "lucide-react";

/**
 * Read-only operational renderer.
 *
 * Deliberately a separate component from the designer canvas rather than a
 * mode on it. The two have opposite requirements: the designer needs hit
 * testing, drag handles, draft state and undo, and is used by one person at a
 * desk; this needs none of that and instead has to redraw moving assets at 60
 * fps for hours on a wall display. Sharing one component would mean carrying
 * all the editing machinery into a view that must never mutate anything.
 *
 * Layer cadence (docs §4.4):
 *   - static layers (floor, features, locations, graph) rebuild only when the
 *     published layout changes
 *   - the live layer redraws every frame off the Pixi ticker
 */

function parseHexToInt(hex: string | null | undefined, fallback: number) {
  if (!hex) return fallback;
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  return match ? parseInt(match[1], 16) : fallback;
}

export type LiveMapCanvasProps = {
  hall: HallDTO;
  locations: LocationDTO[];
  zoneTypes: ZoneTypeDTO[];
  features: FeatureDTO[];
  featureKinds: FeatureKindDTO[];
  navGraph: NavGraphDTO;
  showNavGraph: boolean;
  blockages: BlockageDTO[];
  /** Live assets, re-evaluated every frame. */
  assets: LiveAsset[];
  /** Route polylines to trace, keyed for stable colouring. */
  routes: { key: string; points: Point[] }[];
  /** Set while the supervisor is placing a blockage. */
  pickingPoint: boolean;
  onPointPicked: (point: Point) => void;
};

export default function LiveMapCanvas({
  hall,
  locations,
  zoneTypes,
  features,
  featureKinds,
  navGraph,
  showNavGraph,
  blockages,
  assets,
  routes,
  pickingPoint,
  onPointPicked,
}: LiveMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const staticLayerRef = useRef<Container | null>(null);
  const liveLayerRef = useRef<Graphics | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  // Everything the ticker reads lives behind refs, so a new frame never waits
  // on a React render. Synced in an effect rather than during render: the
  // ticker only reads them after paint, so a frame's delay is invisible, and
  // mutating a ref mid-render is the thing that breaks under concurrent
  // rendering.
  const assetsRef = useRef(assets);
  const blockagesRef = useRef(blockages);
  const routesRef = useRef(routes);
  const pickingRef = useRef(pickingPoint);
  const onPointPickedRef = useRef(onPointPicked);

  useEffect(() => {
    assetsRef.current = assets;
    blockagesRef.current = blockages;
    routesRef.current = routes;
    pickingRef.current = pickingPoint;
    onPointPickedRef.current = onPointPicked;
  }, [assets, blockages, routes, pickingPoint, onPointPicked]);

  function handleZoomIn() {
    const vp = viewportRef.current;
    if (!vp) return;
    vp.setZoom(Math.min(vp.scale.x * 1.5, 8));
  }
  function handleZoomOut() {
    const vp = viewportRef.current;
    if (!vp) return;
    vp.setZoom(vp.scale.x / 1.5);
  }

  // --- Static layers ------------------------------------------------------

  function drawStatic() {
    const layer = staticLayerRef.current;
    const viewport = viewportRef.current;
    if (!layer || !viewport) return;
    layer.removeChildren().forEach((child) => child.destroy({ children: true }));

    const floor = new Graphics()
      .rect(0, 0, hall.physicalWidthMm, hall.physicalLengthMm)
      .fill({ color: 0xf8fafc })
      .stroke({ width: 60, color: 0x1e293b });
    layer.addChild(floor);

    // Features first: context under the storage they surround.
    const featureLayer = new Graphics();
    const kindByName = new Map(featureKinds.map((k) => [k.kind, k]));
    for (const feature of sortFeaturesForRender(features)) {
      const meta = kindByName.get(feature.kind);
      const colour = parseHexToInt(
        feature.color ?? meta?.defaultColor,
        0x64748b,
      );
      const alpha = feature.isVisualOnly ? 0.08 : feature.isObstacle ? 0.4 : 0.16;
      const local = footprintVertices({
        geometryKind: feature.geometryKind,
        originXMm: feature.originXMm,
        originYMm: feature.originYMm,
        widthMm: feature.widthMm,
        lengthMm: feature.lengthMm,
        rotationDegrees: feature.rotationDegrees,
        points: feature.points,
      });
      if (feature.geometryKind === "POLYLINE") {
        if (local.length < 2) continue;
        featureLayer.moveTo(local[0].x, local[0].y);
        for (let i = 1; i < local.length; i++) {
          featureLayer.lineTo(local[i].x, local[i].y);
        }
        const thickness = Number(feature.attrs.thicknessMm);
        featureLayer.stroke({
          width: Number.isFinite(thickness) && thickness > 0 ? thickness : 200,
          color: colour,
          alpha: 0.9,
        });
      } else if (local.length >= 3) {
        featureLayer
          .poly(local.map((p) => ({ x: p.x, y: p.y })))
          .fill({ color: colour, alpha })
          .stroke({ width: 20, color: colour, alpha: 0.8 });
      } else if (local.length === 1) {
        featureLayer
          .circle(local[0].x, local[0].y, 350)
          .fill({ color: colour, alpha: 0.9 });
      }
    }
    layer.addChild(featureLayer);

    // Storage, coloured by zone. One Graphics for all of them: this is a
    // read-only view, so there is nothing to hit-test per bay.
    const storage = new Graphics();
    const zoneById = new Map(zoneTypes.map((z) => [z.zoneId, z]));
    // Bays stack by level at the same footprint; drawing one per footprint
    // keeps a 100k-location DC from becoming 100k draw commands.
    const drawn = new Set<string>();
    for (const location of locations) {
      const key = `${location.physicalX}:${location.physicalY}:${location.physicalWidthMm}:${location.physicalLengthMm}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      const colour = resolveZoneColor(
        location.zoneId != null ? zoneById.get(location.zoneId) : null,
      );
      storage
        .rect(
          location.physicalX,
          location.physicalY,
          location.physicalWidthMm,
          location.physicalLengthMm,
        )
        .fill({ color: colour, alpha: location.isBlocked ? 0.2 : 0.45 })
        .stroke({ width: 18, color: 0x475569, alpha: 0.6 });
    }
    layer.addChild(storage);

    if (showNavGraph) {
      const graph = new Graphics();
      const nodeById = new Map(navGraph.nodes.map((n) => [n.nodeId, n]));
      const scale = viewport.scale.x || 1;
      for (const edge of navGraph.edges) {
        const from = nodeById.get(edge.fromNodeId);
        const to = nodeById.get(edge.toNodeId);
        if (!from || !to) continue;
        graph
          .moveTo(from.xMm, from.yMm)
          .lineTo(to.xMm, to.yMm)
          .stroke({ width: 2 / scale, color: 0x0d9488, alpha: 0.5 });
      }
      layer.addChild(graph);
    }
  }

  // --- Init ---------------------------------------------------------------

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
        console.error("Live map canvas failed to start:", err);
        if (!destroyed) setInitError("The live map couldn't start. Reload the page.");
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

      // Pan and zoom are always live here -- there are no tools to conflict
      // with, and a supervisor watching a floor wants to move around freely.
      viewport.drag().pinch().wheel().decelerate({ friction: 0.9 });
      const fitScale = Math.min(
        el.clientWidth / hall.physicalWidthMm,
        el.clientHeight / hall.physicalLengthMm,
      );
      viewport.clampZoom({ minScale: fitScale, maxScale: 8 });
      viewport.clamp({ direction: "all", underflow: "center" });

      const staticLayer = new Container();
      viewport.addChild(staticLayer);
      staticLayerRef.current = staticLayer;

      const liveLayer = new Graphics();
      liveLayer.eventMode = "none";
      viewport.addChild(liveLayer);
      liveLayerRef.current = liveLayer;

      viewport.fit(true);
      viewport.moveCenter(hall.physicalWidthMm / 2, hall.physicalLengthMm / 2);

      viewport.eventMode = "static";
      viewport.on("pointerdown", (e: FederatedPointerEvent) => {
        if (!pickingRef.current || e.button !== 0) return;
        const world = viewport.toWorld(e.global);
        onPointPickedRef.current({ x: world.x, y: world.y });
      });

      // Live redraw on the ticker, not on React state. This is what turns
      // sparse position reports into continuous motion: every frame we ask
      // where each asset should be *now*, rather than waiting for the next
      // message to move it.
      app.ticker.add(() => {
        const g = liveLayerRef.current;
        if (!g) return;
        const scale = viewport.scale.x;
        g.clear();

        for (const blockage of blockagesRef.current) {
          if (blockage.originXMm == null || blockage.originYMm == null) continue;
          g.circle(
            blockage.originXMm,
            blockage.originYMm,
            blockage.radiusMm ?? 1500,
          )
            .fill({ color: 0xdc2626, alpha: 0.18 })
            .stroke({ width: 3 / scale, color: 0xdc2626, alpha: 0.9 });
        }

        for (const route of routesRef.current) {
          if (route.points.length < 2) continue;
          g.moveTo(route.points[0].x, route.points[0].y);
          for (let i = 1; i < route.points.length; i++) {
            g.lineTo(route.points[i].x, route.points[i].y);
          }
          g.stroke({ width: 4 / scale, color: 0xf59e0b, alpha: 0.85 });
        }

        const now = Date.now();
        for (const asset of assetsRef.current) {
          const rendered = renderAssetAt(asset, now);
          if (!rendered) continue;

          const colour = rendered.assetKind === "MHE" ? 0xf59e0b : 0x2563eb;
          const radius = (rendered.assetKind === "MHE" ? 9 : 7) / scale;

          // Certainty is drawn, not hidden: the halo grows as confidence falls
          // so a stale guess never looks like a fix.
          if (rendered.confidence < 1) {
            g.circle(
              rendered.x,
              rendered.y,
              radius * 1.5 + (1 - rendered.confidence) * 4000,
            ).fill({ color: colour, alpha: 0.12 });
          }

          g.circle(rendered.x, rendered.y, radius)
            .fill({
              color: colour,
              alpha: rendered.confidence < CONFIDENCE_STALE ? 0.45 : 1,
            })
            .stroke({ width: 2 / scale, color: 0xffffff, alpha: 0.9 });

          if (rendered.headingDeg != null && rendered.isInterpolated) {
            const radians = (rendered.headingDeg * Math.PI) / 180;
            g.moveTo(rendered.x, rendered.y)
              .lineTo(
                rendered.x + Math.cos(radians) * radius * 2.5,
                rendered.y + Math.sin(radians) * radius * 2.5,
              )
              .stroke({ width: 2 / scale, color: colour });
          }
        }
      });

      setIsReady(true);
      drawStatic();
    })();

    return () => {
      destroyed = true;
      setIsReady(false);
      const currentApp = appRef.current;
      const currentViewport = viewportRef.current;
      appRef.current = null;
      viewportRef.current = null;
      staticLayerRef.current = null;
      liveLayerRef.current = null;
      if (currentViewport) {
        try {
          currentViewport.destroy();
        } catch {
          // no-op
        }
      }
      if (currentApp) {
        try {
          currentApp.destroy(true, { children: true });
        } catch {
          // no-op
        }
      }
      if (el) el.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hall.hallId, hall.physicalWidthMm, hall.physicalLengthMm]);

  // Static geometry only redraws when the published layout actually changes.
  useEffect(() => {
    if (!isReady) return;
    drawStatic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations, features, zoneTypes, navGraph, showNavGraph, isReady]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !isReady) return;
    if (!showNavGraph) return;
    // Graph line weight is zoom-compensated, so it needs a redraw on zoom.
    const redraw = () => drawStatic();
    viewport.on("zoomed-end", redraw);
    return () => {
      viewport.off("zoomed-end", redraw);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, showNavGraph]);

  return (
    <div className="relative flex h-full w-full overflow-hidden rounded-xl border bg-background/60">
      <div
        ref={containerRef}
        className={`relative z-0 h-full w-full ${pickingPoint ? "cursor-crosshair" : ""}`}
      />

      {initError && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/90 p-4 text-center text-sm font-medium text-destructive">
          {initError}
        </div>
      )}

      {pickingPoint && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-50 -translate-x-1/2 rounded-md bg-slate-900/90 px-3 py-1.5 text-xs font-medium text-white shadow">
          Click the spot to block
        </div>
      )}

      <div className="pointer-events-auto absolute right-4 top-4 z-50 flex flex-col overflow-hidden rounded-lg border bg-background shadow-md">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleZoomIn}
          className="h-8 w-8 rounded-none border-b"
          title="Zoom in"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleZoomOut}
          className="h-8 w-8 rounded-none"
          title="Zoom out"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
