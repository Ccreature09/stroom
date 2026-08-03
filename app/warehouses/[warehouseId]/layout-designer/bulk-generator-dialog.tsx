"use client";

import { useMemo, useState, useTransition } from "react";
import type { HallDTO } from "@/lib/warehouse-map/types";
import type { Point } from "@/lib/warehouse-map/geometry";
import { bulkGenerateLocations, type BulkGenerateResult } from "./actions";

export type BulkGeneratorKind = "racking" | "floor_line" | "shelving";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Boxes, Rows3, LayoutGrid, Crosshair } from "lucide-react";

function OrientationSelect({
  value,
  onChange,
  horizontalLabel,
  verticalLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  horizontalLabel: string;
  verticalLabel: string;
}) {
  return (
    <>
      <input type="hidden" name="orientation" value={value} />
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="horizontal">{horizontalLabel}</SelectItem>
          <SelectItem value="vertical">{verticalLabel}</SelectItem>
        </SelectContent>
      </Select>
    </>
  );
}

function TemplateField({
  id,
  placeholder,
}: {
  id: string;
  placeholder: string;
}) {
  return (
    <div className="space-y-1.5 sm:col-span-2">
      <Label htmlFor={id}>Naming template</Label>
      <Input id={id} name="template" placeholder={placeholder} />
      <p className="text-[11px] text-muted-foreground">
        Tags: <code>{"{Aisle}"}</code> <code>{"{Row}"}</code>{" "}
        <code>{"{Bay}"}</code> <code>{"{Level}"}</code>, each with{" "}
        <code>:letter</code> or <code>:number</code> (default). Leave blank to
        use the default layout for this generator.
      </p>
    </div>
  );
}

/**
 * A repeating rhythm along the generator's primary axis -- "1, empty, 2,
 * empty, 2" for a block of single aisles then wider double blocks, each
 * separated by a cross-aisle gap. Optional: blank keeps the plain contiguous
 * layout this generator always had. See parsePattern in actions.ts for the
 * exact mini-syntax this parses.
 */
function PatternField({
  id,
  name,
  label,
  placeholder,
}: {
  id: string;
  name: string;
  label: string;
  placeholder: string;
}) {
  return (
    <div className="space-y-1.5 sm:col-span-3">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        name={name}
        placeholder={placeholder}
        className="font-mono text-xs"
      />
      <p className="text-[11px] text-muted-foreground">
        Optional. Comma-separated counts and <code>empty</code> markers,
        repeated until the count above is placed -- &quot;{placeholder}&quot;
        lays down that rhythm and cycles it, cutting the last run short rather
        than overshooting. Leave blank for one contiguous run.
      </p>
    </div>
  );
}

/**
 * Replaces manual Start X/Y number entry with a canvas click. Generation
 * coordinates are exact to the millimetre and this hall could be tens of
 * metres across, so typing a plausible-sounding number was really a guess;
 * clicking the spot you actually mean is the same information with none of
 * the arithmetic. The picked point still reaches the server the same way --
 * hidden startX/startY inputs -- so bulkGenerateLocations needed no changes.
 */
function StartPointField({
  startPoint,
  onRequestPick,
}: {
  startPoint: Point | null;
  onRequestPick: () => void;
}) {
  return (
    <div className="space-y-1.5 sm:col-span-2">
      <Label className="text-xs">Start point</Label>
      <div className="flex items-center gap-2">
        <div className="flex h-9 flex-1 items-center rounded-md border bg-muted/30 px-3 text-xs text-muted-foreground">
          {startPoint
            ? `X: ${startPoint.x}mm · Y: ${startPoint.y}mm`
            : "Not set yet"}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRequestPick}
          className="h-9 shrink-0 text-xs"
        >
          <Crosshair className="mr-1.5 h-3.5 w-3.5" />
          {startPoint ? "Re-pick on canvas" : "Pick on canvas"}
        </Button>
      </div>
      <input type="hidden" name="startX" value={startPoint?.x ?? 0} />
      <input type="hidden" name="startY" value={startPoint?.y ?? 0} />
    </div>
  );
}

function ResultBanner({ result }: { result: BulkGenerateResult | null }) {
  if (!result) return null;
  if (result.error) {
    return (
      <Alert variant="destructive" className="text-xs">
        <AlertDescription>{result.error}</AlertDescription>
      </Alert>
    );
  }
  if (result.success) {
    return (
      <Alert className="border-emerald-200 bg-emerald-50 text-xs text-emerald-800">
        <AlertDescription>
          Created {result.created} location{result.created === 1 ? "" : "s"}
          {result.skipped
            ? ` -- skipped ${result.skipped} that already existed.`
            : "."}
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}

export function BulkGenerateDialog({
  warehouseId,
  hall,
  open,
  onOpenChange,
  startPoints,
  onRequestPick,
}: {
  warehouseId: number;
  hall: HallDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** One picked point per generator type -- picking for racking doesn't
   *  disturb whatever was already picked for shelving. Lives in the parent
   *  (layout-designer.tsx), not here: this whole component unmounts while
   *  the dialog is closed for picking (see HallToolbar's `{showBulkGenerate
   *  && <BulkGenerateDialog />}`), so anything that needs to survive that
   *  round trip can't live in this component's own state. */
  startPoints: Record<BulkGeneratorKind, Point | null>;
  onRequestPick: (kind: BulkGeneratorKind) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            Bulk generate locations
          </DialogTitle>
          <DialogDescription>
            Generate many locations at once in{" "}
            <span className="font-medium text-foreground">{hall.name}</span> (
            {hall.physicalWidthMm}mm × {hall.physicalLengthMm}mm).
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="racking" className="mt-2 w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="racking">
              <LayoutGrid className="mr-1.5 h-3.5 w-3.5" />
              Racking
            </TabsTrigger>
            <TabsTrigger value="floor_line">
              <Rows3 className="mr-1.5 h-3.5 w-3.5" />
              Floor line
            </TabsTrigger>
            <TabsTrigger value="shelving">
              <Boxes className="mr-1.5 h-3.5 w-3.5" />
              Shelving
            </TabsTrigger>
          </TabsList>

          <TabsContent value="racking" className="pt-4">
            <RackingForm
              warehouseId={warehouseId}
              hallId={hall.hallId}
              onDone={() => onOpenChange(false)}
              startPoint={startPoints.racking}
              onRequestPick={() => onRequestPick("racking")}
            />
          </TabsContent>

          <TabsContent value="floor_line" className="pt-4">
            <FloorLineForm
              warehouseId={warehouseId}
              hallId={hall.hallId}
              onDone={() => onOpenChange(false)}
              startPoint={startPoints.floor_line}
              onRequestPick={() => onRequestPick("floor_line")}
            />
          </TabsContent>

          <TabsContent value="shelving" className="pt-4">
            <ShelvingForm
              warehouseId={warehouseId}
              hallId={hall.hallId}
              onDone={() => onOpenChange(false)}
              startPoint={startPoints.shelving}
              onRequestPick={() => onRequestPick("shelving")}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Racking: aisle x bay x level grid
// ---------------------------------------------------------------------------

function RackingForm({
  warehouseId,
  hallId,
  onDone,
  startPoint,
  onRequestPick,
}: {
  warehouseId: number;
  hallId: number;
  onDone: () => void;
  startPoint: Point | null;
  onRequestPick: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<BulkGenerateResult | null>(null);
  const [horizontalDirection, setHorizontalDirection] = useState("ltr");
  const [verticalDirection, setVerticalDirection] = useState("utd");
  const [useRows, setUseRows] = useState(false);
  const [aisleCount, setAisleCount] = useState(4);
  const [bayCount, setBayCount] = useState(10);
  const [levelCount, setLevelCount] = useState(4);

  const total = useMemo(
    () =>
      Math.max(0, aisleCount) * Math.max(0, bayCount) * Math.max(0, levelCount),
    [aisleCount, bayCount, levelCount],
  );

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    const formData = new FormData(event.currentTarget);
    formData.set("generatorType", "racking");
    startTransition(async () => {
      const res = await bulkGenerateLocations(formData);
      setResult(res);
      if (res.success) onDone();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input type="hidden" name="warehouseId" value={warehouseId} />
      <input type="hidden" name="hallId" value={hallId} />

      <div className="grid grid-cols-2 gap-3">
        <TemplateField
          id="rk-template"
          placeholder="A{Aisle:letter}-{Row:number}-{Bay:number}-{Level:number}"
        />
      </div>

      <div className="rounded-lg border bg-muted/30 p-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Aisles × bays × levels
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="rk-aisleStart" className="text-xs">
              Aisle start
            </Label>
            <Input
              id="rk-aisleStart"
              name="aisleStart"
              type="number"
              min={1}
              defaultValue={1}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rk-aisleCount" className="text-xs">
              Aisle count
            </Label>
            <Input
              id="rk-aisleCount"
              name="aisleCount"
              type="number"
              min={1}
              value={aisleCount}
              onChange={(e) => setAisleCount(Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rk-aisleGapMm" className="text-xs">
              Aisle gap (mm)
            </Label>
            <Input
              id="rk-aisleGapMm"
              name="aisleGapMm"
              type="number"
              min={0}
              defaultValue={2000}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rk-bayStart" className="text-xs">
              Bay start
            </Label>
            <Input
              id="rk-bayStart"
              name="bayStart"
              type="number"
              min={1}
              defaultValue={1}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rk-bayCount" className="text-xs">
              Bay count
            </Label>
            <Input
              id="rk-bayCount"
              name="bayCount"
              type="number"
              min={1}
              value={bayCount}
              onChange={(e) => setBayCount(Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rk-bayGapMm" className="text-xs">
              Bay gap (mm)
            </Label>
            <Input
              id="rk-bayGapMm"
              name="bayGapMm"
              type="number"
              min={0}
              defaultValue={0}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rk-levelStart" className="text-xs">
              Level start
            </Label>
            <Input
              id="rk-levelStart"
              name="levelStart"
              type="number"
              min={1}
              defaultValue={1}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rk-levelCount" className="text-xs">
              Level count
            </Label>
            <Input
              id="rk-levelCount"
              name="levelCount"
              type="number"
              min={1}
              value={levelCount}
              onChange={(e) => setLevelCount(Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1.5" />

          <PatternField
            id="rk-aislePattern"
            name="aislePattern"
            label="Aisle layout pattern"
            placeholder="1, empty, 2, empty, 2"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="rk-bayWidthMm" className="text-xs">
            Bay width (mm)
          </Label>
          <Input
            id="rk-bayWidthMm"
            name="bayWidthMm"
            type="number"
            min={1}
            defaultValue={1200}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rk-bayDepthMm" className="text-xs">
            Bay depth (mm)
          </Label>
          <Input
            id="rk-bayDepthMm"
            name="bayDepthMm"
            type="number"
            min={1}
            defaultValue={1000}
          />
        </div>

        <StartPointField startPoint={startPoint} onRequestPick={onRequestPick} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="rk-horizontalDirection" className="text-xs">
            Horizontal numbering
          </Label>
          <input
            type="hidden"
            name="horizontalDirection"
            value={horizontalDirection}
          />
          <Select
            value={horizontalDirection}
            onValueChange={setHorizontalDirection}
          >
            <SelectTrigger id="rk-horizontalDirection" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ltr">Left → Right</SelectItem>
              <SelectItem value="rtl">Right → Left</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rk-verticalDirection" className="text-xs">
            Vertical numbering
          </Label>
          <input
            type="hidden"
            name="verticalDirection"
            value={verticalDirection}
          />
          <Select
            value={verticalDirection}
            onValueChange={setVerticalDirection}
          >
            <SelectTrigger id="rk-verticalDirection" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="utd">Up → Down</SelectItem>
              <SelectItem value="dtu">Down → Up</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <input type="hidden" name="useRows" value={useRows ? "on" : "off"} />
        <Checkbox
          id="rk-useRows"
          checked={useRows}
          onCheckedChange={(c) => setUseRows(c === true)}
        />
        <Label
          htmlFor="rk-useRows"
          className="text-xs font-medium cursor-pointer"
        >
          Group bays into rows (1 row = 4 bays)
        </Label>
      </div>

      <p className="text-xs text-muted-foreground">
        {startPoint ? (
          <>
            Will create{" "}
            <span className="font-semibold text-foreground">{total}</span>{" "}
            location{total === 1 ? "" : "s"}.
          </>
        ) : (
          "Pick a start point on the canvas before generating."
        )}
      </p>

      <ResultBanner result={result} />

      <Button
        type="submit"
        disabled={isPending || total === 0 || !startPoint}
        className="w-full"
      >
        {isPending ? "Generating…" : `Generate ${total} locations`}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Floor line: a single row/column of sequential slots (staging, dock doors)
// ---------------------------------------------------------------------------

function FloorLineForm({
  warehouseId,
  hallId,
  onDone,
  startPoint,
  onRequestPick,
}: {
  warehouseId: number;
  hallId: number;
  onDone: () => void;
  startPoint: Point | null;
  onRequestPick: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<BulkGenerateResult | null>(null);
  const [orientation, setOrientation] = useState("horizontal");
  const [sequenceDirection, setSequenceDirection] = useState("forward");
  const [slotCount, setSlotCount] = useState(8);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    const formData = new FormData(event.currentTarget);
    formData.set("generatorType", "floor_line");
    startTransition(async () => {
      const res = await bulkGenerateLocations(formData);
      setResult(res);
      if (res.success) onDone();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input type="hidden" name="warehouseId" value={warehouseId} />
      <input type="hidden" name="hallId" value={hallId} />

      <div className="grid grid-cols-2 gap-3">
        <TemplateField id="fl-template" placeholder="DOCK{Bay:number}" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="fl-slotStart" className="text-xs">
            Slot start
          </Label>
          <Input
            id="fl-slotStart"
            name="slotStart"
            type="number"
            min={1}
            defaultValue={1}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fl-slotCount" className="text-xs">
            Slot count
          </Label>
          <Input
            id="fl-slotCount"
            name="slotCount"
            type="number"
            min={1}
            value={slotCount}
            onChange={(e) => setSlotCount(Number(e.target.value) || 0)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fl-gapMm" className="text-xs">
            Gap (mm)
          </Label>
          <Input
            id="fl-gapMm"
            name="gapMm"
            type="number"
            min={0}
            defaultValue={200}
          />
        </div>

        <PatternField
          id="fl-slotPattern"
          name="slotPattern"
          label="Slot layout pattern"
          placeholder="1, empty, 2, empty, 2"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="fl-slotWidthMm" className="text-xs">
            Slot width (mm)
          </Label>
          <Input
            id="fl-slotWidthMm"
            name="slotWidthMm"
            type="number"
            min={1}
            defaultValue={3500}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fl-slotDepthMm" className="text-xs">
            Slot depth (mm)
          </Label>
          <Input
            id="fl-slotDepthMm"
            name="slotDepthMm"
            type="number"
            min={1}
            defaultValue={12000}
          />
        </div>

        <StartPointField startPoint={startPoint} onRequestPick={onRequestPick} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="fl-orientation" className="text-xs">
            Placement orientation
          </Label>
          <OrientationSelect
            value={orientation}
            onChange={setOrientation}
            horizontalLabel="Left to right"
            verticalLabel="Top to bottom"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fl-sequenceDirection" className="text-xs">
            Numbering direction
          </Label>
          <input
            type="hidden"
            name="sequenceDirection"
            value={sequenceDirection}
          />
          <Select
            value={sequenceDirection}
            onValueChange={setSequenceDirection}
          >
            <SelectTrigger id="fl-sequenceDirection" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="forward">Start → End</SelectItem>
              <SelectItem value="reverse">End → Start</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {startPoint ? (
          <>
            Will create{" "}
            <span className="font-semibold text-foreground">{slotCount}</span>{" "}
            location{slotCount === 1 ? "" : "s"}. Good for dock doors, staging
            lanes, or drop lines.
          </>
        ) : (
          "Pick a start point on the canvas before generating."
        )}
      </p>

      <ResultBanner result={result} />

      <Button
        type="submit"
        disabled={isPending || slotCount <= 0 || !startPoint}
        className="w-full"
      >
        {isPending ? "Generating…" : `Generate ${slotCount} locations`}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Shelving: a single-row bay x level grid (no aisle dimension)
// ---------------------------------------------------------------------------

function ShelvingForm({
  warehouseId,
  hallId,
  onDone,
  startPoint,
  onRequestPick,
}: {
  warehouseId: number;
  hallId: number;
  onDone: () => void;
  startPoint: Point | null;
  onRequestPick: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<BulkGenerateResult | null>(null);
  const [orientation, setOrientation] = useState("horizontal");
  const [sequenceDirection, setSequenceDirection] = useState("forward");
  const [bayCount, setBayCount] = useState(6);
  const [levelCount, setLevelCount] = useState(5);

  const total = useMemo(
    () => Math.max(0, bayCount) * Math.max(0, levelCount),
    [bayCount, levelCount],
  );

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    const formData = new FormData(event.currentTarget);
    formData.set("generatorType", "shelving");
    startTransition(async () => {
      const res = await bulkGenerateLocations(formData);
      setResult(res);
      if (res.success) onDone();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input type="hidden" name="warehouseId" value={warehouseId} />
      <input type="hidden" name="hallId" value={hallId} />

      <div className="grid grid-cols-2 gap-3">
        <TemplateField
          id="sh-template"
          placeholder="SHELF-A{Bay:number}-{Level:number}"
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="sh-bayStart" className="text-xs">
            Bay start
          </Label>
          <Input
            id="sh-bayStart"
            name="bayStart"
            type="number"
            min={1}
            defaultValue={1}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sh-bayCount" className="text-xs">
            Bay count
          </Label>
          <Input
            id="sh-bayCount"
            name="bayCount"
            type="number"
            min={1}
            value={bayCount}
            onChange={(e) => setBayCount(Number(e.target.value) || 0)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sh-bayGapMm" className="text-xs">
            Bay gap (mm)
          </Label>
          <Input
            id="sh-bayGapMm"
            name="bayGapMm"
            type="number"
            min={0}
            defaultValue={0}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="sh-levelStart" className="text-xs">
            Level start
          </Label>
          <Input
            id="sh-levelStart"
            name="levelStart"
            type="number"
            min={1}
            defaultValue={1}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sh-levelCount" className="text-xs">
            Level count
          </Label>
          <Input
            id="sh-levelCount"
            name="levelCount"
            type="number"
            min={1}
            value={levelCount}
            onChange={(e) => setLevelCount(Number(e.target.value) || 0)}
          />
        </div>
        <div className="space-y-1.5" />

        <PatternField
          id="sh-bayPattern"
          name="bayPattern"
          label="Bay layout pattern"
          placeholder="1, empty, 2, empty, 2"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="sh-bayWidthMm" className="text-xs">
            Shelf width (mm)
          </Label>
          <Input
            id="sh-bayWidthMm"
            name="bayWidthMm"
            type="number"
            min={1}
            defaultValue={900}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sh-bayDepthMm" className="text-xs">
            Shelf depth (mm)
          </Label>
          <Input
            id="sh-bayDepthMm"
            name="bayDepthMm"
            type="number"
            min={1}
            defaultValue={500}
          />
        </div>

        <StartPointField startPoint={startPoint} onRequestPick={onRequestPick} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="sh-orientation" className="text-xs">
            Placement orientation
          </Label>
          <OrientationSelect
            value={orientation}
            onChange={setOrientation}
            horizontalLabel="Bays run left-right"
            verticalLabel="Bays run top-bottom"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sh-sequenceDirection" className="text-xs">
            Numbering direction
          </Label>
          <input
            type="hidden"
            name="sequenceDirection"
            value={sequenceDirection}
          />
          <Select
            value={sequenceDirection}
            onValueChange={setSequenceDirection}
          >
            <SelectTrigger id="sh-sequenceDirection" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="forward">Start → End</SelectItem>
              <SelectItem value="reverse">End → Start</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {startPoint ? (
          <>
            Will create{" "}
            <span className="font-semibold text-foreground">{total}</span>{" "}
            location{total === 1 ? "" : "s"}. No aisle dimension -- good for a
            single run of wall shelving.
          </>
        ) : (
          "Pick a start point on the canvas before generating."
        )}
      </p>

      <ResultBanner result={result} />

      <Button
        type="submit"
        disabled={isPending || total === 0 || !startPoint}
        className="w-full"
      >
        {isPending ? "Generating…" : `Generate ${total} locations`}
      </Button>
    </form>
  );
}
