import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { employees, positionTypes, warehouses } from "@/drizzle/schema";
import { createClient } from "@/lib/server";

export default async function WarehouseDashboardPage({
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
      canManageUsers: positionTypes.canManageUsers,
      canModifyConfigs: positionTypes.canModifyConfigs,
      canModifyLayout: positionTypes.canModifyLayout,
      // Add or adjust additional permission flags here as needed
      canViewMetrics: positionTypes.canViewMetrics,
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

  return (
    <main className="flex-1 bg-slate-50 px-5 py-10 sm:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="rounded-2xl border border-slate-200 bg-white px-6 py-6 shadow-sm sm:px-8">
          <Link href="/dashboard/warehouses" className="text-sm font-semibold text-teal-700 hover:text-teal-800">
            ← All warehouses
          </Link>
          <h1 className="mt-3 text-3xl font-bold tracking-[-0.04em] text-slate-950">
            {warehouse.name || `Warehouse #${warehouse.warehouseId}`}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            {[warehouse.city, warehouse.country].filter(Boolean).join(", ") || "No location set"}
            {warehouse.timezone ? ` · ${warehouse.timezone}` : ""}
          </p>
          <p className="mt-3 inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
            {warehouse.isActive ? "Active" : "Inactive"}
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {/* Core Configuration & Management Modules */}
          {employee.canModifyConfigs ? (
            <Link
              href={`/dashboard/warehouses/${warehouse.warehouseId}/configs`}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md"
            >
              <h2 className="text-lg font-bold text-slate-950">Warehouse Configs</h2>
              <p className="mt-2 text-sm text-slate-600">Manage warehouse-level operating rules and behaviors.</p>
              <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">Open module →</span>
            </Link>
          ) : null}

          {employee.canManageUsers ? (
            <Link
              href={`/dashboard/warehouses/${warehouse.warehouseId}/people-roles`}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md"
            >
              <h2 className="text-lg font-bold text-slate-950">People & Roles</h2>
              <p className="mt-2 text-sm text-slate-600">Assign and monitor team members working in this facility.</p>
              <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">Open module →</span>
            </Link>
          ) : null}

          {employee.canModifyLayout ? (
            <Link
              href={`/dashboard/warehouses/${warehouse.warehouseId}/layout-designer`}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md"
            >
              <h2 className="text-lg font-bold text-slate-950">Layout Designer</h2>
              <p className="mt-2 text-sm text-slate-600">Define zones, aisles, bins and physical warehouse structure.</p>
              <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">Open module →</span>
            </Link>
          ) : null}

          {/* 1. Master Data & Partners */}
          <Link
            href={`/dashboard/warehouses/${warehouse.warehouseId}/master-data`}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md"
          >
            <h2 className="text-lg font-bold text-slate-950">Master Data & Partners</h2>
            <p className="mt-2 text-sm text-slate-600">Manage items, suppliers, customers, and carriers.</p>
            <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">Open module →</span>
          </Link>

          {/* 2. Inventory Control */}
          <Link
            href={`/dashboard/warehouses/${warehouse.warehouseId}/inventory`}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md"
          >
            <h2 className="text-lg font-bold text-slate-950">Inventory Control</h2>
            <p className="mt-2 text-sm text-slate-600">Track live stock balances, LPN pallets, and movement logs.</p>
            <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">Open module →</span>
          </Link>

          {/* 3. Inbound Logistics */}
          <Link
            href={`/dashboard/warehouses/${warehouse.warehouseId}/inbound`}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md"
          >
            <h2 className="text-lg font-bold text-slate-950">Inbound Logistics</h2>
            <p className="mt-2 text-sm text-slate-600">Handle purchase orders, receiving, dock booking, and putaway.</p>
            <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">Open module →</span>
          </Link>

          {/* 4. Outbound Logistics */}
          <Link
            href={`/dashboard/warehouses/${warehouse.warehouseId}/outbound`}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md"
          >
            <h2 className="text-lg font-bold text-slate-950">Outbound Logistics</h2>
            <p className="mt-2 text-sm text-slate-600">Process sales orders, picking tasks, staging, and shipments.</p>
            <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">Open module →</span>
          </Link>

          {/* 5. Internal Operations & Audits */}
          <Link
            href={`/dashboard/warehouses/${warehouse.warehouseId}/internal-ops`}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md"
          >
            <h2 className="text-lg font-bold text-slate-950">Internal Operations</h2>
            <p className="mt-2 text-sm text-slate-600">Execute stock replenishments, cycle counting, and inventory audits.</p>
            <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">Open module →</span>
          </Link>

          {/* 6. Task Control Engine */}
          <Link
            href={`/dashboard/warehouses/${warehouse.warehouseId}/task-control`}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md"
          >
            <h2 className="text-lg font-bold text-slate-950">Task Control Engine</h2>
            <p className="mt-2 text-sm text-slate-600">Central queue to monitor, prioritize, and dispatch operational tasks.</p>
            <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">Open module →</span>
          </Link>
        </section>
      </div>
    </main>
  );
}