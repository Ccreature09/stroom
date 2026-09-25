import Link from "next/link";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  employees,
  items,
  locations,
  pickingTasks,
  positionTypes,
  taskStatuses,
  tasks,
  taskTypes,
} from "@/drizzle/schema";
import { requireOutboundManagerAccess } from "@/lib/warehouse-access";
import { getTaskLookups } from "@/lib/inbound/task-lookups";
import { listWarehouseDepartments, loadTaskDepartments } from "@/lib/tasks/routing";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { ClipboardCheck } from "lucide-react";
import { PickingTaskActions } from "./picking-controls";
import { TaskRouting } from "../../task-routing";

const statusStyles: Record<string, string> = {
  PENDING: "bg-slate-100 text-slate-600 border-slate-200",
  IN_PROGRESS: "bg-blue-50 text-blue-700 border-blue-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
};

type SearchParams = Promise<{ show?: string }>;

export default async function PickingPage({
  params,
  searchParams,
}: {
  params: Promise<{ warehouseId: string }>;
  searchParams: SearchParams;
}) {
  const { warehouseId } = await params;
  const { show } = await searchParams;
  const { employee, warehouseId: parsedWarehouseId } =
    await requireOutboundManagerAccess(warehouseId);

  await getTaskLookups();

  const showAll = show === "all";
  const statusFilter = showAll
    ? undefined
    : inArray(taskStatuses.code, ["PENDING", "IN_PROGRESS"]);

  const [rows, employeeOptions] = await Promise.all([
    db
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
          eq(tasks.warehouseId, parsedWarehouseId),
          eq(taskTypes.code, "PICKING"),
          statusFilter,
        ),
      )
      // Group a picker's walk by pallet, then by aisle -- a pick list that
      // jumps between orders and across the building is the classic way to
      // waste a shift.
      .orderBy(asc(pickingTasks.lpnId), asc(locations.locationCode), desc(tasks.createdAt))
      .limit(500),
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
          eq(positionTypes.canPick, true),
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

  const canPick = employee.canPick === true;
  const canAssign = employee.canAssignTasks === true;

  return (
    <main className="flex-1 space-y-6 p-8">
      <div>
        <DynamicBreadcrumb />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Picking</h1>
          <p className="text-sm text-slate-500">
            Every reserved pull, grouped by order pallet then by aisle.
          </p>
        </div>
        <Link
          href={`/warehouses/${parsedWarehouseId}/outbound/picking${showAll ? "" : "?show=all"}`}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {showAll ? "Show open only" : "Show all"}
        </Link>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
            <tr>
              <th className="px-6 py-3">Pallet</th>
              <th className="px-6 py-3">From</th>
              <th className="px-6 py-3">Item</th>
              <th className="px-6 py-3">Batch / Lot</th>
              <th className="px-6 py-3 text-right">Qty</th>
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
                <td className="px-6 py-4 font-mono text-xs font-bold text-teal-700">
                  {row.locationCode ?? "-"}
                </td>
                <td className="px-6 py-4">
                  <div className="font-mono text-xs font-bold text-slate-900">
                    {row.sku ?? "-"}
                  </div>
                  <div className="text-xs text-slate-500">{row.itemName ?? ""}</div>
                </td>
                <td className="px-6 py-4 font-mono text-xs text-slate-500">
                  {row.batchNumber ?? "-"}
                  {row.lotNumber ? ` / ${row.lotNumber}` : ""}
                </td>
                <td className="px-6 py-4 text-right font-mono text-sm font-semibold text-slate-900">
                  {row.pickQuantity}
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                      statusStyles[row.statusCode ?? ""] ??
                      "bg-slate-100 text-slate-700 border-slate-200"
                    }`}
                  >
                    {(row.statusCode ?? "").replace(/_/g, " ")}
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
                  {row.assignedEmployeeId ? (
                    [row.assigneeFirstName, row.assigneeLastName]
                      .filter(Boolean)
                      .join(" ") || `#${row.assignedEmployeeId}`
                  ) : (
                    <span className="text-slate-400">Unassigned</span>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  <PickingTaskActions
                    warehouseId={parsedWarehouseId}
                    taskId={row.taskId}
                    statusCode={row.statusCode ?? "PENDING"}
                    canPick={canPick}
                    canAssign={canAssign}
                    employeeOptions={employeeOptions}
                  />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-6 py-8 text-center text-slate-500">
                  <div className="flex flex-col items-center gap-2">
                    <ClipboardCheck className="h-6 w-6 text-slate-300" />
                    No pick tasks. Release a sales order to create some.
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
