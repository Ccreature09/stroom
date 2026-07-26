import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { employees, positionTypes, warehouses } from "@/drizzle/schema";
import { createClient } from "@/lib/server";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";

export default async function MasterDataDashboardPage({
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
      firstName: employees.firstName,
      lastName: employees.lastName,
      organizationId: employees.organizationId,
      canModifyConfigs: positionTypes.canModifyConfigs,
      canModifyLayout: positionTypes.canModifyLayout,
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
        {/* Header Card */}
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardHeader className="px-6 py-6 sm:px-8">
            <DynamicBreadcrumb />
            <CardTitle className="mt-3 text-3xl font-bold tracking-[-0.04em] text-slate-950">
              Master Data & Partners
            </CardTitle>
            <CardDescription className="mt-2 text-sm text-slate-600">
              Central registry for product catalog definitions and external
              supply chain entities for{" "}
              <span className="font-semibold text-slate-800">
                {warehouse.name}
              </span>
              .
            </CardDescription>
            <p className="mt-2 text-xs uppercase tracking-[0.14em] text-slate-500">
              Signed in as{" "}
              {[employee.firstName, employee.lastName]
                .filter(Boolean)
                .join(" ") || "Administrator"}
            </p>
          </CardHeader>
        </Card>

        {/* Dashboard Grid */}
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {/* 1. Item Catalog / Products */}
          <Link
            href={`/warehouses/${warehouse.warehouseId}/master-data/items`}
            className="group block focus:outline-none"
          >
            <Card className="flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md">
              <CardHeader className="p-6">
                <CardTitle className="text-lg font-bold text-slate-950">
                  Item Catalog
                </CardTitle>
                <CardDescription className="mt-2 text-sm text-slate-600">
                  Manage SKU definitions, physical dimensions, weight, hazard
                  classes, and tracking flags.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-6 pb-6 pt-0">
                <span className="inline-flex text-sm font-semibold text-teal-700 transition-colors group-hover:text-teal-800">
                  View Items →
                </span>
              </CardContent>
            </Card>
          </Link>

          {/* 2. Suppliers Registry */}
          <Link
            href={`/warehouses/${warehouse.warehouseId}/master-data/suppliers`}
            className="group block focus:outline-none"
          >
            <Card className="flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md">
              <CardHeader className="p-6">
                <CardTitle className="text-lg font-bold text-slate-950">
                  Suppliers
                </CardTitle>
                <CardDescription className="mt-2 text-sm text-slate-600">
                  Manage vendors and manufacturers supplying goods for inbound
                  purchase orders.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-6 pb-6 pt-0">
                <span className="inline-flex text-sm font-semibold text-teal-700 transition-colors group-hover:text-teal-800">
                  View Suppliers →
                </span>
              </CardContent>
            </Card>
          </Link>

          {/* 3. Customers Registry */}
          <Link
            href={`/warehouses/${warehouse.warehouseId}/master-data/customers`}
            className="group block focus:outline-none"
          >
            <Card className="flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md">
              <CardHeader className="p-6">
                <CardTitle className="text-lg font-bold text-slate-950">
                  Customers
                </CardTitle>
                <CardDescription className="mt-2 text-sm text-slate-600">
                  Manage buyer accounts, fulfillment destinations, and default
                  shipping addresses.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-6 pb-6 pt-0">
                <span className="inline-flex text-sm font-semibold text-teal-700 transition-colors group-hover:text-teal-800">
                  View Customers →
                </span>
              </CardContent>
            </Card>
          </Link>

          {/* 4. Freight Carriers */}
          <Link
            href={`/warehouses/${warehouse.warehouseId}/master-data/carriers`}
            className="group block focus:outline-none"
          >
            <Card className="flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md">
              <CardHeader className="p-6">
                <CardTitle className="text-lg font-bold text-slate-950">
                  Freight Carriers
                </CardTitle>
                <CardDescription className="mt-2 text-sm text-slate-600">
                  Manage logistics service providers, SCAC codes, and tracking
                  templates.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-6 pb-6 pt-0">
                <span className="inline-flex text-sm font-semibold text-teal-700 transition-colors group-hover:text-teal-800">
                  View Carriers →
                </span>
              </CardContent>
            </Card>
          </Link>
        </section>
      </div>
    </main>
  );
}
