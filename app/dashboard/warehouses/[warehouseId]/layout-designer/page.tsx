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
      <main className="flex h-[calc(100vh-64px)] flex-1 items-center justify-center overflow-hidden bg-[linear-gradient(180deg,#ebe7dc_0%,#f7f4ed_24%,#f4f1e8_100%)] p-4 sm:p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white/95 p-8 shadow-xl backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/95">
          {/* Header Icon & Title */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 text-teal-600 ring-8 ring-teal-50/50 dark:bg-teal-950/50 dark:text-teal-400 dark:ring-teal-950/30">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21" />
              </svg>
            </div>
            <h1 className="mt-4 text-xl font-bold tracking-tight text-slate-900 dark:text-zinc-50">
              Create your first hall
            </h1>
            <p className="mt-1.5 text-xs/relaxed text-slate-500 dark:text-zinc-400">
              A hall defines the physical canvas boundaries inside{" "}
              <span className="font-semibold text-slate-700 dark:text-zinc-200">
                {warehouse.name ?? "this warehouse"}
              </span>.
            </p>
          </div>

          {/* Creation Form */}
          <form action={createHall} className="mt-6 space-y-4">
            <input type="hidden" name="warehouseId" value={parsedWarehouseId} />

            <div>
              <label htmlFor="name" className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-zinc-400">
                Hall Name
              </label>
              <input
                id="name"
                name="name"
                required
                placeholder="e.g. Hall A - Main Storage"
                className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-teal-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="physicalWidthMm" className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-zinc-400">
                    Width (mm)
                  </label>
                  <span className="text-[10px] text-slate-400 dark:text-zinc-500">80m</span>
                </div>
                <input
                  id="physicalWidthMm"
                  name="physicalWidthMm"
                  type="number"
                  min={1}
                  defaultValue={80_000}
                  className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 shadow-sm transition focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-teal-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="physicalLengthMm" className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-zinc-400">
                    Length (mm)
                  </label>
                  <span className="text-[10px] text-slate-400 dark:text-zinc-500">60m</span>
                </div>
                <input
                  id="physicalLengthMm"
                  name="physicalLengthMm"
                  type="number"
                  min={1}
                  defaultValue={60_000}
                  className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 shadow-sm transition focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-teal-500"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="clearHeightMm" className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-zinc-400">
                  Clear Height (mm)
                </label>
                <span className="text-[10px] text-slate-400 dark:text-zinc-500">10m</span>
              </div>
              <input
                id="clearHeightMm"
                name="clearHeightMm"
                type="number"
                min={1}
                defaultValue={10_000}
                className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 shadow-sm transition focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-teal-500"
              />
            </div>

            <button
              type="submit"
              className="mt-2 flex w-full items-center justify-center rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-teal-500 active:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-400"
            >
              Create Hall & Open Designer
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