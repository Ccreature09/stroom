"use client";

import type { LocationDTO, LocationPatch } from "@/lib/warehouse-map/types";
import {
  LOCATION_TYPES,
  LOCATION_TYPE_LABELS,
  parseLocationType,
} from "@/lib/warehouse-map/naming";
import { DraftNumberField, DraftTextField } from "./draft-fields";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RotateCw, Trash2 } from "lucide-react";

// Shared field body for editing one location -- used both by the
// single-selection panel and, per selection in the dropdown, by the mixed
// multi-object panel, so both reading and editing always go through the
// exact same fields.
export function LocationFields({
  location,
  onPatch,
  onDelete,
  locked,
}: {
  location: LocationDTO;
  onPatch: (patch: LocationPatch) => void;
  onDelete: () => void;
  locked: boolean;
}) {
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
        <Label>Location type</Label>
        <Select
          value={location.locationType}
          onValueChange={(val) =>
            onPatch({ locationType: parseLocationType(val) })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOCATION_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {LOCATION_TYPE_LABELS[type]}
              </SelectItem>
            ))}
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
          id={`isTemporary-${location.locationId}`}
          checked={location.isTemporary === true}
          onCheckedChange={(checked) =>
            onPatch({ isTemporary: checked === true })
          }
        />
        <Label
          htmlFor={`isTemporary-${location.locationId}`}
          className="text-xs font-medium leading-none cursor-pointer"
        >
          Temporary (staging/buffer, not permanent storage)
        </Label>
      </div>

      <div className="flex items-center space-x-2">
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
  onPatch,
  onDelete,
  onClose,
  locked,
}: {
  location: LocationDTO;
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
        onPatch={onPatch}
        onDelete={onDelete}
        locked={locked}
      />
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
