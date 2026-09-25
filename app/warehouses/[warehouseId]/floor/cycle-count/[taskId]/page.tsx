import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  cycleCountTasks,
  items,
  locations,
  taskStatuses,
  tasks,
  taskTypes,
} from "@/drizzle/schema";
import { requireWarehouseAccess } from "@/lib/warehouse-access";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { ArrowLeft } from "lucide-react";
import { CountScanFlow } from "./count-scan-flow";

export default async function FloorCycleCountPage({
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
      locationCode: locations.locationCode,
      sku: items.sku,
      itemName: items.name,
      barcode: items.barcode,
      batchNumber: cycleCountTasks.batchNumber,
      lotNumber: cycleCountTasks.lotNumber,
      // expectedQuantity is deliberately NOT selected: it must never reach
      // the counter's screen. A blind count is the only kind worth doing --
      // show someone the number they are meant to find and a good share of
      // them will find it.
    })
    .from(cycleCountTasks)
    .innerJoin(tasks, eq(cycleCountTasks.taskId, tasks.taskId))
    .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
    .innerJoin(taskTypes, eq(tasks.taskTypeId, taskTypes.taskTypeId))
    .leftJoin(items, eq(cycleCountTasks.itemId, items.itemId))
    .leftJoin(locations, eq(cycleCountTasks.locationId, locations.locationId))
    .where(
      and(
        eq(cycleCountTasks.taskId, taskId),
        eq(tasks.warehouseId, parsedWarehouseId),
        eq(taskTypes.code, "CYCLE_COUNT"),
      ),
    )
    .limit(1);

  if (!row) redirect(`/warehouses/${parsedWarehouseId}/floor`);

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
        <h1 className="text-xl font-bold text-slate-900">Stock Count</h1>
        <p className="text-sm text-slate-500">
          Count what is physically there. Don&apos;t adjust to what you expect.
        </p>
      </div>

      <CountScanFlow
        warehouseId={parsedWarehouseId}
        taskId={row.taskId}
        statusCode={row.statusCode ?? "PENDING"}
        assignedEmployeeId={row.assignedEmployeeId}
        myEmployeeId={employee.employeeId}
        canCount={employee.canModifyInventory === true}
        canForceRecount={employee.canForceRecount === true}
        locationCode={row.locationCode ?? ""}
        sku={row.sku ?? ""}
        itemName={row.itemName ?? ""}
        barcode={row.barcode}
        batchNumber={row.batchNumber}
        lotNumber={row.lotNumber}
      />
    </main>
  );
}
