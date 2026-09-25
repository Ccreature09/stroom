import Link from "next/link";
import { requireInternalManagerAccess } from "@/lib/warehouse-access";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";

export default async function InternalDashboardPage({
  params,
}: {
  params: Promise<{ warehouseId: string }>;
}) {
  const { warehouseId } = await params;
  const { employee, warehouse, warehouseId: parsedWarehouseId } =
    await requireInternalManagerAccess(warehouseId);

  const modules = [
    {
      href: `/warehouses/${parsedWarehouseId}/internal/replenishment`,
      title: "Replenishment",
      description:
        "Pick faces running below their minimum, and the reserve stock that can top them up before a picker finds an empty bay.",
      cta: "View Replenishment",
    },
    {
      href: `/warehouses/${parsedWarehouseId}/internal/cycle-count`,
      title: "Cycle Count",
      description:
        "Count stock in place without stopping the warehouse, and correct the record where it disagrees with the shelf.",
      cta: "View Counts",
    },
  ];

  return (
    <main className="flex-1 bg-slate-50 px-5 py-10 sm:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardHeader className="px-6 py-6 sm:px-8">
            <DynamicBreadcrumb />
            <CardTitle className="mt-3 text-3xl font-bold tracking-[-0.04em] text-slate-950">
              Internal Operations
            </CardTitle>
            <CardDescription className="mt-2 text-sm text-slate-600">
              Work that moves and verifies stock inside{" "}
              <span className="font-semibold text-slate-800">{warehouse.name}</span>{" "}
              rather than in or out of it.
            </CardDescription>
          </CardHeader>
        </Card>

        <section className="grid gap-4 md:grid-cols-2">
          {modules.map((module) => (
            <Link key={module.href} href={module.href} className="group block focus:outline-none">
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
