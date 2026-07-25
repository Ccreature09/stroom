"use client";

import { useState, useTransition } from "react";
import { createLocation, deleteLocation, updateLocationDetails, updateLocationGeometry } from "@/app/dashboard/warehouses/[warehouseId]/layout-designer/actions";
import type { DraftGeometry, LocationDTO, ZoneTypeDTO } from "./types";

const inputClass =
  "mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10";
const labelClass = "text-xs font-semibold text-slate-700";

function ZoneSelect({ zoneTypes, defaultValue }: { zoneTypes: ZoneTypeDTO[]; defaultValue?: number | null }) {
  return (
    <select name="zoneId" defaultValue={defaultValue ?? ""} className={inputClass}>
      <option value="">No zone</option>
      {zoneTypes.map((z) => (
        <option key={z.zoneId} value={z.zoneId}>
          {z.name}
        </option>
      ))}
    </select>
  );
}

export function CreateLocationPanel({
  warehouseId,
  hallId,
  draft,
  zoneTypes,
  onClose,
}: {
  warehouseId: number;
  hallId: number;
  draft: DraftGeometry;
  zoneTypes: ZoneTypeDTO[];
  onClose: () => void;
}) {
  const [error, setError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createLocation(formData);
      if (result?.error) setError(result.error);
      else onClose();
    });
  }

  return (
    <div className="flex h-full w-80 shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between">
        <h2 className="text-sm font-semibold text-slate-900">New location</h2>
        <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-700">Cancel</button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {draft.physicalWidthMm}mm × {draft.physicalLengthMm}mm at ({draft.physicalX}, {draft.physicalY})
      </p>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <input type="hidden" name="warehouseId" value={warehouseId} />
        <input type="hidden" name="hallId" value={hallId} />
        <input type="hidden" name="physicalX" value={draft.physicalX} />
        <input type="hidden" name="physicalY" value={draft.physicalY} />
        <input type="hidden" name="physicalWidthMm" value={draft.physicalWidthMm} />
        <input type="hidden" name="physicalLengthMm" value={draft.physicalLengthMm} />

        <div>
          <label className={labelClass} htmlFor="locationCode">Location code</label>
          <input id="locationCode" name="locationCode" required placeholder="WH1-BULK-04-12-3" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="zoneId">Zone</label>
          <ZoneSelect zoneTypes={zoneTypes} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className={labelClass} htmlFor="aisle">Aisle</label>
            <input id="aisle" name="aisle" type="number" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="bay">Bay</label>
            <input id="bay" name="bay" type="number" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="level">Level</label>
            <input id="level" name="level" type="number" className={inputClass} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass} htmlFor="heightMm">Height (mm)</label>
            <input id="heightMm" name="heightMm" type="number" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="maxWeightKg">Max weight (kg)</label>
            <input id="maxWeightKg" name="maxWeightKg" type="number" className={inputClass} />
          </div>
        </div>
        <div>
          <label className={labelClass} htmlFor="floorLevel">Floor level</label>
          <input id="floorLevel" name="floorLevel" type="number" min={1} defaultValue={1} className={inputClass} />
        </div>

        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

        <button type="submit" disabled={isPending} className="w-full rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
          {isPending ? "Creating…" : "Create location"}
        </button>
      </form>
    </div>
  );
}

export function EditLocationPanel({
  warehouseId,
  location,
  zoneTypes,
  onClose,
  onDeleted,
}: {
  warehouseId: number;
  location: LocationDTO;
  zoneTypes: ZoneTypeDTO[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [error, setError] = useState<string>();
  const [isPending, startTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await updateLocationDetails(formData);
      if (result?.error) setError(result.error);
    });
  }

  function handleDelete() {
    if (!confirm(`Delete location "${location.locationCode}"? This cannot be undone.`)) return;
    const formData = new FormData();
    formData.set("warehouseId", String(warehouseId));
    formData.set("locationId", String(location.locationId));
    startDeleteTransition(async () => {
      const result = await deleteLocation(formData);
      if (result?.error) setError(result.error);
      else onDeleted();
    });
  }

  function handleRotate() {
    startTransition(async () => {
      await updateLocationGeometry(warehouseId, location.locationId, {
        physicalX: location.physicalX,
        physicalY: location.physicalY,
        physicalWidthMm: location.physicalWidthMm,
        physicalLengthMm: location.physicalLengthMm,
        rotationDegrees: (location.rotationDegrees + 90) % 360,
      });
    });
  }

  return (
    <div className="flex h-full w-80 shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between">
        <h2 className="text-sm font-semibold text-slate-900">{location.locationCode}</h2>
        <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-700">Close</button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {location.physicalWidthMm}mm × {location.physicalLengthMm}mm at ({location.physicalX}, {location.physicalY}) ·{" "}
        {location.rotationDegrees}°
      </p>
      <button onClick={handleRotate} disabled={isPending} className="mt-2 self-start rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
        Rotate 90°
      </button>

      <form key={location.locationId} onSubmit={handleSubmit} className="mt-4 space-y-3">
        <input type="hidden" name="warehouseId" value={warehouseId} />
        <input type="hidden" name="locationId" value={location.locationId} />

        <div>
          <label className={labelClass} htmlFor="locationCode">Location code</label>
          <input id="locationCode" name="locationCode" required defaultValue={location.locationCode} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="zoneId">Zone</label>
          <ZoneSelect zoneTypes={zoneTypes} defaultValue={location.zoneId} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className={labelClass} htmlFor="aisle">Aisle</label>
            <input id="aisle" name="aisle" type="number" defaultValue={location.aisle ?? undefined} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="bay">Bay</label>
            <input id="bay" name="bay" type="number" defaultValue={location.bay ?? undefined} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="level">Level</label>
            <input id="level" name="level" type="number" defaultValue={location.level ?? undefined} className={inputClass} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass} htmlFor="heightMm">Height (mm)</label>
            <input id="heightMm" name="heightMm" type="number" defaultValue={location.heightMm ?? undefined} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="maxWeightKg">Max weight (kg)</label>
            <input id="maxWeightKg" name="maxWeightKg" type="number" defaultValue={location.maxWeightKg ?? undefined} className={inputClass} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
          <input type="checkbox" name="isBlocked" defaultChecked={location.isBlocked === true} className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600" />
          Blocked (excluded from putaway/picking)
        </label>

        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

        <button type="submit" disabled={isPending} className="w-full rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
          {isPending ? "Saving…" : "Save changes"}
        </button>
      </form>

      <button onClick={handleDelete} disabled={isDeleting} className="mt-3 w-full rounded-lg border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-60">
        {isDeleting ? "Deleting…" : "Delete location"}
      </button>
    </div>
  );
}

export function EmptyLocationPanel() {
  return (
    <div className="flex h-full w-80 shrink-0 flex-col items-center justify-center border-l border-slate-200 bg-white p-5 text-center">
      <p className="text-sm font-medium text-slate-500">Create or select a location to edit.</p>
    </div>
  );
}