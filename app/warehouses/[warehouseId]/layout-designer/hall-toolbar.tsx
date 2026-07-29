"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cssColorForZone } from "./types";
import type {
  HallDTO,
  HallPatch,
  LayoutVersionDTO,
  LocationDTO,
  NavGraphDTO,
  RoutingVehicleDTO,
  UnderlayDTO,
  ZonePatch,
  ZoneTypeDTO,
} from "./types";
import UnderlayPanel from "./underlay-panel";
import NavGraphPanel from "./nav-graph-panel";
import RoutePanel from "./route-panel";
import type { RoutePreview } from "./routing-actions";
import type { Tool } from "./layout-designer-canvas";
import { createHall } from "./actions";

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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Plus,
  Check,
  MousePointer,
  Hand,
  Move,
  SquarePlus,
  Blocks,
  Layers,
  Undo2,
  Redo2,
  Pencil,
  Trash2,
} from "lucide-react";

import { BulkGenerateDialog } from "./bulk-generator-dialog";
import { Separator } from "@/components/ui/separator";

export default function HallToolbar({
  warehouseId,
  halls,
  selectedHallId,
  zoneTypes,
  tool,
  onToolChange,
  hallDraft,
  onHallFieldChange,
  canUndoHall,
  canRedoHall,
  onUndoHall,
  onRedoHall,
  onSaveMap,
  isSavingMap,
  pendingCount,
  onCreateZone,
  onPatchZone,
  onDeleteZone,
  locked,
  currentVersionNumber,
  versionHistory,
  draftSaveState,
  underlay,
  measuredMm,
  onClearMeasurement,
  navGraph,
  showNavGraph,
  onToggleNavGraph,
  routingVehicles,
  selectedLocations,
  routePreview,
  onRoutePreview,
  onClearRoute,
}: {
  warehouseId: number;
  halls: HallDTO[];
  selectedHallId: number;
  zoneTypes: ZoneTypeDTO[];
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
  onSaveMap: () => void;
  isSavingMap: boolean;
  pendingCount: number;
  onCreateZone: (data: ZonePatch) => void;
  onPatchZone: (zoneId: number, patch: ZonePatch) => void;
  onDeleteZone: (zoneId: number) => void;
  locked: boolean;
  currentVersionNumber: number;
  versionHistory: LayoutVersionDTO[];
  draftSaveState: "idle" | "saving" | "saved" | "error";
  underlay: UnderlayDTO | null;
  measuredMm: number | null;
  onClearMeasurement: () => void;
  navGraph: NavGraphDTO;
  showNavGraph: boolean;
  onToggleNavGraph: (next: boolean) => void;
  routingVehicles: RoutingVehicleDTO[];
  selectedLocations: LocationDTO[];
  routePreview: RoutePreview | null;
  onRoutePreview: (result: RoutePreview | null) => void;
  onClearRoute: () => void;
}) {
  const router = useRouter();
  const [showNewHall, setShowNewHall] = useState(false);
  const [showNewZone, setShowNewZone] = useState(false);
  const [editingZone, setEditingZone] = useState<ZoneTypeDTO | null>(null);
  const [showBulkGenerate, setShowBulkGenerate] = useState(false);
  const [savedMessage, setSavedMessage] = useState(false);
  const wasSavingRef = useRef(false);

  useEffect(() => {
    if (wasSavingRef.current && !isSavingMap) {
      setSavedMessage(true);
      const timeout = setTimeout(() => setSavedMessage(false), 2000);
      return () => clearTimeout(timeout);
    }
    wasSavingRef.current = isSavingMap;
  }, [isSavingMap]);

  const selectedHall =
    halls.find((h) => h.hallId === selectedHallId) ?? halls[0];

  function handleDeleteZone(zone: ZoneTypeDTO) {
    onDeleteZone(zone.zoneId);
  }

  return (
    <div className="flex w-64 shrink-0 flex-col overflow-y-auto border-r bg-background/70 p-4">
      <div className="flex flex-1 flex-col gap-5">
        {/* Disabled as a whole while a save is in flight, so no dispatch can
            land between the snapshot Save Map took and RESET_ALL clearing
            it -- the root cause of the discarded-concurrent-edit bug. */}
        <fieldset disabled={locked} className="contents">
        {/* Hall Selection Group */}
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Active Hall
          </Label>
          <Select
            value={String(selectedHallId)}
            onValueChange={(val) =>
              router.push(
                `/warehouses/${warehouseId}/layout-designer?hall=${val}`,
              )
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select hall" />
            </SelectTrigger>
            <SelectContent>
              {halls.map((h) => (
                <SelectItem key={h.hallId} value={String(h.hallId)}>
                  {h.name}
                  {h.isActive === false ? " (inactive)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowNewHall(true)}
            className="w-full justify-start text-xs"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New Hall
          </Button>
        </div>
        <Separator />
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
        {/* Tools Group */}
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Tools
          </Label>
          <div className="flex flex-col gap-1 rounded-lg border bg-card p-1">
            <Button
              variant={tool === "select" ? "default" : "ghost"}
              size="sm"
              onClick={() => onToolChange("select")}
              className="justify-start text-xs font-medium"
            >
              <MousePointer className="mr-2 h-3.5 w-3.5" />
              Select
            </Button>
            <Button
              variant={tool === "pan" ? "default" : "ghost"}
              size="sm"
              onClick={() => onToolChange("pan")}
              className="justify-start text-xs font-medium"
            >
              <Hand className="mr-2 h-3.5 w-3.5" />
              Pan
            </Button>
            <Button
              variant={tool === "transform" ? "default" : "ghost"}
              size="sm"
              onClick={() => onToolChange("transform")}
              className="justify-start text-xs font-medium"
            >
              <Move className="mr-2 h-3.5 w-3.5" />
              Move &amp; Resize
            </Button>
            <Button
              variant={tool === "draw" ? "default" : "ghost"}
              size="sm"
              onClick={() => onToolChange("draw")}
              className="justify-start text-xs font-medium"
            >
              <SquarePlus className="mr-2 h-3.5 w-3.5" />
              Add location
            </Button>
            <Button
              variant={tool === "feature" ? "default" : "ghost"}
              size="sm"
              onClick={() => onToolChange("feature")}
              className="justify-start text-xs font-medium"
            >
              <Blocks className="mr-2 h-3.5 w-3.5" />
              Add feature
            </Button>
          </div>
          {tool === "feature" && (
            <p className="px-1 text-[11px] leading-snug text-muted-foreground">
              Drag out an area, then pick what it is -- walls, columns, docks,
              staging, workstations, hazard areas.
            </p>
          )}
        </div>
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
          vehicles={routingVehicles}
          hasGraph={navGraph.nodes.length > 0}
          preview={routePreview}
          onPreview={onRoutePreview}
          onClear={onClearRoute}
          locked={locked}
        />

        <div className="flex flex-col gap-2">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Bulk Generate
          </Label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowBulkGenerate(true)}
            className="w-full justify-start text-xs"
          >
            <Layers className="mr-1.5 h-3.5 w-3.5" />
            Rackings / floor lines / shelving
          </Button>
        </div>
        <Separator></Separator>
        {/* Zones Group */}
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Zones
          </Label>
          <div className="flex flex-col gap-2">
            {zoneTypes.map((z) => (
              <div
                key={z.zoneId}
                className="flex items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground"
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: cssColorForZone(z) }}
                />
                <span className="truncate flex-1">
                  {z.name}
                  {z.zoneId < 0 && (
                    <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium text-amber-700">
                      pending
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setEditingZone(z)}
                  className="text-muted-foreground hover:text-foreground"
                  title="Edit zone"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteZone(z)}
                  className="text-muted-foreground hover:text-destructive"
                  title="Delete zone"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowNewZone(true)}
              className="w-full justify-start border-dashed text-xs text-muted-foreground hover:text-foreground"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New Zone
            </Button>
          </div>
        </div>
        {showBulkGenerate && (
          <BulkGenerateDialog
            warehouseId={warehouseId}
            hall={halls.find((h) => h.hallId === selectedHallId) ?? halls[0]}
            zoneTypes={zoneTypes}
            open={showBulkGenerate}
            onOpenChange={setShowBulkGenerate}
          />
        )}
        </fieldset>
      </div>

      {/* Publish: version state, autosave status, then Save Map */}
      <div className="mt-6 space-y-2 border-t pt-4">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span
            title={
              versionHistory[0]?.publishedAt
                ? `Published ${new Date(versionHistory[0].publishedAt).toLocaleString()}${
                    versionHistory[0].publishedByName
                      ? ` by ${versionHistory[0].publishedByName}`
                      : ""
                  }`
                : "This layout has never been published."
            }
          >
            {currentVersionNumber > 0
              ? `Layout v${currentVersionNumber}`
              : "Unpublished layout"}
          </span>

          {/* Autosave is about the *draft*, not the published layout -- the
              wording keeps those separate so nobody reads "Draft saved" as
              "the map is live". */}
          <span
            className={
              draftSaveState === "error"
                ? "font-medium text-destructive"
                : undefined
            }
          >
            {draftSaveState === "saving" && "Saving draft…"}
            {draftSaveState === "saved" && "Draft saved"}
            {draftSaveState === "error" && "Draft not synced"}
          </span>
        </div>

        <Button
          onClick={onSaveMap}
          disabled={isSavingMap || pendingCount === 0}
          className="w-full text-xs font-semibold"
        >
          {isSavingMap ? (
            "Saving..."
          ) : savedMessage ? (
            <span className="flex items-center gap-1">
              <Check className="h-4 w-4" /> Map Saved!
            </span>
          ) : pendingCount > 0 ? (
            `Save Map (${pendingCount})`
          ) : (
            "Save Map"
          )}
        </Button>
      </div>

      {showNewHall && (
        <NewHallDialog
          warehouseId={warehouseId}
          open={showNewHall}
          onOpenChange={setShowNewHall}
        />
      )}
      {showNewZone && (
        <NewZoneDialog
          open={showNewZone}
          onOpenChange={setShowNewZone}
          onCreateZone={onCreateZone}
        />
      )}
      {editingZone && (
        <EditZoneDialog
          zone={editingZone}
          open={Boolean(editingZone)}
          onOpenChange={(open) => {
            if (!open) setEditingZone(null);
          }}
          onPatchZone={onPatchZone}
        />
      )}
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

function NewHallDialog({
  warehouseId,
  open,
  onOpenChange,
}: {
  warehouseId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">New hall</DialogTitle>
        </DialogHeader>
        <form action={createHall} className="space-y-3 pt-2">
          <input type="hidden" name="warehouseId" value={warehouseId} />
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              required
              placeholder="Hall B - Cold Storage"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="physicalWidthMm">Width (mm)</Label>
              <Input
                id="physicalWidthMm"
                name="physicalWidthMm"
                type="number"
                min={1}
                defaultValue={80_000}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="physicalLengthMm">Length (mm)</Label>
              <Input
                id="physicalLengthMm"
                name="physicalLengthMm"
                type="number"
                min={1}
                defaultValue={60_000}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="clearHeightMm">Clear height (mm)</Label>
            <Input
              id="clearHeightMm"
              name="clearHeightMm"
              type="number"
              min={1}
              defaultValue={12_000}
            />
          </div>
          <Button type="submit" className="w-full pt-2">
            Create hall
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const DEFAULT_ZONE_COLOR = "#2563eb";

type ZoneFormDefaults = Partial<{
  name: string;
  isPickable: boolean | null;
  isTemperatureControlled: boolean | null;
  requiresHazmatClearance: boolean | null;
  requiresBarcodeScan: boolean | null;
  storagePermanence: string;
  color: string | null;
}>;

function ZoneFormFields({
  namePrefix,
  defaults,
}: {
  namePrefix: string;
  defaults: ZoneFormDefaults;
}) {
  const [isPickable, setIsPickable] = useState(defaults.isPickable ?? true);
  const [requiresBarcodeScan, setRequiresBarcodeScan] = useState(
    defaults.requiresBarcodeScan ?? true,
  );
  const [isTemperatureControlled, setIsTemperatureControlled] = useState(
    defaults.isTemperatureControlled ?? false,
  );
  const [requiresHazmatClearance, setRequiresHazmatClearance] = useState(
    defaults.requiresHazmatClearance ?? false,
  );
  const [color, setColor] = useState(defaults.color ?? DEFAULT_ZONE_COLOR);

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`${namePrefix}-name`}>Name</Label>
        <Input
          id={`${namePrefix}-name`}
          name="name"
          required
          placeholder="BULK"
          defaultValue={defaults.name}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${namePrefix}-color`}>Color</Label>
        <div className="flex items-center gap-2">
          <input
            id={`${namePrefix}-color`}
            name="color"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-8 w-12 cursor-pointer rounded border p-0.5"
          />
          <span className="text-xs text-muted-foreground">{color}</span>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${namePrefix}-storagePermanence`}>
          Storage permanence
        </Label>
        <Select
          name="storagePermanence"
          defaultValue={defaults.storagePermanence ?? "PERMANENT"}
        >
          <SelectTrigger id={`${namePrefix}-storagePermanence`}>
            <SelectValue placeholder="Select permanence" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PERMANENT">Permanent</SelectItem>
            <SelectItem value="TEMPORARY">Temporary</SelectItem>
            <SelectItem value="FLUID_BUFFER">Fluid buffer</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2 pt-1">
        <div className="flex items-center space-x-2">
          <input
            type="hidden"
            name="isPickable"
            value={isPickable ? "true" : "false"}
          />
          <Checkbox
            id={`${namePrefix}-isPickable`}
            checked={isPickable}
            onCheckedChange={(checked) => setIsPickable(checked === true)}
          />
          <Label
            htmlFor={`${namePrefix}-isPickable`}
            className="text-xs font-medium cursor-pointer"
          >
            Pickable
          </Label>
        </div>

        <div className="flex items-center space-x-2">
          <input
            type="hidden"
            name="requiresBarcodeScan"
            value={requiresBarcodeScan ? "true" : "false"}
          />
          <Checkbox
            id={`${namePrefix}-requiresBarcodeScan`}
            checked={requiresBarcodeScan}
            onCheckedChange={(checked) =>
              setRequiresBarcodeScan(checked === true)
            }
          />
          <Label
            htmlFor={`${namePrefix}-requiresBarcodeScan`}
            className="text-xs font-medium cursor-pointer"
          >
            Requires barcode scan
          </Label>
        </div>

        <div className="flex items-center space-x-2">
          <input
            type="hidden"
            name="isTemperatureControlled"
            value={isTemperatureControlled ? "true" : "false"}
          />
          <Checkbox
            id={`${namePrefix}-isTemperatureControlled`}
            checked={isTemperatureControlled}
            onCheckedChange={(checked) =>
              setIsTemperatureControlled(checked === true)
            }
          />
          <Label
            htmlFor={`${namePrefix}-isTemperatureControlled`}
            className="text-xs font-medium cursor-pointer"
          >
            Temperature controlled
          </Label>
        </div>

        <div className="flex items-center space-x-2">
          <input
            type="hidden"
            name="requiresHazmatClearance"
            value={requiresHazmatClearance ? "true" : "false"}
          />
          <Checkbox
            id={`${namePrefix}-requiresHazmatClearance`}
            checked={requiresHazmatClearance}
            onCheckedChange={(checked) =>
              setRequiresHazmatClearance(checked === true)
            }
          />
          <Label
            htmlFor={`${namePrefix}-requiresHazmatClearance`}
            className="text-xs font-medium cursor-pointer"
          >
            Requires hazmat clearance
          </Label>
        </div>
      </div>
    </>
  );
}

function readZonePatchFromForm(formData: FormData): ZonePatch {
  return {
    name: String(formData.get("name") ?? "").trim(),
    storagePermanence: String(
      formData.get("storagePermanence") ?? "PERMANENT",
    ),
    isPickable: formData.get("isPickable") === "true",
    requiresBarcodeScan: formData.get("requiresBarcodeScan") === "true",
    isTemperatureControlled:
      formData.get("isTemperatureControlled") === "true",
    requiresHazmatClearance:
      formData.get("requiresHazmatClearance") === "true",
    color: String(formData.get("color") ?? "").trim() || null,
  };
}

function NewZoneDialog({
  open,
  onOpenChange,
  onCreateZone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateZone: (data: ZonePatch) => void;
}) {
  const [error, setError] = useState<string>();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const formData = new FormData(event.currentTarget);
    const data = readZonePatchFromForm(formData);
    if (!data.name) {
      setError("Zone name is required.");
      return;
    }
    onCreateZone(data);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">New zone</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 pt-2">
          <ZoneFormFields namePrefix="new-zone" defaults={{}} />
          {error && (
            <Alert variant="destructive" className="py-2 text-xs">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" className="w-full">
            Create zone
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditZoneDialog({
  zone,
  open,
  onOpenChange,
  onPatchZone,
}: {
  zone: ZoneTypeDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPatchZone: (zoneId: number, patch: ZonePatch) => void;
}) {
  const [error, setError] = useState<string>();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const formData = new FormData(event.currentTarget);
    const data = readZonePatchFromForm(formData);
    if (!data.name) {
      setError("Zone name is required.");
      return;
    }
    onPatchZone(zone.zoneId, data);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">
            Edit zone
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 pt-2">
          <ZoneFormFields
            namePrefix="edit-zone"
            defaults={{ ...zone, color: zone.color ?? cssColorForZone(zone) }}
          />
          {error && (
            <Alert variant="destructive" className="py-2 text-xs">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" className="w-full">
            Save zone
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
