import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  carriers,
  employees,
  locations,
  positionTypes,
  taskStatuses,
  tasks,
  taskTypes,
  unloadingTasks,
} from "@/drizzle/schema";
import { requireInboundManagerAccess } from "@/lib/warehouse-access";
import { getTaskLookups } from "@/lib/inbound/task-lookups";
import { listWarehouseDepartments, loadTaskDepartments } from "@/lib/tasks/routing";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { Truck } from "lucide-react";
import { CreateUnloadingDialog, UnloadingTaskActions } from "./unloading-controls";
import { TaskRouting } from "../../task-routing";

const statusStyles: Record<string, string> = {
  PENDING: "bg-slate-100 text-slate-600 border-slate-200",
  IN_PROGRESS: "bg-blue-50 text-blue-700 border-blue-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
};

export default async function UnloadingPage({
  params,
}: {
  params: Promise<{ warehouseId: string }>;
}) {
  const { warehouseId } = await params;
  const { employee, warehouseId: parsedWarehouseId } =
    await requireInboundManagerAccess(warehouseId);

  await getTaskLookups();

  const [rows, locationOptions, carrierOptions, employeeOptions] = await Promise.all([
    db
      .select({
        taskId: tasks.taskId,
        statusCode: taskStatuses.code,
        createdAt: tasks.createdAt,
        assignedEmployeeId: tasks.assignedEmployeeId,
        assigneeFirstName: employees.firstName,
        assigneeLastName: employees.lastName,
        dockDoorLocationId: unloadingTasks.dockDoorLocationId,
        dockDoorCode: locations.locationCode,
        trailerNumber: unloadingTasks.trailerNumber,
        expectedPallets: unloadingTasks.expectedPallets,
        carrierId: unloadingTasks.carrierId,
        carrierName: carriers.name,
      })
      .from(unloadingTasks)
      .innerJoin(tasks, eq(unloadingTasks.taskId, tasks.taskId))
      .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
      .innerJoin(taskTypes, eq(tasks.taskTypeId, taskTypes.taskTypeId))
      .leftJoin(locations, eq(unloadingTasks.dockDoorLocationId, locations.locationId))
      .leftJoin(carriers, eq(unloadingTasks.carrierId, carriers.carrierId))
      .leftJoin(employees, eq(tasks.assignedEmployeeId, employees.employeeId))
      .where(and(eq(tasks.warehouseId, parsedWarehouseId), eq(taskTypes.code, "UNLOADING")))
      .orderBy(desc(tasks.createdAt))
      .limit(500),
    db
      .select({ locationId: locations.locationId, locationCode: locations.locationCode })
      .from(locations)
      .where(
        and(eq(locations.warehouseId, parsedWarehouseId), eq(locations.isBlocked, false)),
      )
      .orderBy(asc(locations.locationCode)),
    db
      .select({ carrierId: carriers.carrierId, name: carriers.name })
      .from(carriers)
      .where(
        and(eq(carriers.organizationId, employee.organizationId), eq(carriers.isActive, true)),
      )
      .orderBy(asc(carriers.name)),
    db
      .select({
        employeeId: employees.employeeId,
        firstName: employees.firstName,
        lastName: employees.lastName,
      })
      .from(employees)
      .innerJoin(positionTypes, eq(employees.positionId, positionTypes.positionId))
      .where(
        and(
          eq(employees.organizationId, employee.organizationId),
          eq(employees.isActive, true),
          eq(positionTypes.canUnload, true),
          or(
            eq(employees.primaryWarehouseId, parsedWarehouseId),
            eq(employees.currentWarehouseId, parsedWarehouseId),
            and(
              isNull(employees.primaryWarehouseId),
              isNull(employees.currentWarehouseId),
            ),
          ),
        ),
      )
      .orderBy(asc(employees.firstName)),
  ]);

  const [departmentOptions, taskDepartments] = await Promise.all([
    listWarehouseDepartments(parsedWarehouseId),
    loadTaskDepartments(rows.map((r) => r.taskId)),
  ]);

  const canUnload = employee.canUnload === true;
  const canAssign = employee.canAssignTasks === true;

  return (
    <main className="flex-1 space-y-6 p-8">
      <div>
        <DynamicBreadcrumb />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Unloading
          </h1>
          <p className="text-sm text-slate-500">
            Trailers at the dock, waiting to be unloaded.
          </p>
        </div>
        {canUnload ? (
          <CreateUnloadingDialog
            warehouseId={parsedWarehouseId}
            locationOptions={locationOptions}
            carrierOptions={carrierOptions}
            employeeOptions={employeeOptions}
            departmentOptions={departmentOptions}
          />
        ) : null}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
            <tr>
              <th className="px-6 py-3">Dock Door</th>
              <th className="px-6 py-3">Trailer</th>
              <th className="px-6 py-3">Carrier</th>
              <th className="px-6 py-3 text-right">Expected Pallets</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Routed To</th>
              <th className="px-6 py-3">Assigned To</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {rows.map((row) => (
              <tr key={row.taskId} className="hover:bg-slate-50">
                <td className="px-6 py-4 font-mono text-xs font-bold text-slate-900">
                  {row.dockDoorCode ?? "-"}
                </td>
                <td className="px-6 py-4 font-mono text-xs text-slate-600">
                  {row.trailerNumber ?? "-"}
                </td>
                <td className="px-6 py-4 text-xs text-slate-600">
                  {row.carrierName ?? <span className="text-slate-400">-</span>}
                </td>
                <td className="px-6 py-4 text-right font-mono text-xs text-slate-600">
                  {row.expectedPallets}
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                      statusStyles[row.statusCode ?? ""] ??
                      "bg-slate-100 text-slate-700 border-slate-200"
                    }`}
                  >
                    {(row.statusCode ?? "UNKNOWN").replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <TaskRouting
                    warehouseId={parsedWarehouseId}
                    taskId={row.taskId}
                    departments={taskDepartments.get(row.taskId) ?? []}
                    options={departmentOptions}
                    canEdit={canAssign}
                  />
                </td>
                <td className="px-6 py-4 text-xs text-slate-600">
                  {row.assignedEmployeeId
                    ? [row.assigneeFirstName, row.assigneeLastName]
                        .filter(Boolean)
                        .join(" ") || `#${row.assignedEmployeeId}`
                    : <span className="text-slate-400">Unassigned</span>}
                </td>
                <td className="px-6 py-4 text-right">
                  <UnloadingTaskActions
                    warehouseId={parsedWarehouseId}
                    taskId={row.taskId}
                    statusCode={row.statusCode ?? "PENDING"}
                    canUnload={canUnload}
                    canAssign={canAssign}
                    employeeOptions={employeeOptions}
                  />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center text-slate-500">
                  <div className="flex flex-col items-center gap-2">
                    <Truck className="h-6 w-6 text-slate-300" />
                    No unloading tasks yet.
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
