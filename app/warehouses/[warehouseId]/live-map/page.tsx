import { redirect } from "next/navigation";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  assetPositions,
  employees,
  featureKinds as featureKindsTable,
  halls as hallsTable,
  layoutBlockages,
  layoutFeatures,
  locations,
  navEdges,
  navNodes,
  warehouses,
  zoneTypes,
} from "@/drizzle/schema";
import { requireLiveMapContext } from "@/lib/warehouse-map/context";
import { sanitizePoints, type GeometryKind } from "@/lib/warehouse-map/geometry";
import type { FeatureAttrs, FeatureCategory } from "@/lib/warehouse-map/feature-kinds";
import { parseLocationType } from "@/lib/warehouse-map/naming";
import type {
  BlockageDTO,
  LiveAssetDTO,
  NavGraphDTO,
} from "@/lib/warehouse-map/types";
import LiveMapView from "./live-map-view";
import { getBottlenecks, getHeatmapCells } from "./traffic-actions";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { Radio } from "lucide-react";

const HEATMAP_CELL_SIZE_MM = 1000;

/**
 * Operational live map.
 *
 * Reads the *published* layout only -- there is no draft state here, and no
 * way to mutate geometry. Designing the map and watching it are separate
 * jobs done by different people at different times, so they are separate
 * modules with separate permissions.
 */
export default async function LiveMapPage({
  params,
  searchParams,
}: {
  params: Promise<{ warehouseId: string }>;
  searchParams?: Promise<{ hall?: string }>;
}) {
  const { warehouseId } = await params;
  const parsedWarehouseId = Number(warehouseId);
  if (!Number.isInteger(parsedWarehouseId) || parsedWarehouseId <= 0) {
    redirect("/warehouses");
  }

  const query = (await searchParams) ?? {};
  const { canReportBlockages } = await requireLiveMapContext(parsedWarehouseId);

  const [warehouse] = await db
    .select({ warehouseId: warehouses.warehouseId, name: warehouses.name })
    .from(warehouses)
    .where(eq(warehouses.warehouseId, parsedWarehouseId))
    .limit(1);
  if (!warehouse) redirect("/warehouses");

  const halls = await db
    .select({
      hallId: hallsTable.hallId,
      name: hallsTable.name,
      physicalWidthMm: hallsTable.physicalWidthMm,
      physicalLengthMm: hallsTable.physicalLengthMm,
      clearHeightMm: hallsTable.clearHeightMm,
      isActive: hallsTable.isActive,
    })
    .from(hallsTable)
    .where(eq(hallsTable.warehouseId, parsedWarehouseId))
    .orderBy(hallsTable.name);

  if (halls.length === 0) {
    return (
      <main className="flex h-[calc(100vh-64px)] flex-1 items-center justify-center bg-[linear-gradient(180deg,#ebe7dc_0%,#f7f4ed_24%,#f4f1e8_100%)] p-6">
        <Card className="w-full max-w-md text-center shadow-xl">
          <CardHeader>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 text-teal-600">
              <Radio className="h-6 w-6" />
            </div>
            <CardTitle className="mt-4 text-xl">No halls to watch</CardTitle>
            <CardDescription className="text-xs/relaxed">
              This warehouse has no halls yet. Build one in the Layout Designer
              first — the live map shows a published layout, it does not create
              one.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  const requestedHallId = Number(query.hall);
  const hall = halls.find((h) => h.hallId === requestedHallId) ?? halls[0];

  const [
    locationRows,
    zoneRows,
    featureRows,
    featureKindRows,
    navNodeRows,
    navEdgeRows,
    blockageRows,
    assetRows,
  ] = await Promise.all([
    db
      .select({
        locationId: locations.locationId,
        locationCode: locations.locationCode,
        zoneId: locations.zoneId,
        aisle: locations.aisle,
        bay: locations.bay,
        level: locations.level,
        row: locations.row,
        locationType: locations.locationType,
        heightMm: locations.heightMm,
        maxWeightKg: locations.maxWeightKg,
        isBlocked: locations.isBlocked,
        physicalX: locations.physicalX,
        physicalY: locations.physicalY,
        physicalWidthMm: locations.physicalWidthMm,
        physicalLengthMm: locations.physicalLengthMm,
        rotationDegrees: locations.rotationDegrees,
        floorLevel: locations.floorLevel,
      })
      .from(locations)
      .where(
        and(
          eq(locations.warehouseId, parsedWarehouseId),
          eq(locations.hallId, hall.hallId),
        ),
      ),
    db
      .select({
        zoneId: zoneTypes.zoneId,
        name: zoneTypes.name,
        isPickable: zoneTypes.isPickable,
        isTemperatureControlled: zoneTypes.isTemperatureControlled,
        requiresHazmatClearance: zoneTypes.requiresHazmatClearance,
        requiresBarcodeScan: zoneTypes.requiresBarcodeScan,
        storagePermanence: zoneTypes.storagePermanence,
        color: zoneTypes.color,
      })
      .from(zoneTypes)
      .where(eq(zoneTypes.warehouseId, parsedWarehouseId)),
    db
      .select({
        featureId: layoutFeatures.featureId,
        floorLevel: layoutFeatures.floorLevel,
        kind: layoutFeatures.kind,
        geometryKind: layoutFeatures.geometryKind,
        originXMm: layoutFeatures.originXMm,
        originYMm: layoutFeatures.originYMm,
        widthMm: layoutFeatures.widthMm,
        lengthMm: layoutFeatures.lengthMm,
        rotationDegrees: layoutFeatures.rotationDegrees,
        points: layoutFeatures.points,
        elevationMm: layoutFeatures.elevationMm,
        heightMm: layoutFeatures.heightMm,
        layerIndex: layoutFeatures.layerIndex,
        isObstacle: layoutFeatures.isObstacle,
        isVisualOnly: layoutFeatures.isVisualOnly,
        zoneId: layoutFeatures.zoneId,
        label: layoutFeatures.label,
        color: layoutFeatures.color,
        attrs: layoutFeatures.attrs,
      })
      .from(layoutFeatures)
      .where(
        and(
          eq(layoutFeatures.hallId, hall.hallId),
          eq(layoutFeatures.isActive, true),
        ),
      ),
    db
      .select({
        kind: featureKindsTable.kind,
        category: featureKindsTable.category,
        label: featureKindsTable.label,
        defaultGeometryKind: featureKindsTable.defaultGeometryKind,
        defaultWidthMm: featureKindsTable.defaultWidthMm,
        defaultLengthMm: featureKindsTable.defaultLengthMm,
        defaultHeightMm: featureKindsTable.defaultHeightMm,
        isObstacleDefault: featureKindsTable.isObstacleDefault,
        defaultColor: featureKindsTable.defaultColor,
        sortOrder: featureKindsTable.sortOrder,
      })
      .from(featureKindsTable)
      .where(eq(featureKindsTable.isActive, true)),
    db
      .select({
        nodeId: navNodes.nodeId,
        xMm: navNodes.xMm,
        yMm: navNodes.yMm,
        floorLevel: navNodes.floorLevel,
        nodeKind: navNodes.nodeKind,
        isGenerated: navNodes.isGenerated,
      })
      .from(navNodes)
      .where(eq(navNodes.hallId, hall.hallId)),
    db
      .select({
        edgeId: navEdges.edgeId,
        fromNodeId: navEdges.fromNodeId,
        toNodeId: navEdges.toNodeId,
        edgeKind: navEdges.edgeKind,
        traversal: navEdges.traversal,
        lengthMm: navEdges.lengthMm,
        widthMm: navEdges.widthMm,
        isGenerated: navEdges.isGenerated,
      })
      .from(navEdges)
      .where(eq(navEdges.hallId, hall.hallId)),
    db
      .select({
        blockageId: layoutBlockages.blockageId,
        edgeIds: layoutBlockages.edgeIds,
        originXMm: layoutBlockages.originXMm,
        originYMm: layoutBlockages.originYMm,
        radiusMm: layoutBlockages.radiusMm,
        reason: layoutBlockages.reason,
        notes: layoutBlockages.notes,
        startedAt: layoutBlockages.startedAt,
        expiresAt: layoutBlockages.expiresAt,
      })
      .from(layoutBlockages)
      .where(
        and(
          eq(layoutBlockages.hallId, hall.hallId),
          eq(layoutBlockages.isActive, true),
          // Expiry is evaluated by the database -- an expired blockage is
          // stale data, not an obstruction.
          or(
            isNull(layoutBlockages.expiresAt),
            sql`${layoutBlockages.expiresAt} > CURRENT_TIMESTAMP`,
          ),
        ),
      ),
    // Snapshot only. Live positions arrive over the Realtime channel; this is
    // what the map shows before the first message lands.
    db
      .select({
        assetKind: assetPositions.assetKind,
        assetRefId: assetPositions.assetRefId,
        xMm: assetPositions.xMm,
        yMm: assetPositions.yMm,
        floorLevel: assetPositions.floorLevel,
        headingDeg: assetPositions.headingDeg,
        source: assetPositions.source,
        confidence: assetPositions.confidence,
        status: assetPositions.status,
        routePlanId: assetPositions.routePlanId,
        observedAt: assetPositions.observedAt,
        firstName: employees.firstName,
        lastName: employees.lastName,
      })
      .from(assetPositions)
      .leftJoin(
        employees,
        and(
          eq(assetPositions.assetKind, "EMPLOYEE"),
          eq(assetPositions.assetRefId, employees.employeeId),
        ),
      )
      .where(
        and(
          eq(assetPositions.warehouseId, parsedWarehouseId),
          eq(assetPositions.hallId, hall.hallId),
        ),
      ),
  ]);

  const mapLocations = locationRows.map((row) => ({
    ...row,
    locationType: parseLocationType(row.locationType),
  }));

  const mapFeatures = featureRows.map((row) => ({
    ...row,
    geometryKind: row.geometryKind as GeometryKind,
    points: sanitizePoints(row.points),
    attrs: (row.attrs ?? {}) as FeatureAttrs,
  }));

  const mapFeatureKinds = featureKindRows.map((row) => ({
    ...row,
    category: row.category as FeatureCategory,
    defaultGeometryKind: row.defaultGeometryKind as GeometryKind,
  }));

  const navGraph: NavGraphDTO = {
    nodes: navNodeRows,
    edges: navEdgeRows,
    accessPointCount: 0,
    layoutVersion: null,
  };

  const blockages: BlockageDTO[] = blockageRows;

  const [bottlenecks, heatmapCells] = await Promise.all([
    getBottlenecks(parsedWarehouseId, hall.hallId),
    getHeatmapCells(parsedWarehouseId, hall.hallId, {
      cellSizeMm: HEATMAP_CELL_SIZE_MM,
    }),
  ]);

  const initialAssets: LiveAssetDTO[] = assetRows.map((row) => ({
    assetKind: row.assetKind as "EMPLOYEE" | "MHE",
    assetRefId: row.assetRefId,
    label:
      [row.firstName, row.lastName].filter(Boolean).join(" ") ||
      `${row.assetKind} ${row.assetRefId}`,
    xMm: row.xMm,
    yMm: row.yMm,
    floorLevel: row.floorLevel,
    headingDeg: row.headingDeg,
    source: row.source,
    confidence: Number(row.confidence),
    status: row.status,
    routePlanId: row.routePlanId,
    observedAt: row.observedAt,
  }));

  return (
    <main className="flex h-[calc(100vh-64px)] flex-1 flex-col gap-4 overflow-hidden bg-[linear-gradient(180deg,#ebe7dc_0%,#f7f4ed_24%,#f4f1e8_100%)] p-4 sm:p-6">
      <Card className="shrink-0 rounded-2xl shadow-sm">
        <CardHeader className="px-6 py-5 sm:px-8">
          <DynamicBreadcrumb />
          <CardTitle className="mt-3 text-3xl font-bold tracking-[-0.04em] text-foreground">
            Live Map
          </CardTitle>
          <CardDescription className="mt-2 text-sm">
            Real-time activity across{" "}
            <span className="font-semibold text-foreground">
              {warehouse.name ?? "this warehouse"}
            </span>
            .
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="min-h-0 flex-1">
        <LiveMapView
          warehouseId={parsedWarehouseId}
          halls={halls}
          selectedHallId={hall.hallId}
          hall={hall}
          locations={mapLocations}
          zoneTypes={zoneRows}
          features={mapFeatures}
          featureKinds={mapFeatureKinds}
          navGraph={navGraph}
          blockages={blockages}
          initialAssets={initialAssets}
          canReportBlockages={canReportBlockages}
          bottlenecks={bottlenecks}
          heatmapCells={heatmapCells}
          heatmapCellSizeMm={HEATMAP_CELL_SIZE_MM}
        />
      </div>
    </main>
  );
}
