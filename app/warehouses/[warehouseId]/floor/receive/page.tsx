import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { purchaseOrderLines, purchaseOrders, suppliers } from "@/drizzle/schema";
import { requireWarehouseAccess } from "@/lib/warehouse-access";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { ArrowLeft, PackageSearch } from "lucide-react";

/**
 * What a worker receives against is whatever the warehouse already expects
 * -- a purchase order's lines carry the expected item and quantity the
 * moment a supervisor creates or approves it, which is the same information
 * a supplier's invoice/ASN would carry. Scanning against that is what turns
 * receiving into a reconciliation instead of a worker's manual count.
 */
export default async function FloorReceivePickerPage({
  params,
}: {
  params: Promise<{ warehouseId: string }>;
}) {
  const { warehouseId } = await params;
  const { employee, warehouseId: parsedWarehouseId } =
    await requireWarehouseAccess(warehouseId);

  if (employee.canModifyInventory !== true) {
    redirect(`/warehouses/${parsedWarehouseId}/floor`);
  }

  const openPos = await db
    .select({
      poId: purchaseOrders.poId,
      poNumber: purchaseOrders.poNumber,
      status: purchaseOrders.status,
      expectedDate: purchaseOrders.expectedDate,
      supplierName: suppliers.name,
      lineCount: sql<number>`count(${purchaseOrderLines.poLineId})::int`,
      totalOrdered: sql<number>`coalesce(sum(${purchaseOrderLines.quantityOrdered}), 0)::int`,
      totalReceived: sql<number>`coalesce(sum(${purchaseOrderLines.quantityReceived}), 0)::int`,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.supplierId))
    .innerJoin(purchaseOrderLines, eq(purchaseOrderLines.poId, purchaseOrders.poId))
    .where(
      and(
        eq(purchaseOrders.warehouseId, parsedWarehouseId),
        or(eq(purchaseOrders.status, "OPEN"), eq(purchaseOrders.status, "PARTIALLY_RECEIVED")),
      ),
    )
    .groupBy(purchaseOrders.poId, suppliers.name)
    .orderBy(desc(purchaseOrders.expectedDate))
    .limit(50);

  return (
    <main className="flex-1 space-y-6 bg-slate-50 p-5 sm:p-8">
      <div>
        <DynamicBreadcrumb />
      </div>
      <Link
        href={`/warehouses/${parsedWarehouseId}/floor`}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> My Tasks
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Book Items</h1>
        <p className="text-sm text-slate-500">
          Pick the delivery you&apos;re receiving -- you&apos;ll scan against
          what&apos;s actually expected on it.
        </p>
      </div>

      <div className="space-y-2">
        {openPos.map((po) => (
          <Link
            key={po.poId}
            href={`/warehouses/${parsedWarehouseId}/floor/receive/${po.poId}`}
            className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm transition hover:border-teal-300 hover:shadow-md"
          >
            <div className="min-w-0">
              <div className="font-mono text-sm font-bold text-slate-900">{po.poNumber}</div>
              <div className="truncate text-xs text-slate-500">
                {po.supplierName}
                {po.expectedDate ? ` · Expected ${po.expectedDate}` : ""}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-mono text-sm font-semibold text-slate-900">
                {po.totalReceived} / {po.totalOrdered}
              </div>
              <div className="text-[11px] text-slate-400">{po.lineCount} lines</div>
            </div>
          </Link>
        ))}
        {openPos.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center">
            <PackageSearch className="h-6 w-6 text-slate-300" />
            <p className="text-sm text-slate-500">
              No open purchase orders to receive against right now.
            </p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
