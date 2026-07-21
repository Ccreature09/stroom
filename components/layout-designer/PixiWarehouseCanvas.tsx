"use client";

import { useEffect, useRef } from "react";
import { useWarehouseDesignerCanvas } from "@/lib/warehouse-layout/useWarehouseDesignerCanvas";
import type { DesignerMode } from "@/lib/warehouse-layout/constants";
import type { WarehouseLayoutLocation } from "@/lib/warehouse-layout/types";

interface PixiWarehouseCanvasProps {
  activeFloorLevel: number;
  locations: WarehouseLayoutLocation[];
  mode: DesignerMode;
  selectedLocationId: number | null;
  onSelectLocation: (locationId: number | null) => void;
}

export default function PixiWarehouseCanvas({
  activeFloorLevel,
  locations,
  mode,
  selectedLocationId,
  onSelectLocation,
}: PixiWarehouseCanvasProps) {
  // Guard references to ensure active layout properties update smoothly without ripping down the canvas context
  const onSelectRef = useRef(onSelectLocation);
  
  useEffect(() => {
    onSelectRef.current = onSelectLocation;
  }, [onSelectLocation]);

  const { hostRef, isReady } = useWarehouseDesignerCanvas({
    activeFloorLevel,
    locations,
    mode, // Ensure useWarehouseDesignerCanvas processes mode shifts via inner state effect rather than complete canvas destruction
    selectedLocationId,
    onSelectLocation: (id) => onSelectRef.current(id),
  });

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Visual State Indicator */}
      <div className="pointer-events-none absolute right-4 top-4 z-20 rounded-md border border-slate-200 bg-white/90 px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur">
        {isReady ? "● WebGL Interactive" : "○ Initializing layout engine..."}
      </div>

      {/* Strict full size layout wrapper */}
      <div className="absolute inset-0 h-full w-full bg-slate-100">
        <div 
          id="pixi-canvas-container" 
          ref={hostRef} 
          className="h-full w-full block [&>canvas]:block [&>canvas]:w-full [&>canvas]:h-full" 
        />
      </div>
    </div>
  );
}