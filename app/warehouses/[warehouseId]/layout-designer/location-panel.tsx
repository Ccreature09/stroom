"use client";

import { useState } from "react";
import type {
  DraftGeometry,
  LocationDTO,
  LocationPatch,
  ZoneTypeDTO,
} from "./types";
import {
  flagsToLocationType,
  locationTypeFlagsFor,
  type LocationTypeFlag,
} from "./naming";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RotateCw, Trash2, X } from "lucide-react";

type LocationTypeValue = LocationTypeFlag;

function parseOptionalInt(value: FormDataEntryValue | null): number | null {
  if (value === null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

// ---------------------------------------------------------------------------
// Draft-committing field primitives -- local input state mirrors the current
// (merged draft) value and resyncs whenever that value changes from outside
// the field (a canvas drag, undo/redo, switching selection); edits commit
// into the draft store on blur rather than firing a network request. This is
// the "adjust state during render" pattern React recommends for resetting
// controlled-input state from a prop, not a useEffect.
// ---------------------------------------------------------------------------

function DraftTextField({
  id,
  label,
  value,
  onCommit,
  required = false,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onCommit: (value: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  const [input, setInput] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setInput(value);
  }

  function commit() {
    const trimmed = input.trim();
    if (trimmed === value) return;
    if (required && !trimmed) return;
    onCommit(trimmed);
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={input}
        placeholder={placeholder}
        onChange={(e) => setInput(e.target.value)}
        onBlur={commit}
      />
    </div>
  );
}

function DraftNumberField({
  id,
  label,
  value,
  onCommit,
  nullable = false,
  min,
}: {
  id: string;
  label: string;
  value: number | null;
  onCommit: (value: number | null) => void;
  nullable?: boolean;
  min?: number;
}) {
  const [input, setInput] = useState(value === null ? "" : String(value));
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setInput(value === null ? "" : String(value));
  }

  function commit() {
    if (input.trim() === "") {
      if (nullable && value !== null) onCommit(null);
      return;
    }
    const parsed = Number(input);
    if (!Number.isFinite(parsed)) return;
    const rounded = Math.round(parsed);
    if (rounded === value) return;
    onCommit(rounded);
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onBlur={commit}
      />
    </div>
  );
}

function ZoneSelect({
  zoneTypes,
  defaultValue,
  name = "zoneId",
}: {
  zoneTypes: ZoneTypeDTO[];
  defaultValue?: number | null;
  name?: string;
}) {
  const [value, setValue] = useState<string>(
    defaultValue ? String(defaultValue) : "none",
  );

  return (
    <>
      <input type="hidden" name={name} value={value === "none" ? "" : value} />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="No zone" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No zone</SelectItem>
          {zoneTypes.map((z) => (
            <SelectItem key={z.zoneId} value={String(z.zoneId)}>
              {z.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

function LocationTypeSelect({
  defaultValue = "none",
}: {
  defaultValue?: LocationTypeValue;
}) {
  const [value, setValue] = useState<LocationTypeValue>(defaultValue);

  return (
    <div className="space-y-1.5">
      <Label htmlFor="locationType">Location type</Label>
      <input type="hidden" name="locationType" value={value} />
      <Select
        value={value}
        onValueChange={(v) => setValue(v as LocationTypeValue)}
      >
        <SelectTrigger id="locationType" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">None</SelectItem>
          <SelectItem value="racking">Racking</SelectItem>
          <SelectItem value="shelf">Shelf</SelectItem>
          <SelectItem value="floor">Floor storage</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-[11px] text-muted-foreground">
        Racking locations sharing an aisle number move and resize together on
        the canvas.
      </p>
    </div>
  );
}

export function CreateLocationPanel({
  draft,
  zoneTypes,
  onCreate,
  onClose,
  locked,
}: {
  draft: DraftGeometry;
  zoneTypes: ZoneTypeDTO[];
  onCreate: (data: LocationPatch) => void;
  onClose: () => void;
  locked: boolean;
}) {
  const [error, setError] = useState<string>();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const formData = new FormData(event.currentTarget);

    const locationCode = String(formData.get("locationCode") ?? "").trim();
    if (!locationCode) {
      setError("Location code is required.");
      return;
    }

    const physicalX = Number(formData.get("physicalX"));
    const physicalY = Number(formData.get("physicalY"));
    const physicalWidthMm = Number(formData.get("physicalWidthMm"));
    const physicalLengthMm = Number(formData.get("physicalLengthMm"));
    if (
      !Number.isFinite(physicalX) ||
      !Number.isFinite(physicalY) ||
      !Number.isFinite(physicalWidthMm) ||
      physicalWidthMm <= 0 ||
      !Number.isFinite(physicalLengthMm) ||
      physicalLengthMm <= 0
    ) {
      setError("Geometry fields must be valid numbers.");
      return;
    }
    const rotationRaw = Number(formData.get("rotationDegrees") ?? 0);
    const rotationDegrees = Number.isFinite(rotationRaw)
      ? ((Math.round(rotationRaw) % 360) + 360) % 360
      : 0;

    const typeFlag = String(
      formData.get("locationType") ?? "none",
    ) as LocationTypeFlag;

    onCreate({
      locationCode,
      zoneId: parseOptionalInt(formData.get("zoneId")),
      aisle: parseOptionalInt(formData.get("aisle")),
      bay: parseOptionalInt(formData.get("bay")),
      level: parseOptionalInt(formData.get("level")),
      row: parseOptionalInt(formData.get("row")),
      ...locationTypeFlagsFor(typeFlag),
      heightMm: parseOptionalInt(formData.get("heightMm")),
      maxWeightKg: parseOptionalInt(formData.get("maxWeightKg")),
      floorLevel: parseOptionalInt(formData.get("floorLevel")) ?? 1,
      physicalX,
      physicalY,
      physicalWidthMm,
      physicalLengthMm,
      rotationDegrees,
    });
    onClose();
  }

  return (
    <div className="flex h-full w-80 shrink-0 flex-col overflow-y-auto border-l bg-background p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">New location</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Staged as a draft -- nothing is saved until you click Save Map.
      </p>

      <fieldset disabled={locked} className="contents">
      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="locationCode">Location code</Label>
          <Input
            id="locationCode"
            name="locationCode"
            required
            placeholder="WH1-BULK-04-12-3"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="zoneId">Zone</Label>
          <ZoneSelect zoneTypes={zoneTypes} />
        </div>

        <LocationTypeSelect />

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="aisle">Aisle</Label>
            <Input id="aisle" name="aisle" type="number" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="row">Row (optional)</Label>
            <Input id="row" name="row" type="number" min={1} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="bay">Bay</Label>
            <Input id="bay" name="bay" type="number" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="level">Level</Label>
            <Input id="level" name="level" type="number" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="heightMm">Height (mm)</Label>
            <Input id="heightMm" name="heightMm" type="number" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="maxWeightKg">Max weight (kg)</Label>
            <Input id="maxWeightKg" name="maxWeightKg" type="number" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="floorLevel">Floor level</Label>
          <Input
            id="floorLevel"
            name="floorLevel"
            type="number"
            min={1}
            defaultValue={1}
          />
        </div>

        <div className="space-y-1.5 border-t pt-3">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Spatial (world grid, mm)
          </Label>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="physicalX">X (mm)</Label>
              <Input
                id="physicalX"
                name="physicalX"
                type="number"
                min={0}
                defaultValue={draft.physicalX}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="physicalY">Y (mm)</Label>
              <Input
                id="physicalY"
                name="physicalY"
                type="number"
                min={0}
                defaultValue={draft.physicalY}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="physicalWidthMm">Width (mm)</Label>
              <Input
                id="physicalWidthMm"
                name="physicalWidthMm"
                type="number"
                min={1}
                defaultValue={draft.physicalWidthMm}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="physicalLengthMm">Length (mm)</Label>
              <Input
                id="physicalLengthMm"
                name="physicalLengthMm"
                type="number"
                min={1}
                defaultValue={draft.physicalLengthMm}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rotationDegrees">Rotation (deg)</Label>
            <Input
              id="rotationDegrees"
              name="rotationDegrees"
              type="number"
              min={0}
              max={359}
              defaultValue={0}
            />
          </div>
        </div>

        {error && (
          <Alert variant="destructive" className="py-2 text-xs">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" className="w-full">
          Create location
        </Button>
      </form>
      </fieldset>
    </div>
  );
}

// Shared field body for editing one location -- used both by the
// single-selection panel and, per selection in the dropdown, by the
// multi-select panel, so both reading and editing always go through the
// exact same fields.
function LocationFields({
  location,
  zoneTypes,
  onPatch,
  onDelete,
  locked,
}: {
  location: LocationDTO;
  zoneTypes: ZoneTypeDTO[];
  onPatch: (patch: LocationPatch) => void;
  onDelete: () => void;
  locked: boolean;
}) {
  const currentType = flagsToLocationType(location);
  const isPending = location.locationId < 0;

  function handleDelete() {
    if (
      !isPending &&
      !confirm(
        `Delete location "${location.locationCode}"? This takes effect when you click Save Map.`,
      )
    )
      return;
    onDelete();
  }

  return (
    <fieldset
      disabled={locked}
      className="mt-4 space-y-3 border-0 p-0 m-0 min-w-0"
    >
      <p className="text-xs text-muted-foreground">
        {location.physicalWidthMm}mm × {location.physicalLengthMm}mm at (
        {location.physicalX}, {location.physicalY}) ·{" "}
        {location.rotationDegrees}°
      </p>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onPatch({ rotationDegrees: (location.rotationDegrees + 90) % 360 })
        }
        className="self-start text-xs"
      >
        <RotateCw className="mr-1.5 h-3.5 w-3.5" />
        Rotate 90°
      </Button>

      <DraftTextField
        id={`locationCode-${location.locationId}`}
        label="Location code"
        value={location.locationCode}
        required
        onCommit={(value) => onPatch({ locationCode: value })}
      />

      <div className="space-y-1.5">
        <Label>Zone</Label>
        <Select
          value={location.zoneId != null ? String(location.zoneId) : "none"}
          onValueChange={(val) =>
            onPatch({ zoneId: val === "none" ? null : Number(val) })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="No zone" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No zone</SelectItem>
            {zoneTypes.map((z) => (
              <SelectItem key={z.zoneId} value={String(z.zoneId)}>
                {z.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Location type</Label>
        <Select
          value={currentType}
          onValueChange={(val) =>
            onPatch(locationTypeFlagsFor(val as LocationTypeFlag))
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="racking">Racking</SelectItem>
            <SelectItem value="shelf">Shelf</SelectItem>
            <SelectItem value="floor">Floor storage</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          Racking locations sharing an aisle number move and resize together
          on the canvas.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <DraftNumberField
          id={`aisle-${location.locationId}`}
          label="Aisle"
          value={location.aisle}
          nullable
          onCommit={(v) => onPatch({ aisle: v })}
        />
        <DraftNumberField
          id={`row-${location.locationId}`}
          label="Row (optional)"
          value={location.row}
          nullable
          onCommit={(v) => onPatch({ row: v })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <DraftNumberField
          id={`bay-${location.locationId}`}
          label="Bay"
          value={location.bay}
          nullable
          onCommit={(v) => onPatch({ bay: v })}
        />
        <DraftNumberField
          id={`level-${location.locationId}`}
          label="Level"
          value={location.level}
          nullable
          onCommit={(v) => onPatch({ level: v })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <DraftNumberField
          id={`height-${location.locationId}`}
          label="Height (mm)"
          value={location.heightMm}
          nullable
          onCommit={(v) => onPatch({ heightMm: v })}
        />
        <DraftNumberField
          id={`maxWeight-${location.locationId}`}
          label="Max weight (kg)"
          value={location.maxWeightKg}
          nullable
          onCommit={(v) => onPatch({ maxWeightKg: v })}
        />
      </div>

      <div className="space-y-1.5 border-t pt-3">
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Spatial (world grid, mm)
        </Label>
        <div className="grid grid-cols-2 gap-2">
          <DraftNumberField
            id={`x-${location.locationId}`}
            label="X (mm)"
            value={location.physicalX}
            min={0}
            onCommit={(v) => v !== null && onPatch({ physicalX: v })}
          />
          <DraftNumberField
            id={`y-${location.locationId}`}
            label="Y (mm)"
            value={location.physicalY}
            min={0}
            onCommit={(v) => v !== null && onPatch({ physicalY: v })}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <DraftNumberField
            id={`w-${location.locationId}`}
            label="Width (mm)"
            value={location.physicalWidthMm}
            min={1}
            onCommit={(v) => v !== null && onPatch({ physicalWidthMm: v })}
          />
          <DraftNumberField
            id={`l-${location.locationId}`}
            label="Length (mm)"
            value={location.physicalLengthMm}
            min={1}
            onCommit={(v) => v !== null && onPatch({ physicalLengthMm: v })}
          />
        </div>
        <DraftNumberField
          id={`rot-${location.locationId}`}
          label="Rotation (deg)"
          value={location.rotationDegrees}
          min={0}
          onCommit={(v) =>
            v !== null &&
            onPatch({ rotationDegrees: ((Math.round(v) % 360) + 360) % 360 })
          }
        />
      </div>

      <div className="flex items-center space-x-2 pt-1">
        <Checkbox
          id={`isBlocked-${location.locationId}`}
          checked={location.isBlocked === true}
          onCheckedChange={(checked) =>
            onPatch({ isBlocked: checked === true })
          }
        />
        <Label
          htmlFor={`isBlocked-${location.locationId}`}
          className="text-xs font-medium leading-none cursor-pointer"
        >
          Blocked (excluded from putaway/picking)
        </Label>
      </div>

      <Button
        variant="destructive"
        onClick={handleDelete}
        className="mt-2 w-full text-xs"
      >
        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
        {isPending ? "Discard (unsaved)" : "Delete location"}
      </Button>
    </fieldset>
  );
}

export function EditLocationPanel({
  location,
  zoneTypes,
  onPatch,
  onDelete,
  onClose,
  locked,
}: {
  location: LocationDTO;
  zoneTypes: ZoneTypeDTO[];
  onPatch: (patch: LocationPatch) => void;
  onDelete: () => void;
  onClose: () => void;
  locked: boolean;
}) {
  return (
    <div className="flex h-full w-80 shrink-0 flex-col overflow-y-auto border-l bg-background p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          {location.locationCode}
          {location.locationId < 0 && (
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
              pending
            </span>
          )}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          Close
        </Button>
      </div>
      <LocationFields
        key={location.locationId}
        location={location}
        zoneTypes={zoneTypes}
        onPatch={onPatch}
        onDelete={onDelete}
        locked={locked}
      />
    </div>
  );
}

export function MultiSelectPanel({
  locations,
  zoneTypes,
  onPatch,
  onDelete,
  onClose,
  locked,
}: {
  locations: LocationDTO[];
  zoneTypes: ZoneTypeDTO[];
  onPatch: (locationId: number, patch: LocationPatch) => void;
  onDelete: (locationId: number) => void;
  onClose: () => void;
  locked: boolean;
}) {
  const [chosenId, setChosenId] = useState<number | null>(
    locations[0]?.locationId ?? null,
  );

  // If the selection set changes (e.g. one member was deleted) and the
  // previously-chosen id fell out of it, fall back to the first remaining
  // one -- adjusted during render rather than in an effect.
  const stillPresent =
    chosenId != null && locations.some((l) => l.locationId === chosenId);
  if (!stillPresent) {
    const fallback = locations[0]?.locationId ?? null;
    if (fallback !== chosenId) setChosenId(fallback);
  }

  const chosen =
    locations.find((l) => l.locationId === chosenId) ?? locations[0];

  return (
    <div className="flex h-full w-80 shrink-0 flex-col overflow-y-auto border-l bg-background p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          {locations.length} locations selected
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <X className="mr-1 h-3.5 w-3.5" />
          Close
        </Button>
      </div>

      {chosen ? (
        <>
          <div className="mt-3 space-y-1.5">
            <Label className="text-xs">Editing</Label>
            <Select
              value={String(chosen.locationId)}
              onValueChange={(val) => setChosenId(Number(val))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.locationId} value={String(l.locationId)}>
                    {l.locationCode}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <LocationFields
            key={chosen.locationId}
            location={chosen}
            zoneTypes={zoneTypes}
            onPatch={(patch) => onPatch(chosen.locationId, patch)}
            onDelete={() => onDelete(chosen.locationId)}
            locked={locked}
          />
        </>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          No locations selected.
        </p>
      )}
    </div>
  );
}

export function EmptyLocationPanel() {
  return (
    <div className="flex h-full w-80 shrink-0 flex-col items-center justify-center border-l bg-background p-5 text-center">
      <p className="text-sm font-medium text-muted-foreground">
        Create or select a location to edit.
      </p>
    </div>
  );
}
