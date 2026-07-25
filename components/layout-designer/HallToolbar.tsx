"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createHall, createZoneType } from "@/app/dashboard/warehouses/[warehouseId]/layout-designer/actions";
import { cssColorForZone } from "./types";
import type { HallDTO, ZoneTypeDTO } from "./types";
import type { Tool } from "./LayoutDesignerCanvas";

const inputClass =
  "mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10";

export default function HallToolbar({
  warehouseId,
  halls,
  selectedHallId,
  zoneTypes,
  tool,
  onToolChange,
}: {
  warehouseId: number;
  halls: HallDTO[];
  selectedHallId: number;
  zoneTypes: ZoneTypeDTO[];
  tool: Tool;
  onToolChange: (tool: Tool) => void;
}) {
  const router = useRouter();
  const [showNewHall, setShowNewHall] = useState(false);
  const [showNewZone, setShowNewZone] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState(false);

  function handleSaveMap() {
    setIsSaving(true);
    router.refresh();
    setTimeout(() => {
      setIsSaving(false);
      setSavedMessage(true);
      setTimeout(() => setSavedMessage(false), 2000);
    }, 400);
  }

  return (
    <div className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white/70 p-4 overflow-y-auto">
      <div className="flex flex-col gap-5 flex-1">
        {/* Hall Selection Group */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Active Hall</label>
          <select
            value={selectedHallId}
            onChange={(e) => router.push(`/dashboard/warehouses/${warehouseId}/layout-designer?hall=${e.target.value}`)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm"
          >
            {halls.map((h) => (
              <option key={h.hallId} value={h.hallId}>
                {h.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => setShowNewHall(true)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            + New Hall
          </button>
        </div>

        <div className="h-px w-full bg-slate-200" />

        {/* Tools Group */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Tools</label>
          <div className="flex flex-col gap-1 rounded-lg border border-slate-300 bg-white p-1">
            <button
              onClick={() => onToolChange("select")}
              className={`w-full rounded-md px-3 py-1.5 text-left text-sm font-medium transition ${tool === "select" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              Select
            </button>
            <button
              onClick={() => onToolChange("draw")}
              className={`w-full rounded-md px-3 py-1.5 text-left text-sm font-medium transition ${tool === "draw" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              Add location
            </button>
          </div>
        </div>

        <div className="h-px w-full bg-slate-200" />

        {/* Zones Group */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Zones</label>
          <div className="flex flex-col gap-2">
            {zoneTypes.map((z) => (
              <span key={z.zoneId} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: cssColorForZone(z.zoneId) }} />
                <span className="truncate">{z.name}</span>
              </span>
            ))}
            <button
              onClick={() => setShowNewZone(true)}
              className="w-full rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50"
            >
              + New Zone
            </button>
          </div>
        </div>
      </div>

      {/* Save Map Button at the bottom of the left sidebar */}
      <div className="mt-6 pt-4 border-t border-slate-200">
        <button
          onClick={handleSaveMap}
          disabled={isSaving}
          className="w-full rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
        >
          {isSaving ? "Saving..." : savedMessage ? "Map Saved!" : "Save Map"}
        </button>
      </div>

      {showNewHall && <NewHallDialog warehouseId={warehouseId} onClose={() => setShowNewHall(false)} />}
      {showNewZone && <NewZoneDialog warehouseId={warehouseId} onClose={() => setShowNewZone(false)} />}
    </div>
  );
}

function DialogShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
        <div className="flex items-start justify-between">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-700">Cancel</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function NewHallDialog({ warehouseId, onClose }: { warehouseId: number; onClose: () => void }) {
  return (
    <DialogShell title="New hall" onClose={onClose}>
      <form action={createHall} className="mt-4 space-y-3">
        <input type="hidden" name="warehouseId" value={warehouseId} />
        <div>
          <label className="text-xs font-semibold text-slate-700" htmlFor="name">Name</label>
          <input id="name" name="name" required placeholder="Hall B - Cold Storage" className={inputClass} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-semibold text-slate-700" htmlFor="physicalWidthMm">Width (mm)</label>
            <input id="physicalWidthMm" name="physicalWidthMm" type="number" min={1} defaultValue={80_000} className={inputClass} />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700" htmlFor="physicalLengthMm">Length (mm)</label>
            <input id="physicalLengthMm" name="physicalLengthMm" type="number" min={1} defaultValue={60_000} className={inputClass} />
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-700" htmlFor="clearHeightMm">Clear height (mm)</label>
          <input id="clearHeightMm" name="clearHeightMm" type="number" min={1} defaultValue={12_000} className={inputClass} />
        </div>
        <button type="submit" className="w-full rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800">
          Create hall
        </button>
      </form>
    </DialogShell>
  );
}

function NewZoneDialog({ warehouseId, onClose }: { warehouseId: number; onClose: () => void }) {
  const [error, setError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createZoneType(formData);
      if (result?.error) setError(result.error);
      else onClose();
    });
  }

  return (
    <DialogShell title="New zone" onClose={onClose}>
      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <input type="hidden" name="warehouseId" value={warehouseId} />
        <div>
          <label className="text-xs font-semibold text-slate-700" htmlFor="zone-name">Name</label>
          <input id="zone-name" name="name" required placeholder="BULK" className={inputClass} />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-700" htmlFor="storagePermanence">Storage permanence</label>
          <select id="storagePermanence" name="storagePermanence" defaultValue="PERMANENT" className={inputClass}>
            <option value="PERMANENT">Permanent</option>
            <option value="TEMPORARY">Temporary</option>
            <option value="FLUID_BUFFER">Fluid buffer</option>
          </select>
        </div>
        <div className="space-y-2">
          {[
            { name: "isPickable", label: "Pickable", defaultChecked: true },
            { name: "requiresBarcodeScan", label: "Requires barcode scan", defaultChecked: true },
            { name: "isTemperatureControlled", label: "Temperature controlled", defaultChecked: false },
            { name: "requiresHazmatClearance", label: "Requires hazmat clearance", defaultChecked: false },
          ].map((f) => (
            <label key={f.name} className="flex items-center gap-2 text-xs font-medium text-slate-700">
              <input type="checkbox" name={f.name} defaultChecked={f.defaultChecked} className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600" />
              {f.label}
            </label>
          ))}
        </div>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <button type="submit" disabled={isPending} className="w-full rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60">
          {isPending ? "Creating…" : "Create zone"}
        </button>
      </form>
    </DialogShell>
  );
}