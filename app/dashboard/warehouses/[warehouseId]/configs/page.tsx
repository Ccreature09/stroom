import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { employees, positionTypes, warehouseConfigs, warehouses } from "@/drizzle/schema";
import { createClient } from "@/lib/server";
import { updateWarehouseConfig } from "../actions";

type SearchParams = {
  status?: "success" | "error";
  message?: string;
};

export default async function WarehouseConfigsPage({
  params,
  searchParams,
}: {
  params: Promise<{ warehouseId: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const query = (await searchParams) ?? {};

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
      canModifyConfigs: positionTypes.canModifyConfigs,
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
      requireStagingBeforePutaway: warehouseConfigs.requireStagingBeforePutaway,
      allowMixedSkuPerLocation: warehouseConfigs.allowMixedSkuPerLocation,
      allowMixedLpnPerLocation: warehouseConfigs.allowMixedLpnPerLocation,
      defaultPutawayStrategy: warehouseConfigs.defaultPutawayStrategy,
      cycleCountFrequencyDays: warehouseConfigs.cycleCountFrequencyDays,
      updatedAt: warehouseConfigs.updatedAt,
    })
    .from(warehouses)
    .leftJoin(warehouseConfigs, eq(warehouses.configId, warehouseConfigs.configId))
    .where(and(eq(warehouses.organizationId, employee.organizationId), eq(warehouses.warehouseId, parsedWarehouseId)))
    .limit(1);

  if (!warehouse) redirect("/dashboard/warehouses");

  const updatedAtValue = warehouse.updatedAt
    ? new Date(warehouse.updatedAt).toISOString().slice(0, 16)
    : "";

  const statusClass =
    query.status === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-red-200 bg-red-50 text-red-800";

  return (
    <main className="flex-1 bg-slate-50 px-5 py-10 sm:px-8">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="rounded-2xl border border-slate-200 bg-white px-6 py-6 shadow-sm sm:px-8">
          <Link href={`/dashboard/warehouses/${warehouse.warehouseId}`} className="text-sm font-semibold text-teal-700 hover:text-teal-800">
            ← Back to warehouse dashboard
          </Link>
          <h1 className="mt-3 text-3xl font-bold tracking-[-0.04em] text-slate-950">Warehouse Configs</h1>
          <p className="mt-2 text-sm text-slate-600">
            Configure operating rules for {warehouse.name || `Warehouse #${warehouse.warehouseId}`}.
          </p>
        </header>

        {query.message ? (
          <div className={`rounded-xl border px-4 py-3 text-sm font-medium ${statusClass}`}>{query.message}</div>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <form action={updateWarehouseConfig} className="space-y-4">
            <input type="hidden" name="warehouseId" value={warehouse.warehouseId} />

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-slate-700">
                Default putaway strategy
                <input
                  name="defaultPutawayStrategy"
                  required
                  maxLength={20}
                  defaultValue={warehouse.defaultPutawayStrategy ?? "NEAREST_EMPTY"}
                  className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm uppercase outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                />
              </label>

              <label className="text-sm font-semibold text-slate-700">
                Cycle count frequency (days)
                <input
                  name="cycleCountFrequencyDays"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={warehouse.cycleCountFrequencyDays ?? ""}
                  className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                />
              </label>

              <label className="text-sm font-semibold text-slate-700 sm:col-span-2">
                Updated at
                <input
                  name="updatedAt"
                  type="datetime-local"
                  defaultValue={updatedAtValue}
                  className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                />
              </label>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  name="requireStagingBeforePutaway"
                  defaultChecked={warehouse.requireStagingBeforePutaway ?? true}
                  className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                />
                Require staging before putaway
              </label>

              <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  name="allowMixedSkuPerLocation"
                  defaultChecked={warehouse.allowMixedSkuPerLocation ?? false}
                  className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                />
                Allow mixed SKU per location
              </label>

              <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 sm:col-span-2">
                <input
                  type="checkbox"
                  name="allowMixedLpnPerLocation"
                  defaultChecked={warehouse.allowMixedLpnPerLocation ?? true}
                  className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                />
                Allow mixed LPN per location
              </label>
            </div>

            {employee.canModifyConfigs ? (
              <button
                type="submit"
                className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Save warehouse config
              </button>
            ) : (
              <p className="text-sm font-medium text-amber-700">You do not have permission to modify configs for this warehouse.</p>
            )}
          </form>
        </section>
      </div>
    </main>
  );
}
