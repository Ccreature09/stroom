"use client";

import { useState } from "react";
import type {
  HallDTO,
  HallPatch,
  LabelCategoryKey,
  LocationDTO,
  NavGraphDTO,
  RoutingVehicleDTO,
  UnderlayDTO,
} from "@/lib/warehouse-map/types";
import UnderlayPanel from "./underlay-panel";
import NavGraphPanel from "./nav-graph-panel";
import RoutePanel from "./route-panel";
import LabelsPanel from "./labels-panel";
import type { RoutePreview } from "@/lib/warehouse-map/routing-server";
import type { Tool } from "./layout-designer-canvas";
import { DraftTextField } from "./draft-fields";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Undo2, Redo2, Layers } from "lucide-react";

import { BulkGenerateDialog, type BulkGeneratorKind } from "./bulk-generator-dialog";
import type { Point } from "@/lib/warehouse-map/geometry";
import { Separator } from "@/components/ui/separator";

// The collapsible left panel -- hall property editing and the
// underlay/nav-graph/route sub-panels. Hall navigation, the drawing-tool
// switcher, and Save Map now live in the sticky LayoutTopBar (layout-top-bar.tsx)
// above this; every prop here still comes straight from layout-designer.tsx.
export default function HallToolbar({
  warehouseId,
  halls,
  selectedHallId,
  tool,
  onToolChange,
  hallDraft,
  onHallFieldChange,
  canUndoHall,
  canRedoHall,
  onUndoHall,
  onRedoHall,
  locked,
  underlay,
  measuredMm,
  onClearMeasurement,
  navGraph,
  showNavGraph,
  onToggleNavGraph,
  routingVehicles,
  selectedLocations,
  selectedFeatureCount,
  routePreview,
  onRoutePreview,
  onClearRoute,
  multiSelectMode,
  onToggleMultiSelect,
  onClearSelection,
  showBulkGenerate,
  onShowBulkGenerateChange,
  bulkGenStartPoints,
  onRequestBulkGenPick,
  collapsed,
  showLabels,
  onToggleShowLabels,
  labelCategoryVisibility,
  onToggleLabelCategory,
}: {
  warehouseId: number;
  halls: HallDTO[];
  selectedHallId: number;
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  hallDraft: HallPatch;
  onHallFieldChange: (
    field: keyof HallPatch,
    value: HallPatch[keyof HallPatch],
  ) => void;
  canUndoHall: boolean;
  canRedoHall: boolean;
  onUndoHall: () => void;
  onRedoHall: () => void;
  locked: boolean;
  underlay: UnderlayDTO | null;
  measuredMm: number | null;
  onClearMeasurement: () => void;
  navGraph: NavGraphDTO;
  showNavGraph: boolean;
  onToggleNavGraph: (next: boolean) => void;
  routingVehicles: RoutingVehicleDTO[];
  selectedLocations: LocationDTO[];
  selectedFeatureCount: number;
  routePreview: RoutePreview | null;
  onRoutePreview: (result: RoutePreview | null) => void;
  onClearRoute: () => void;
  multiSelectMode: boolean;
  onToggleMultiSelect: () => void;
  onClearSelection: () => void;
  showBulkGenerate: boolean;
  onShowBulkGenerateChange: (open: boolean) => void;
  bulkGenStartPoints: Record<BulkGeneratorKind, Point | null>;
  onRequestBulkGenPick: (kind: BulkGeneratorKind) => void;
  collapsed: boolean;
  showLabels: boolean;
  onToggleShowLabels: (next: boolean) => void;
  labelCategoryVisibility: Record<LabelCategoryKey, boolean>;
  onToggleLabelCategory: (key: LabelCategoryKey, next: boolean) => void;
}) {
  const selectedHall =
    halls.find((h) => h.hallId === selectedHallId) ?? halls[0];

  return (
    <div
      className={
        collapsed
          ? "w-0 shrink-0 overflow-hidden border-r-0 transition-all duration-200"
          : "flex w-72 shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r bg-background/70 p-4 transition-all duration-200"
      }
    >
      {/*
        No fixed width here: the outer div's w-72 already includes its own
        padding/border in its box (border-box), so this inner column's
        available width is w-72 minus that padding -- roughly 255px, not 288.
        A hardcoded w-72 on this child ignored the parent's padding entirely
        and made every field in the sidebar render ~33px too wide, bleeding
        past the border into the canvas. flex-col's default align-items:
        stretch sizes this correctly on its own; min-w-0 keeps long
        unbreakable content (a wide Select, an untruncated label) from
        re-expanding it.
      */}
      <div className="flex min-w-0 w-full flex-1 flex-col gap-5">
        {/* Disabled as a whole while a save is in flight, so no dispatch can
            land between the snapshot Save Map took and RESET_ALL clearing
            it -- the root cause of the discarded-concurrent-edit bug. */}
        <fieldset disabled={locked} className="contents">
        {/* Hall Properties Group */}
        <HallPropertiesFields
          hall={selectedHall}
          draft={hallDraft}
          onFieldChange={onHallFieldChange}
          canUndo={canUndoHall}
          canRedo={canRedoHall}
          onUndo={onUndoHall}
          onRedo={onRedoHall}
        />
        <Separator />
        <UnderlayPanel
          warehouseId={warehouseId}
          hall={selectedHall}
          underlay={underlay}
          measuredMm={measuredMm}
          onClearMeasurement={onClearMeasurement}
          isMeasuring={tool === "measure"}
          onToggleMeasure={() =>
            onToolChange(tool === "measure" ? "select" : "measure")
          }
          locked={locked}
        />

        <NavGraphPanel
          warehouseId={warehouseId}
          hall={selectedHall}
          navGraph={navGraph}
          showNavGraph={showNavGraph}
          onToggleShow={onToggleNavGraph}
          locked={locked}
        />

        <RoutePanel
          warehouseId={warehouseId}
          hallId={selectedHall.hallId}
          selectedLocations={selectedLocations}
          selectedFeatureCount={selectedFeatureCount}
          vehicles={routingVehicles}
          hasGraph={navGraph.nodes.length > 0}
          preview={routePreview}
          onPreview={onRoutePreview}
          onClear={onClearRoute}
          multiSelectMode={multiSelectMode}
          onToggleMultiSelect={onToggleMultiSelect}
          onClearSelection={onClearSelection}
          locked={locked}
        />

        <Separator />
        <LabelsPanel
          showLabels={showLabels}
          onToggleShowLabels={onToggleShowLabels}
          categoryVisibility={labelCategoryVisibility}
          onToggleCategory={onToggleLabelCategory}
        />

        <div className="flex flex-col gap-2">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Bulk Generate
          </Label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onShowBulkGenerateChange(true)}
            className="w-full justify-start text-xs"
          >
            <Layers className="mr-1.5 h-3.5 w-3.5" />
            Rackings / floor lines / shelving
          </Button>
        </div>
        {showBulkGenerate && (
          <BulkGenerateDialog
            warehouseId={warehouseId}
            hall={halls.find((h) => h.hallId === selectedHallId) ?? halls[0]}
            open={showBulkGenerate}
            onOpenChange={onShowBulkGenerateChange}
            startPoints={bulkGenStartPoints}
            onRequestPick={onRequestBulkGenPick}
          />
        )}
        </fieldset>
      </div>
    </div>
  );
}

function HallPropertiesFields({
  hall,
  draft,
  onFieldChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  hall: HallDTO;
  draft: HallPatch;
  onFieldChange: (
    field: keyof HallPatch,
    value: HallPatch[keyof HallPatch],
  ) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const nameValue = draft.name ?? hall.name;
  const widthValue = draft.physicalWidthMm ?? hall.physicalWidthMm;
  const lengthValue = draft.physicalLengthMm ?? hall.physicalLengthMm;
  const clearHeightValue =
    draft.clearHeightMm !== undefined
      ? draft.clearHeightMm
      : (hall.clearHeightMm ?? 0);
  const isActiveValue = draft.isActive ?? hall.isActive ?? true;

  const [widthInput, setWidthInput] = useState(String(widthValue));
  const [lengthInput, setLengthInput] = useState(String(lengthValue));
  const [clearHeightInput, setClearHeightInput] = useState(
    String(clearHeightValue ?? ""),
  );

  // Resync local text whenever the merged (committed + draft) value changes
  // from outside this input -- hall switch, undo/redo, or our own commit.
  // Adjusted directly during render (React's documented pattern for this)
  // rather than in an effect, so it takes effect in the same render pass.
  const [prevWidthValue, setPrevWidthValue] = useState(widthValue);
  if (widthValue !== prevWidthValue) {
    setPrevWidthValue(widthValue);
    setWidthInput(String(widthValue));
  }
  const [prevLengthValue, setPrevLengthValue] = useState(lengthValue);
  if (lengthValue !== prevLengthValue) {
    setPrevLengthValue(lengthValue);
    setLengthInput(String(lengthValue));
  }
  const [prevClearHeightValue, setPrevClearHeightValue] =
    useState(clearHeightValue);
  if (clearHeightValue !== prevClearHeightValue) {
    setPrevClearHeightValue(clearHeightValue);
    setClearHeightInput(String(clearHeightValue ?? ""));
  }

  function commitPositiveInt(
    field: "physicalWidthMm" | "physicalLengthMm",
    raw: string,
    current: number,
  ) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    if (Math.round(parsed) === current) return;
    onFieldChange(field, Math.round(parsed));
  }

  function commitClearHeight(raw: string, current: number | null) {
    if (raw.trim() === "") {
      if (current !== null) onFieldChange("clearHeightMm", null);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    if (Math.round(parsed) === current) return;
    onFieldChange("clearHeightMm", Math.round(parsed));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Hall Properties
        </Label>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="Undo"
            disabled={!canUndo}
            onClick={onUndo}
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="Redo"
            disabled={!canRedo}
            onClick={onRedo}
          >
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <DraftTextField
        id="hall-name"
        label="Name"
        value={nameValue}
        required
        onCommit={(value) => onFieldChange("name", value)}
      />

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="hall-width" className="text-[11px]">
            Width (mm)
          </Label>
          <Input
            id="hall-width"
            type="number"
            min={1}
            value={widthInput}
            onChange={(e) => setWidthInput(e.target.value)}
            onBlur={() =>
              commitPositiveInt("physicalWidthMm", widthInput, widthValue)
            }
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="hall-length" className="text-[11px]">
            Length (mm)
          </Label>
          <Input
            id="hall-length"
            type="number"
            min={1}
            value={lengthInput}
            onChange={(e) => setLengthInput(e.target.value)}
            onBlur={() =>
              commitPositiveInt("physicalLengthMm", lengthInput, lengthValue)
            }
            className="h-8 text-xs"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="hall-clear-height" className="text-[11px]">
          Clear height (mm)
        </Label>
        <Input
          id="hall-clear-height"
          type="number"
          min={1}
          value={clearHeightInput}
          onChange={(e) => setClearHeightInput(e.target.value)}
          onBlur={() => commitClearHeight(clearHeightInput, clearHeightValue)}
          className="h-8 text-xs"
        />
      </div>

      <div className="flex items-center space-x-2 pt-1">
        <Checkbox
          id="hall-is-active"
          checked={isActiveValue}
          onCheckedChange={(checked) =>
            onFieldChange("isActive", checked === true)
          }
        />
        <Label
          htmlFor="hall-is-active"
          className="text-xs font-medium leading-none cursor-pointer"
        >
          Active
        </Label>
      </div>
    </div>
  );
}

