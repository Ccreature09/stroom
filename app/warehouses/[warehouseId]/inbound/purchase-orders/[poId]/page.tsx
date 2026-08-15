import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  inventoryStatuses,
  items,
  locations,
  purchaseOrderLines,
  purchaseOrders,
  suppliers,
} from "@/drizzle/schema";
import { requireInboundManagerAccess } from "@/lib/warehouse-access";
import { ArrowLeft } from "lucide-react";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import {
  CancelPurchaseOrderButton,
  SubmitPurchaseOrderButton,
} from "../po-controls";
import { ReceiveLineButton } from "./receive-controls";
import { PO_STATUS_LABEL, type PurchaseOrderStatus } from "../constants";

const statusStyles: Record<PurchaseOrderStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-600 border-slate-200",
  OPEN: "bg-blue-50 text-blue-700 border-blue-200",
  PARTIALLY_RECEIVED: "bg-amber-50 text-amber-700 border-amber-200",
  RECEIVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
};

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ warehouseId: string; poId: string }>;
}) {
  const { warehouseId, poId } = await params;
  const { employee, warehouseId: parsedWarehouseId } =
    await requireInboundManagerAccess(warehouseId);

  const parsedPoId = Number(poId);
  if (!Number.isInteger(parsedPoId) || parsedPoId <= 0) {
    redirect(`/warehouses/${parsedWarehouseId}/inbound/purchase-orders`);
  }

  const [po] = await db
    .select({
      poId: purchaseOrders.poId,
      poNumber: purchaseOrders.poNumber,
      status: purchaseOrders.status,
      expectedDate: purchaseOrders.expectedDate,
      createdAt: purchaseOrders.createdAt,
      supplierId: purchaseOrders.supplierId,
      supplierName: suppliers.name,
      supplierEmail: suppliers.contactEmail,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.supplierId))
    .where(
      and(
        eq(purchaseOrders.poId, parsedPoId),
        eq(purchaseOrders.warehouseId, parsedWarehouseId),
      ),
    )
    .limit(1);

  if (!po) {
    redirect(`/warehouses/${parsedWarehouseId}/inbound/purchase-orders`);
  }

  const [lineRows, locationOptions, statusOptions] = await Promise.all([
    db
      .select({
        poLineId: purchaseOrderLines.poLineId,
        itemId: purchaseOrderLines.itemId,
        sku: items.sku,
        itemName: items.name,
        quantityOrdered: purchaseOrderLines.quantityOrdered,
        quantityReceived: purchaseOrderLines.quantityReceived,
        batchNumber: purchaseOrderLines.batchNumber,
        lotNumber: purchaseOrderLines.lotNumber,
        expiryDate: purchaseOrderLines.expiryDate,
        unitCost: purchaseOrderLines.unitCost,
      })
      .from(purchaseOrderLines)
      .leftJoin(items, eq(purchaseOrderLines.itemId, items.itemId))
      .where(eq(purchaseOrderLines.poId, parsedPoId))
      .orderBy(asc(purchaseOrderLines.poLineId)),
    db
      .select({ locationId: locations.locationId, locationCode: locations.locationCode })
      .from(locations)
      .where(
        and(
          eq(locations.warehouseId, parsedWarehouseId),
          eq(locations.isBlocked, false),
        ),
      )
      .orderBy(asc(locations.locationCode)),
    db
      .select({ statusId: inventoryStatuses.statusId, name: inventoryStatuses.name })
      .from(inventoryStatuses)
      .where(eq(inventoryStatuses.organizationId, employee.organizationId))
      .orderBy(asc(inventoryStatuses.name)),
  ]);

  const canModify = employee.canModifyInventory === true;
  const status = po.status as PurchaseOrderStatus;
  const canReceive = status === "OPEN" || status === "PARTIALLY_RECEIVED";

  return (
    <main className="flex-1 space-y-6 p-8">
      <div>
        <DynamicBreadcrumb />
      </div>

      <div>
        <Link
          href={`/warehouses/${parsedWarehouseId}/inbound/purchase-orders`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Purchase Orders
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-bold tracking-tight text-slate-900">
              {po.poNumber}
            </h1>
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusStyles[status]}`}
            >
              {PO_STATUS_LABEL[status]}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {po.supplierName}
            {po.supplierEmail ? ` · ${po.supplierEmail}` : ""}
            {po.expectedDate ? ` · Expected ${po.expectedDate}` : ""}
          </p>
        </div>

        {canModify ? (
          <div className="flex items-center gap-2">
            {status === "DRAFT" ? (
              <>
                <SubmitPurchaseOrderButton
                  warehouseId={parsedWarehouseId}
                  poId={po.poId}
                />
                <CancelPurchaseOrderButton
                  warehouseId={parsedWarehouseId}
                  poId={po.poId}
                />
              </>
            ) : status === "OPEN" ? (
              <CancelPurchaseOrderButton
                warehouseId={parsedWarehouseId}
                poId={po.poId}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {status === "DRAFT" ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          This order is still a draft. Submit it to open it for receiving.
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
            <tr>
              <th className="px-6 py-3">Item</th>
              <th className="px-6 py-3">Batch / Lot</th>
              <th className="px-6 py-3">Expiry</th>
              <th className="px-6 py-3 text-right">Unit Cost</th>
              <th className="px-6 py-3 text-right">Received / Ordered</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {lineRows.map((line) => {
              const remaining =
                line.quantityOrdered - (line.quantityReceived ?? 0);
              return (
                <tr key={line.poLineId} className="hover:bg-slate-50">
                  <td className="px-6 py-4">
                    <div className="font-mono text-xs font-bold text-slate-900">
                      {line.sku ?? "-"}
                    </div>
                    <div className="text-xs text-slate-500">
                      {line.itemName ?? "Unknown item"}
                    </div>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-600">
                    {line.batchNumber || line.lotNumber ? (
                      <>
                        <div>{line.batchNumber ?? "-"}</div>
                        <div className="text-slate-400">{line.lotNumber ?? "-"}</div>
                      </>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-600">
                    {line.expiryDate ?? "-"}
                  </td>
                  <td className="px-6 py-4 text-right font-mono text-xs text-slate-600">
                    {line.unitCost ?? "-"}
                  </td>
                  <td className="px-6 py-4 text-right font-mono text-sm font-semibold text-slate-900">
                    {line.quantityReceived ?? 0} / {line.quantityOrdered}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {canModify && canReceive && remaining > 0 && line.itemId ? (
                      <ReceiveLineButton
                        warehouseId={parsedWarehouseId}
                        poLineId={line.poLineId}
                        remaining={remaining}
                        itemLabel={`${line.sku ?? ""} — ${line.itemName ?? ""}`}
                        locationOptions={locationOptions}
                        statusOptions={statusOptions}
                      />
                    ) : (
                      <span className="text-xs text-slate-400">
                        {remaining <= 0 ? "Complete" : "-"}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {lineRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                  No lines on this order.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
