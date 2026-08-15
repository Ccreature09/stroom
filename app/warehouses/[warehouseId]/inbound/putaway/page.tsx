import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  employees,
  locations,
  pallets,
  positionTypes,
  putawayTasks,
  taskStatuses,
  tasks,
  taskTypes,
} from "@/drizzle/schema";
import { requireInboundManagerAccess } from "@/lib/warehouse-access";
import { getTaskLookups } from "@/lib/inbound/task-lookups";
import { listWarehouseDepartments, loadTaskDepartments } from "@/lib/tasks/routing";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { PackageSearch } from "lucide-react";
import { CreatePutawayDialog, PutawayTaskActions } from "./putaway-controls";
import { TaskRouting } from "../../task-routing";

const statusStyles: Record<string, string> = {
  PENDING: "bg-slate-100 text-slate-600 border-slate-200",
  IN_PROGRESS: "bg-blue-50 text-blue-700 border-blue-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
};

export default async function PutawayPage({
  params,
}: {
  params: Promise<{ warehouseId: string }>;
}) {
  const { warehouseId } = await params;
  const { employee, warehouseId: parsedWarehouseId } =
    await requireInboundManagerAccess(warehouseId);

  await getTaskLookups();

  const [rows, palletOptions, locationOptions, employeeOptions] = await Promise.all([
    db
      .select({
        taskId: tasks.taskId,
        statusCode: taskStatuses.code,
        createdAt: tasks.createdAt,
        assignedEmployeeId: tasks.assignedEmployeeId,
        assigneeFirstName: employees.firstName,
        assigneeLastName: employees.lastName,
        lpnId: putawayTasks.lpnId,
        sourceLocationId: putawayTasks.sourceLocationId,
        suggestedDestLocationId: putawayTasks.suggestedDestLocationId,
        actualDestLocationId: putawayTasks.actualDestLocationId,
      })
      .from(putawayTasks)
      .innerJoin(tasks, eq(putawayTasks.taskId, tasks.taskId))
      .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
      .innerJoin(taskTypes, eq(tasks.taskTypeId, taskTypes.taskTypeId))
      .leftJoin(employees, eq(tasks.assignedEmployeeId, employees.employeeId))
      .where(and(eq(tasks.warehouseId, parsedWarehouseId), eq(taskTypes.code, "PUTAWAY")))
      .orderBy(desc(tasks.createdAt))
      .limit(500),
    db
      .select({
        lpnId: pallets.lpnId,
        currentLocationId: pallets.currentLocationId,
        currentLocationCode: locations.locationCode,
      })
      .from(pallets)
      .leftJoin(locations, eq(pallets.currentLocationId, locations.locationId))
      .where(and(eq(pallets.warehouseId, parsedWarehouseId), eq(pallets.status, "ACTIVE")))
      .orderBy(asc(pallets.lpnId)),
    db
      .select({ locationId: locations.locationId, locationCode: locations.locationCode })
      .from(locations)
      .where(
        and(eq(locations.warehouseId, parsedWarehouseId), eq(locations.isBlocked, false)),
      )
      .orderBy(asc(locations.locationCode)),
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
          eq(positionTypes.canModifyInventory, true),
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

  // Locations referenced by open tasks, keyed for the row display below --
  // fetched separately since a putaway task references three locations and
  // joining `locations` three times in one query would need three aliases.
  const locationCodeById = new Map(
    locationOptions.map((l) => [l.locationId, l.locationCode]),
  );

  const [departmentOptions, taskDepartments] = await Promise.all([
    listWarehouseDepartments(parsedWarehouseId),
    loadTaskDepartments(rows.map((r) => r.taskId)),
  ]);

  const canModify = employee.canModifyInventory === true;
  const canAssign = employee.canAssignTasks === true;

  return (
    <main className="flex-1 space-y-6 p-8">
      <div>
        <DynamicBreadcrumb />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Putaway
          </h1>
          <p className="text-sm text-slate-500">
            Move received pallets from staging to their storage location.
          </p>
        </div>
        {canModify ? (
          <CreatePutawayDialog
            warehouseId={parsedWarehouseId}
            palletOptions={palletOptions}
            locationOptions={locationOptions}
            employeeOptions={employeeOptions}
            departmentOptions={departmentOptions}
          />
        ) : null}
      </div>

      {palletOptions.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No active pallets available to put away yet.
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
            <tr>
              <th className="px-6 py-3">LPN</th>
              <th className="px-6 py-3">Source</th>
              <th className="px-6 py-3">Suggested Dest.</th>
              <th className="px-6 py-3">Actual Dest.</th>
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
                  {row.lpnId}
                </td>
                <td className="px-6 py-4 font-mono text-xs text-slate-600">
                  {locationCodeById.get(row.sourceLocationId) ?? "-"}
                </td>
                <td className="px-6 py-4 font-mono text-xs text-slate-600">
                  {locationCodeById.get(row.suggestedDestLocationId) ?? "-"}
                </td>
                <td className="px-6 py-4 font-mono text-xs text-slate-600">
                  {row.actualDestLocationId
                    ? locationCodeById.get(row.actualDestLocationId) ?? "-"
                    : <span className="text-slate-400">-</span>}
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
                  <PutawayTaskActions
                    warehouseId={parsedWarehouseId}
                    taskId={row.taskId}
                    statusCode={row.statusCode ?? "PENDING"}
                    suggestedDestLocationId={row.suggestedDestLocationId}
                    canModify={canModify}
                    canAssign={canAssign}
                    locationOptions={locationOptions}
                    employeeOptions={employeeOptions}
                  />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center text-slate-500">
                  <div className="flex flex-col items-center gap-2">
                    <PackageSearch className="h-6 w-6 text-slate-300" />
                    No putaway tasks yet.
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
