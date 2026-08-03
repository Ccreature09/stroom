import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  employees,
  featureKinds as featureKindsTable,
  hallUnderlays,
  layoutDrafts,
  layoutFeatures,
  layoutVersions,
  locationAccessPoints,
  locations,
  mheTypes,
  navEdges,
  navNodes,
  positionTypes,
  halls as hallsTable,
  warehouses,
} from "@/drizzle/schema";
import {
  UNDERLAY_BUCKET,
  UNDERLAY_SIGNED_URL_TTL_SECONDS,
  createStorageClient,
} from "@/lib/warehouse-map/context";
import {
  DRAFT_STATE_VERSION,
  type HallState,
  type NavGraphDTO,
  type RoutingVehicleDTO,
  type RecoveredDraft,
  type UnderlayDTO,
} from "@/lib/warehouse-map/types";
import { createClient } from "@/lib/server";
import { createHall } from "./actions";
import LayoutDesigner from "./layout-designer";
import { sanitizePoints } from "@/lib/warehouse-map/geometry";
import type { GeometryKind } from "@/lib/warehouse-map/geometry";
import type { FeatureCategory, FeatureAttrs } from "@/lib/warehouse-map/feature-kinds";
import { parseLocationType } from "@/lib/warehouse-map/naming";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { Building2 } from "lucide-react";

export default async function WarehouseLayoutDesignerPage({
  params,
  searchParams,
}: {
  params: Promise<{ warehouseId: string }>;
  searchParams?: Promise<{ hall?: string }>;
}) {
  const { warehouseId } = await params;
  const parsedWarehouseId = Number(warehouseId);
  if (!Number.isInteger(parsedWarehouseId) || parsedWarehouseId <= 0)
    redirect("/warehouses");

  const query = (await searchParams) ?? {};

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/sign-in");

  const [employee] = await db
    .select({
      employeeId: employees.employeeId,
      firstName: employees.firstName,
      lastName: employees.lastName,
      organizationId: employees.organizationId,
      canModifyLocations: positionTypes.canModifyLocations,
    })
    .from(employees)
    .innerJoin(
      positionTypes,
      eq(employees.positionId, positionTypes.positionId),
    )
    .where(and(eq(employees.authUserId, userId), eq(employees.isActive, true)))
    .limit(1);

  if (!employee) redirect("/sign-in");

  const [warehouse] = await db
    .select({ warehouseId: warehouses.warehouseId, name: warehouses.name })
    .from(warehouses)
    .where(
      and(
        eq(warehouses.warehouseId, parsedWarehouseId),
        eq(warehouses.organizationId, employee.organizationId),
      ),
    )
    .limit(1);

  if (!warehouse) redirect("/warehouses");
  if (employee.canModifyLocations !== true)
    redirect(`/warehouses/${parsedWarehouseId}`);

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

  // No halls yet -- show a minimal empty state instead of an empty canvas.
  if (halls.length === 0) {
    return (
      <main className="flex h-[calc(100vh-64px)] flex-1 items-center justify-center overflow-hidden bg-[linear-gradient(180deg,#ebe7dc_0%,#f7f4ed_24%,#f4f1e8_100%)] p-4 sm:p-6">
        <Card className="w-full max-w-md shadow-xl backdrop-blur-sm">
          <CardHeader className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 text-teal-600 ring-8 ring-teal-50/50 dark:bg-teal-950/50 dark:text-teal-400 dark:ring-teal-950/30">
              <Building2 className="h-6 w-6" />
            </div>
            <CardTitle className="mt-4 text-xl">
              Create your first hall
            </CardTitle>
            <CardDescription className="text-xs/relaxed">
              A hall defines the physical canvas boundaries inside{" "}
              <span className="font-semibold text-foreground">
                {warehouse.name ?? "this warehouse"}
              </span>
              .
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form action={createHall} className="space-y-4">
              <input
                type="hidden"
                name="warehouseId"
                value={parsedWarehouseId}
              />

              <div className="space-y-1.5">
                <Label
                  htmlFor="name"
                  className="text-xs uppercase tracking-wider text-muted-foreground"
                >
                  Hall Name
                </Label>
                <Input
                  id="name"
                  name="name"
                  required
                  placeholder="e.g. Hall A - Main Storage"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label
                      htmlFor="physicalWidthMm"
                      className="text-xs uppercase tracking-wider text-muted-foreground"
                    >
                      Width (mm)
                    </Label>
                    <span className="text-[10px] text-muted-foreground">
                      80m
                    </span>
                  </div>
                  <Input
                    id="physicalWidthMm"
                    name="physicalWidthMm"
                    type="number"
                    min={1}
                    defaultValue={80_000}
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label
                      htmlFor="physicalLengthMm"
                      className="text-xs uppercase tracking-wider text-muted-foreground"
                    >
                      Length (mm)
                    </Label>
                    <span className="text-[10px] text-muted-foreground">
                      60m
                    </span>
                  </div>
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
                <div className="flex items-center justify-between">
                  <Label
                    htmlFor="clearHeightMm"
                    className="text-xs uppercase tracking-wider text-muted-foreground"
                  >
                    Clear Height (mm)
                  </Label>
                  <span className="text-[10px] text-muted-foreground">10m</span>
                </div>
                <Input
                  id="clearHeightMm"
                  name="clearHeightMm"
                  type="number"
                  min={1}
                  defaultValue={10_000}
                />
              </div>

              <Button
                type="submit"
                className="mt-2 w-full bg-teal-600 hover:bg-teal-500"
              >
                Create Hall & Open Designer
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    );
  }

  const requestedHallId = Number(query.hall);
  const selectedHall =
    halls.find((h) => h.hallId === requestedHallId) ?? halls[0];

  const [hallLocationRows, hallFeatureRows, featureKindRows] =
    await Promise.all([
      db
        .select({
          locationId: locations.locationId,
          locationCode: locations.locationCode,
          aisle: locations.aisle,
          bay: locations.bay,
          level: locations.level,
          heightMm: locations.heightMm,
          maxWeightKg: locations.maxWeightKg,
          isBlocked: locations.isBlocked,
          isTemporary: locations.isTemporary,
          physicalX: locations.physicalX,
          physicalY: locations.physicalY,
          physicalWidthMm: locations.physicalWidthMm,
          physicalLengthMm: locations.physicalLengthMm,
          rotationDegrees: locations.rotationDegrees,
          floorLevel: locations.floorLevel,
          locationType: locations.locationType,
          row: locations.row,
        })
        .from(locations)
        .where(
          and(
            eq(locations.warehouseId, parsedWarehouseId),
            eq(locations.hallId, selectedHall.hallId),
          ),
        ),
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
          label: layoutFeatures.label,
          color: layoutFeatures.color,
          attrs: layoutFeatures.attrs,
        })
        .from(layoutFeatures)
        .where(
          and(
            eq(layoutFeatures.warehouseId, parsedWarehouseId),
            eq(layoutFeatures.hallId, selectedHall.hallId),
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
        .where(eq(featureKindsTable.isActive, true))
        .orderBy(featureKindsTable.sortOrder),
    ]);

  // `location_type` and the feature geometry/category columns are varchar +
  // check constraint rather than a Postgres enum, so Drizzle types them as
  // plain strings. Narrow them once here so nothing downstream has to.
  const hallLocations = hallLocationRows.map((row) => ({
    ...row,
    locationType: parseLocationType(row.locationType),
  }));

  const hallFeatures = hallFeatureRows.map((row) => ({
    ...row,
    geometryKind: row.geometryKind as GeometryKind,
    points: sanitizePoints(row.points),
    attrs: (row.attrs ?? {}) as FeatureAttrs,
  }));

  const featureKinds = featureKindRows.map((row) => ({
    ...row,
    category: row.category as FeatureCategory,
    defaultGeometryKind: row.defaultGeometryKind as GeometryKind,
  }));

  // --- Layout lifecycle -----------------------------------------------------

  const [versionRows, draftRows, underlayRows] = await Promise.all([
    db
      .select({
        versionNumber: layoutVersions.versionNumber,
        graphEpoch: layoutVersions.graphEpoch,
        changeCount: layoutVersions.changeCount,
        notes: layoutVersions.notes,
        publishedAt: layoutVersions.publishedAt,
        firstName: employees.firstName,
        lastName: employees.lastName,
      })
      .from(layoutVersions)
      .leftJoin(employees, eq(layoutVersions.publishedBy, employees.employeeId))
      .where(eq(layoutVersions.warehouseId, parsedWarehouseId))
      .orderBy(desc(layoutVersions.versionNumber))
      .limit(10),
    db
      .select({
        hallId: layoutDrafts.hallId,
        state: layoutDrafts.state,
        stateVersion: layoutDrafts.stateVersion,
        baseVersionNumber: layoutDrafts.baseVersionNumber,
        changeCount: layoutDrafts.changeCount,
        updatedAt: layoutDrafts.updatedAt,
      })
      .from(layoutDrafts)
      .where(
        and(
          eq(layoutDrafts.warehouseId, parsedWarehouseId),
          eq(layoutDrafts.employeeId, employee.employeeId),
        ),
      ),
    db
      .select({
        underlayId: hallUnderlays.underlayId,
        hallId: hallUnderlays.hallId,
        floorLevel: hallUnderlays.floorLevel,
        storagePath: hallUnderlays.storagePath,
        originalFilename: hallUnderlays.originalFilename,
        imageWidthPx: hallUnderlays.imageWidthPx,
        imageHeightPx: hallUnderlays.imageHeightPx,
        scaleMmPerPx: hallUnderlays.scaleMmPerPx,
        offsetXMm: hallUnderlays.offsetXMm,
        offsetYMm: hallUnderlays.offsetYMm,
        rotationDegrees: hallUnderlays.rotationDegrees,
        opacity: hallUnderlays.opacity,
        isVisible: hallUnderlays.isVisible,
        calibMeasuredMm: hallUnderlays.calibMeasuredMm,
        calibKnownMm: hallUnderlays.calibKnownMm,
      })
      .from(hallUnderlays)
      .where(eq(hallUnderlays.hallId, selectedHall.hallId)),
  ]);

  // Compiled navigation graph for this hall, if one has been built.
  const [navNodeRows, navEdgeRows, accessPointCount, vehicleRows] =
    await Promise.all([
    db
      .select({
        nodeId: navNodes.nodeId,
        xMm: navNodes.xMm,
        yMm: navNodes.yMm,
        floorLevel: navNodes.floorLevel,
        nodeKind: navNodes.nodeKind,
        isGenerated: navNodes.isGenerated,
        layoutVersion: navNodes.layoutVersion,
      })
      .from(navNodes)
      .where(eq(navNodes.hallId, selectedHall.hallId)),
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
      .where(eq(navEdges.hallId, selectedHall.hallId)),
    db
      .select({ locationId: locationAccessPoints.locationId })
      .from(locationAccessPoints)
      .innerJoin(navNodes, eq(locationAccessPoints.nodeId, navNodes.nodeId))
      .where(eq(navNodes.hallId, selectedHall.hallId)),
    db
      .select({
        mheTypeId: mheTypes.mheTypeId,
        name: mheTypes.name,
        classBit: mheTypes.classBit,
        isPedestrian: mheTypes.isPedestrian,
      })
      .from(mheTypes)
      .orderBy(mheTypes.name),
  ]);

  const routingVehicles: RoutingVehicleDTO[] = vehicleRows.filter(
    (row) => row.classBit !== null,
  );

  const navGraph: NavGraphDTO = {
    nodes: navNodeRows.map((row) => ({
      nodeId: row.nodeId,
      xMm: row.xMm,
      yMm: row.yMm,
      floorLevel: row.floorLevel,
      nodeKind: row.nodeKind,
      isGenerated: row.isGenerated,
    })),
    edges: navEdgeRows,
    accessPointCount: accessPointCount.length,
    layoutVersion: navNodeRows[0]?.layoutVersion ?? null,
  };

  const versionHistory = versionRows.map((row) => ({
    versionNumber: row.versionNumber,
    graphEpoch: row.graphEpoch,
    changeCount: row.changeCount,
    notes: row.notes,
    publishedAt: row.publishedAt,
    publishedByName:
      [row.firstName, row.lastName].filter(Boolean).join(" ") || null,
  }));
  // 0 means "never published" -- the first publish creates version 1.
  const currentVersionNumber = versionHistory[0]?.versionNumber ?? 0;

  const recoveredDrafts: RecoveredDraft[] = draftRows
    // A draft written against an older HallState shape is not migratable in
    // general, so it is dropped rather than rehydrated into the reducer.
    .filter((row) => row.stateVersion === DRAFT_STATE_VERSION)
    .map((row) => ({
      hallId: row.hallId,
      state: row.state as HallState,
      baseVersionNumber: row.baseVersionNumber,
      changeCount: row.changeCount,
      updatedAt: row.updatedAt,
      isStale: row.baseVersionNumber !== currentVersionNumber,
    }));

  // Underlays live in a private bucket, so each one needs a short-lived signed
  // URL minted here. A failure to sign is not fatal -- the designer still
  // works, it just has no tracing image.
  const underlays: UnderlayDTO[] = [];
  if (underlayRows.length > 0) {
    try {
      const storage = createStorageClient().storage.from(UNDERLAY_BUCKET);
      const signed = await storage.createSignedUrls(
        underlayRows.map((row) => row.storagePath),
        UNDERLAY_SIGNED_URL_TTL_SECONDS,
      );
      const urlByPath = new Map<string, string>();
      for (const entry of signed.data ?? []) {
        if (entry.path && entry.signedUrl) {
          urlByPath.set(entry.path, entry.signedUrl);
        }
      }
      for (const row of underlayRows) {
        underlays.push({
          underlayId: row.underlayId,
          hallId: row.hallId,
          floorLevel: row.floorLevel,
          signedUrl: urlByPath.get(row.storagePath) ?? null,
          originalFilename: row.originalFilename,
          imageWidthPx: row.imageWidthPx,
          imageHeightPx: row.imageHeightPx,
          scaleMmPerPx: Number(row.scaleMmPerPx),
          offsetXMm: row.offsetXMm,
          offsetYMm: row.offsetYMm,
          rotationDegrees: row.rotationDegrees,
          opacity: Number(row.opacity),
          isVisible: row.isVisible,
          calibMeasuredMm: row.calibMeasuredMm,
          calibKnownMm: row.calibKnownMm,
        });
      }
    } catch (err) {
      console.error("Failed to sign underlay URLs:", err);
    }
  }

  return (
    <main className="flex h-[calc(100vh-64px)] flex-1 flex-col gap-4 overflow-hidden bg-[linear-gradient(180deg,#ebe7dc_0%,#f7f4ed_24%,#f4f1e8_100%)] p-4 sm:p-6">
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="px-6 py-6 sm:px-8">
          <DynamicBreadcrumb />
          <CardTitle className="mt-3 text-3xl font-bold tracking-[-0.04em] text-foreground">
            Layout Designer
          </CardTitle>
          <CardDescription className="mt-2 text-sm">
            Configure floor plans, rack coordinates, and staging locations for{" "}
            <span className="font-semibold text-foreground">
              {warehouse.name ?? "Warehouse"}
            </span>
            .
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="flex-1 overflow-hidden">
        <LayoutDesigner
          warehouseId={parsedWarehouseId}
          halls={halls}
          selectedHallId={selectedHall.hallId}
          locations={hallLocations}
          features={hallFeatures}
          featureKinds={featureKinds}
          currentVersionNumber={currentVersionNumber}
          versionHistory={versionHistory}
          recoveredDrafts={recoveredDrafts}
          underlays={underlays}
          navGraph={navGraph}
          routingVehicles={routingVehicles}
        />
      </div>
    </main>
  );
}
