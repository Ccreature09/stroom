"use client";

import { useState } from "react";
import type {
  FeatureDTO,
  FeatureKindDTO,
  FeaturePatch,
  LocationDTO,
  LocationPatch,
} from "@/lib/warehouse-map/types";
import { LocationFields } from "./location-panel";
import { FeatureFields } from "./feature-panel";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RotateCw, Trash2, X } from "lucide-react";

type SelectedItem =
  | { kind: "location"; id: number; location: LocationDTO }
  | { kind: "feature"; id: number; feature: FeatureDTO };

/**
 * Right-hand panel for a mixed multi-selection (any combination of locations
 * and features, 2 or more total). The Move & Resize tool only offers moving
 * and rotating a multi-selection as a rigid group -- never a per-member
 * resize, which is ambiguous once locations and features with different
 * geometry kinds are mixed together -- so this panel is where a group-level
 * rotate lives, alongside the option to edit one member's own fields.
 */
export function MultiObjectPanel({
  locations,
  features,
  featureKinds,
  onPatchLocation,
  onDeleteLocation,
  onPatchFeature,
  onDeleteFeature,
  onRotateSelection,
  onClose,
  locked,
}: {
  locations: LocationDTO[];
  features: FeatureDTO[];
  featureKinds: FeatureKindDTO[];
  onPatchLocation: (locationId: number, patch: LocationPatch) => void;
  onDeleteLocation: (locationId: number) => void;
  onPatchFeature: (featureId: number, patch: FeaturePatch) => void;
  onDeleteFeature: (featureId: number) => void;
  onRotateSelection: (deltaDegrees: number) => void;
  onClose: () => void;
  locked: boolean;
}) {
  const items: SelectedItem[] = [
    ...locations.map(
      (location): SelectedItem => ({
        kind: "location",
        id: location.locationId,
        location,
      }),
    ),
    ...features.map(
      (feature): SelectedItem => ({ kind: "feature", id: feature.featureId, feature }),
    ),
  ];

  const [chosenKey, setChosenKey] = useState<string | null>(
    items[0] ? `${items[0].kind}:${items[0].id}` : null,
  );

  // If the selection set changes (e.g. one member was deleted, or the group
  // was rotated away entirely) and the previously-chosen item fell out of it,
  // fall back to the first remaining one -- adjusted during render rather
  // than in an effect.
  const stillPresent =
    chosenKey != null && items.some((i) => `${i.kind}:${i.id}` === chosenKey);
  if (!stillPresent) {
    const fallback = items[0] ? `${items[0].kind}:${items[0].id}` : null;
    if (fallback !== chosenKey) setChosenKey(fallback);
  }

  const chosen = items.find((i) => `${i.kind}:${i.id}` === chosenKey) ?? items[0];

  return (
    <div className="flex h-full w-80 shrink-0 flex-col overflow-y-auto border-l bg-background p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          {items.length} objects selected
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
      <p className="mt-1 text-xs text-muted-foreground">
        {locations.length} location{locations.length === 1 ? "" : "s"} ·{" "}
        {features.length} feature{features.length === 1 ? "" : "s"}
      </p>

      <fieldset disabled={locked} className="mt-4 space-y-3 border-0 p-0">
        <div className="rounded-md border bg-muted/40 p-3">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Drag any selected object on the canvas to move the whole group
            together. Resizing is not available for a multi-selection --
            rotate the group instead.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onRotateSelection(90)}
            className="mt-2 w-full justify-start text-xs"
          >
            <RotateCw className="mr-1.5 h-3.5 w-3.5" />
            Rotate group 90°
          </Button>
        </div>

        {chosen && (
          <>
            <div className="space-y-1.5 border-t pt-3">
              <Label className="text-xs">Editing</Label>
              <Select
                value={`${chosen.kind}:${chosen.id}`}
                onValueChange={(val) => setChosenKey(val)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {locations.length > 0 && (
                    <>
                      {locations.map((l) => (
                        <SelectItem
                          key={`location:${l.locationId}`}
                          value={`location:${l.locationId}`}
                        >
                          {l.locationCode}
                        </SelectItem>
                      ))}
                    </>
                  )}
                  {features.map((f) => {
                    const meta = featureKinds.find((k) => k.kind === f.kind);
                    return (
                      <SelectItem
                        key={`feature:${f.featureId}`}
                        value={`feature:${f.featureId}`}
                      >
                        {f.label || meta?.label || f.kind}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            {chosen.kind === "location" ? (
              <LocationFields
                key={chosen.id}
                location={chosen.location}
                onPatch={(patch) => onPatchLocation(chosen.id, patch)}
                onDelete={() => onDeleteLocation(chosen.id)}
                locked={locked}
              />
            ) : (
              <FeatureFields
                key={chosen.id}
                feature={chosen.feature}
                featureKinds={featureKinds}
                onPatch={(patch) => onPatchFeature(chosen.id, patch)}
                onDelete={() => onDeleteFeature(chosen.id)}
                locked={locked}
              />
            )}
          </>
        )}

        {items.length > 1 && (
          <Button
            variant="destructive"
            onClick={() => {
              if (
                !confirm(
                  `Delete all ${items.length} selected objects? This takes effect when you click Save Map.`,
                )
              )
                return;
              for (const item of items) {
                if (item.kind === "location") onDeleteLocation(item.id);
                else onDeleteFeature(item.id);
              }
            }}
            className="mt-2 w-full text-xs"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Delete all selected
          </Button>
        )}
      </fieldset>
    </div>
  );
}
