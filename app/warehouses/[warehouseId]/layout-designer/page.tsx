import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  employees,
  locations,
  positionTypes,
  halls as hallsTable,
  warehouses,
  zoneTypes,
} from "@/drizzle/schema";
import { createClient } from "@/lib/server";
import { createHall } from "./actions";
import LayoutDesigner from "./layout-designer";

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

  const [hallLocations, hallZoneTypes] = await Promise.all([
    db
      .select({
        locationId: locations.locationId,
        locationCode: locations.locationCode,
        zoneId: locations.zoneId,
        aisle: locations.aisle,
        bay: locations.bay,
        level: locations.level,
        heightMm: locations.heightMm,
        maxWeightKg: locations.maxWeightKg,
        isBlocked: locations.isBlocked,
        physicalX: locations.physicalX,
        physicalY: locations.physicalY,
        physicalWidthMm: locations.physicalWidthMm,
        physicalLengthMm: locations.physicalLengthMm,
        rotationDegrees: locations.rotationDegrees,
        floorLevel: locations.floorLevel,
        isRacking: locations.isRacking, // Added
        isShelf: locations.isShelf, // Added
        isFloorStorage: locations.isFloorStorage, // Added
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
      .where(eq(zoneTypes.warehouseId, parsedWarehouseId))
      .orderBy(zoneTypes.name),
  ]);

  return (
    <main className="flex min-h-[calc(100vh-64px)] flex-1 flex-col gap-4 bg-[linear-gradient(180deg,#ebe7dc_0%,#f7f4ed_24%,#f4f1e8_100%)] p-4 sm:p-6">
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="px-6 py-6 sm:px-8">
          <DynamicBreadcrumb />
          <CardTitle className="mt-3 text-3xl font-bold tracking-[-0.04em] text-foreground">
            Layout Designer
          </CardTitle>
          <CardDescription className="mt-2 text-sm">
            Configure floor plans, rack coordinates, and zone assignments for{" "}
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
          zoneTypes={hallZoneTypes}
        />
      </div>
    </main>
  );
}
