"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  BlockageDTO,
  FeatureDTO,
  FeatureKindDTO,
  HallDTO,
  LiveAssetDTO,
  LocationDTO,
  NavGraphDTO,
  ZoneTypeDTO,
} from "@/lib/warehouse-map/types";
import type { LiveAsset } from "@/lib/warehouse-map/live-map";
import type { Point } from "@/lib/warehouse-map/geometry";
import LiveMapCanvas from "./live-map-canvas";
import BlockagePanel from "./blockage-panel";
import AssetRoster from "./asset-roster";
import { useLiveMap } from "./use-live-map";

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
import { Radio, RefreshCw } from "lucide-react";

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
  zoneTypes,
  features,
  featureKinds,
  navGraph,
  blockages,
  initialAssets,
  canReportBlockages,
}: {
  warehouseId: number;
  halls: HallDTO[];
  selectedHallId: number;
  hall: HallDTO;
  locations: LocationDTO[];
  zoneTypes: ZoneTypeDTO[];
  features: FeatureDTO[];
  featureKinds: FeatureKindDTO[];
  navGraph: NavGraphDTO;
  blockages: BlockageDTO[];
  initialAssets: LiveAssetDTO[];
  canReportBlockages: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [isPaused, setIsPaused] = useState(false);
  const [showNavGraph, setShowNavGraph] = useState(false);
  const [pickedPoint, setPickedPoint] = useState<Point | null>(null);
  const [isPicking, setIsPicking] = useState(false);

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
        </div>

        <AssetRoster assets={assetList} />

        <BlockagePanel
          warehouseId={warehouseId}
          hallId={hall.hallId}
          blockages={blockages}
          pickedPoint={pickedPoint}
          isPicking={isPicking}
          onStartPicking={() => {
            setPickedPoint(null);
            setIsPicking(true);
          }}
          onCancel={() => {
            setPickedPoint(null);
            setIsPicking(false);
          }}
          canReport={canReportBlockages}
        />
      </div>

      <div className="relative flex min-w-0 flex-1 items-center justify-center bg-muted/30 p-4">
        <div className="h-full w-full overflow-hidden rounded-xl shadow-sm">
          <LiveMapCanvas
            hall={hall}
            locations={locations}
            zoneTypes={zoneTypes}
            features={features}
            featureKinds={featureKinds}
            navGraph={navGraph}
            showNavGraph={showNavGraph}
            blockages={blockages}
            assets={assetList}
            routes={[]}
            pickingPoint={isPicking}
            onPointPicked={handlePointPicked}
          />
        </div>
      </div>
    </div>
  );
}
