import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  carriers,
  customers,
  loadingTasks,
  locations,
  salesOrders,
  shipmentSalesOrders,
  shipments,
  taskStatuses,
  tasks,
} from "@/drizzle/schema";
import { requireOutboundManagerAccess } from "@/lib/warehouse-access";
import { ArrowLeft } from "lucide-react";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { DispatchShipmentButton } from "../shipment-controls";

const statusStyles: Record<string, string> = {
  STAGING: "bg-slate-100 text-slate-600 border-slate-200",
  LOADING: "bg-blue-50 text-blue-700 border-blue-200",
  DISPATCHED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
};

const taskStatusStyles: Record<string, string> = {
  PENDING: "bg-slate-100 text-slate-600 border-slate-200",
  IN_PROGRESS: "bg-blue-50 text-blue-700 border-blue-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
};

export default async function ShipmentDetailPage({
  params,
}: {
  params: Promise<{ warehouseId: string; shipmentId: string }>;
}) {
  const { warehouseId, shipmentId } = await params;
  const { employee, warehouseId: parsedWarehouseId } =
    await requireOutboundManagerAccess(warehouseId);

  const [shipment] = await db
    .select({
      shipmentId: shipments.shipmentId,
      status: shipments.status,
      trailerNumber: shipments.trailerNumber,
      dispatchedAt: shipments.dispatchedAt,
      createdAt: shipments.createdAt,
      carrierName: carriers.name,
    })
    .from(shipments)
    .leftJoin(carriers, eq(shipments.carrierId, carriers.carrierId))
    .where(
      and(
        eq(shipments.shipmentId, shipmentId),
        eq(shipments.warehouseId, parsedWarehouseId),
      ),
    )
    .limit(1);

  if (!shipment) redirect(`/warehouses/${parsedWarehouseId}/outbound/shipments`);

  const [orderRows, loadRows] = await Promise.all([
    db
      .select({
        soId: salesOrders.soId,
        soNumber: salesOrders.soNumber,
        status: salesOrders.status,
        customerName: customers.name,
      })
      .from(shipmentSalesOrders)
      .innerJoin(salesOrders, eq(shipmentSalesOrders.soId, salesOrders.soId))
      .innerJoin(customers, eq(salesOrders.customerId, customers.customerId))
      .where(eq(shipmentSalesOrders.shipmentId, shipmentId))
      .orderBy(asc(salesOrders.soNumber)),
    db
      .select({
        taskId: tasks.taskId,
        statusCode: taskStatuses.code,
        lpnId: loadingTasks.lpnId,
        sequenceNumber: loadingTasks.sequenceNumber,
        dockDoorCode: locations.locationCode,
      })
      .from(loadingTasks)
      .innerJoin(tasks, eq(loadingTasks.taskId, tasks.taskId))
      .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
      .leftJoin(locations, eq(loadingTasks.dockDoorLocationId, locations.locationId))
      .where(eq(loadingTasks.shipmentId, shipmentId))
      .orderBy(asc(loadingTasks.sequenceNumber)),
  ]);

  const outstanding = loadRows.filter(
    (l) => l.statusCode === "PENDING" || l.statusCode === "IN_PROGRESS",
  ).length;
  const canDispatch =
    employee.canLoad === true &&
    shipment.status !== "DISPATCHED" &&
    shipment.status !== "CANCELLED";

  return (
    <main className="flex-1 space-y-6 p-8">
      <div>
        <DynamicBreadcrumb />
      </div>

      <div>
        <Link
          href={`/warehouses/${parsedWarehouseId}/outbound/shipments`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Shipments
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-bold tracking-tight text-slate-900">
              {shipment.shipmentId.slice(0, 8).toUpperCase()}
            </h1>
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                statusStyles[shipment.status ?? ""] ??
                "bg-slate-100 text-slate-700 border-slate-200"
              }`}
            >
              {shipment.status}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {shipment.carrierName ?? "No carrier set"}
            {shipment.trailerNumber ? ` · Trailer ${shipment.trailerNumber}` : ""}
            {shipment.dispatchedAt
              ? ` · Left ${shipment.dispatchedAt.replace("T", " ").slice(0, 16)}`
              : ""}
          </p>
        </div>

        {canDispatch ? (
          outstanding > 0 ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              {outstanding} pallet{outstanding === 1 ? "" : "s"} still to load
            </p>
          ) : (
            <DispatchShipmentButton
              warehouseId={parsedWarehouseId}
              shipmentId={shipment.shipmentId}
            />
          )
        ) : null}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-700">
          Loading plan
        </h2>
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-6 py-3 text-right">Seq</th>
                <th className="px-6 py-3">Pallet</th>
                <th className="px-6 py-3">Dock</th>
                <th className="px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loadRows.map((load) => (
                <tr key={load.taskId} className="hover:bg-slate-50">
                  <td className="px-6 py-4 text-right font-mono text-xs text-slate-500">
                    {load.sequenceNumber}
                  </td>
                  <td className="px-6 py-4 font-mono text-xs font-bold text-slate-900">
                    {load.lpnId}
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-600">
                    {load.dockDoorCode ?? "-"}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                        taskStatusStyles[load.statusCode ?? ""] ??
                        "bg-slate-100 text-slate-700 border-slate-200"
                      }`}
                    >
                      {(load.statusCode ?? "").replace(/_/g, " ")}
                    </span>
                  </td>
                </tr>
              ))}
              {loadRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-slate-500">
                    No loading tasks on this shipment.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-700">
          Orders on this trailer
        </h2>
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-6 py-3">Order</th>
                <th className="px-6 py-3">Customer</th>
                <th className="px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {orderRows.map((order) => (
                <tr key={order.soId} className="hover:bg-slate-50">
                  <td className="px-6 py-4">
                    <Link
                      href={`/warehouses/${parsedWarehouseId}/outbound/sales-orders/${order.soId}`}
                      className="font-mono text-xs font-bold text-teal-700 hover:underline"
                    >
                      {order.soNumber}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-slate-900">{order.customerName}</td>
                  <td className="px-6 py-4 text-xs text-slate-600">{order.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
