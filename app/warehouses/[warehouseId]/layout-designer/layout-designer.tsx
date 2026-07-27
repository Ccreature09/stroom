"use client";

import { useMemo, useState } from "react";
import HallToolbar from "./hall-toolbar";
import LayoutDesignerCanvas, { type Tool } from "./layout-designer-canvas";
import {
  CreateLocationPanel,
  EditLocationPanel,
  EmptyLocationPanel,
  MultiSelectPanel,
} from "./location-panel";
import type { DraftGeometry, HallDTO, LocationDTO, ZoneTypeDTO } from "./types";
import { updateLocationGeometry } from "./actions";
import { Button } from "@/components/ui/button";

export default function LayoutDesigner({
  warehouseId,
  halls,
  selectedHallId,
  locations,
  zoneTypes,
}: {
  warehouseId: number;
  halls: HallDTO[];
  selectedHallId: number;
  locations: LocationDTO[];
  zoneTypes: ZoneTypeDTO[];
}) {
  const [tool, setTool] = useState<Tool>("select");
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(
    null,
  );
  const [selectedLocationIds, setSelectedLocationIds] = useState<number[]>([]);
  const [draft, setDraft] = useState<DraftGeometry | null>(null);

  const hall = useMemo(
    () => halls.find((h) => h.hallId === selectedHallId) ?? halls[0],
    [halls, selectedHallId],
  );
  const selectedLocation = useMemo(
    () => locations.find((l) => l.locationId === selectedLocationId) ?? null,
    [locations, selectedLocationId],
  );

  // Level overlay: which height level is active for rackings/shelves. Only
  // shown when the hall actually has multi-level racking/shelf locations.
  const availableLevels = useMemo(() => {
    const levels = new Set<number>();
    for (const loc of locations) {
      if ((loc.isRacking || loc.isShelf) && loc.level != null)
        levels.add(loc.level);
    }
    return Array.from(levels).sort((a, b) => a - b);
  }, [locations]);
  const [activeLevel, setActiveLevel] = useState<number | null>(
    availableLevels[0] ?? null,
  );

  function handleToolChange(next: Tool) {
    setTool(next);
    setSelectedLocationId(null);
    setSelectedLocationIds([]);
    setDraft(null);
  }

  function handleDraftDrawn(geometry: DraftGeometry) {
    setDraft(geometry);
  }

  function handleSelect(locationId: number | null) {
    setSelectedLocationIds([]);
    setSelectedLocationId(locationId);
  }

  function handleMultiSelect(locationIds: number[]) {
    setSelectedLocationId(null);
    setSelectedLocationIds(locationIds);
  }

  function handleClearSelection() {
    setSelectedLocationId(null);
    setSelectedLocationIds([]);
  }

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-row overflow-hidden rounded-xl border bg-background/40">
      {/* 1. Left Sidebar: Toolbar */}
      <HallToolbar
        warehouseId={warehouseId}
        halls={halls}
        selectedHallId={hall.hallId}
        zoneTypes={zoneTypes}
        tool={tool}
        onToolChange={handleToolChange}
      />

      {/* 2. Middle Column: Canvas Container */}
      <div className="relative flex min-w-0 flex-1 items-center justify-center p-6 bg-muted/30">
        {/* Level overlay */}
        {availableLevels.length > 0 && (
          <div className="pointer-events-auto absolute left-4 top-4 z-50 flex gap-1 rounded-lg border bg-background p-1 shadow-md">
            {availableLevels.map((lvl) => (
              <Button
                key={lvl}
                size="sm"
                variant={lvl === activeLevel ? "default" : "ghost"}
                onClick={() => setActiveLevel(lvl)}
              >
                L{lvl}
              </Button>
            ))}
          </div>
        )}

        <div className="h-[600px] w-full max-w-5xl overflow-hidden rounded-xl shadow-sm">
          <LayoutDesignerCanvas
            hall={hall}
            locations={locations}
            selectedLocationId={selectedLocationId}
            selectedLocationIds={selectedLocationIds}
            activeLevel={activeLevel}
            tool={tool}
            onSelect={handleSelect}
            onMultiSelect={handleMultiSelect}
            onDraftDrawn={handleDraftDrawn}
            onGeometryChange={(locationId, geometry) => {
              void updateLocationGeometry(warehouseId, locationId, geometry);
            }}
          />
        </div>
      </div>

      {/* 3. Right Sidebar: Location Panel */}
      {draft ? (
        <CreateLocationPanel
          warehouseId={warehouseId}
          hallId={hall.hallId}
          draft={draft}
          zoneTypes={zoneTypes}
          onClose={() => setDraft(null)}
        />
      ) : selectedLocationIds.length > 1 ? (
        <MultiSelectPanel
          warehouseId={warehouseId}
          locationIds={selectedLocationIds}
          onClose={handleClearSelection}
          onDone={handleClearSelection}
        />
      ) : selectedLocation ? (
        <EditLocationPanel
          warehouseId={warehouseId}
          location={selectedLocation}
          zoneTypes={zoneTypes}
          onClose={() => setSelectedLocationId(null)}
          onDeleted={() => setSelectedLocationId(null)}
        />
      ) : (
        <EmptyLocationPanel />
      )}
    </div>
  );
}
