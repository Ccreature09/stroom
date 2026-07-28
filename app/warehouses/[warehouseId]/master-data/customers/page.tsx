import { and, eq, ilike } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { customers, employees } from "@/drizzle/schema";
import { createClient } from "@/lib/server";
import { Search } from "lucide-react";
import { AddCustomerDialog } from "./add-customer-dialog";
import { CustomerRowActions } from "./customer-row-actions";

type SearchParams = Promise<{ q?: string }>;

export default async function WarehouseCustomersMasterDataPage({
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
    customers.organizationId,
    currentEmployee.organizationId,
  );
  const searchCondition = query
    ? ilike(customers.name, `%${query}%`)
    : undefined;

  const customerList = await db
    .select()
    .from(customers)
    .where(
      searchCondition ? and(baseCondition, searchCondition) : baseCondition,
    );

  return (
    <main className="flex-1 space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Customers
          </h1>
          <p className="text-sm text-slate-500">
            Manage customer accounts, contacts, and default shipping
            destinations.
          </p>
        </div>
        <AddCustomerDialog warehouseId={parsedWarehouseId} />
      </div>

      <div className="flex items-center justify-between gap-4">
        <form className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            name="q"
            defaultValue={query || ""}
            placeholder="Search customer name..."
            className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 py-2 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/10"
          />
        </form>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
            <tr>
              <th className="px-6 py-3">Customer ID</th>
              <th className="px-6 py-3">Customer Name</th>
              <th className="px-6 py-3">Email</th>
              <th className="px-6 py-3">Phone</th>
              <th className="px-6 py-3">Default Shipping Address</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {customerList.map((customer) => (
              <tr key={customer.customerId} className="hover:bg-slate-50">
                <td className="px-6 py-4 font-mono text-xs text-slate-500">
                  #{customer.customerId}
                </td>
                <td className="px-6 py-4 font-medium text-slate-900">
                  {customer.name}
                </td>
                <td className="px-6 py-4 text-slate-600">
                  {customer.contactEmail ?? "-"}
                </td>
                <td className="px-6 py-4 text-slate-600">
                  {customer.contactPhone ?? "-"}
                </td>
                <td className="px-6 py-4 text-slate-600 max-w-xs truncate">
                  {customer.defaultShippingAddress ?? "-"}
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      customer.isActive
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-slate-100 text-slate-600 border border-slate-200"
                    }`}
                  >
                    {customer.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <CustomerRowActions
                    customer={customer}
                    warehouseId={parsedWarehouseId}
                  />
                </td>
              </tr>
            ))}
            {customerList.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-6 py-8 text-center text-slate-500"
                >
                  No customers found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
