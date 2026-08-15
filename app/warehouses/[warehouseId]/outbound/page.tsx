import Link from "next/link";
import { requireOutboundManagerAccess } from "@/lib/warehouse-access";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";

export default async function OutboundDashboardPage({
  params,
}: {
  params: Promise<{ warehouseId: string }>;
}) {
  const { warehouseId } = await params;
  const { employee, warehouse, warehouseId: parsedWarehouseId } =
    await requireOutboundManagerAccess(warehouseId);

  const modules = [
    {
      href: `/warehouses/${parsedWarehouseId}/outbound/sales-orders`,
      title: "Sales Orders",
      description:
        "Customer orders, and releasing them to the floor -- which reserves the exact batches to pull.",
      cta: "View Orders",
    },
    {
      href: `/warehouses/${parsedWarehouseId}/outbound/picking`,
      title: "Picking",
      description:
        "Every reserved pull, grouped by order pallet then by aisle so a picker walks the building once.",
      cta: "View Picks",
    },
    {
      href: `/warehouses/${parsedWarehouseId}/outbound/shipments`,
      title: "Shipments",
      description:
        "Build a trailer from picked orders, track loading pallet by pallet, and dispatch.",
      cta: "View Shipments",
    },
  ];

  return (
    <main className="flex-1 bg-slate-50 px-5 py-10 sm:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardHeader className="px-6 py-6 sm:px-8">
            <DynamicBreadcrumb />
            <CardTitle className="mt-3 text-3xl font-bold tracking-[-0.04em] text-slate-950">
              Outbound Operations
            </CardTitle>
            <CardDescription className="mt-2 text-sm text-slate-600">
              From customer order to dispatched trailer -- everything that
              takes stock out of{" "}
              <span className="font-semibold text-slate-800">{warehouse.name}</span>.
            </CardDescription>
          </CardHeader>
        </Card>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {modules.map((module) => (
            <Link
              key={module.href}
              href={module.href}
              className="group block focus:outline-none"
            >
              <Card className="flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md">
                <CardHeader className="p-6">
                  <CardTitle className="text-lg font-bold text-slate-950">
                    {module.title}
                  </CardTitle>
                  <CardDescription className="mt-2 text-sm text-slate-600">
                    {module.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-6 pb-6 pt-0">
                  <span className="inline-flex text-sm font-semibold text-teal-700 transition-colors group-hover:text-teal-800">
                    {module.cta} →
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </section>

        <p className="text-xs text-slate-400">
          Signed in as{" "}
          {[employee.firstName, employee.lastName].filter(Boolean).join(" ") || "Employee"}
        </p>
      </div>
    </main>
  );
}
