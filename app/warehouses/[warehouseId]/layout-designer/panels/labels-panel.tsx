"use client";

import { CATEGORY_LABELS, CATEGORY_ORDER } from "@/lib/warehouse-map/feature-kinds";
import type { LabelCategoryKey } from "@/lib/warehouse-map/types";

import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tags } from "lucide-react";

// "LOCATION" plus every feature category, in the order they should list --
// locations first since they are the primary thing on the map, then features
// in the same order the Add feature menu already uses.
const LABEL_CATEGORY_ROWS: Array<{ key: LabelCategoryKey; label: string }> = [
  { key: "LOCATION", label: "Locations" },
  ...CATEGORY_ORDER.map((category) => ({
    key: category as LabelCategoryKey,
    label: CATEGORY_LABELS[category],
  })),
];

export default function LabelsPanel({
  showLabels,
  onToggleShowLabels,
  categoryVisibility,
  onToggleCategory,
}: {
  showLabels: boolean;
  onToggleShowLabels: (next: boolean) => void;
  categoryVisibility: Record<LabelCategoryKey, boolean>;
  onToggleCategory: (key: LabelCategoryKey, next: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Labels
      </Label>

      <div className="flex items-center space-x-2">
        <Checkbox
          id="show-labels"
          checked={showLabels}
          onCheckedChange={(checked) => onToggleShowLabels(checked === true)}
        />
        <Label
          htmlFor="show-labels"
          className="flex cursor-pointer items-center gap-1.5 text-xs font-medium leading-none"
        >
          <Tags className="h-3.5 w-3.5" />
          Show labels
        </Label>
      </div>

      {showLabels && (
        <div className="ml-1 flex flex-col gap-1.5 border-l pl-3">
          {LABEL_CATEGORY_ROWS.map(({ key, label }) => (
            <div key={key} className="flex items-center space-x-2">
              <Checkbox
                id={`show-labels-${key}`}
                checked={categoryVisibility[key] !== false}
                onCheckedChange={(checked) =>
                  onToggleCategory(key, checked === true)
                }
              />
              <Label
                htmlFor={`show-labels-${key}`}
                className="cursor-pointer text-xs font-normal leading-none text-muted-foreground"
              >
                {label}
              </Label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
