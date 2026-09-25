import Link from "next/link";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, items, salesOrderLines, salesOrders } from "@/drizzle/schema";
import { requireOutboundManagerAccess } from "@/lib/warehouse-access";
import { Search } from "lucide-react";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { CreateSalesOrderDialog } from "./so-controls";
import { SO_STATUSES, SO_STATUS_LABEL, SO_STATUS_STYLE, type SalesOrderStatus } from "./constants";

const ROW_LIMIT = 500;

type SearchParams = Promise<{ q?: string; status?: string }>;

export default async function SalesOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ warehouseId: string }>;
  searchParams: SearchParams;
}) {
  const { warehouseId } = await params;
  const { q: query, status: statusFilter } = await searchParams;
  const { employee, warehouseId: parsedWarehouseId } =
    await requireOutboundManagerAccess(warehouseId);

  const searchCondition = query
    ? or(ilike(salesOrders.soNumber, `%${query}%`), ilike(customers.name, `%${query}%`))
    : undefined;

  const statusCondition =
    statusFilter && SO_STATUSES.includes(statusFilter as SalesOrderStatus)
      ? eq(salesOrders.status, statusFilter)
      : undefined;

  const [soRows, customerOptions, itemOptions] = await Promise.all([
    db
      .select({
        soId: salesOrders.soId,
        soNumber: salesOrders.soNumber,
        status: salesOrders.status,
        createdAt: salesOrders.createdAt,
        customerName: customers.name,
        lineCount: sql<number>`count(${salesOrderLines.soLineId})::int`,
        totalRequested: sql<number>`coalesce(sum(${salesOrderLines.quantityRequested}), 0)::int`,
        totalAllocated: sql<number>`coalesce(sum(${salesOrderLines.quantityAllocated}), 0)::int`,
        totalShipped: sql<number>`coalesce(sum(${salesOrderLines.quantityShipped}), 0)::int`,
      })
      .from(salesOrders)
      .innerJoin(customers, eq(salesOrders.customerId, customers.customerId))
      .leftJoin(salesOrderLines, eq(salesOrderLines.soId, salesOrders.soId))
      .where(
        and(
          eq(salesOrders.warehouseId, parsedWarehouseId),
          searchCondition,
          statusCondition,
        ),
      )
      .groupBy(salesOrders.soId, customers.name)
      .orderBy(desc(salesOrders.createdAt))
      .limit(ROW_LIMIT),
    db
      .select({ customerId: customers.customerId, name: customers.name, address: customers.defaultShippingAddress })
      .from(customers)
      .where(
        and(eq(customers.organizationId, employee.organizationId), eq(customers.isActive, true)),
      )
      .orderBy(asc(customers.name)),
    db
      .select({ itemId: items.itemId, sku: items.sku, name: items.name })
      .from(items)
      .where(eq(items.organizationId, employee.organizationId))
      .orderBy(asc(items.sku)),
  ]);

  const canModify = employee.canModifyInventory === true;
  const truncated = soRows.length === ROW_LIMIT;

  return (
    <main className="flex-1 space-y-6 p-8">
      <div>
        <DynamicBreadcrumb />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sales Orders</h1>
          <p className="text-sm text-slate-500">
            Customer orders, what has been reserved for them, and what has
            actually gone out.
          </p>
        </div>
        {canModify ? (
          <CreateSalesOrderDialog
            warehouseId={parsedWarehouseId}
            customerOptions={customerOptions}
            itemOptions={itemOptions}
          />
        ) : null}
      </div>

      <form className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            name="q"
            defaultValue={query || ""}
            placeholder="Search order number or customer..."
            className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 py-2 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/10"
          />
        </div>
        <select
          name="status"
          defaultValue={statusFilter ?? ""}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/10"
        >
          <option value="">All statuses</option>
          {SO_STATUSES.map((status) => (
            <option key={status} value={status}>
              {SO_STATUS_LABEL[status]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Apply
        </button>
      </form>

      {customerOptions.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No customers exist yet, so an order cannot be raised.{" "}
          <Link
            href={`/warehouses/${parsedWarehouseId}/master-data/customers`}
            className="font-semibold underline"
          >
            Add a customer first
          </Link>
          .
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
            <tr>
              <th className="px-6 py-3">Order</th>
              <th className="px-6 py-3">Customer</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3 text-right">Lines</th>
              <th className="px-6 py-3 text-right">Allocated / Requested</th>
              <th className="px-6 py-3 text-right">Shipped</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {soRows.map((so) => (
              <tr key={so.soId} className="hover:bg-slate-50">
                <td className="px-6 py-4">
                  <Link
                    href={`/warehouses/${parsedWarehouseId}/outbound/sales-orders/${so.soId}`}
                    className="font-mono text-xs font-bold text-teal-700 hover:underline"
                  >
                    {so.soNumber}
                  </Link>
                </td>
                <td className="px-6 py-4 text-slate-900">{so.customerName}</td>
                <td className="px-6 py-4">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                      SO_STATUS_STYLE[so.status as SalesOrderStatus] ??
                      "bg-slate-100 text-slate-700 border-slate-200"
                    }`}
                  >
                    {SO_STATUS_LABEL[so.status as SalesOrderStatus] ?? so.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-right font-mono text-xs text-slate-600">
                  {so.lineCount}
                </td>
                <td className="px-6 py-4 text-right font-mono text-sm font-semibold text-slate-900">
                  {so.totalAllocated} / {so.totalRequested}
                </td>
                <td className="px-6 py-4 text-right font-mono text-xs text-slate-600">
                  {so.totalShipped}
                </td>
              </tr>
            ))}
            {soRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                  No sales orders yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {truncated ? (
        <p className="text-xs text-slate-500">
          Showing the first {ROW_LIMIT} orders. Narrow the search to see more.
        </p>
      ) : null}
    </main>
  );
}
