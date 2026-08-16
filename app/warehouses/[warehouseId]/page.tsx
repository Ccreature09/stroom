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
      canAssignTasks: positionTypes.canAssignTasks,
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

          {employee.canViewMetrics ? (
            <Link href={`/warehouses/${warehouse.warehouseId}/live-map`}>
              <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md h-full">
                <CardContent className="p-6">
                  <h2 className="text-lg font-bold text-slate-950">
                    Live Map
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Watch people, equipment, and inventory move across the
                    published layout in real time.
                  </p>
                  <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">
                    Open module →
                  </span>
                </CardContent>
              </Card>
            </Link>
          ) : null}

          {/* Inbound Operations -- the management view over the whole
              inbound flow (suppliers, costs, reassigning others' work).
              Reserved for people who direct floor work; a floor worker
              wants My Tasks below instead. */}
          {employee.canAssignTasks ? (
            <Link href={`/warehouses/${warehouse.warehouseId}/inbound`}>
              <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md h-full">
                <CardContent className="p-6">
                  <h2 className="text-lg font-bold text-slate-950">
                    Inbound Operations
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Purchase orders, dock appointments, unloading, and
                    putaway.
                  </p>
                  <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">
                    Open module →
                  </span>
                </CardContent>
              </Card>
            </Link>
          ) : null}

          {/* Outbound Operations -- management view, same gate as Inbound. */}
          {employee.canAssignTasks ? (
            <Link href={`/warehouses/${warehouse.warehouseId}/outbound`}>
              <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md h-full">
                <CardContent className="p-6">
                  <h2 className="text-lg font-bold text-slate-950">
                    Outbound Operations
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Sales orders, picking, and building trailers for
                    dispatch.
                  </p>
                  <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">
                    Open module →
                  </span>
                </CardContent>
              </Card>
            </Link>
          ) : null}

          {/* Internal Operations -- management view, same gate. */}
          {employee.canAssignTasks ? (
            <Link href={`/warehouses/${warehouse.warehouseId}/internal`}>
              <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md h-full">
                <CardContent className="p-6">
                  <h2 className="text-lg font-bold text-slate-950">
                    Internal Operations
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Replenishing pick faces and cycle counting stock in
                    place.
                  </p>
                  <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">
                    Open module →
                  </span>
                </CardContent>
              </Card>
            </Link>
          ) : null}

          {/* Performance -- named individuals' output is on this page, so it
              sits behind canViewMetrics like Time Clock and Live Map. */}
          {employee.canViewMetrics ? (
            <Link href={`/warehouses/${warehouse.warehouseId}/metrics`}>
              <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md h-full">
                <CardContent className="p-6">
                  <h2 className="text-lg font-bold text-slate-950">
                    Performance
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Throughput, dock-to-stock, count accuracy, and where the
                    time actually goes.
                  </p>
                  <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">
                    Open module →
                  </span>
                </CardContent>
              </Card>
            </Link>
          ) : null}

          {/* Time Clock -- workforce hours. Behind the metrics gate, the
              same boundary individual worker location sits behind. */}
          {employee.canViewMetrics ? (
            <Link href={`/warehouses/${warehouse.warehouseId}/timeclock`}>
              <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md h-full">
                <CardContent className="p-6">
                  <h2 className="text-lg font-bold text-slate-950">
                    Time Clock
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Who is on shift now, and hours worked across the team.
                  </p>
                  <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">
                    Open module →
                  </span>
                </CardContent>
              </Card>
            </Link>
          ) : null}

          {/* Task Routing -- standing policy for which team gets which
              kind of work. Same gate as the manager views that consume it. */}
          {employee.canAssignTasks ? (
            <Link href={`/warehouses/${warehouse.warehouseId}/task-routing`}>
              <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md h-full">
                <CardContent className="p-6">
                  <h2 className="text-lg font-bold text-slate-950">
                    Task Routing
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Set which department each kind of task goes to by
                    default.
                  </p>
                  <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">
                    Open module →
                  </span>
                </CardContent>
              </Card>
            </Link>
          ) : null}

          {/* My Tasks -- the worker-facing surface. Open to everyone,
              including managers: it shows only what's assigned to (or
              claimable by) whoever is signed in, never the full supplier/
              cost picture. */}
          <Link href={`/warehouses/${warehouse.warehouseId}/floor`}>
            <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md h-full">
              <CardContent className="p-6">
                <h2 className="text-lg font-bold text-slate-950">
                  My Tasks
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  Dock appointments, unloading, and putaway assigned to you
                  -- receive a truck and book stock in.
                </p>
                <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">
                  Open module →
                </span>
              </CardContent>
            </Card>
          </Link>

          {/* Master Data & Partners */}
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

          {/* Inventory Control */}
          <Link href={`/warehouses/${warehouse.warehouseId}/inventory`}>
            <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md h-full">
              <CardContent className="p-6">
                <h2 className="text-lg font-bold text-slate-950">
                  Inventory Control
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  Track stock on hand, pallets, and every movement in the
                  warehouse.
                </p>
                <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">
                  Open module →
                </span>
              </CardContent>
            </Card>
          </Link>

          {/* Inbound/Outbound Logistics, Internal Operations, and Task Control
              Engine are not built yet -- their cards previously linked to
              routes that don't exist and 404'd. Re-add once each has real
              pages behind it. */}
        </section>
      </div>
    </main>
  );
}
