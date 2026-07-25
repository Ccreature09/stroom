"use client";

import { useMemo, useState } from "react";
import HallToolbar from "./HallToolbar";
import LayoutDesignerCanvas, { type Tool } from "./LayoutDesignerCanvas";
// Added EmptyLocationPanel to the imports here:
import { CreateLocationPanel, EditLocationPanel, EmptyLocationPanel } from "./LocationPanel";
import { updateLocationGeometry } from "@/app/dashboard/warehouses/[warehouseId]/layout-designer/actions";
import type { DraftGeometry, HallDTO, LocationDTO, ZoneTypeDTO } from "./types";

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
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [draft, setDraft] = useState<DraftGeometry | null>(null);

  const hall = useMemo(() => halls.find((h) => h.hallId === selectedHallId) ?? halls[0], [halls, selectedHallId]);
  const selectedLocation = useMemo(
    () => locations.find((l) => l.locationId === selectedLocationId) ?? null,
    [locations, selectedLocationId],
  );

  function handleToolChange(next: Tool) {
    setTool(next);
    setSelectedLocationId(null);
    setDraft(null);
  }

  function handleDraftDrawn(geometry: DraftGeometry) {
    setDraft(geometry);
  }

  function handleSelect(locationId: number | null) {
    setSelectedLocationId(locationId);
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-row overflow-hidden rounded-xl border border-slate-200 bg-white/40">
      
      {/* 1. Left Sidebar: Toolbar */}
      <HallToolbar
        warehouseId={warehouseId}
        halls={halls}
        selectedHallId={hall.hallId}
        zoneTypes={zoneTypes}
        tool={tool}
        onToolChange={handleToolChange}
      />
      
      {/* 2. Middle Column: Centered restricted-size canvas */}
      <div className="flex min-w-0 flex-1 items-center justify-center p-6 bg-slate-50/50">
        <div className="h-[600px] w-full max-w-5xl overflow-hidden rounded-xl shadow-sm">
          <LayoutDesignerCanvas
            hall={hall}
            locations={locations}
            selectedLocationId={selectedLocationId}
            tool={tool}
            onSelect={handleSelect}
            onDraftDrawn={handleDraftDrawn}
            onGeometryChange={(locationId, geometry) => {
              void updateLocationGeometry(warehouseId, locationId, geometry);
            }}
          />
        </div>
      </div>

      {/* 3. Right Sidebar: Permanently mounted Location Panel */}
      {draft ? (
        <CreateLocationPanel
          warehouseId={warehouseId}
          hallId={hall.hallId}
          draft={draft}
          zoneTypes={zoneTypes}
          onClose={() => setDraft(null)}
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