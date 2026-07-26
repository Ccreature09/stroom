"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cssColorForZone } from "./types";
import type { HallDTO, ZoneTypeDTO } from "./types";
import type { Tool } from "./layout-designer-canvas";
import { createHall, createZoneType } from "./actions";

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
import { Plus, Check, MousePointer, SquarePlus } from "lucide-react";

export default function HallToolbar({
  warehouseId,
  halls,
  selectedHallId,
  zoneTypes,
  tool,
  onToolChange,
}: {
  warehouseId: number;
  halls: HallDTO[];
  selectedHallId: number;
  zoneTypes: ZoneTypeDTO[];
  tool: Tool;
  onToolChange: (tool: Tool) => void;
}) {
  const router = useRouter();
  const [showNewHall, setShowNewHall] = useState(false);
  const [showNewZone, setShowNewZone] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState(false);

  function handleSaveMap() {
    setIsSaving(true);
    router.refresh();
    setTimeout(() => {
      setIsSaving(false);
      setSavedMessage(true);
      setTimeout(() => setSavedMessage(false), 2000);
    }, 400);
  }

  return (
    <div className="flex w-64 shrink-0 flex-col overflow-y-auto border-r bg-background/70 p-4">
      <div className="flex flex-1 flex-col gap-5">
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

        <div className="h-px w-full bg-border" />

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
              variant={tool === "draw" ? "default" : "ghost"}
              size="sm"
              onClick={() => onToolChange("draw")}
              className="justify-start text-xs font-medium"
            >
              <SquarePlus className="mr-2 h-3.5 w-3.5" />
              Add location
            </Button>
          </div>
        </div>

        <div className="h-px w-full bg-border" />

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
                  style={{ backgroundColor: cssColorForZone(z.zoneId) }}
                />
                <span className="truncate">{z.name}</span>
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
      </div>

      {/* Save Map Button */}
      <div className="mt-6 border-t pt-4">
        <Button
          onClick={handleSaveMap}
          disabled={isSaving}
          className="w-full text-xs font-semibold"
        >
          {isSaving ? (
            "Saving..."
          ) : savedMessage ? (
            <span className="flex items-center gap-1">
              <Check className="h-4 w-4" /> Map Saved!
            </span>
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
          warehouseId={warehouseId}
          open={showNewZone}
          onOpenChange={setShowNewZone}
        />
      )}
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

function NewZoneDialog({
  warehouseId,
  open,
  onOpenChange,
}: {
  warehouseId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [error, setError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  // Form checkbox state hooks
  const [isPickable, setIsPickable] = useState(true);
  const [requiresBarcodeScan, setRequiresBarcodeScan] = useState(true);
  const [isTemperatureControlled, setIsTemperatureControlled] = useState(false);
  const [requiresHazmatClearance, setRequiresHazmatClearance] = useState(false);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createZoneType(formData);
      if (result?.error) setError(result.error);
      else onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">New zone</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 pt-2">
          <input type="hidden" name="warehouseId" value={warehouseId} />
          <div className="space-y-1.5">
            <Label htmlFor="zone-name">Name</Label>
            <Input id="zone-name" name="name" required placeholder="BULK" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="storagePermanence">Storage permanence</Label>
            <Select name="storagePermanence" defaultValue="PERMANENT">
              <SelectTrigger>
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
                id="isPickable"
                checked={isPickable}
                onCheckedChange={(checked) => setIsPickable(checked === true)}
              />
              <Label
                htmlFor="isPickable"
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
                id="requiresBarcodeScan"
                checked={requiresBarcodeScan}
                onCheckedChange={(checked) =>
                  setRequiresBarcodeScan(checked === true)
                }
              />
              <Label
                htmlFor="requiresBarcodeScan"
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
                id="isTemperatureControlled"
                checked={isTemperatureControlled}
                onCheckedChange={(checked) =>
                  setIsTemperatureControlled(checked === true)
                }
              />
              <Label
                htmlFor="isTemperatureControlled"
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
                id="requiresHazmatClearance"
                checked={requiresHazmatClearance}
                onCheckedChange={(checked) =>
                  setRequiresHazmatClearance(checked === true)
                }
              />
              <Label
                htmlFor="requiresHazmatClearance"
                className="text-xs font-medium cursor-pointer"
              >
                Requires hazmat clearance
              </Label>
            </div>
          </div>

          {error && (
            <Alert variant="destructive" className="py-2 text-xs">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? "Creating…" : "Create zone"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
