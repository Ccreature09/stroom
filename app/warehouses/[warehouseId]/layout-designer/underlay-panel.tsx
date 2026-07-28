"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { HallDTO, UnderlayDTO } from "./types";
import {
  calibrateHallUnderlay,
  deleteHallUnderlay,
  updateHallUnderlay,
  uploadHallUnderlay,
} from "./lifecycle-actions";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Image as ImageIcon, Ruler, Trash2, Upload } from "lucide-react";

/**
 * Reads a chosen image's natural pixel dimensions before upload. The server
 * needs them to derive an opening scale (assume the plan spans the hall
 * width), so the user sees something plausibly sized rather than a speck or a
 * wall of pixels before they calibrate.
 */
function readImageSize(
  file: File,
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

export default function UnderlayPanel({
  warehouseId,
  hall,
  underlay,
  measuredMm,
  onClearMeasurement,
  isMeasuring,
  onToggleMeasure,
  locked,
}: {
  warehouseId: number;
  hall: HallDTO;
  underlay: UnderlayDTO | null;
  measuredMm: number | null;
  onClearMeasurement: () => void;
  isMeasuring: boolean;
  onToggleMeasure: () => void;
  locked: boolean;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [knownMm, setKnownMm] = useState("");
  const [isPending, startTransition] = useTransition();

  async function handleFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);

    const size = await readImageSize(file);
    const formData = new FormData();
    formData.set("warehouseId", String(warehouseId));
    formData.set("hallId", String(hall.hallId));
    formData.set("floorLevel", "1");
    formData.set("hallWidthMm", String(hall.physicalWidthMm));
    if (size) {
      formData.set("imageWidthPx", String(size.width));
      formData.set("imageHeightPx", String(size.height));
    }
    formData.set("file", file);

    startTransition(async () => {
      const result = await uploadHallUnderlay(formData);
      if (result?.error) setError(result.error);
      else router.refresh();
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  }

  function patch(next: Parameters<typeof updateHallUnderlay>[2]) {
    if (!underlay) return;
    startTransition(async () => {
      const result = await updateHallUnderlay(
        warehouseId,
        underlay.underlayId,
        next,
      );
      if (result?.error) setError(result.error);
      else router.refresh();
    });
  }

  function handleCalibrate() {
    if (!underlay || measuredMm == null) return;
    const known = Number(knownMm);
    if (!Number.isFinite(known) || known <= 0) {
      setError("Enter the real distance in millimetres.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await calibrateHallUnderlay(
        warehouseId,
        underlay.underlayId,
        measuredMm,
        known,
      );
      if (result?.error) {
        setError(result.error);
      } else {
        setKnownMm("");
        onClearMeasurement();
        router.refresh();
      }
    });
  }

  function handleDelete() {
    if (!underlay) return;
    if (!confirm("Remove this underlay? The image file is deleted too.")) return;
    startTransition(async () => {
      const result = await deleteHallUnderlay(warehouseId, underlay.underlayId);
      if (result?.error) setError(result.error);
      else router.refresh();
    });
  }

  const busy = locked || isPending;

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Floorplan Underlay
      </Label>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={handleFileChosen}
      />

      {!underlay ? (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            className="w-full justify-start text-xs"
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            {isPending ? "Uploading…" : "Import floorplan"}
          </Button>
          <p className="px-1 text-[11px] leading-snug text-muted-foreground">
            Trace a real building instead of drawing it from measurements. PNG,
            JPEG, WebP or SVG up to 25 MB.
          </p>
        </>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border bg-card p-2">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <ImageIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate" title={underlay.originalFilename ?? ""}>
              {underlay.originalFilename ?? "Underlay"}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="underlay-visible"
              checked={underlay.isVisible}
              disabled={busy}
              onCheckedChange={(checked) =>
                patch({ isVisible: checked === true })
              }
            />
            <Label
              htmlFor="underlay-visible"
              className="cursor-pointer text-xs font-medium leading-none"
            >
              Show on canvas
            </Label>
          </div>

          <div className="space-y-1">
            <Label htmlFor="underlay-opacity" className="text-[11px]">
              Opacity · {Math.round(underlay.opacity * 100)}%
            </Label>
            <input
              id="underlay-opacity"
              type="range"
              min={0}
              max={100}
              step={5}
              disabled={busy}
              defaultValue={Math.round(underlay.opacity * 100)}
              onMouseUp={(e) =>
                patch({ opacity: Number(e.currentTarget.value) / 100 })
              }
              onTouchEnd={(e) =>
                patch({ opacity: Number(e.currentTarget.value) / 100 })
              }
              className="w-full accent-teal-600"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="underlay-x" className="text-[11px]">
                X (mm)
              </Label>
              <Input
                id="underlay-x"
                type="number"
                disabled={busy}
                defaultValue={underlay.offsetXMm}
                onBlur={(e) => {
                  const v = Number(e.currentTarget.value);
                  if (Number.isFinite(v) && v !== underlay.offsetXMm)
                    patch({ offsetXMm: v });
                }}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="underlay-y" className="text-[11px]">
                Y (mm)
              </Label>
              <Input
                id="underlay-y"
                type="number"
                disabled={busy}
                defaultValue={underlay.offsetYMm}
                onBlur={(e) => {
                  const v = Number(e.currentTarget.value);
                  if (Number.isFinite(v) && v !== underlay.offsetYMm)
                    patch({ offsetYMm: v });
                }}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="underlay-rotation" className="text-[11px]">
              Rotation (deg)
            </Label>
            <Input
              id="underlay-rotation"
              type="number"
              min={0}
              max={359}
              disabled={busy}
              defaultValue={underlay.rotationDegrees}
              onBlur={(e) => {
                const v = Number(e.currentTarget.value);
                if (Number.isFinite(v) && v !== underlay.rotationDegrees)
                  patch({ rotationDegrees: v });
              }}
              className="h-8 text-xs"
            />
          </div>

          {/* Calibration: measure something of known length on the plan and
              say what it really is. The correction is relative, so it works
              from whatever scale the image currently has. */}
          <div className="space-y-1.5 border-t pt-2">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Scale calibration
            </Label>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Current: {underlay.scaleMmPerPx.toFixed(3)} mm per image pixel.
            </p>

            <Button
              variant={isMeasuring ? "default" : "outline"}
              size="sm"
              disabled={busy}
              onClick={onToggleMeasure}
              className="w-full justify-start text-xs"
            >
              <Ruler className="mr-1.5 h-3.5 w-3.5" />
              {isMeasuring ? "Click two points…" : "Measure a known distance"}
            </Button>

            {measuredMm != null && (
              <div className="space-y-1.5 rounded-md border bg-muted/40 p-2">
                <p className="text-[11px] text-muted-foreground">
                  Measured{" "}
                  <span className="font-semibold text-foreground">
                    {(measuredMm / 1000).toFixed(2)} m
                  </span>
                  . What is it really?
                </p>
                <div className="flex gap-1.5">
                  <Input
                    type="number"
                    min={1}
                    placeholder="mm"
                    value={knownMm}
                    disabled={busy}
                    onChange={(e) => setKnownMm(e.target.value)}
                    className="h-8 text-xs"
                  />
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={handleCalibrate}
                    className="h-8 shrink-0 text-xs"
                  >
                    Apply
                  </Button>
                </div>
              </div>
            )}
          </div>

          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={handleDelete}
            className="w-full justify-start text-xs text-destructive hover:text-destructive"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Remove underlay
          </Button>
        </div>
      )}

      {error && (
        <Alert variant="destructive" className="py-2 text-xs">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
