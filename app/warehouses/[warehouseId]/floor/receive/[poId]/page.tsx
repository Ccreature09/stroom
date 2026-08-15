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
import { requireWarehouseAccess } from "@/lib/warehouse-access";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { ArrowLeft } from "lucide-react";
import { ScanSession } from "./scan-session";

export default async function FloorReceivePoPage({
  params,
}: {
  params: Promise<{ warehouseId: string; poId: string }>;
}) {
  const { warehouseId, poId } = await params;
  const { employee, warehouseId: parsedWarehouseId } =
    await requireWarehouseAccess(warehouseId);

  if (employee.canModifyInventory !== true) {
    redirect(`/warehouses/${parsedWarehouseId}/floor`);
  }

  const parsedPoId = Number(poId);
  if (!Number.isInteger(parsedPoId) || parsedPoId <= 0) {
    redirect(`/warehouses/${parsedWarehouseId}/floor/receive`);
  }

  const [po] = await db
    .select({
      poId: purchaseOrders.poId,
      poNumber: purchaseOrders.poNumber,
      status: purchaseOrders.status,
      supplierName: suppliers.name,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.supplierId))
    .where(
      and(eq(purchaseOrders.poId, parsedPoId), eq(purchaseOrders.warehouseId, parsedWarehouseId)),
    )
    .limit(1);

  if (!po || (po.status !== "OPEN" && po.status !== "PARTIALLY_RECEIVED")) {
    redirect(`/warehouses/${parsedWarehouseId}/floor/receive`);
  }

  const [lineRows, locationOptions, statusOptions] = await Promise.all([
    db
      .select({
        poLineId: purchaseOrderLines.poLineId,
        itemId: purchaseOrderLines.itemId,
        sku: items.sku,
        itemName: items.name,
        barcode: items.barcode,
        isBatchTracked: items.isBatchTracked,
        isLotTracked: items.isLotTracked,
        hasExpiry: items.hasExpiry,
        quantityOrdered: purchaseOrderLines.quantityOrdered,
        quantityReceived: purchaseOrderLines.quantityReceived,
      })
      .from(purchaseOrderLines)
      .innerJoin(items, eq(purchaseOrderLines.itemId, items.itemId))
      .where(eq(purchaseOrderLines.poId, parsedPoId))
      .orderBy(asc(purchaseOrderLines.poLineId)),
    db
      .select({ locationId: locations.locationId, locationCode: locations.locationCode })
      .from(locations)
      .where(
        and(eq(locations.warehouseId, parsedWarehouseId), eq(locations.isBlocked, false)),
      )
      .orderBy(asc(locations.locationCode)),
    db
      .select({ statusId: inventoryStatuses.statusId, name: inventoryStatuses.name })
      .from(inventoryStatuses)
      .where(eq(inventoryStatuses.organizationId, employee.organizationId))
      .orderBy(asc(inventoryStatuses.name)),
  ]);

  return (
    <main className="flex-1 space-y-5 bg-slate-50 p-5 sm:p-8">
      <div>
        <DynamicBreadcrumb />
      </div>
      <Link
        href={`/warehouses/${parsedWarehouseId}/floor/receive`}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Choose a different delivery
      </Link>

      <div>
        <h1 className="font-mono text-xl font-bold text-slate-900">{po.poNumber}</h1>
        <p className="text-sm text-slate-500">{po.supplierName}</p>
      </div>

      <ScanSession
        warehouseId={parsedWarehouseId}
        initialLines={lineRows}
        locationOptions={locationOptions}
        statusOptions={statusOptions}
      />
    </main>
  );
}
