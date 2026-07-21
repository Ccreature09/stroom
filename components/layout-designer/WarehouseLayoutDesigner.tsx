"use client";

import { useMemo, useState } from "react";
import PixiWarehouseCanvas from "@/components/layout-designer/PixiWarehouseCanvas";
import { DESIGNER_MODE_LABELS, type DesignerMode } from "@/lib/warehouse-layout/constants";
import {
  formatFloorLevelLabel,
  getLocationAreaSquareMeters,
  normalizeStoragePermanence,
} from "@/lib/warehouse-layout/utils";
import type {
  WarehouseLayoutInspectorDraft,
  WarehouseLayoutLocation,
  WarehouseLayoutWarehouseSummary,
} from "@/lib/warehouse-layout/types";

interface WarehouseLayoutDesignerProps {
  warehouse: WarehouseLayoutWarehouseSummary;
  locations: WarehouseLayoutLocation[];
  floorLevels: number[];
}

function buildInspectorDraft(location: WarehouseLayoutLocation): WarehouseLayoutInspectorDraft {
  return {
    locationCode: location.locationCode,
    requiresBarcodeScan: location.requiresBarcodeScan,
    maxWeightKg: location.maxWeightKg === null ? "" : String(location.maxWeightKg),
    heightMm: location.heightMm === null ? "" : String(location.heightMm),
  };
}

export default function WarehouseLayoutDesigner({
  warehouse,
  locations,
  floorLevels,
}: WarehouseLayoutDesignerProps) {
  const [mode, setMode] = useState<DesignerMode>("SELECT");
  const [activeFloorLevel, setActiveFloorLevel] = useState<number>(floorLevels[0] ?? 1);
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [draftsByLocationId, setDraftsByLocationId] = useState<Record<number, WarehouseLayoutInspectorDraft>>({});

  const visibleLocations = useMemo(
    () => locations.filter((location) => location.floorLevel === activeFloorLevel),
    [activeFloorLevel, locations],
  );

  const effectiveSelectedLocationId = useMemo(() => {
    if (visibleLocations.length === 0) return null;
    if (selectedLocationId !== null && visibleLocations.some((location) => location.locationId === selectedLocationId)) {
      return selectedLocationId;
    }

    return visibleLocations[0].locationId;
  }, [selectedLocationId, visibleLocations]);

  const selectedLocation = useMemo(
  () => locations.find((location) => location.locationId === selectedLocationId) ?? null,
  [selectedLocationId, locations]
);

  const inspectorDraft = useMemo(() => {
    if (!selectedLocation) return null;
    return draftsByLocationId[selectedLocation.locationId] ?? buildInspectorDraft(selectedLocation);
  }, [draftsByLocationId, selectedLocation]);

  function updateInspectorDraft<Key extends keyof WarehouseLayoutInspectorDraft>(key: Key, value: WarehouseLayoutInspectorDraft[Key]) {
    if (!selectedLocation) return;

    setDraftsByLocationId((current) => ({
      ...current,
      [selectedLocation.locationId]: {
        ...(current[selectedLocation.locationId] ?? buildInspectorDraft(selectedLocation)),
        [key]: value,
      },
    }));
  }

  const floorOptions = floorLevels.length > 0 ? floorLevels : [1];

  return (
    <section className="flex h-full w-full min-h-0 overflow-hidden rounded-[28px] border border-slate-200 bg-slate-50 text-slate-900 shadow-[0_20px_70px_rgba(15,23,42,0.10)]">
      <aside className="flex w-80 shrink-0 flex-col justify-between overflow-y-auto border-r border-slate-200 bg-white p-4">
        <div className="space-y-6">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">Toolbox</h2>
            <h1 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Layout Controls</h1>
            <p className="mt-2 text-sm text-slate-500">{warehouse.name || `Warehouse #${warehouse.warehouseId}`}</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-600" htmlFor="floor-level-select">
              Floor Level
            </label>
            <select
              id="floor-level-select"
              value={activeFloorLevel}
              onChange={(event) => {
                const nextFloorLevel = Number(event.target.value);
                setActiveFloorLevel(nextFloorLevel);

                const nextFloorLocations = locations.filter((location) => location.floorLevel === nextFloorLevel);
                setSelectedLocationId(nextFloorLocations[0]?.locationId ?? null);
              }}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm outline-none transition focus:border-blue-500"
            >
              {floorOptions.map((floorLevel) => (
                <option key={floorLevel} value={floorLevel}>
                  {formatFloorLevelLabel(floorLevel)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setMode("DRAW_BOX")}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm font-medium transition hover:bg-slate-50"
            >
              Add Zone
            </button>
            <button
              type="button"
              onClick={() => setMode("GENERATE_GRID")}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm font-medium transition hover:bg-slate-50"
            >
              Generate Racking Row
            </button>
            <button
              type="button"
              disabled
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm font-medium text-slate-400 disabled:cursor-not-allowed"
            >
              Draw Line
            </button>
            <button
              type="button"
              onClick={() => setMode("SELECT")}
              className={`w-full rounded-lg border px-3 py-2 text-left text-sm font-medium transition ${
                mode === "SELECT"
                  ? "border-blue-200 bg-blue-50 text-blue-700"
                  : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              Selection Mode
            </button>
          </div>

          <hr className="border-slate-100" />

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Hierarchy</h3>
                <p className="mt-1 text-xs text-slate-500">Flat element list for the current plane.</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{visibleLocations.length}</span>
            </div>

            <div className="space-y-2">
              {visibleLocations.length > 0 ? (
                visibleLocations.map((location) => {
                  const permanence = normalizeStoragePermanence(location.storagePermanence);
                  const isSelected = location.locationId === effectiveSelectedLocationId;

                  return (
                    <button
                      key={location.locationId}
                      type="button"
                      onClick={() => {
                        setSelectedLocationId(location.locationId);
                        setMode("SELECT");
                      }}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                        isSelected
                          ? "border-blue-200 bg-blue-50 text-blue-900"
                          : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold">{location.locationCode}</span>
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">{permanence}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {location.zoneName || "Unassigned zone"} · x {location.physicalX} mm · y {location.physicalY} mm
                      </p>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-4 text-center text-xs text-slate-400">
                  No locations exist on this floor level yet.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-auto border-t border-slate-100 pt-4">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Active Mode</span>
          <p className="mt-1 text-sm font-medium text-slate-700">{DESIGNER_MODE_LABELS[mode]}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full bg-slate-950 px-2.5 py-1 text-white">{formatFloorLevelLabel(activeFloorLevel)}</span>
            <span className="rounded-full bg-sky-100 px-2.5 py-1 text-sky-800">1 px = 20 mm</span>
          </div>
        </div>
      </aside>

      <main className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-100">
        <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-md border border-slate-200 bg-white/80 px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm backdrop-blur">
          Viewport Canvas Area
        </div>
        <PixiWarehouseCanvas
  activeFloorLevel={activeFloorLevel}
  locations={locations}
  mode={mode}
  selectedLocationId={selectedLocationId} // Pass raw value instead of computed fallback
  onSelectLocation={(locationId) => {
    setSelectedLocationId(locationId);
    setMode("SELECT");
  }}
/>
      </main>

      <aside className="hidden w-80 shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white p-4 lg:flex">
        <div className="border-b border-slate-100 pb-4">
          <h2 className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">Inspector</h2>
          <h3 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Contextual Metadata</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Select a layout node to modify structural properties, constraints, or codes.
          </p>
        </div>

        {selectedLocation && inspectorDraft ? (
          <div className="mt-5 space-y-5">
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-bold text-slate-950">{selectedLocation.locationCode}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {selectedLocation.zoneName || "Unassigned zone"} · {normalizeStoragePermanence(selectedLocation.storagePermanence)}
                  </p>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">
                  #{selectedLocation.locationId}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-600">
                <div className="rounded-2xl bg-white px-3 py-2 ring-1 ring-inset ring-slate-200">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Position</p>
                  <p className="mt-1 font-semibold text-slate-900">{selectedLocation.physicalX} / {selectedLocation.physicalY} mm</p>
                </div>
                <div className="rounded-2xl bg-white px-3 py-2 ring-1 ring-inset ring-slate-200">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Rotation</p>
                  <p className="mt-1 font-semibold text-slate-900">{selectedLocation.rotationDegrees}°</p>
                </div>
                <div className="rounded-2xl bg-white px-3 py-2 ring-1 ring-inset ring-slate-200">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Footprint</p>
                  <p className="mt-1 font-semibold text-slate-900">{getLocationAreaSquareMeters(selectedLocation).toFixed(2)} m²</p>
                </div>
                <div className="rounded-2xl bg-white px-3 py-2 ring-1 ring-inset ring-slate-200">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Floor</p>
                  <p className="mt-1 font-semibold text-slate-900">{formatFloorLevelLabel(selectedLocation.floorLevel)}</p>
                </div>
              </div>
            </div>

            <form className="space-y-4">
              <label className="block text-sm font-semibold text-slate-800" htmlFor="location-code-input">
                Location code
              </label>
              <input
                id="location-code-input"
                value={inspectorDraft.locationCode}
                onChange={(event) => updateInspectorDraft("locationCode", event.target.value)}
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-teal-500"
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-slate-800" htmlFor="max-weight-input">
                    Structural capacity (kg)
                  </label>
                  <input
                    id="max-weight-input"
                    inputMode="numeric"
                    value={inspectorDraft.maxWeightKg}
                    onChange={(event) => updateInspectorDraft("maxWeightKg", event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-800" htmlFor="height-input">
                    Structure height (mm)
                  </label>
                  <input
                    id="height-input"
                    inputMode="numeric"
                    value={inspectorDraft.heightMm}
                    onChange={(event) => updateInspectorDraft("heightMm", event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-teal-500"
                  />
                </div>
              </div>

              <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <span>
                  <span className="block text-sm font-semibold text-slate-900">Required barcode scanning</span>
                  <span className="mt-1 block text-xs text-slate-500">Inspector-local toggle for scan enforcement behavior.</span>
                </span>
                <input
                  type="checkbox"
                  checked={inspectorDraft.requiresBarcodeScan}
                  onChange={(event) => updateInspectorDraft("requiresBarcodeScan", event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-teal-600"
                />
              </label>
            </form>
          </div>
        ) : (
          <div className="my-auto py-8 text-center">
            <p className="text-sm text-slate-400">
              Select a layout node to modify structural properties, constraints, or codes.
            </p>
          </div>
        )}
      </aside>
    </section>
  );
}