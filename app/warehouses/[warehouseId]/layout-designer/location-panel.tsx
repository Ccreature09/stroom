"use client";

import { useState, useTransition } from "react";
import type { DraftGeometry, LocationDTO, ZoneTypeDTO } from "./types";
import {
  createLocation,
  moveLocations,
  deleteLocations,
  deleteLocation,
  updateLocationDetails,
  updateLocationGeometry,
} from "./actions";

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

type LocationTypeValue = "racking" | "shelf" | "floor" | "none";

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
        Setting a type groups this location with others of the same zone + type
        -- they move and delete together.
      </p>
    </div>
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
        {draft.physicalWidthMm}mm × {draft.physicalLengthMm}mm at (
        {draft.physicalX}, {draft.physicalY})
      </p>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <input type="hidden" name="warehouseId" value={warehouseId} />
        <input type="hidden" name="hallId" value={hallId} />
        <input type="hidden" name="physicalX" value={draft.physicalX} />
        <input type="hidden" name="physicalY" value={draft.physicalY} />
        <input
          type="hidden"
          name="physicalWidthMm"
          value={draft.physicalWidthMm}
        />
        <input
          type="hidden"
          name="physicalLengthMm"
          value={draft.physicalLengthMm}
        />

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

        {error && (
          <Alert variant="destructive" className="py-2 text-xs">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? "Creating…" : "Create location"}
        </Button>
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
  const [isBlocked, setIsBlocked] = useState<boolean>(
    location.isBlocked === true,
  );
  const [isPending, startTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();

  const initialType: LocationTypeValue = location.isRacking
    ? "racking"
    : location.isShelf
      ? "shelf"
      : location.isFloorStorage
        ? "floor"
        : "none";

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
    if (
      !confirm(
        `Delete location "${location.locationCode}"? This cannot be undone.`,
      )
    )
      return;
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
    <div className="flex h-full w-80 shrink-0 flex-col overflow-y-auto border-l bg-background p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          {location.locationCode}
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
      <p className="mt-1 text-xs text-muted-foreground">
        {location.physicalWidthMm}mm × {location.physicalLengthMm}mm at (
        {location.physicalX}, {location.physicalY}) · {location.rotationDegrees}
        °
      </p>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleRotate}
        disabled={isPending}
        className="mt-2 self-start text-xs"
      >
        <RotateCw className="mr-1.5 h-3.5 w-3.5" />
        Rotate 90°
      </Button>

      <form
        key={location.locationId}
        onSubmit={handleSubmit}
        className="mt-4 space-y-3"
      >
        <input type="hidden" name="warehouseId" value={warehouseId} />
        <input type="hidden" name="locationId" value={location.locationId} />

        <div className="space-y-1.5">
          <Label htmlFor="locationCode">Location code</Label>
          <Input
            id="locationCode"
            name="locationCode"
            required
            defaultValue={location.locationCode}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="zoneId">Zone</Label>
          <ZoneSelect zoneTypes={zoneTypes} defaultValue={location.zoneId} />
        </div>

        <LocationTypeSelect defaultValue={initialType} />

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="aisle">Aisle</Label>
            <Input
              id="aisle"
              name="aisle"
              type="number"
              defaultValue={location.aisle ?? undefined}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="row">Row (optional)</Label>
            <Input
              id="row"
              name="row"
              type="number"
              min={1}
              defaultValue={location.row ?? undefined}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="bay">Bay</Label>
            <Input
              id="bay"
              name="bay"
              type="number"
              defaultValue={location.bay ?? undefined}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="level">Level</Label>
            <Input
              id="level"
              name="level"
              type="number"
              defaultValue={location.level ?? undefined}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="heightMm">Height (mm)</Label>
            <Input
              id="heightMm"
              name="heightMm"
              type="number"
              defaultValue={location.heightMm ?? undefined}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="maxWeightKg">Max weight (kg)</Label>
            <Input
              id="maxWeightKg"
              name="maxWeightKg"
              type="number"
              defaultValue={location.maxWeightKg ?? undefined}
            />
          </div>
        </div>

        <div className="flex items-center space-x-2 pt-1">
          <input
            type="hidden"
            name="isBlocked"
            value={isBlocked ? "true" : "false"}
          />
          <Checkbox
            id="isBlocked"
            checked={isBlocked}
            onCheckedChange={(checked) => setIsBlocked(checked === true)}
          />
          <Label
            htmlFor="isBlocked"
            className="text-xs font-medium leading-none cursor-pointer"
          >
            Blocked (excluded from putaway/picking)
          </Label>
        </div>

        {error && (
          <Alert variant="destructive" className="py-2 text-xs">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? "Saving…" : "Save changes"}
        </Button>
      </form>

      <Button
        variant="destructive"
        onClick={handleDelete}
        disabled={isDeleting}
        className="mt-3 w-full text-xs"
      >
        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
        {isDeleting ? "Deleting…" : "Delete location"}
      </Button>
    </div>
  );
}

export function MultiSelectPanel({
  warehouseId,
  locationIds,
  onClose,
  onDone,
}: {
  warehouseId: number;
  locationIds: number[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  function handleMove(dx: number, dy: number) {
    setError(undefined);
    startTransition(async () => {
      const result = await moveLocations(warehouseId, locationIds, dx, dy);
      if (result?.error) setError(result.error);
    });
  }

  function handleDelete() {
    if (
      !confirm(
        `Delete ${locationIds.length} selected locations? This cannot be undone.`,
      )
    )
      return;
    setError(undefined);
    startTransition(async () => {
      const result = await deleteLocations(warehouseId, locationIds);
      if (result?.error) setError(result.error);
      else onDone();
    });
  }

  return (
    <div className="flex h-full w-80 shrink-0 flex-col gap-4 border-l bg-background p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          {locationIds.length} locations selected
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

      <p className="text-xs text-muted-foreground">
        Multiple locations are selected -- only move and delete are available as
        a group action.
      </p>

      <div className="space-y-1.5">
        <Label className="text-xs">Nudge selection (500mm)</Label>
        <div className="grid grid-cols-3 gap-2">
          <div />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => handleMove(0, -500)}
          >
            ↑
          </Button>
          <div />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => handleMove(-500, 0)}
          >
            ←
          </Button>
          <div />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => handleMove(500, 0)}
          >
            →
          </Button>
          <div />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => handleMove(0, 500)}
          >
            ↓
          </Button>
          <div />
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="py-2 text-xs">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button
        variant="destructive"
        disabled={isPending}
        onClick={handleDelete}
        className="w-full text-xs"
      >
        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
        Delete {locationIds.length} locations
      </Button>
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
