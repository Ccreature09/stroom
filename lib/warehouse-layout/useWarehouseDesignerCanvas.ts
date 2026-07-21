"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import * as PIXI from "pixi.js";
import { Viewport } from "pixi-viewport";
import type { DesignerMode } from "./constants";
import type { WarehouseLayoutLocation } from "./types";

interface UseWarehouseDesignerCanvasProps {
  activeFloorLevel: number;
  locations: WarehouseLayoutLocation[];
  mode: DesignerMode;
  selectedLocationId: number | null;
  onSelectLocation: (locationId: number | null) => void;
}

interface PixiCanvasContext {
  app: PIXI.Application;
  viewport: Viewport;
  gridTexture: PIXI.Texture;
}

const SCALE_FACTOR = 0.05; // 1mm = 0.05px

export function useWarehouseDesignerCanvas({
  activeFloorLevel,
  locations,
  mode,
  selectedLocationId,
  onSelectLocation,
}: UseWarehouseDesignerCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const pixiRef = useRef<PixiCanvasContext | null>(null);
  const [isReady, setIsReady] = useState(false);

  // 1. Dynamic scale bounds calculation base tracking
  // Using fixed fallback dimensions for baseline rendering checks if macro parameters are unassigned
  const warehouseWidthMm = 80000;  // 80 meters
  const warehouseLengthMm = 60000; // 60 meters

  const worldBounds = useMemo(() => {
    return {
      width: warehouseWidthMm * SCALE_FACTOR,
      height: warehouseLengthMm * SCALE_FACTOR,
    };
  }, [warehouseWidthMm, warehouseLengthMm]);

  // Keep latest reactivity configurations tracked via references to isolate the Pixi loop
  const propsRef = useRef({ mode, selectedLocationId, activeFloorLevel, locations });
  useEffect(() => {
    propsRef.current = { mode, selectedLocationId, activeFloorLevel, locations };
  }, [mode, selectedLocationId, activeFloorLevel, locations]);

  useEffect(() => {
    // 2. CRITICAL FIX: Extract local host reference copy & safeguard early null states
    const host = hostRef.current;
    if (!host) return; 

    const width = host.clientWidth || 800;
    const height = host.clientHeight || 600;

    let destroyed = false;
    let app: PIXI.Application | null = null;

    const initPixi = async () => {
      app = new PIXI.Application();
      
      // Initialize the accelerated canvas instance
      await app.init({
        width,
        height,
        backgroundColor: 0xf8fafc,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });

      if (destroyed) {
        app.destroy( true );
        return;
      }

      // 3. Mount the HTML5 canvas view securely to the safe DOM wrapper element
      host.appendChild(app.canvas);

      // Create a clean background grid texture asset locally
      const gridGraphics = new PIXI.Graphics();
      gridGraphics.rect(0, 0, 40, 40);
      gridGraphics.stroke({ width: 1, color: 0xe2e8f0 });
      const gridTexture = app.renderer.generateTexture(gridGraphics);

      // Initialize the standalone viewport manager container
      const viewport = new Viewport({
  screenWidth: width,
  screenHeight: height,
  worldWidth: worldBounds.width,
  worldHeight: worldBounds.height,
  events: app.renderer.events, // ✅ Pass Pixi's internal event system here
});

      app.stage.addChild(viewport);

      // Enable standard viewport controls interaction behaviors
      viewport
        .drag()
        .pinch()
        .wheel()
        .clamp({ direction: "all" })
        .clampZoom({ minScale: 0.2, maxScale: 3 });

      // Keep context tracked within our mutable hook reference map
      pixiRef.current = { app, viewport, gridTexture };
      setIsReady(true);
    };

    initPixi();

    // Resize observer connection logic
    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        if (pixiRef.current?.app) {
          const { inlineSize: w, blockSize: h } = entry.borderBoxSize[0] ?? {
            inlineSize: entry.contentRect.width,
            blockSize: entry.contentRect.height,
          };
          pixiRef.current.app.renderer.resize(w, h);
          pixiRef.current.viewport.resize(w, h);
        }
      }
    });
    resizeObserver.observe(host);

    // 4. MEMORY & LIFECYCLE CLEANUP FIX (PixiJS v8 Specification)
    return () => {
      destroyed = true;
      resizeObserver.disconnect();

      if (host && app && app.canvas && host.contains(app.canvas)) {
        host.removeChild(app.canvas);
      }

      if (pixiRef.current) {
        if (pixiRef.current.gridTexture) {
          pixiRef.current.gridTexture.destroy(true);
        }

        // Fix: Flat configuration options structure prevents internal 'next' evaluation crashes
       pixiRef.current.app.destroy(true, {
  texture: true,
  context: true,
});

        pixiRef.current = null;
      }
      setIsReady(false);
    };
  }, [worldBounds]);

  return {
    hostRef,
    isReady,
  };
}