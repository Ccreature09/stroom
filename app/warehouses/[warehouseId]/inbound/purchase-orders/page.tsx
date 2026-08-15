import Link from "next/link";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { items, purchaseOrderLines, purchaseOrders, suppliers } from "@/drizzle/schema";
import { requireInboundManagerAccess } from "@/lib/warehouse-access";
import { Search } from "lucide-react";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { CreatePurchaseOrderDialog } from "./po-controls";
import { PO_STATUSES, PO_STATUS_LABEL, type PurchaseOrderStatus } from "./constants";

const ROW_LIMIT = 500;

const statusStyles: Record<PurchaseOrderStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-600 border-slate-200",
  OPEN: "bg-blue-50 text-blue-700 border-blue-200",
  PARTIALLY_RECEIVED: "bg-amber-50 text-amber-700 border-amber-200",
  RECEIVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
};

type SearchParams = Promise<{ q?: string; status?: string }>;

export default async function PurchaseOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ warehouseId: string }>;
  searchParams: SearchParams;
}) {
  const { warehouseId } = await params;
  const { q: query, status: statusFilter } = await searchParams;
  const { employee, warehouseId: parsedWarehouseId } =
    await requireInboundManagerAccess(warehouseId);

  const searchCondition = query
    ? or(
        ilike(purchaseOrders.poNumber, `%${query}%`),
        ilike(suppliers.name, `%${query}%`),
      )
    : undefined;

  const statusCondition =
    statusFilter && PO_STATUSES.includes(statusFilter as PurchaseOrderStatus)
      ? eq(purchaseOrders.status, statusFilter)
      : undefined;

  const [poRows, supplierOptions, itemOptions] = await Promise.all([
    db
      .select({
        poId: purchaseOrders.poId,
        poNumber: purchaseOrders.poNumber,
        status: purchaseOrders.status,
        expectedDate: purchaseOrders.expectedDate,
        createdAt: purchaseOrders.createdAt,
        supplierId: purchaseOrders.supplierId,
        supplierName: suppliers.name,
        lineCount: sql<number>`count(${purchaseOrderLines.poLineId})::int`,
        totalOrdered: sql<number>`coalesce(sum(${purchaseOrderLines.quantityOrdered}), 0)::int`,
        totalReceived: sql<number>`coalesce(sum(${purchaseOrderLines.quantityReceived}), 0)::int`,
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.supplierId))
      .leftJoin(
        purchaseOrderLines,
        eq(purchaseOrderLines.poId, purchaseOrders.poId),
      )
      .where(
        and(
          eq(purchaseOrders.warehouseId, parsedWarehouseId),
          searchCondition,
          statusCondition,
        ),
      )
      .groupBy(purchaseOrders.poId, suppliers.name)
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(ROW_LIMIT),
    db
      .select({ supplierId: suppliers.supplierId, name: suppliers.name })
      .from(suppliers)
      .where(
        and(
          eq(suppliers.organizationId, employee.organizationId),
          eq(suppliers.isActive, true),
        ),
      )
      .orderBy(asc(suppliers.name)),
    db
      .select({ itemId: items.itemId, sku: items.sku, name: items.name })
      .from(items)
      .where(eq(items.organizationId, employee.organizationId))
      .orderBy(asc(items.sku)),
  ]);

  const canModify = employee.canModifyInventory === true;
  const truncated = poRows.length === ROW_LIMIT;

  return (
    <main className="flex-1 space-y-6 p-8">
      <div>
        <DynamicBreadcrumb />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Purchase Orders
          </h1>
          <p className="text-sm text-slate-500">
            Inbound orders placed with suppliers, and what has actually
            arrived against them.
          </p>
        </div>
        {canModify ? (
          <CreatePurchaseOrderDialog
            warehouseId={parsedWarehouseId}
            supplierOptions={supplierOptions}
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
            placeholder="Search PO number or supplier..."
            className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 py-2 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/10"
          />
        </div>
        <select
          name="status"
          defaultValue={statusFilter ?? ""}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/10"
        >
          <option value="">All statuses</option>
          {PO_STATUSES.map((status) => (
            <option key={status} value={status}>
              {PO_STATUS_LABEL[status]}
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

      {supplierOptions.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No suppliers exist yet, so a purchase order cannot be placed.{" "}
          <Link
            href={`/warehouses/${parsedWarehouseId}/master-data/suppliers`}
            className="font-semibold underline"
          >
            Add a supplier first
          </Link>
          .
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
            <tr>
              <th className="px-6 py-3">PO Number</th>
              <th className="px-6 py-3">Supplier</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Expected</th>
              <th className="px-6 py-3 text-right">Lines</th>
              <th className="px-6 py-3 text-right">Received / Ordered</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {poRows.map((po) => (
              <tr key={po.poId} className="hover:bg-slate-50">
                <td className="px-6 py-4">
                  <Link
                    href={`/warehouses/${parsedWarehouseId}/inbound/purchase-orders/${po.poId}`}
                    className="font-mono text-xs font-bold text-teal-700 hover:underline"
                  >
                    {po.poNumber}
                  </Link>
                </td>
                <td className="px-6 py-4 text-slate-900">{po.supplierName}</td>
                <td className="px-6 py-4">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                      statusStyles[po.status as PurchaseOrderStatus] ??
                      "bg-slate-100 text-slate-700 border-slate-200"
                    }`}
                  >
                    {PO_STATUS_LABEL[po.status as PurchaseOrderStatus] ?? po.status}
                  </span>
                </td>
                <td className="px-6 py-4 font-mono text-xs text-slate-600">
                  {po.expectedDate ?? "-"}
                </td>
                <td className="px-6 py-4 text-right font-mono text-xs text-slate-600">
                  {po.lineCount}
                </td>
                <td className="px-6 py-4 text-right font-mono text-sm font-semibold text-slate-900">
                  {po.totalReceived} / {po.totalOrdered}
                </td>
              </tr>
            ))}
            {poRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                  No purchase orders yet.
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
