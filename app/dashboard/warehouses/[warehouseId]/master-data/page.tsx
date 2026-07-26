import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { employees, positionTypes, warehouses } from "@/drizzle/schema";
import { createClient } from "@/lib/server";

export default async function MasterDataDashboardPage({
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
      canModifyConfigs: positionTypes.canModifyConfigs,
      canModifyLayout: positionTypes.canModifyLayout,
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
    .where(
      and(
        eq(warehouses.organizationId, employee.organizationId),
        eq(warehouses.warehouseId, parsedWarehouseId)
      )
    )
    .limit(1);

  if (!warehouse) {
    redirect("/dashboard/warehouses");
  }

  return (
    <main className="flex-1 bg-slate-50 px-5 py-10 sm:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="rounded-2xl border border-slate-200 bg-white px-6 py-6 shadow-sm sm:px-8">
          <Link
            href={`/dashboard/warehouses/${warehouse.warehouseId}`}
            className="text-sm font-semibold text-teal-700 hover:text-teal-800"
          >
            ← Back to Warehouse
          </Link>
          <h1 className="mt-3 text-3xl font-bold tracking-[-0.04em] text-slate-950">
            Master Data & Partners
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Central registry for product catalog definitions and external supply chain entities.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {/* 1. Item Catalog / Products */}
          <Link
            href={`/dashboard/warehouses/${warehouse.warehouseId}/master-data/items`}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md flex flex-col justify-between"
          >
            <div>
              <h2 className="text-lg font-bold text-slate-950">Item Catalog</h2>
              <p className="mt-2 text-sm text-slate-600">
                Manage SKU definitions, physical dimensions, weight, hazard classes, and tracking flags.
              </p>
            </div>
            <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">View Items →</span>
          </Link>

          {/* 2. Suppliers Registry */}
          <Link
            href={`/dashboard/warehouses/${warehouse.warehouseId}/master-data/suppliers`}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md flex flex-col justify-between"
          >
            <div>
              <h2 className="text-lg font-bold text-slate-950">Suppliers</h2>
              <p className="mt-2 text-sm text-slate-600">
                Manage vendors and manufacturers supplying goods for inbound purchase orders.
              </p>
            </div>
            <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">View Suppliers →</span>
          </Link>

          {/* 3. Customers Registry */}
          <Link
            href={`/dashboard/warehouses/${warehouse.warehouseId}/master-data/customers`}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md flex flex-col justify-between"
          >
            <div>
              <h2 className="text-lg font-bold text-slate-950">Customers</h2>
              <p className="mt-2 text-sm text-slate-600">
                Manage buyer accounts, fulfillment destinations, and default shipping addresses.
              </p>
            </div>
            <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">View Customers →</span>
          </Link>

          {/* 4. Freight Carriers */}
          <Link
            href={`/dashboard/warehouses/${warehouse.warehouseId}/master-data/carriers`}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md flex flex-col justify-between"
          >
            <div>
              <h2 className="text-lg font-bold text-slate-950">Freight Carriers</h2>
              <p className="mt-2 text-sm text-slate-600">
                Manage logistics service providers, SCAC codes, and tracking templates.
              </p>
            </div>
            <span className="mt-4 inline-flex text-sm font-semibold text-teal-700">View Carriers →</span>
          </Link>
        </section>
      </div>
    </main>
  );
}