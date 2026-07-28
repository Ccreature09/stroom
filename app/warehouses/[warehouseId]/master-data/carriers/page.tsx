import { and, eq, ilike } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { carriers, employees } from "@/drizzle/schema";
import { createClient } from "@/lib/server";
import { ExternalLink, Search } from "lucide-react";
import { AddCarrierDialog } from "./add-carrier-dialog";
import { CarrierRowActions } from "./carrier-row-actions";

type SearchParams = Promise<{ q?: string }>;

export default async function WarehouseCarriersMasterDataPage({
  params,
  searchParams,
}: {
  params: Promise<{ warehouseId: string }>;
  searchParams: SearchParams;
}) {
  const { warehouseId } = await params;
  const { q: query } = await searchParams;
  const parsedWarehouseId = Number(warehouseId);

  if (!Number.isInteger(parsedWarehouseId) || parsedWarehouseId <= 0) {
    redirect("/warehouses");
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/sign-in");

  const [currentEmployee] = await db
    .select({ organizationId: employees.organizationId })
    .from(employees)
    .where(and(eq(employees.authUserId, userId), eq(employees.isActive, true)))
    .limit(1);

  if (!currentEmployee) redirect("/sign-in");

  const baseCondition = eq(
    carriers.organizationId,
    currentEmployee.organizationId,
  );
  const searchCondition = query
    ? ilike(carriers.name, `%${query}%`)
    : undefined;

  const carrierList = await db
    .select()
    .from(carriers)
    .where(
      searchCondition ? and(baseCondition, searchCondition) : baseCondition,
    );

  return (
    <main className="flex-1 space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Carriers
          </h1>
          <p className="text-sm text-slate-500">
            Manage shipping lines, freight providers, and tracking options.
          </p>
        </div>
        <AddCarrierDialog warehouseId={parsedWarehouseId} />
      </div>

      <div className="flex items-center justify-between gap-4">
        <form className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            name="q"
            defaultValue={query || ""}
            placeholder="Search carrier name..."
            className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 py-2 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/10"
          />
        </form>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
            <tr>
              <th className="px-6 py-3">Carrier Name</th>
              <th className="px-6 py-3">SCAC</th>
              <th className="px-6 py-3">Tracking Template</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {carrierList.map((carrier) => (
              <tr key={carrier.carrierId} className="hover:bg-slate-50">
                <td className="px-6 py-4 font-medium text-slate-900">
                  {carrier.name}
                </td>
                <td className="px-6 py-4 font-mono text-xs uppercase text-slate-700">
                  {carrier.scacCode ?? "-"}
                </td>
                <td className="px-6 py-4 font-mono text-xs text-slate-500 max-w-xs truncate">
                  {carrier.trackingUrlTemplate ? (
                    <span className="inline-flex items-center gap-1.5 text-slate-600">
                      <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                      {carrier.trackingUrlTemplate}
                    </span>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      carrier.isActive
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-slate-100 text-slate-600 border border-slate-200"
                    }`}
                  >
                    {carrier.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <CarrierRowActions
                    carrier={carrier}
                    warehouseId={parsedWarehouseId}
                  />
                </td>
              </tr>
            ))}
            {carrierList.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-6 py-8 text-center text-slate-500"
                >
                  No carriers found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
