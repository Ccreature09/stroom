import { and, eq, ilike, or } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { suppliers, employees } from "@/drizzle/schema";
import { createClient } from "@/lib/server";
import { Search, Mail, Phone, Clock, MapPin } from "lucide-react";
import { AddSupplierDialog } from "./add-supplier-dialog";
import { SupplierRowActions } from "./supplier-row-actions";

type SearchParams = Promise<{ q?: string }>;

export default async function WarehouseSupplierCatalogMasterDataPage({
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
    suppliers.organizationId,
    currentEmployee.organizationId,
  );

  const searchCondition = query
    ? or(
        ilike(suppliers.name, `%${query}%`),
        ilike(suppliers.contactName, `%${query}%`),
        ilike(suppliers.contactEmail, `%${query}%`),
      )
    : undefined;

  const supplierList = await db
    .select()
    .from(suppliers)
    .where(
      searchCondition ? and(baseCondition, searchCondition) : baseCondition,
    );

  return (
    <main className="flex-1 space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Suppliers Catalog
          </h1>
          <p className="text-sm text-slate-500">
            Vendor details, contact info, and lead time specifications.
          </p>
        </div>
        <AddSupplierDialog warehouseId={parsedWarehouseId} />
      </div>

      <div className="flex items-center justify-between gap-4">
        <form className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            name="q"
            defaultValue={query || ""}
            placeholder="Search by supplier name, contact, or email..."
            className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 py-2 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/10"
          />
        </form>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
            <tr>
              <th className="px-6 py-3">Supplier Name</th>
              <th className="px-6 py-3">Contact Person</th>
              <th className="px-6 py-3">Contact Details</th>
              <th className="px-6 py-3">Lead Time</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {supplierList.map((supplier) => (
              <tr key={supplier.supplierId} className="hover:bg-slate-50">
                <td className="px-6 py-4">
                  <div className="font-semibold text-slate-900">
                    {supplier.name}
                  </div>
                  {supplier.address && (
                    <div className="flex items-center gap-1 text-xs text-slate-400 mt-0.5">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate max-w-[200px]">
                        {supplier.address}
                      </span>
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 font-medium text-slate-800">
                  {supplier.contactName ?? "-"}
                </td>
                <td className="px-6 py-4 space-y-1">
                  {supplier.contactEmail ? (
                    <div className="flex items-center gap-1.5 text-xs text-slate-600">
                      <Mail className="h-3.5 w-3.5 text-slate-400" />
                      <span>{supplier.contactEmail}</span>
                    </div>
                  ) : null}
                  {supplier.contactPhone ? (
                    <div className="flex items-center gap-1.5 text-xs text-slate-600">
                      <Phone className="h-3.5 w-3.5 text-slate-400" />
                      <span>{supplier.contactPhone}</span>
                    </div>
                  ) : null}
                  {!supplier.contactEmail && !supplier.contactPhone && (
                    <span className="text-xs text-slate-400">-</span>
                  )}
                </td>
                <td className="px-6 py-4">
                  {supplier.leadTimeDays ? (
                    <div className="inline-flex items-center gap-1 font-mono text-xs text-slate-700 bg-slate-100 px-2 py-1 rounded">
                      <Clock className="h-3 w-3 text-slate-500" />
                      <span>{supplier.leadTimeDays} days</span>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">N/A</span>
                  )}
                </td>
                <td className="px-6 py-4">
                  {supplier.isActive ? (
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                      Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-500/10">
                      Inactive
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  <SupplierRowActions
                    supplier={supplier}
                    warehouseId={parsedWarehouseId}
                  />
                </td>
              </tr>
            ))}
            {supplierList.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-6 py-8 text-center text-slate-500"
                >
                  No suppliers found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
