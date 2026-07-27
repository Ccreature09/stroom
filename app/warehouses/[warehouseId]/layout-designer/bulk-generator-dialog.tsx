"use client";

import { useMemo, useState, useTransition } from "react";
import type { ZoneTypeDTO, HallDTO } from "./types";
import { bulkGenerateLocations, type BulkGenerateResult } from "./actions";

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
import { Boxes, Rows3, LayoutGrid } from "lucide-react";

function ZoneSelect({
  zoneTypes,
  value,
  onChange,
}: {
  zoneTypes: ZoneTypeDTO[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <input
        type="hidden"
        name="zoneId"
        value={value === "none" ? "" : value}
      />
      <Select value={value} onValueChange={onChange}>
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
  zoneTypes,
  open,
  onOpenChange,
}: {
  warehouseId: number;
  hall: HallDTO;
  zoneTypes: ZoneTypeDTO[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
              zoneTypes={zoneTypes}
              onDone={() => onOpenChange(false)}
            />
          </TabsContent>

          <TabsContent value="floor_line" className="pt-4">
            <FloorLineForm
              warehouseId={warehouseId}
              hallId={hall.hallId}
              zoneTypes={zoneTypes}
              onDone={() => onOpenChange(false)}
            />
          </TabsContent>

          <TabsContent value="shelving" className="pt-4">
            <ShelvingForm
              warehouseId={warehouseId}
              hallId={hall.hallId}
              zoneTypes={zoneTypes}
              onDone={() => onOpenChange(false)}
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
  zoneTypes,
  onDone,
}: {
  warehouseId: number;
  hallId: number;
  zoneTypes: ZoneTypeDTO[];
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<BulkGenerateResult | null>(null);
  const [zoneId, setZoneId] = useState("none");
  const [orientation, setOrientation] = useState("horizontal");
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
        <div className="space-y-1.5">
          <Label htmlFor="rk-codePrefix">Code prefix</Label>
          <Input
            id="rk-codePrefix"
            name="codePrefix"
            required
            placeholder="WH1-BULK"
            className="uppercase"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rk-zoneId">Zone</Label>
          <ZoneSelect
            zoneTypes={zoneTypes}
            value={zoneId}
            onChange={setZoneId}
          />
        </div>
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
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
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
        <div className="space-y-1.5">
          <Label htmlFor="rk-startX" className="text-xs">
            Start X (mm)
          </Label>
          <Input
            id="rk-startX"
            name="startX"
            type="number"
            min={0}
            defaultValue={0}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rk-startY" className="text-xs">
            Start Y (mm)
          </Label>
          <Input
            id="rk-startY"
            name="startY"
            type="number"
            min={0}
            defaultValue={0}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="rk-orientation" className="text-xs">
          Orientation
        </Label>
        <OrientationSelect
          value={orientation}
          onChange={setOrientation}
          horizontalLabel="Aisles stacked in rows (bays run left-right)"
          verticalLabel="Aisles side-by-side (bays run top-bottom)"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Will create{" "}
        <span className="font-semibold text-foreground">{total}</span> location
        {total === 1 ? "" : "s"} (aisle-bay-level codes, e.g.{" "}
        {`{prefix}-01-01-01`}).
      </p>

      <ResultBanner result={result} />

      <Button
        type="submit"
        disabled={isPending || total === 0}
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
  zoneTypes,
  onDone,
}: {
  warehouseId: number;
  hallId: number;
  zoneTypes: ZoneTypeDTO[];
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<BulkGenerateResult | null>(null);
  const [zoneId, setZoneId] = useState("none");
  const [orientation, setOrientation] = useState("horizontal");
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
      <Input type="hidden" name="warehouseId" value={warehouseId} />
      <Input type="hidden" name="hallId" value={hallId} />

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="fl-codePrefix">Code prefix</Label>
          <Input
            id="fl-codePrefix"
            name="codePrefix"
            required
            placeholder="DOCK"
            className="uppercase"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fl-zoneId">Zone</Label>
          <ZoneSelect
            zoneTypes={zoneTypes}
            value={zoneId}
            onChange={setZoneId}
          />
        </div>
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
      </div>

      <div className="grid grid-cols-4 gap-3">
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
        <div className="space-y-1.5">
          <Label htmlFor="fl-startX" className="text-xs">
            Start X (mm)
          </Label>
          <Input
            id="fl-startX"
            name="startX"
            type="number"
            min={0}
            defaultValue={0}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fl-startY" className="text-xs">
            Start Y (mm)
          </Label>
          <Input
            id="fl-startY"
            name="startY"
            type="number"
            min={0}
            defaultValue={0}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="fl-orientation" className="text-xs">
          Orientation
        </Label>
        <OrientationSelect
          value={orientation}
          onChange={setOrientation}
          horizontalLabel="Left to right"
          verticalLabel="Top to bottom"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Will create{" "}
        <span className="font-semibold text-foreground">{slotCount}</span>{" "}
        location
        {slotCount === 1 ? "" : "s"} (e.g. {`{prefix}-01`}, {`{prefix}-02`}…).
        Good for dock doors, staging lanes, or drop lines.
      </p>

      <ResultBanner result={result} />

      <Button
        type="submit"
        disabled={isPending || slotCount <= 0}
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
  zoneTypes,
  onDone,
}: {
  warehouseId: number;
  hallId: number;
  zoneTypes: ZoneTypeDTO[];
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<BulkGenerateResult | null>(null);
  const [zoneId, setZoneId] = useState("none");
  const [orientation, setOrientation] = useState("horizontal");
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
        <div className="space-y-1.5">
          <Label htmlFor="sh-codePrefix">Code prefix</Label>
          <Input
            id="sh-codePrefix"
            name="codePrefix"
            required
            placeholder="SHELF-A"
            className="uppercase"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sh-zoneId">Zone</Label>
          <ZoneSelect
            zoneTypes={zoneTypes}
            value={zoneId}
            onChange={setZoneId}
          />
        </div>
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
      </div>

      <div className="grid grid-cols-4 gap-3">
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
        <div className="space-y-1.5">
          <Label htmlFor="sh-startX" className="text-xs">
            Start X (mm)
          </Label>
          <Input
            id="sh-startX"
            name="startX"
            type="number"
            min={0}
            defaultValue={0}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sh-startY" className="text-xs">
            Start Y (mm)
          </Label>
          <Input
            id="sh-startY"
            name="startY"
            type="number"
            min={0}
            defaultValue={0}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sh-orientation" className="text-xs">
          Orientation
        </Label>
        <OrientationSelect
          value={orientation}
          onChange={setOrientation}
          horizontalLabel="Bays run left-right"
          verticalLabel="Bays run top-bottom"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Will create{" "}
        <span className="font-semibold text-foreground">{total}</span> location
        {total === 1 ? "" : "s"} (e.g. {`{prefix}-01-01`}). No aisle dimension
        -- good for a single run of wall shelving.
      </p>

      <ResultBanner result={result} />

      <Button
        type="submit"
        disabled={isPending || total === 0}
        className="w-full"
      >
        {isPending ? "Generating…" : `Generate ${total} locations`}
      </Button>
    </form>
  );
}
