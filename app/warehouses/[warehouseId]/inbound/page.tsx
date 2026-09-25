import Link from "next/link";
import { requireInboundManagerAccess } from "@/lib/warehouse-access";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";

export default async function InboundDashboardPage({
  params,
}: {
  params: Promise<{ warehouseId: string }>;
}) {
  const { warehouseId } = await params;
  const { employee, warehouse, warehouseId: parsedWarehouseId } =
    await requireInboundManagerAccess(warehouseId);

  return (
    <main className="flex-1 bg-slate-50 px-5 py-10 sm:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardHeader className="px-6 py-6 sm:px-8">
            <DynamicBreadcrumb />
            <CardTitle className="mt-3 text-3xl font-bold tracking-[-0.04em] text-slate-950">
              Inbound Operations
            </CardTitle>
            <CardDescription className="mt-2 text-sm text-slate-600">
              From purchase order to putaway -- everything that brings stock
              into{" "}
              <span className="font-semibold text-slate-800">
                {warehouse.name}
              </span>
              .
            </CardDescription>
          </CardHeader>
        </Card>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Link
            href={`/warehouses/${parsedWarehouseId}/inbound/purchase-orders`}
            className="group block focus:outline-none"
          >
            <Card className="flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md">
              <CardHeader className="p-6">
                <CardTitle className="text-lg font-bold text-slate-950">
                  Purchase Orders
                </CardTitle>
                <CardDescription className="mt-2 text-sm text-slate-600">
                  Place orders with suppliers and receive against them as
                  stock arrives.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-6 pb-6 pt-0">
                <span className="inline-flex text-sm font-semibold text-teal-700 transition-colors group-hover:text-teal-800">
                  View Orders →
                </span>
              </CardContent>
            </Card>
          </Link>

          <Link
            href={`/warehouses/${parsedWarehouseId}/inbound/bookings`}
            className="group block focus:outline-none"
          >
            <Card className="flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md">
              <CardHeader className="p-6">
                <CardTitle className="text-lg font-bold text-slate-950">
                  Dock Appointments
                </CardTitle>
                <CardDescription className="mt-2 text-sm text-slate-600">
                  Book dock doors and time slots for expected deliveries.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-6 pb-6 pt-0">
                <span className="inline-flex text-sm font-semibold text-teal-700 transition-colors group-hover:text-teal-800">
                  View Bookings →
                </span>
              </CardContent>
            </Card>
          </Link>

          <Link
            href={`/warehouses/${parsedWarehouseId}/inbound/unloading`}
            className="group block focus:outline-none"
          >
            <Card className="flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md">
              <CardHeader className="p-6">
                <CardTitle className="text-lg font-bold text-slate-950">
                  Unloading
                </CardTitle>
                <CardDescription className="mt-2 text-sm text-slate-600">
                  Track trailers at the dock and the pallets coming off them.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-6 pb-6 pt-0">
                <span className="inline-flex text-sm font-semibold text-teal-700 transition-colors group-hover:text-teal-800">
                  View Unloading →
                </span>
              </CardContent>
            </Card>
          </Link>

          <Link
            href={`/warehouses/${parsedWarehouseId}/inbound/putaway`}
            className="group block focus:outline-none"
          >
            <Card className="flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md">
              <CardHeader className="p-6">
                <CardTitle className="text-lg font-bold text-slate-950">
                  Putaway
                </CardTitle>
                <CardDescription className="mt-2 text-sm text-slate-600">
                  Direct received pallets from staging to their storage
                  location.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-6 pb-6 pt-0">
                <span className="inline-flex text-sm font-semibold text-teal-700 transition-colors group-hover:text-teal-800">
                  View Putaway →
                </span>
              </CardContent>
            </Card>
          </Link>
        </section>

        <p className="text-xs text-slate-400">
          Signed in as{" "}
          {[employee.firstName, employee.lastName].filter(Boolean).join(" ") ||
            "Employee"}
        </p>
      </div>
    </main>
  );
}
