import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees, locations, positionTypes, halls as hallsTable, warehouses, zoneTypes } from "@/drizzle/schema";
import { createClient } from "@/lib/server";
import { createHall } from "./actions";
import LayoutDesigner from "@/components/layout-designer/LayoutDesigner";

export default async function WarehouseLayoutDesignerPage({
  params,
  searchParams,
}: {
  params: Promise<{ warehouseId: string }>;
  searchParams?: Promise<{ hall?: string }>;
}) {
  const { warehouseId } = await params;
  const parsedWarehouseId = Number(warehouseId);
  if (!Number.isInteger(parsedWarehouseId) || parsedWarehouseId <= 0) redirect("/dashboard/warehouses");

  const query = (await searchParams) ?? {};

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
    .select({ warehouseId: warehouses.warehouseId, name: warehouses.name })
    .from(warehouses)
    .where(and(eq(warehouses.warehouseId, parsedWarehouseId), eq(warehouses.organizationId, employee.organizationId)))
    .limit(1);

  if (!warehouse) redirect("/dashboard/warehouses");
  if (employee.canModifyLocations !== true) redirect(`/dashboard/warehouses/${parsedWarehouseId}`);

  const halls = await db
    .select({
      hallId: hallsTable.hallId,
      name: hallsTable.name,
      physicalWidthMm: hallsTable.physicalWidthMm,
      physicalLengthMm: hallsTable.physicalLengthMm,
      clearHeightMm: hallsTable.clearHeightMm,
    })
    .from(hallsTable)
    .where(and(eq(hallsTable.warehouseId, parsedWarehouseId), eq(hallsTable.isActive, true)))
    .orderBy(hallsTable.name);

  // No halls yet -- show a minimal empty state instead of an empty canvas.
  if (halls.length === 0) {
    return (
      <main className="flex h-[calc(100vh-64px)] flex-1 items-center justify-center overflow-hidden bg-[linear-gradient(180deg,#ebe7dc_0%,#f7f4ed_24%,#f4f1e8_100%)] px-4 py-4 sm:px-6">
        <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Create your first hall</h1>
          <p className="mt-1 text-sm text-slate-500">
            A hall is a physical building or module inside {warehouse.name ?? "this warehouse"}. Its dimensions define the
            canvas bounds for the layout designer.
          </p>
          <form action={createHall} className="mt-5 space-y-4">
            <input type="hidden" name="warehouseId" value={parsedWarehouseId} />
            <div>
              <label htmlFor="name" className="text-sm font-semibold text-slate-700">Hall name</label>
              <input id="name" name="name" required placeholder="Hall A - Ambient" className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm shadow-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="physicalWidthMm" className="text-sm font-semibold text-slate-700">Width (mm)</label>
                <input id="physicalWidthMm" name="physicalWidthMm" type="number" min={1} defaultValue={80_000} className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm shadow-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10" />
              </div>
              <div>
                <label htmlFor="physicalLengthMm" className="text-sm font-semibold text-slate-700">Length (mm)</label>
                <input id="physicalLengthMm" name="physicalLengthMm" type="number" min={1} defaultValue={60_000} className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm shadow-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10" />
              </div>
            </div>
            <button type="submit" className="w-full rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800">
              Create hall
            </button>
          </form>
        </div>
      </main>
    );
  }

  const requestedHallId = Number(query.hall);
  const selectedHall = halls.find((h) => h.hallId === requestedHallId) ?? halls[0];

  const [hallLocations, hallZoneTypes] = await Promise.all([
    db
      .select({
        locationId: locations.locationId,
        locationCode: locations.locationCode,
        zoneId: locations.zoneId,
        aisle: locations.aisle,
        bay: locations.bay,
        level: locations.level,
        position: locations.position,
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
      .where(and(eq(locations.warehouseId, parsedWarehouseId), eq(locations.hallId, selectedHall.hallId))),
    db
      .select({
        zoneId: zoneTypes.zoneId,
        name: zoneTypes.name,
        isPickable: zoneTypes.isPickable,
        isTemperatureControlled: zoneTypes.isTemperatureControlled,
        requiresHazmatClearance: zoneTypes.requiresHazmatClearance,
        requiresBarcodeScan: zoneTypes.requiresBarcodeScan,
        storagePermanence: zoneTypes.storagePermanence,
      })
      .from(zoneTypes)
      .where(eq(zoneTypes.warehouseId, parsedWarehouseId))
      .orderBy(zoneTypes.name),
  ]);

  return (
    <main className="flex h-[calc(100vh-64px)] flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,#ebe7dc_0%,#f7f4ed_24%,#f4f1e8_100%)] px-4 py-4 sm:px-6">
      <LayoutDesigner
        warehouseId={parsedWarehouseId}
        halls={halls}
        selectedHallId={selectedHall.hallId}
        locations={hallLocations}
        zoneTypes={hallZoneTypes}
      />
    </main>
  );
}