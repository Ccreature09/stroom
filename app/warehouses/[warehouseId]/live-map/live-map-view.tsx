"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  BlockageDTO,
  FeatureDTO,
  FeatureKindDTO,
  HallDTO,
  InventoryLocationDTO,
  ItemSearchResultDTO,
  LiveAssetDTO,
  LocationDTO,
  NavGraphDTO,
  RoutingVehicleDTO,
} from "@/lib/warehouse-map/types";
import type { LiveAsset } from "@/lib/warehouse-map/live-map";
import type { RoutePreview } from "@/lib/warehouse-map/routing-server";
import type { Point } from "@/lib/warehouse-map/geometry";
import LiveMapCanvas from "./live-map-canvas";
import BlockagePanel from "./blockage-panel";
import AssetRoster from "./asset-roster";
import AnalyticsPanel from "./analytics-panel";
import InventoryPanel from "./inventory-panel";
import { useLiveMap } from "./use-live-map";
import type { BottleneckDTO } from "./traffic-actions";
import type { HeatmapCell } from "@/lib/warehouse-map/traffic";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Info, Radio, RefreshCw } from "lucide-react";

const CONNECTION_STYLE: Record<string, string> = {
  live: "text-emerald-600",
  connecting: "text-amber-600",
  reconnecting: "text-amber-600",
  error: "text-destructive",
  idle: "text-muted-foreground",
};

const CONNECTION_LABEL: Record<string, string> = {
  live: "Live",
  connecting: "Connecting…",
  reconnecting: "Reconnecting…",
  error: "Channel error",
  idle: "Paused",
};

/** Server snapshot rows become the shape the interpolator expects. */
function toLiveAsset(dto: LiveAssetDTO): LiveAsset {
  return {
    assetKind: dto.assetKind,
    assetRefId: dto.assetRefId,
    label: dto.label,
    fixX: dto.xMm,
    fixY: dto.yMm,
    floorLevel: dto.floorLevel,
    fixedAt: dto.observedAt ? new Date(dto.observedAt).getTime() : Date.now(),
    source: dto.source as LiveAsset["source"],
    status: dto.status as LiveAsset["status"],
    headingDeg: dto.headingDeg,
    routePoints: null,
    speedMms: null,
  };
}

export default function LiveMapView({
  warehouseId,
  halls,
  selectedHallId,
  hall,
  locations,
  features,
  featureKinds,
  navGraph,
  blockages,
  initialAssets,
  canReportBlockages,
  bottlenecks,
  heatmapCells,
  heatmapCellSizeMm,
  initialInventory,
  routingVehicles,
  hasNavGraph,
}: {
  warehouseId: number;
  halls: HallDTO[];
  selectedHallId: number;
  hall: HallDTO;
  locations: LocationDTO[];
  features: FeatureDTO[];
  featureKinds: FeatureKindDTO[];
  navGraph: NavGraphDTO;
  blockages: BlockageDTO[];
  initialAssets: LiveAssetDTO[];
  canReportBlockages: boolean;
  bottlenecks: BottleneckDTO[];
  heatmapCells: HeatmapCell[];
  heatmapCellSizeMm: number;
  initialInventory: InventoryLocationDTO[];
  routingVehicles: RoutingVehicleDTO[];
  hasNavGraph: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [isPaused, setIsPaused] = useState(false);
  const [showNavGraph, setShowNavGraph] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showInventory, setShowInventory] = useState(true);
  const [pickedPoint, setPickedPoint] = useState<Point | null>(null);
  const [isPicking, setIsPicking] = useState(false);

  // Find-item-and-route state. Origin is picked on the canvas (a read-only
  // click, not a mutation -- see locationAtPoint in the canvas), destinations
  // come from the inventory search results below.
  const [originLocationId, setOriginLocationId] = useState<number | null>(
    null,
  );
  const [pickingOrigin, setPickingOrigin] = useState(false);
  const [destinations, setDestinations] = useState<ItemSearchResultDTO[]>([]);
  const [searchResultIds, setSearchResultIds] = useState<number[]>([]);
  const [routePreview, setRoutePreview] = useState<RoutePreview | null>(null);

  const highlightedLocationIds = useMemo(() => {
    const ids = new Set<number>(searchResultIds);
    for (const d of destinations) ids.add(d.locationId);
    return ids;
  }, [searchResultIds, destinations]);

  const originLocationCode = useMemo(
    () =>
      originLocationId != null
        ? (locations.find((l) => l.locationId === originLocationId)
            ?.locationCode ?? null)
        : null,
    [locations, originLocationId],
  );

  // Snapshot -> live shape. Memoised on identity so the hook does not reseed
  // its asset map on every render.
  const seededAssets = useMemo(
    () => initialAssets.map(toLiveAsset),
    [initialAssets],
  );

  // Unlike the designer, this view subscribes as soon as it opens: watching
  // is the entire point of it.
  const live = useLiveMap({
    warehouseId,
    hallId: hall.hallId,
    enabled: !isPaused,
    initialAssets: seededAssets,
    initialInventory,
  });

  // A layout republish or a blockage raised elsewhere makes what is on screen
  // wrong, so refetch rather than show it.
  useEffect(() => {
    if (live.layoutChangedAt || live.resyncRequestedAt) {
      startTransition(() => router.refresh());
    }
  }, [live.layoutChangedAt, live.resyncRequestedAt, router]);

  const assetList = useMemo(
    () => Array.from(live.assets.values()),
    [live.assets],
  );

  function handlePointPicked(point: Point) {
    setPickedPoint(point);
    setIsPicking(false);
  }

  // Blockage placement and route-origin picking share the same canvas click
  // -- only one can be "armed" at a time, so starting either cancels the
  // other rather than letting a click satisfy both silently.
  function handleStartPickBlockage() {
    setPickedPoint(null);
    setPickingOrigin(false);
    setIsPicking(true);
  }

  function handleStartPickOrigin() {
    setIsPicking(false);
    setPickingOrigin(true);
  }

  function handleRouteOriginPicked(locationId: number) {
    setOriginLocationId(locationId);
    setPickingOrigin(false);
    setRoutePreview(null);
  }

  function handleAddDestination(result: ItemSearchResultDTO) {
    setDestinations((prev) =>
      prev.some((d) => d.locationId === result.locationId)
        ? prev
        : [...prev, result],
    );
    setRoutePreview(null);
  }

  function handleRemoveDestination(locationId: number) {
    setDestinations((prev) => prev.filter((d) => d.locationId !== locationId));
    setRoutePreview(null);
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-row overflow-hidden rounded-xl border bg-background/40">
      <div className="flex w-72 shrink-0 flex-col gap-5 overflow-y-auto border-r bg-background/70 p-4">
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Hall
          </Label>
          <Select
            value={String(selectedHallId)}
            onValueChange={(value) =>
              router.push(`/warehouses/${warehouseId}/live-map?hall=${value}`)
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {halls.map((h) => (
                <SelectItem key={h.hallId} value={String(h.hallId)}>
                  {h.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between rounded-md border bg-card px-2 py-1.5 text-xs">
            <span className="flex items-center gap-1.5 font-medium">
              <Radio
                className={`h-3.5 w-3.5 ${CONNECTION_STYLE[live.connection]}`}
              />
              {CONNECTION_LABEL[live.connection]}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => startTransition(() => router.refresh())}
              className="h-6 px-1.5"
              title="Refetch the snapshot"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="pause-live"
              checked={isPaused}
              onCheckedChange={(checked) => setIsPaused(checked === true)}
            />
            <Label
              htmlFor="pause-live"
              className="cursor-pointer text-xs font-medium leading-none"
            >
              Pause updates
            </Label>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="show-graph"
              checked={showNavGraph}
              onCheckedChange={(checked) => setShowNavGraph(checked === true)}
            />
            <Label
              htmlFor="show-graph"
              className="cursor-pointer text-xs font-medium leading-none"
            >
              Show travel network
            </Label>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="show-inventory"
              checked={showInventory}
              onCheckedChange={(checked) => setShowInventory(checked === true)}
            />
            <Label
              htmlFor="show-inventory"
              className="cursor-pointer text-xs font-medium leading-none"
            >
              Show inventory
            </Label>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-2 text-[11px] leading-snug text-sky-900">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            Positions are scan-derived: each fix comes from someone&apos;s last
            inventory action, not a continuous feed. Most warehouses don&apos;t
            run RTLS hardware, so this is the honest default rather than a
            simulated one -- certainty fades with age (see the % on each
            person below) instead of staying pinned to a stale spot.
          </p>
        </div>

        <AssetRoster assets={assetList} />

        <InventoryPanel
          warehouseId={warehouseId}
          hallId={hall.hallId}
          vehicles={routingVehicles}
          hasGraph={hasNavGraph}
          originLocationId={originLocationId}
          originLocationCode={originLocationCode}
          pickingOrigin={pickingOrigin}
          onStartPickOrigin={handleStartPickOrigin}
          onClearOrigin={() => {
            setOriginLocationId(null);
            setRoutePreview(null);
          }}
          destinations={destinations}
          onAddDestination={handleAddDestination}
          onRemoveDestination={handleRemoveDestination}
          onClearDestinations={() => {
            setDestinations([]);
            setRoutePreview(null);
          }}
          preview={routePreview}
          onPreview={setRoutePreview}
          onClearPreview={() => setRoutePreview(null)}
          onSearchResultsChange={(results) =>
            setSearchResultIds(results.map((r) => r.locationId))
          }
          locked={false}
        />

        <BlockagePanel
          warehouseId={warehouseId}
          hallId={hall.hallId}
          blockages={blockages}
          pickedPoint={pickedPoint}
          isPicking={isPicking}
          onStartPicking={handleStartPickBlockage}
          onCancel={() => {
            setPickedPoint(null);
            setIsPicking(false);
          }}
          canReport={canReportBlockages}
        />

        <AnalyticsPanel
          warehouseId={warehouseId}
          hallId={hall.hallId}
          bottlenecks={bottlenecks}
          showHeatmap={showHeatmap}
          onToggleHeatmap={setShowHeatmap}
          onRefreshed={() => startTransition(() => router.refresh())}
        />
      </div>

      <div className="relative flex min-w-0 flex-1 items-center justify-center bg-muted/30 p-4">
        <div className="h-full w-full overflow-hidden rounded-xl shadow-sm">
          <LiveMapCanvas
            hall={hall}
            locations={locations}
            features={features}
            featureKinds={featureKinds}
            navGraph={navGraph}
            showNavGraph={showNavGraph}
            blockages={blockages}
            heatmapCells={heatmapCells}
            showHeatmap={showHeatmap}
            heatmapCellSizeMm={heatmapCellSizeMm}
            bottleneckEdges={bottlenecks}
            assets={assetList}
            routes={
              routePreview?.points
                ? [{ key: "inventory-route", points: routePreview.points }]
                : []
            }
            pickingPoint={isPicking}
            onPointPicked={handlePointPicked}
            inventory={live.inventory}
            showInventory={showInventory}
            highlightedLocationIds={highlightedLocationIds}
            routeOriginLocationId={originLocationId}
            pickingRouteOrigin={pickingOrigin}
            onRouteOriginPicked={handleRouteOriginPicked}
          />
        </div>
      </div>
    </div>
  );
}
