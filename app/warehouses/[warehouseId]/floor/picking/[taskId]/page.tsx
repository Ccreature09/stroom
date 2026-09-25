import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  employees,
  items,
  locations,
  pickingTasks,
  taskStatuses,
  tasks,
  taskTypes,
} from "@/drizzle/schema";
import { requireWarehouseAccess } from "@/lib/warehouse-access";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { ArrowLeft } from "lucide-react";
import { serialsAtLocation } from "@/lib/inventory/serials-server";
import { PickScanFlow } from "./pick-scan-flow";

export default async function FloorPickingDetailPage({
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
      assigneeFirstName: employees.firstName,
      assigneeLastName: employees.lastName,
      lpnId: pickingTasks.lpnId,
      pickQuantity: pickingTasks.pickQuantity,
      batchNumber: pickingTasks.batchNumber,
      lotNumber: pickingTasks.lotNumber,
      sku: items.sku,
      itemName: items.name,
      barcode: items.barcode,
      isSerialTracked: items.isSerialTracked,
      itemId: pickingTasks.itemId,
      pickLocationId: pickingTasks.pickLocationId,
      locationCode: locations.locationCode,
    })
    .from(pickingTasks)
    .innerJoin(tasks, eq(pickingTasks.taskId, tasks.taskId))
    .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
    .innerJoin(taskTypes, eq(tasks.taskTypeId, taskTypes.taskTypeId))
    .leftJoin(items, eq(pickingTasks.itemId, items.itemId))
    .leftJoin(locations, eq(pickingTasks.pickLocationId, locations.locationId))
    .leftJoin(employees, eq(tasks.assignedEmployeeId, employees.employeeId))
    .where(
      and(
        eq(pickingTasks.taskId, taskId),
        eq(tasks.warehouseId, parsedWarehouseId),
        eq(taskTypes.code, "PICKING"),
      ),
    )
    .limit(1);

  if (!row) redirect(`/warehouses/${parsedWarehouseId}/floor`);

  // Only fetched for serialised items: the picker gets told immediately when a
  // scanned unit isn't in this bin, instead of after submitting the pallet.
  // The server re-checks every serial anyway -- this list is for feedback, not
  // authority, and can be stale by the time the pick is confirmed.
  const availableSerials = row.isSerialTracked
    ? (
        await serialsAtLocation(db, {
          itemId: row.itemId,
          locationId: row.pickLocationId,
          batchNumber: row.batchNumber,
          lotNumber: row.lotNumber,
        })
      ).map((s) => s.serialNumber)
    : [];

  const assigneeName = row.assignedEmployeeId
    ? [row.assigneeFirstName, row.assigneeLastName].filter(Boolean).join(" ") ||
      `#${row.assignedEmployeeId}`
    : null;

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
        <h1 className="text-xl font-bold text-slate-900">Pick</h1>
        <p className="text-sm text-slate-500">
          Onto pallet <span className="font-mono font-semibold">{row.lpnId}</span>
          {assigneeName ? ` · ${assigneeName}` : " · unclaimed"}
        </p>
      </div>

      <PickScanFlow
        warehouseId={parsedWarehouseId}
        taskId={row.taskId}
        statusCode={row.statusCode ?? "PENDING"}
        assignedEmployeeId={row.assignedEmployeeId}
        myEmployeeId={employee.employeeId}
        canPick={employee.canPick === true}
        locationCode={row.locationCode ?? ""}
        sku={row.sku ?? ""}
        itemName={row.itemName ?? ""}
        barcode={row.barcode}
        batchNumber={row.batchNumber}
        lotNumber={row.lotNumber}
        pickQuantity={row.pickQuantity}
        isSerialTracked={row.isSerialTracked === true}
        availableSerials={availableSerials}
      />
    </main>
  );
}
