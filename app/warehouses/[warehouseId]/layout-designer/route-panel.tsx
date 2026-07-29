"use client";

import { useState, useTransition } from "react";
import type { LocationDTO, RoutingVehicleDTO } from "./types";
import { previewRoute, type RoutePreview } from "./routing-actions";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Navigation, X } from "lucide-react";

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export default function RoutePanel({
  warehouseId,
  hallId,
  selectedLocations,
  vehicles,
  hasGraph,
  preview,
  onPreview,
  onClear,
  locked,
}: {
  warehouseId: number;
  hallId: number;
  selectedLocations: LocationDTO[];
  vehicles: RoutingVehicleDTO[];
  hasGraph: boolean;
  preview: RoutePreview | null;
  onPreview: (result: RoutePreview | null) => void;
  onClear: () => void;
  locked: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [mheTypeId, setMheTypeId] = useState<string>("foot");

  // The first selected location is the origin; the rest are stops to visit.
  const origin = selectedLocations[0];
  const stops = selectedLocations.slice(1);
  const canRoute = hasGraph && selectedLocations.length >= 2;

  function handleRoute() {
    if (!origin) return;
    startTransition(async () => {
      const result = await previewRoute(
        warehouseId,
        hallId,
        origin.locationId,
        stops.map((s) => s.locationId),
        { mheTypeId: mheTypeId === "foot" ? null : Number(mheTypeId) },
      );
      onPreview(result);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Route Preview
      </Label>

      {!hasGraph ? (
        <p className="px-1 text-[11px] leading-snug text-muted-foreground">
          Compile the navigation graph first — routing needs the aisle network.
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="route-vehicle" className="text-[11px]">
              Travelling as
            </Label>
            <Select value={mheTypeId} onValueChange={setMheTypeId}>
              <SelectTrigger id="route-vehicle" className="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="foot">On foot</SelectItem>
                {vehicles
                  .filter((v) => !v.isPedestrian)
                  .map((v) => (
                    <SelectItem key={v.mheTypeId} value={String(v.mheTypeId)}>
                      {v.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <p className="px-1 text-[11px] leading-snug text-muted-foreground">
            {selectedLocations.length < 2 ? (
              <>
                Select two or more locations on the canvas. The first is the
                start; the rest are ordered into an efficient pick path.
              </>
            ) : (
              <>
                From{" "}
                <span className="font-medium text-foreground">
                  {origin.locationCode}
                </span>{" "}
                through {stops.length} stop{stops.length === 1 ? "" : "s"}.
              </>
            )}
          </p>

          <Button
            variant="outline"
            size="sm"
            disabled={locked || isPending || !canRoute}
            onClick={handleRoute}
            className="w-full justify-start text-xs"
          >
            <Navigation className="mr-1.5 h-3.5 w-3.5" />
            {isPending ? "Routing…" : "Compute route"}
          </Button>

          {preview?.error && (
            <Alert variant="destructive" className="py-2 text-xs">
              <AlertDescription>{preview.error}</AlertDescription>
            </Alert>
          )}

          {preview?.found && (
            <div className="space-y-1.5 rounded-md border bg-card p-2 text-[11px] leading-relaxed">
              <div className="flex items-center justify-between font-medium text-foreground">
                <span>
                  {((preview.distanceMm ?? 0) / 1000).toFixed(1)} m ·{" "}
                  {formatDuration(preview.totalMs ?? 0)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClear}
                  className="h-6 px-1.5 text-[11px]"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
              {/* Travel and handling are separated because they are improved
                  by completely different things -- layout versus process. */}
              <p className="text-muted-foreground">
                {formatDuration(preview.travelMs ?? 0)} travelling ·{" "}
                {formatDuration(preview.handlingMs ?? 0)} handling ·{" "}
                {preview.edgeIds?.length ?? 0} segments
              </p>
              {preview.orderedStops && preview.orderedStops.length > 0 && (
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Order:</span>{" "}
                  {preview.orderedStops.map((s) => s.locationCode).join(" → ")}
                </p>
              )}
              {preview.sequencingTruncated && (
                <p className="text-amber-700">
                  Stop ordering hit its time budget — the sequence is good, not
                  proven optimal.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
