import Link from "next/link";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  carriers,
  locations,
  salesOrders,
  shipmentSalesOrders,
  shipments,
} from "@/drizzle/schema";
import { requireOutboundManagerAccess } from "@/lib/warehouse-access";
import { getTaskLookups } from "@/lib/inbound/task-lookups";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { Truck } from "lucide-react";
import { CreateShipmentDialog } from "./shipment-controls";

const statusStyles: Record<string, string> = {
  STAGING: "bg-slate-100 text-slate-600 border-slate-200",
  LOADING: "bg-blue-50 text-blue-700 border-blue-200",
  DISPATCHED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
};

export default async function ShipmentsPage({
  params,
}: {
  params: Promise<{ warehouseId: string }>;
}) {
  const { warehouseId } = await params;
  const { employee, warehouseId: parsedWarehouseId } =
    await requireOutboundManagerAccess(warehouseId);

  await getTaskLookups();

  const [shipmentRows, pickedOrders, carrierOptions, dockOptions] = await Promise.all([
    db
      .select({
        shipmentId: shipments.shipmentId,
        status: shipments.status,
        trailerNumber: shipments.trailerNumber,
        dispatchedAt: shipments.dispatchedAt,
        createdAt: shipments.createdAt,
        carrierName: carriers.name,
        orderCount: sql<number>`count(${shipmentSalesOrders.soId})::int`,
      })
      .from(shipments)
      .leftJoin(carriers, eq(shipments.carrierId, carriers.carrierId))
      .leftJoin(shipmentSalesOrders, eq(shipmentSalesOrders.shipmentId, shipments.shipmentId))
      .where(eq(shipments.warehouseId, parsedWarehouseId))
      .groupBy(shipments.shipmentId, carriers.name)
      .orderBy(desc(shipments.createdAt))
      .limit(200),
    // Only fully-picked orders can be loaded, and only ones not already on
    // a shipment -- a pallet cannot go on two trailers.
    db
      .select({ soId: salesOrders.soId, soNumber: salesOrders.soNumber })
      .from(salesOrders)
      .leftJoin(shipmentSalesOrders, eq(shipmentSalesOrders.soId, salesOrders.soId))
      .where(
        and(
          eq(salesOrders.warehouseId, parsedWarehouseId),
          eq(salesOrders.status, "PICKED"),
          sql`${shipmentSalesOrders.soId} is null`,
        ),
      )
      .orderBy(asc(salesOrders.soNumber)),
    db
      .select({ carrierId: carriers.carrierId, name: carriers.name })
      .from(carriers)
      .where(
        and(
          eq(carriers.organizationId, employee.organizationId),
          eq(carriers.isActive, true),
        ),
      )
      .orderBy(asc(carriers.name)),
    db
      .select({ locationId: locations.locationId, locationCode: locations.locationCode })
      .from(locations)
      .where(
        and(eq(locations.warehouseId, parsedWarehouseId), eq(locations.isBlocked, false)),
      )
      .orderBy(asc(locations.locationCode)),
  ]);

  return (
    <main className="flex-1 space-y-6 p-8">
      <div>
        <DynamicBreadcrumb />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Shipments</h1>
          <p className="text-sm text-slate-500">
            Trailers being built from picked orders, and what has left the
            building.
          </p>
        </div>
        {employee.canLoad ? (
          <CreateShipmentDialog
            warehouseId={parsedWarehouseId}
            pickedOrders={pickedOrders}
            carrierOptions={carrierOptions}
            dockOptions={dockOptions}
          />
        ) : null}
      </div>

      {pickedOrders.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          No fully-picked orders are waiting for a trailer.
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
            <tr>
              <th className="px-6 py-3">Shipment</th>
              <th className="px-6 py-3">Carrier</th>
              <th className="px-6 py-3">Trailer</th>
              <th className="px-6 py-3 text-right">Orders</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Dispatched</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {shipmentRows.map((s) => (
              <tr key={s.shipmentId} className="hover:bg-slate-50">
                <td className="px-6 py-4">
                  <Link
                    href={`/warehouses/${parsedWarehouseId}/outbound/shipments/${s.shipmentId}`}
                    className="font-mono text-xs font-bold text-teal-700 hover:underline"
                  >
                    {s.shipmentId.slice(0, 8).toUpperCase()}
                  </Link>
                </td>
                <td className="px-6 py-4 text-xs text-slate-600">
                  {s.carrierName ?? <span className="text-slate-400">-</span>}
                </td>
                <td className="px-6 py-4 font-mono text-xs text-slate-600">
                  {s.trailerNumber ?? "-"}
                </td>
                <td className="px-6 py-4 text-right font-mono text-xs text-slate-900">
                  {s.orderCount}
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                      statusStyles[s.status ?? ""] ??
                      "bg-slate-100 text-slate-700 border-slate-200"
                    }`}
                  >
                    {s.status ?? "-"}
                  </span>
                </td>
                <td className="px-6 py-4 font-mono text-xs text-slate-500">
                  {s.dispatchedAt ? s.dispatchedAt.replace("T", " ").slice(0, 16) : "-"}
                </td>
              </tr>
            ))}
            {shipmentRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                  <div className="flex flex-col items-center gap-2">
                    <Truck className="h-6 w-6 text-slate-300" />
                    No shipments yet.
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
