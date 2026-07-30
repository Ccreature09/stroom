"use client";

import { useState } from "react";
import type { FeatureDTO, FeatureKindDTO, FeaturePatch, ZoneTypeDTO } from "@/lib/warehouse-map/types";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  attrSpecsFor,
  type AttrSpec,
  type FeatureAttrs,
  type FeatureCategory,
} from "@/lib/warehouse-map/feature-kinds";
import { DraftNumberField, DraftTextField } from "./draft-fields";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RotateCw, Trash2, X } from "lucide-react";

function groupKindsByCategory(kinds: FeatureKindDTO[]) {
  const groups = new Map<FeatureCategory, FeatureKindDTO[]>();
  for (const kind of kinds) {
    const existing = groups.get(kind.category) ?? [];
    existing.push(kind);
    groups.set(kind.category, existing);
  }
  return CATEGORY_ORDER.filter((c) => groups.has(c)).map((category) => ({
    category,
    kinds: groups.get(category)!,
  }));
}

/**
 * Renders one attribute field from its spec. The spec is the same object the
 * server validates against, so the panel can never offer a value the server
 * will reject.
 */
function AttrField({
  spec,
  featureId,
  attrs,
  onChange,
}: {
  spec: AttrSpec;
  featureId: number;
  attrs: FeatureAttrs;
  onChange: (next: FeatureAttrs) => void;
}) {
  const current = attrs[spec.key];
  const id = `attr-${spec.key}-${featureId}`;

  function commit(value: string | number | boolean | undefined) {
    const next = { ...attrs };
    if (value === undefined || value === "") delete next[spec.key];
    else next[spec.key] = value;
    onChange(next);
  }

  const hint = spec.hint ? (
    <p className="text-[11px] leading-snug text-muted-foreground">{spec.hint}</p>
  ) : null;

  switch (spec.type) {
    case "string":
      return (
        <div className="space-y-1.5">
          <DraftTextField
            id={id}
            label={spec.label}
            value={typeof current === "string" ? current : ""}
            placeholder={spec.placeholder}
            onCommit={(v) => commit(v)}
          />
          {hint}
        </div>
      );
    case "int":
      return (
        <div className="space-y-1.5">
          <DraftNumberField
            id={id}
            label={spec.label}
            value={typeof current === "number" ? current : null}
            nullable
            min={spec.min}
            max={spec.max}
            onCommit={(v) => commit(v ?? undefined)}
          />
          {hint}
        </div>
      );
    case "bool":
      return (
        <div className="space-y-1.5">
          <div className="flex items-center space-x-2">
            <Checkbox
              id={id}
              checked={current === true}
              onCheckedChange={(checked) => commit(checked === true)}
            />
            <Label
              htmlFor={id}
              className="cursor-pointer text-xs font-medium leading-none"
            >
              {spec.label}
            </Label>
          </div>
          {hint}
        </div>
      );
    case "enum":
      return (
        <div className="space-y-1.5">
          <Label htmlFor={id}>{spec.label}</Label>
          <Select
            value={typeof current === "string" ? current : ""}
            onValueChange={(v) => commit(v)}
          >
            <SelectTrigger id={id} className="w-full">
              <SelectValue placeholder="Not set" />
            </SelectTrigger>
            <SelectContent>
              {spec.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hint}
        </div>
      );
  }
}

/**
 * Shown after a rectangle is dragged out with the Feature tool: pick what the
 * shape *is*. The chosen kind supplies the geometry kind, default height and
 * obstacle flag, so a wall becomes a polyline and a column a rectangle
 * without the user thinking about geometry at all.
 */
export function CreateFeaturePanel({
  featureKinds,
  onCreate,
  onClose,
  locked,
}: {
  featureKinds: FeatureKindDTO[];
  onCreate: (kind: FeatureKindDTO) => void;
  onClose: () => void;
  locked: boolean;
}) {
  const grouped = groupKindsByCategory(featureKinds);
  const [selectedKind, setSelectedKind] = useState<string>(
    featureKinds[0]?.kind ?? "",
  );
  const chosen = featureKinds.find((k) => k.kind === selectedKind);

  return (
    <div className="flex h-full w-80 shrink-0 flex-col overflow-y-auto border-l bg-background p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">New feature</h2>
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

      <fieldset disabled={locked} className="mt-4 space-y-3 border-0 p-0">
        <div className="space-y-1.5">
          <Label htmlFor="featureKind">Feature type</Label>
          <Select value={selectedKind} onValueChange={setSelectedKind}>
            <SelectTrigger id="featureKind" className="w-full">
              <SelectValue placeholder="Pick a type" />
            </SelectTrigger>
            <SelectContent>
              {grouped.map(({ category, kinds }) => (
                <SelectGroup key={category}>
                  <SelectLabel>{CATEGORY_LABELS[category]}</SelectLabel>
                  {kinds.map((kind) => (
                    <SelectItem key={kind.kind} value={kind.kind}>
                      {kind.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>

        {chosen && (
          <div className="rounded-md border bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-3 w-3 shrink-0 rounded-sm"
                style={{ backgroundColor: chosen.defaultColor }}
              />
              <span className="font-medium text-foreground">
                {chosen.label}
              </span>
            </div>
            <p className="mt-1.5">
              Drawn as {chosen.defaultGeometryKind.toLowerCase()}
              {chosen.defaultHeightMm != null &&
                ` · ${chosen.defaultHeightMm}mm tall`}
              {chosen.isObstacleDefault
                ? " · blocks travel"
                : " · does not block travel"}
              .
            </p>
          </div>
        )}

        <Button
          type="button"
          className="w-full"
          disabled={!chosen}
          onClick={() => chosen && onCreate(chosen)}
        >
          Create feature
        </Button>
      </fieldset>
    </div>
  );
}

export function EditFeaturePanel({
  feature,
  featureKinds,
  zoneTypes,
  onPatch,
  onDelete,
  onClose,
  locked,
}: {
  feature: FeatureDTO;
  featureKinds: FeatureKindDTO[];
  zoneTypes: ZoneTypeDTO[];
  onPatch: (patch: FeaturePatch) => void;
  onDelete: () => void;
  onClose: () => void;
  locked: boolean;
}) {
  const meta = featureKinds.find((k) => k.kind === feature.kind);
  const specs = attrSpecsFor(feature.kind);
  const isPending = feature.featureId < 0;
  const isRectLike =
    feature.geometryKind === "RECT" || feature.geometryKind === "CIRCLE";

  function handleDelete() {
    if (
      !isPending &&
      !confirm(
        `Delete this ${meta?.label ?? feature.kind}? This takes effect when you click Save Map.`,
      )
    )
      return;
    onDelete();
  }

  return (
    <div className="flex h-full w-80 shrink-0 flex-col overflow-y-auto border-l bg-background p-5">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <span
            className="inline-block h-3 w-3 shrink-0 rounded-sm"
            style={{
              backgroundColor:
                feature.color ?? meta?.defaultColor ?? "#64748b",
            }}
          />
          {feature.label || meta?.label || feature.kind}
          {isPending && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
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
          <X className="mr-1 h-3.5 w-3.5" />
          Close
        </Button>
      </div>

      <fieldset
        disabled={locked}
        className="mt-4 min-w-0 space-y-3 border-0 p-0"
      >
        <p className="text-xs text-muted-foreground">
          {meta?.label ?? feature.kind} · {feature.geometryKind.toLowerCase()} ·{" "}
          {feature.widthMm}mm × {feature.lengthMm}mm at ({feature.originXMm},{" "}
          {feature.originYMm}) · {feature.rotationDegrees}°
        </p>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onPatch({ rotationDegrees: (feature.rotationDegrees + 90) % 360 })
          }
          className="self-start text-xs"
        >
          <RotateCw className="mr-1.5 h-3.5 w-3.5" />
          Rotate 90°
        </Button>

        <DraftTextField
          id={`feature-label-${feature.featureId}`}
          label="Label"
          value={feature.label ?? ""}
          placeholder={meta?.label ?? feature.kind}
          onCommit={(v) => onPatch({ label: v || null })}
        />

        <div className="space-y-1.5">
          <Label>Zone</Label>
          <Select
            value={feature.zoneId != null ? String(feature.zoneId) : "none"}
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

        {specs.length > 0 && (
          <div className="space-y-3 border-t pt-3">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {meta?.label ?? feature.kind} details
            </Label>
            {specs.map((spec) => (
              <AttrField
                key={spec.key}
                spec={spec}
                featureId={feature.featureId}
                attrs={feature.attrs}
                onChange={(next) => onPatch({ attrs: next })}
              />
            ))}
          </div>
        )}

        <div className="space-y-3 border-t pt-3">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Vertical extent
          </Label>
          <div className="grid grid-cols-2 gap-2">
            <DraftNumberField
              id={`feature-elev-${feature.featureId}`}
              label="Base (mm)"
              value={feature.elevationMm}
              min={0}
              onCommit={(v) => v !== null && onPatch({ elevationMm: v })}
            />
            <DraftNumberField
              id={`feature-height-${feature.featureId}`}
              label="Height (mm)"
              value={feature.heightMm}
              nullable
              min={0}
              onCommit={(v) => onPatch({ heightMm: v })}
            />
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Occupies {feature.elevationMm}mm to{" "}
            {feature.heightMm != null
              ? `${feature.elevationMm + feature.heightMm}mm`
              : "the hall's clear height"}
            . A conveyor raised above head height does not obstruct anyone
            walking under it.
          </p>
        </div>

        <div className="space-y-1.5 border-t pt-3">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Spatial (world grid, mm)
          </Label>
          <div className="grid grid-cols-2 gap-2">
            <DraftNumberField
              id={`feature-x-${feature.featureId}`}
              label="X (mm)"
              value={feature.originXMm}
              onCommit={(v) => v !== null && onPatch({ originXMm: v })}
            />
            <DraftNumberField
              id={`feature-y-${feature.featureId}`}
              label="Y (mm)"
              value={feature.originYMm}
              onCommit={(v) => v !== null && onPatch({ originYMm: v })}
            />
          </div>
          {isRectLike && (
            <div className="grid grid-cols-2 gap-2">
              <DraftNumberField
                id={`feature-w-${feature.featureId}`}
                label="Width (mm)"
                value={feature.widthMm}
                min={1}
                onCommit={(v) => v !== null && onPatch({ widthMm: v })}
              />
              <DraftNumberField
                id={`feature-l-${feature.featureId}`}
                label="Length (mm)"
                value={feature.lengthMm}
                min={1}
                onCommit={(v) => v !== null && onPatch({ lengthMm: v })}
              />
            </div>
          )}
          <DraftNumberField
            id={`feature-rot-${feature.featureId}`}
            label="Rotation (deg)"
            value={feature.rotationDegrees}
            min={0}
            max={359}
            onCommit={(v) =>
              v !== null &&
              onPatch({ rotationDegrees: ((Math.round(v) % 360) + 360) % 360 })
            }
          />
          <DraftNumberField
            id={`feature-floor-${feature.featureId}`}
            label="Floor level"
            value={feature.floorLevel}
            min={1}
            onCommit={(v) => v !== null && onPatch({ floorLevel: v })}
          />
          <DraftNumberField
            id={`feature-layer-${feature.featureId}`}
            label="Draw order"
            value={feature.layerIndex}
            onCommit={(v) => v !== null && onPatch({ layerIndex: v })}
          />
        </div>

        <div className="space-y-2 border-t pt-3">
          <div className="flex items-center space-x-2">
            <Checkbox
              id={`feature-obstacle-${feature.featureId}`}
              checked={feature.isObstacle}
              onCheckedChange={(checked) =>
                onPatch({ isObstacle: checked === true })
              }
            />
            <Label
              htmlFor={`feature-obstacle-${feature.featureId}`}
              className="cursor-pointer text-xs font-medium leading-none"
            >
              Blocks travel
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id={`feature-visual-${feature.featureId}`}
              checked={feature.isVisualOnly}
              onCheckedChange={(checked) =>
                onPatch({ isVisualOnly: checked === true })
              }
            />
            <Label
              htmlFor={`feature-visual-${feature.featureId}`}
              className="cursor-pointer text-xs font-medium leading-none"
            >
              Annotation only (never affects logic)
            </Label>
          </div>
        </div>

        <Button
          variant="destructive"
          onClick={handleDelete}
          className="mt-2 w-full text-xs"
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          {isPending ? "Discard (unsaved)" : "Delete feature"}
        </Button>
      </fieldset>
    </div>
  );
}
