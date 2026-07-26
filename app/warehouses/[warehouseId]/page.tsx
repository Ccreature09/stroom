import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { employees, positionTypes, warehouses } from "@/drizzle/schema";
import { createClient } from "@/lib/server";
import { Card, CardContent } from "@/components/ui/card";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
export default async function WarehouseDashboardPage({
  params,
}: {
  params: Promise<{ warehouseId: string }>;
}) {
  const { warehouseId } = await params;
  const parsedWarehouseId = Number(warehouseId);
  if (!Number.isInteger(parsedWarehouseId) || parsedWarehouseId <= 0) {
    redirect("/warehouses");
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
      canViewMetrics: positionTypes.canViewMetrics,
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
    .select({
      warehouseId: warehouses.warehouseId,
      name: warehouses.name,
      city: warehouses.city,
      country: warehouses.country,
      timezone: warehouses.timezone,
      isActive: warehouses.isActive,
    })
    .from(warehouses)
    .where(
      and(
        eq(warehouses.organizationId, employee.organizationId),
        eq(warehouses.warehouseId, parsedWarehouseId),
      ),
    )
    .limit(1);

  if (!warehouse) {
    redirect("/warehouses");
  }

  return (
    <main className="flex-1 bg-slate-50 px-5 py-10 sm:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="rounded-2xl border border-slate-200 bg-white px-6 py-6 shadow-sm sm:px-8">
          <DynamicBreadcrumb />
          <h1 className="mt-3 text-3xl font-bold tracking-[-0.04em] text-slate-950">
            {warehouse.name || `Warehouse #${warehouse.warehouseId}`}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            {[warehouse.city, warehouse.country].filter(Boolean).join(", ") ||
              "No location set"}
            {warehouse.timezone ? ` · ${warehouse.timezone}` : ""}
          </p>
          <p className="mt-3 inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
            {warehouse.isActive ? "Active" : "Inactive"}
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {/* Core Configuration & Management Modules */}
          {employee.canModifyConfigs ? (
            <Link href={`/warehouses/${warehouse.warehouseId}/configs`}>
              <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md h-full">
                <CardContent className="p-6">
                  <h2 className="text-lg font-bold text-slate-950">
                    Warehouse Configs
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Manage warehouse-level operating rules and behaviors.
                  </p>
                  <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">
                    Open module →
                  </span>
                </CardContent>
              </Card>
            </Link>
          ) : null}

          {employee.canManageUsers ? (
            <Link href={`/warehouses/${warehouse.warehouseId}/people-roles`}>
              <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md h-full">
                <CardContent className="p-6">
                  <h2 className="text-lg font-bold text-slate-950">
                    People & Roles
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Assign and monitor team members working in this facility.
                  </p>
                  <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">
                    Open module →
                  </span>
                </CardContent>
              </Card>
            </Link>
          ) : null}

          {employee.canModifyLayout ? (
            <Link href={`/warehouses/${warehouse.warehouseId}/layout-designer`}>
              <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md h-full">
                <CardContent className="p-6">
                  <h2 className="text-lg font-bold text-slate-950">
                    Layout Designer
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Define zones, aisles, bins and physical warehouse structure.
                  </p>
                  <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">
                    Open module →
                  </span>
                </CardContent>
              </Card>
            </Link>
          ) : null}

          {/* 1. Master Data & Partners */}
          <Link href={`/warehouses/${warehouse.warehouseId}/master-data`}>
            <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md h-full">
              <CardContent className="p-6">
                <h2 className="text-lg font-bold text-slate-950">
                  Master Data & Partners
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  Manage items, suppliers, customers, and carriers.
                </p>
                <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">
                  Open module →
                </span>
              </CardContent>
            </Card>
          </Link>

          {/* 2. Inventory Control */}
          <Link href={`/warehouses/${warehouse.warehouseId}/inventory`}>
            <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md h-full">
              <CardContent className="p-6">
                <h2 className="text-lg font-bold text-slate-950">
                  Inventory Control
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  Track live stock balances, LPN pallets, and movement logs.
                </p>
                <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">
                  Open module →
                </span>
              </CardContent>
            </Card>
          </Link>

          {/* 3. Inbound Logistics */}
          <Link href={`/warehouses/${warehouse.warehouseId}/inbound`}>
            <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md h-full">
              <CardContent className="p-6">
                <h2 className="text-lg font-bold text-slate-950">
                  Inbound Logistics
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  Handle purchase orders, receiving, dock booking, and putaway.
                </p>
                <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">
                  Open module →
                </span>
              </CardContent>
            </Card>
          </Link>

          {/* 4. Outbound Logistics */}
          <Link href={`/warehouses/${warehouse.warehouseId}/outbound`}>
            <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md h-full">
              <CardContent className="p-6">
                <h2 className="text-lg font-bold text-slate-950">
                  Outbound Logistics
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  Process sales orders, picking tasks, staging, and shipments.
                </p>
                <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">
                  Open module →
                </span>
              </CardContent>
            </Card>
          </Link>

          {/* 5. Internal Operations & Audits */}
          <Link href={`/warehouses/${warehouse.warehouseId}/internal-ops`}>
            <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md h-full">
              <CardContent className="p-6">
                <h2 className="text-lg font-bold text-slate-950">
                  Internal Operations
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  Execute stock replenishments, cycle counting, and inventory
                  audits.
                </p>
                <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">
                  Open module →
                </span>
              </CardContent>
            </Card>
          </Link>

          {/* 6. Task Control Engine */}
          <Link href={`/warehouses/${warehouse.warehouseId}/task-control`}>
            <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md h-full">
              <CardContent className="p-6">
                <h2 className="text-lg font-bold text-slate-950">
                  Task Control Engine
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  Central queue to monitor, prioritize, and dispatch operational
                  tasks.
                </p>
                <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">
                  Open module →
                </span>
              </CardContent>
            </Card>
          </Link>
        </section>
      </div>
    </main>
  );
}
