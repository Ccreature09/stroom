import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import WarehouseLayoutDesigner from "@/components/layout-designer/WarehouseLayoutDesigner";
import { db } from "@/lib/db";
import type { WarehouseLayoutLocation, WarehouseLayoutWarehouseSummary } from "@/lib/warehouse-layout/types";
import { employees, locations, positionTypes, warehouses, zoneTypes } from "@/drizzle/schema";
import { createClient } from "@/lib/server";

export default async function WarehouseLayoutDesignerPage({
  params,
}: {
  params: Promise<{ warehouseId: string }>;
}) {
  const { warehouseId } = await params;
  const parsedWarehouseId = Number(warehouseId);
  if (!Number.isInteger(parsedWarehouseId) || parsedWarehouseId <= 0) {
    redirect("/dashboard/warehouses");
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/sign-in");

  const [employee] = await db
    .select({
      organizationId: employees.organizationId,
      canModifyLocations: positionTypes.canModifyLocations,
    })
    .from(employees)
    .innerJoin(positionTypes, eq(employees.positionId, positionTypes.positionId))
    .where(and(eq(employees.authUserId, userId), eq(employees.isActive, true)))
    .limit(1);

  if (!employee) redirect("/sign-in");

  const [warehouse] = await db
    .select({
      warehouseId: warehouses.warehouseId,
      name: warehouses.name,
      city: warehouses.city,
      country: warehouses.country,
      timezone: warehouses.timezone,
      isActive: warehouses.isActive,
    })
    .from(warehouses)
    .where(and(eq(warehouses.organizationId, employee.organizationId), eq(warehouses.warehouseId, parsedWarehouseId)))
    .limit(1);

  if (!warehouse) {
    redirect("/dashboard/warehouses");
  }

  const locationRows = await db
    .select({
      locationId: locations.locationId,
      warehouseId: locations.warehouseId,
      zoneId: locations.zoneId,
      locationCode: locations.locationCode,
      aisle: locations.aisle,
      bay: locations.bay,
      level: locations.level,
      position: locations.position,
      heightMm: locations.heightMm,
      maxWeightKg: locations.maxWeightKg,
      isBlocked: locations.isBlocked,
      updatedAt: locations.updatedAt,
      physicalX: locations.physicalX,
      physicalY: locations.physicalY,
      physicalWidthMm: locations.physicalWidthMm,
      physicalLengthMm: locations.physicalLengthMm,
      rotationDegrees: locations.rotationDegrees,
      floorLevel: locations.floorLevel,
      storagePermanence: zoneTypes.storagePermanence,
      requiresBarcodeScan: zoneTypes.requiresBarcodeScan,
      zoneName: zoneTypes.name,
    })
    .from(locations)
    .leftJoin(zoneTypes, eq(locations.zoneId, zoneTypes.zoneId))
    .where(eq(locations.warehouseId, parsedWarehouseId))
    .orderBy(asc(locations.floorLevel), asc(locations.locationCode));

  const initialLocations: WarehouseLayoutLocation[] = locationRows.map((row) => ({
    locationId: row.locationId,
    warehouseId: row.warehouseId,
    zoneId: row.zoneId,
    locationCode: row.locationCode,
    aisle: row.aisle,
    bay: row.bay,
    level: row.level,
    position: row.position,
    heightMm: row.heightMm,
    maxWeightKg: row.maxWeightKg,
    isBlocked: row.isBlocked,
    updatedAt: row.updatedAt,
    physicalX: row.physicalX,
    physicalY: row.physicalY,
    physicalWidthMm: row.physicalWidthMm,
    physicalLengthMm: row.physicalLengthMm,
    rotationDegrees: row.rotationDegrees,
    floorLevel: row.floorLevel,
    storagePermanence: row.storagePermanence,
    requiresBarcodeScan: row.requiresBarcodeScan ?? true,
    zoneName: row.zoneName,
  }));

  const floorLevels = Array.from(new Set(initialLocations.map((location) => location.floorLevel))).sort((left, right) => left - right);

  const warehouseSummary: WarehouseLayoutWarehouseSummary = {
    warehouseId: warehouse.warehouseId,
    name: warehouse.name,
    city: warehouse.city,
    country: warehouse.country,
    timezone: warehouse.timezone,
    isActive: warehouse.isActive,
  };

  return (
    <main className="flex h-[calc(100vh-64px)] flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,#ebe7dc_0%,#f7f4ed_24%,#f4f1e8_100%)] px-4 py-4 sm:px-6">
      <div className="mx-auto flex h-full w-full max-w-[1800px] min-h-0 flex-col gap-4">
        <header className="shrink-0 rounded-[28px] border border-stone-300/80 bg-white/85 px-6 py-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur sm:px-8">
          <Link href={`/dashboard/warehouses/${warehouseSummary.warehouseId}`} className="text-sm font-semibold text-teal-700 hover:text-teal-800">
            ← Warehouse dashboard
          </Link>
          <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-amber-700">Spatial Operations</p>
              <h1 className="mt-2 text-3xl font-bold tracking-[-0.05em] text-slate-950 sm:text-4xl">
                {warehouseSummary.name || `Warehouse #${warehouseSummary.warehouseId}`} layout designer
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Map racking, staging, buffers, and dock-adjacent structure on floor-specific planes using warehouse millimeter coordinates.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-semibold">
              <span className="rounded-full bg-slate-950 px-3 py-1.5 text-white">Pixi viewport</span>
              <span className="rounded-full bg-emerald-100 px-3 py-1.5 text-emerald-800">
                {employee.canModifyLocations ? "Edit enabled" : "Read only"}
              </span>
              <span className="rounded-full bg-white px-3 py-1.5 text-slate-600 ring-1 ring-inset ring-slate-200">
                {floorLevels.length > 0 ? `${floorLevels.length} floor level${floorLevels.length === 1 ? "" : "s"}` : "No floor data"}
              </span>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-hidden">
          <WarehouseLayoutDesigner
            warehouse={warehouseSummary}
            locations={initialLocations}
            floorLevels={floorLevels}
          />
        </div>
      </div>
    </main>
  );
}