import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customers,
  items,
  locations,
  pickingTasks,
  salesOrderLines,
  salesOrders,
  taskStatuses,
  tasks,
} from "@/drizzle/schema";
import { requireOutboundManagerAccess } from "@/lib/warehouse-access";
import { orderPickLpn } from "@/lib/outbound/fulfilment";
import { listWarehouseDepartments } from "@/lib/tasks/routing";
import { ArrowLeft } from "lucide-react";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { CancelSalesOrderButton, ReleaseSalesOrderButton } from "../so-controls";
import { SO_STATUS_LABEL, SO_STATUS_STYLE, type SalesOrderStatus } from "../constants";

const pickStatusStyles: Record<string, string> = {
  PENDING: "bg-slate-100 text-slate-600 border-slate-200",
  IN_PROGRESS: "bg-blue-50 text-blue-700 border-blue-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
};

export default async function SalesOrderDetailPage({
  params,
}: {
  params: Promise<{ warehouseId: string; soId: string }>;
}) {
  const { warehouseId, soId } = await params;
  const { employee, warehouseId: parsedWarehouseId } =
    await requireOutboundManagerAccess(warehouseId);

  const parsedSoId = Number(soId);
  if (!Number.isInteger(parsedSoId) || parsedSoId <= 0) {
    redirect(`/warehouses/${parsedWarehouseId}/outbound/sales-orders`);
  }

  const [so] = await db
    .select({
      soId: salesOrders.soId,
      soNumber: salesOrders.soNumber,
      status: salesOrders.status,
      shippingAddress: salesOrders.shippingAddress,
      trackingNumber: salesOrders.trackingNumber,
      createdAt: salesOrders.createdAt,
      customerName: customers.name,
      customerEmail: customers.contactEmail,
    })
    .from(salesOrders)
    .innerJoin(customers, eq(salesOrders.customerId, customers.customerId))
    .where(
      and(eq(salesOrders.soId, parsedSoId), eq(salesOrders.warehouseId, parsedWarehouseId)),
    )
    .limit(1);

  if (!so) redirect(`/warehouses/${parsedWarehouseId}/outbound/sales-orders`);

  const [lineRows, pickRows] = await Promise.all([
    db
      .select({
        soLineId: salesOrderLines.soLineId,
        sku: items.sku,
        itemName: items.name,
        quantityRequested: salesOrderLines.quantityRequested,
        quantityAllocated: salesOrderLines.quantityAllocated,
        quantityShipped: salesOrderLines.quantityShipped,
      })
      .from(salesOrderLines)
      .leftJoin(items, eq(salesOrderLines.itemId, items.itemId))
      .where(eq(salesOrderLines.soId, parsedSoId))
      .orderBy(asc(salesOrderLines.soLineId)),
    db
      .select({
        taskId: tasks.taskId,
        statusCode: taskStatuses.code,
        sku: items.sku,
        pickQuantity: pickingTasks.pickQuantity,
        batchNumber: pickingTasks.batchNumber,
        lotNumber: pickingTasks.lotNumber,
        locationCode: locations.locationCode,
      })
      .from(pickingTasks)
      .innerJoin(tasks, eq(pickingTasks.taskId, tasks.taskId))
      .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
      .leftJoin(items, eq(pickingTasks.itemId, items.itemId))
      .leftJoin(locations, eq(pickingTasks.pickLocationId, locations.locationId))
      .where(
        and(
          eq(tasks.warehouseId, parsedWarehouseId),
          eq(pickingTasks.lpnId, orderPickLpn(so.soNumber)),
        ),
      )
      .orderBy(asc(locations.locationCode)),
  ]);

  const departmentOptions = await listWarehouseDepartments(parsedWarehouseId);
  const status = so.status as SalesOrderStatus;

  return (
    <main className="flex-1 space-y-6 p-8">
      <div>
        <DynamicBreadcrumb />
      </div>

      <div>
        <Link
          href={`/warehouses/${parsedWarehouseId}/outbound/sales-orders`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Sales Orders
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-bold tracking-tight text-slate-900">
              {so.soNumber}
            </h1>
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                SO_STATUS_STYLE[status] ?? "bg-slate-100 text-slate-700 border-slate-200"
              }`}
            >
              {SO_STATUS_LABEL[status] ?? status}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {so.customerName}
            {so.customerEmail ? ` · ${so.customerEmail}` : ""}
          </p>
          <p className="mt-1 max-w-md whitespace-pre-line text-xs text-slate-500">
            {so.shippingAddress}
          </p>
        </div>

        {employee.canReleaseOrders ? (
          <div className="flex flex-col items-end gap-2">
            {status === "DRAFT" ? (
              <>
                <ReleaseSalesOrderButton
                  warehouseId={parsedWarehouseId}
                  soId={so.soId}
                  departmentOptions={departmentOptions}
                />
                <CancelSalesOrderButton warehouseId={parsedWarehouseId} soId={so.soId} />
              </>
            ) : status !== "SHIPPED" && status !== "CANCELLED" ? (
              <CancelSalesOrderButton warehouseId={parsedWarehouseId} soId={so.soId} />
            ) : null}
          </div>
        ) : null}
      </div>

      {status === "DRAFT" ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Nothing is reserved yet. Releasing this order picks the specific
          batches to pull (first-expiring first) and creates the pick tasks.
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
            <tr>
              <th className="px-6 py-3">Item</th>
              <th className="px-6 py-3 text-right">Requested</th>
              <th className="px-6 py-3 text-right">Reserved</th>
              <th className="px-6 py-3 text-right">Shipped</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {lineRows.map((line) => {
              const short =
                (line.quantityAllocated ?? 0) < line.quantityRequested &&
                status !== "DRAFT" &&
                status !== "CANCELLED";
              return (
                <tr key={line.soLineId} className="hover:bg-slate-50">
                  <td className="px-6 py-4">
                    <div className="font-mono text-xs font-bold text-slate-900">
                      {line.sku ?? "-"}
                    </div>
                    <div className="text-xs text-slate-500">
                      {line.itemName ?? "Unknown item"}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right font-mono text-xs text-slate-600">
                    {line.quantityRequested}
                  </td>
                  <td
                    className={`px-6 py-4 text-right font-mono text-sm font-semibold ${
                      short ? "text-amber-700" : "text-slate-900"
                    }`}
                  >
                    {line.quantityAllocated ?? 0}
                    {short ? " ⚠" : ""}
                  </td>
                  <td className="px-6 py-4 text-right font-mono text-xs text-slate-600">
                    {line.quantityShipped ?? 0}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pickRows.length > 0 ? (
        <div>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-700">
            Pick tasks ({orderPickLpn(so.soNumber)})
          </h2>
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3">From</th>
                  <th className="px-6 py-3">Item</th>
                  <th className="px-6 py-3">Batch / Lot</th>
                  <th className="px-6 py-3 text-right">Qty</th>
                  <th className="px-6 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {pickRows.map((pick) => (
                  <tr key={pick.taskId} className="hover:bg-slate-50">
                    <td className="px-6 py-4 font-mono text-xs font-bold text-slate-900">
                      {pick.locationCode ?? "-"}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-slate-600">
                      {pick.sku ?? "-"}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-slate-500">
                      {pick.batchNumber ?? "-"}
                      {pick.lotNumber ? ` / ${pick.lotNumber}` : ""}
                    </td>
                    <td className="px-6 py-4 text-right font-mono text-xs text-slate-900">
                      {pick.pickQuantity}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                          pickStatusStyles[pick.statusCode ?? ""] ??
                          "bg-slate-100 text-slate-700 border-slate-200"
                        }`}
                      >
                        {(pick.statusCode ?? "").replace(/_/g, " ")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </main>
  );
}
