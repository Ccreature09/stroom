import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  items,
  locations,
  replenishmentTasks,
  taskStatuses,
  tasks,
  taskTypes,
} from "@/drizzle/schema";
import { requireWarehouseAccess } from "@/lib/warehouse-access";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { ArrowLeft } from "lucide-react";
import { ReplenScanFlow } from "./replen-scan-flow";

export default async function FloorReplenishmentPage({
  params,
}: {
  params: Promise<{ warehouseId: string; taskId: string }>;
}) {
  const { warehouseId, taskId } = await params;
  const { employee, warehouseId: parsedWarehouseId } =
    await requireWarehouseAccess(warehouseId);

  const [row] = await db
    .select({
      taskId: tasks.taskId,
      statusCode: taskStatuses.code,
      assignedEmployeeId: tasks.assignedEmployeeId,
      itemId: replenishmentTasks.itemId,
      sku: items.sku,
      itemName: items.name,
      barcode: items.barcode,
      batchNumber: replenishmentTasks.batchNumber,
      lotNumber: replenishmentTasks.lotNumber,
      quantity: replenishmentTasks.quantity,
      sourceLocationId: replenishmentTasks.sourceLocationId,
      destinationLocationId: replenishmentTasks.destinationLocationId,
    })
    .from(replenishmentTasks)
    .innerJoin(tasks, eq(replenishmentTasks.taskId, tasks.taskId))
    .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
    .innerJoin(taskTypes, eq(tasks.taskTypeId, taskTypes.taskTypeId))
    .leftJoin(items, eq(replenishmentTasks.itemId, items.itemId))
    .where(
      and(
        eq(replenishmentTasks.taskId, taskId),
        eq(tasks.warehouseId, parsedWarehouseId),
        eq(taskTypes.code, "REPLENISHMENT"),
      ),
    )
    .limit(1);

  if (!row) redirect(`/warehouses/${parsedWarehouseId}/floor`);

  const locationRows = await db
    .select({ locationId: locations.locationId, locationCode: locations.locationCode })
    .from(locations)
    .where(
      and(
        eq(locations.warehouseId, parsedWarehouseId),
        inArray(locations.locationId, [row.sourceLocationId, row.destinationLocationId]),
      ),
    );
  const codeById = new Map(locationRows.map((l) => [l.locationId, l.locationCode]));

  return (
    <main className="flex-1 space-y-5 bg-slate-50 p-5 sm:p-8">
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
        <h1 className="text-xl font-bold text-slate-900">Replenish</h1>
        <p className="text-sm text-slate-500">Top up a pick face from reserve.</p>
      </div>

      <ReplenScanFlow
        warehouseId={parsedWarehouseId}
        taskId={row.taskId}
        statusCode={row.statusCode ?? "PENDING"}
        assignedEmployeeId={row.assignedEmployeeId}
        myEmployeeId={employee.employeeId}
        canReplenish={employee.canReplenish === true}
        sourceCode={codeById.get(row.sourceLocationId) ?? ""}
        destinationCode={codeById.get(row.destinationLocationId) ?? ""}
        sku={row.sku ?? ""}
        itemName={row.itemName ?? ""}
        barcode={row.barcode}
        batchNumber={row.batchNumber}
        lotNumber={row.lotNumber}
        quantity={row.quantity}
      />
    </main>
  );
}
