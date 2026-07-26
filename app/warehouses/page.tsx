import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { employees, positionTypes, warehouses } from "@/drizzle/schema";
import { createClient } from "@/lib/server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

export default async function WarehousesPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/sign-in");

  const [employee] = await db
    .select({
      organizationId: employees.organizationId,
    })
    .from(employees)
    .innerJoin(
      positionTypes,
      eq(employees.positionId, positionTypes.positionId),
    )
    .where(and(eq(employees.authUserId, userId), eq(employees.isActive, true)))
    .limit(1);

  if (!employee) redirect("/sign-in");

  const warehouseRows = await db
    .select({
      warehouseId: warehouses.warehouseId,
      configId: warehouses.configId,
      name: warehouses.name,
      street: warehouses.street,
      city: warehouses.city,
      postalCode: warehouses.postalCode,
      country: warehouses.country,
      timezone: warehouses.timezone,
      isActive: warehouses.isActive,
    })
    .from(warehouses)
    .where(eq(warehouses.organizationId, employee.organizationId));

  return (
    <main className="flex-1 bg-slate-50 px-5 py-10 sm:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardHeader className="px-6 py-6 sm:px-8">
            <CardTitle className="mt-3 text-3xl font-bold tracking-[-0.04em] text-slate-950">
              Warehouses
            </CardTitle>
            <CardDescription className="mt-2 text-sm text-slate-600">
              Open a warehouse module to access its dashboard.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold tracking-[-0.03em] text-slate-950">
            Warehouse modules
          </h2>

          {warehouseRows.length > 0 ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {warehouseRows.map((warehouse, index) => (
                <Link
                  key={warehouse.warehouseId}
                  href={`/warehouses/${warehouse.warehouseId}`}
                >
                  <Card className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md h-full">
                    <CardContent className="p-0">
                      <span className="grid h-9 w-9 place-items-center rounded-lg bg-teal-50 text-sm font-bold text-teal-700">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <h3 className="mt-4 text-lg font-bold tracking-[-0.02em] text-slate-950">
                        {warehouse.name ||
                          `Warehouse #${warehouse.warehouseId}`}
                      </h3>
                      <p className="mt-1 text-sm text-slate-600">
                        {[
                          warehouse.street,
                          warehouse.city,
                          warehouse.postalCode,
                          warehouse.country,
                        ]
                          .filter(Boolean)
                          .join(", ") || "No address yet"}
                      </p>
                      <div className="mt-4 flex items-center justify-between gap-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            warehouse.isActive
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {warehouse.isActive ? "Active" : "Inactive"}
                        </span>
                        <span className="text-sm font-semibold text-teal-700">
                          Open →
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-600">
              No warehouses found yet.
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
