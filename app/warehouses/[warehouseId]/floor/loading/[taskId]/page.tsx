import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  carriers,
  employees,
  loadingTasks,
  locations,
  shipments,
  taskStatuses,
  tasks,
  taskTypes,
} from "@/drizzle/schema";
import { requireWarehouseAccess } from "@/lib/warehouse-access";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { ArrowLeft } from "lucide-react";
import { LoadScanFlow } from "./load-scan-flow";

export default async function FloorLoadingDetailPage({
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
      lpnId: loadingTasks.lpnId,
      sequenceNumber: loadingTasks.sequenceNumber,
      shipmentId: loadingTasks.shipmentId,
      dockDoorCode: locations.locationCode,
      trailerNumber: shipments.trailerNumber,
      carrierName: carriers.name,
    })
    .from(loadingTasks)
    .innerJoin(tasks, eq(loadingTasks.taskId, tasks.taskId))
    .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
    .innerJoin(taskTypes, eq(tasks.taskTypeId, taskTypes.taskTypeId))
    .innerJoin(shipments, eq(loadingTasks.shipmentId, shipments.shipmentId))
    .leftJoin(carriers, eq(shipments.carrierId, carriers.carrierId))
    .leftJoin(locations, eq(loadingTasks.dockDoorLocationId, locations.locationId))
    .leftJoin(employees, eq(tasks.assignedEmployeeId, employees.employeeId))
    .where(
      and(
        eq(loadingTasks.taskId, taskId),
        eq(tasks.warehouseId, parsedWarehouseId),
        eq(taskTypes.code, "LOADING"),
      ),
    )
    .limit(1);

  if (!row) redirect(`/warehouses/${parsedWarehouseId}/floor`);

  const [progress] = await db
    .select({
      total: sql<number>`count(*)::int`,
      loaded: sql<number>`count(*) filter (where ${taskStatuses.code} = 'COMPLETED')::int`,
    })
    .from(loadingTasks)
    .innerJoin(tasks, eq(loadingTasks.taskId, tasks.taskId))
    .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
    .where(eq(loadingTasks.shipmentId, row.shipmentId));

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
        <h1 className="text-xl font-bold text-slate-900">Load Pallet</h1>
        <p className="text-sm text-slate-500">
          {row.carrierName ?? "No carrier"}
          {row.trailerNumber ? ` · Trailer ${row.trailerNumber}` : ""} ·{" "}
          {progress?.loaded ?? 0} of {progress?.total ?? 0} loaded
          {assigneeName ? ` · ${assigneeName}` : " · unclaimed"}
        </p>
      </div>

      <LoadScanFlow
        warehouseId={parsedWarehouseId}
        taskId={row.taskId}
        statusCode={row.statusCode ?? "PENDING"}
        assignedEmployeeId={row.assignedEmployeeId}
        myEmployeeId={employee.employeeId}
        canLoad={employee.canLoad === true}
        lpnId={row.lpnId}
        sequenceNumber={row.sequenceNumber}
        dockDoorCode={row.dockDoorCode ?? ""}
      />
    </main>
  );
}
