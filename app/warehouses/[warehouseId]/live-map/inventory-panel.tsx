"use client";

import { useState, useTransition } from "react";
import type {
  ItemSearchResultDTO,
  RoutingVehicleDTO,
} from "@/lib/warehouse-map/types";
import type { RoutePreview } from "@/lib/warehouse-map/routing-server";
import { searchWarehouseItems } from "./inventory-actions";
import { previewLiveRoute } from "./live-routing-actions";

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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MapPin, Navigation, Search, X } from "lucide-react";

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/**
 * Find-item-and-route panel: the routing engine (`previewLiveRoute`) has
 * existed since the routing stage but had no picker UI on the live canvas --
 * this is that picker, driven by what is actually in stock rather than a
 * manual location pick.
 */
export default function InventoryPanel({
  warehouseId,
  hallId,
  vehicles,
  hasGraph,
  originLocationId,
  originLocationCode,
  pickingOrigin,
  onStartPickOrigin,
  onClearOrigin,
  destinations,
  onAddDestination,
  onRemoveDestination,
  onClearDestinations,
  preview,
  onPreview,
  onClearPreview,
  onSearchResultsChange,
  locked,
}: {
  warehouseId: number;
  hallId: number;
  vehicles: RoutingVehicleDTO[];
  hasGraph: boolean;
  originLocationId: number | null;
  originLocationCode: string | null;
  pickingOrigin: boolean;
  onStartPickOrigin: () => void;
  onClearOrigin: () => void;
  destinations: ItemSearchResultDTO[];
  onAddDestination: (result: ItemSearchResultDTO) => void;
  onRemoveDestination: (locationId: number) => void;
  onClearDestinations: () => void;
  preview: RoutePreview | null;
  onPreview: (result: RoutePreview | null) => void;
  onClearPreview: () => void;
  onSearchResultsChange: (results: ItemSearchResultDTO[]) => void;
  locked: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ItemSearchResultDTO[]>([]);
  const [isSearching, startSearch] = useTransition();
  const [isRouting, startRoute] = useTransition();
  const [mheTypeId, setMheTypeId] = useState<string>("foot");

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      onSearchResultsChange([]);
      return;
    }
    startSearch(async () => {
      const found = await searchWarehouseItems(warehouseId, hallId, trimmed);
      setResults(found);
      onSearchResultsChange(found);
    });
  }

  function handleClearSearch() {
    setQuery("");
    setResults([]);
    onSearchResultsChange([]);
  }

  function handleComputeRoute() {
    if (!originLocationId || destinations.length === 0) return;
    startRoute(async () => {
      const result = await previewLiveRoute(
        warehouseId,
        hallId,
        originLocationId,
        destinations.map((d) => d.locationId),
        { mheTypeId: mheTypeId === "foot" ? null : Number(mheTypeId) },
      );
      onPreview(result);
    });
  }

  const canRoute = hasGraph && originLocationId != null && destinations.length > 0;
  const destinationIds = new Set(destinations.map((d) => d.locationId));

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Find Item &amp; Route
      </Label>

      {!hasGraph ? (
        <p className="px-1 text-[11px] leading-snug text-muted-foreground">
          No navigation graph published for this hall yet -- routing needs the
          aisle network from the layout designer.
        </p>
      ) : (
        <>
          <form onSubmit={handleSearch} className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="SKU, item, batch, or lot..."
                className="h-8 pl-7 text-xs"
              />
            </div>
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={isSearching}
              className="h-8 px-2 text-xs"
            >
              {isSearching ? "…" : "Go"}
            </Button>
            {(query || results.length > 0) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearSearch}
                className="h-8 px-1.5"
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </form>

          {results.length > 0 && (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border bg-card p-1.5">
              {results.map((r) => {
                const added = destinationIds.has(r.locationId);
                return (
                  <div
                    key={`${r.locationId}-${r.itemId}-${r.batchNumber ?? ""}-${r.lotNumber ?? ""}`}
                    className="flex items-center justify-between gap-1.5 rounded px-1.5 py-1 text-[11px] hover:bg-muted/60"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-mono font-semibold text-foreground">
                        {r.locationCode} · {r.sku}
                      </div>
                      <div className="truncate text-muted-foreground">
                        {r.itemName ?? "Unknown item"} · qty {r.quantity}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant={added ? "secondary" : "outline"}
                      size="sm"
                      disabled={added || locked}
                      onClick={() => onAddDestination(r)}
                      className="h-6 shrink-0 px-1.5 text-[10px]"
                    >
                      {added ? "Added" : "Add stop"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {query && results.length === 0 && !isSearching && (
            <p className="px-1 text-[11px] text-muted-foreground">
              No stock matches &quot;{query}&quot; in this hall.
            </p>
          )}

          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant={pickingOrigin ? "default" : "outline"}
              size="sm"
              disabled={locked}
              onClick={onStartPickOrigin}
              className="h-7 flex-1 justify-start text-xs"
            >
              <MapPin className="mr-1.5 h-3.5 w-3.5" />
              {originLocationCode
                ? `From ${originLocationCode}`
                : pickingOrigin
                  ? "Click a location…"
                  : "Pick start on map"}
            </Button>
            {originLocationId != null && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={locked}
                onClick={onClearOrigin}
                className="h-7 px-1.5 text-[11px]"
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>

          {destinations.length > 0 && (
            <div className="space-y-1 rounded-md border bg-card p-1.5 text-[11px]">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>
                  {destinations.length} stop{destinations.length === 1 ? "" : "s"}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={locked}
                  onClick={onClearDestinations}
                  className="h-5 px-1 text-[10px]"
                >
                  Clear
                </Button>
              </div>
              {destinations.map((d) => (
                <div
                  key={d.locationId}
                  className="flex items-center justify-between gap-1.5"
                >
                  <span className="truncate font-mono">{d.locationCode}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={locked}
                    onClick={() => onRemoveDestination(d.locationId)}
                    className="h-5 px-1"
                  >
                    <X className="h-2.5 w-2.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="inv-route-vehicle" className="text-[11px]">
              Travelling as
            </Label>
            <Select value={mheTypeId} onValueChange={setMheTypeId}>
              <SelectTrigger id="inv-route-vehicle" className="h-8 w-full text-xs">
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

          <Button
            variant="outline"
            size="sm"
            disabled={locked || isRouting || !canRoute}
            onClick={handleComputeRoute}
            className="w-full justify-start text-xs"
          >
            <Navigation className="mr-1.5 h-3.5 w-3.5" />
            {isRouting ? "Routing…" : "Compute route"}
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
                  onClick={onClearPreview}
                  className="h-6 px-1.5 text-[11px]"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
              <p className="text-muted-foreground">
                {formatDuration(preview.travelMs ?? 0)} travelling ·{" "}
                {formatDuration(preview.handlingMs ?? 0)} handling ·{" "}
                congestion-aware
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
