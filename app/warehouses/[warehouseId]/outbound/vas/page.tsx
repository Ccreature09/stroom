import Link from "next/link";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customers,
  employees,
  positionTypes,
  salesOrders,
  taskStatuses,
  tasks,
  taskTypes,
  vasTaskSteps,
  vasTasks,
} from "@/drizzle/schema";
import { requireOutboundManagerAccess } from "@/lib/warehouse-access";
import { getTaskLookups } from "@/lib/inbound/task-lookups";
import { loadTaskSetting } from "@/lib/vas/vas-server";
import { listWarehouseDepartments, loadTaskDepartments } from "@/lib/tasks/routing";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { ArrowLeft, Sparkles } from "lucide-react";
import { RaiseVasDialog, VasTaskActions } from "./vas-controls";
import { TaskRouting } from "../../task-routing";

const statusStyles: Record<string, string> = {
  PENDING: "bg-slate-100 text-slate-600 border-slate-200",
  IN_PROGRESS: "bg-blue-50 text-blue-700 border-blue-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
};

export default async function VasQueuePage({
  params,
}: {
  params: Promise<{ warehouseId: string }>;
}) {
  const { warehouseId } = await params;
  const { employee, warehouseId: parsedWarehouseId } =
    await requireOutboundManagerAccess(warehouseId);

  await getTaskLookups();
  const setting = await loadTaskSetting(db, parsedWarehouseId, "VAS");

  const [rows, eligibleOrders, employeeOptions] = await Promise.all([
    db
      .select({
        taskId: tasks.taskId,
        statusCode: taskStatuses.code,
        assignedEmployeeId: tasks.assignedEmployeeId,
        assigneeFirstName: employees.firstName,
        assigneeLastName: employees.lastName,
        soId: vasTasks.soId,
        soNumber: salesOrders.soNumber,
        customerName: customers.name,
        lpnId: vasTasks.lpnId,
        totalSteps: sql<number>`count(${vasTaskSteps.stepId})::int`,
        doneSteps: sql<number>`count(*) filter (where ${vasTaskSteps.isDone})::int`,
      })
      .from(vasTasks)
      .innerJoin(tasks, eq(vasTasks.taskId, tasks.taskId))
      .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
      .innerJoin(taskTypes, eq(tasks.taskTypeId, taskTypes.taskTypeId))
      .innerJoin(salesOrders, eq(vasTasks.soId, salesOrders.soId))
      .innerJoin(customers, eq(salesOrders.customerId, customers.customerId))
      .leftJoin(employees, eq(tasks.assignedEmployeeId, employees.employeeId))
      .leftJoin(vasTaskSteps, eq(vasTaskSteps.taskId, vasTasks.taskId))
      .where(
        and(eq(tasks.warehouseId, parsedWarehouseId), eq(taskTypes.code, "VAS")),
      )
      .groupBy(
        tasks.taskId,
        taskStatuses.code,
        employees.firstName,
        employees.lastName,
        vasTasks.soId,
        salesOrders.soNumber,
        customers.name,
        vasTasks.lpnId,
      )
      .orderBy(desc(tasks.createdAt))
      .limit(300),
    // Orders far enough along to need VAS but without a task yet.
    db
      .select({ soId: salesOrders.soId, soNumber: salesOrders.soNumber })
      .from(salesOrders)
      .leftJoin(vasTasks, eq(vasTasks.soId, salesOrders.soId))
      .where(
        and(
          eq(salesOrders.warehouseId, parsedWarehouseId),
          inArray(salesOrders.status, ["PICKED", "PACKING", "PACKED"]),
          sql`${vasTasks.soId} is null`,
        ),
      )
      .orderBy(asc(salesOrders.soNumber)),
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
          eq(positionTypes.canPack, true),
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

  const canAssign = employee.canAssignTasks === true;
  const canPack = employee.canPack === true;

  return (
    <main className="flex-1 space-y-6 p-8">
      <div>
        <DynamicBreadcrumb />
      </div>
      <Link
        href={`/warehouses/${parsedWarehouseId}/outbound`}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Outbound
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Packing &amp; VAS
          </h1>
          <p className="text-sm text-slate-500">
            Value-added work on picked orders, and how far through its
            checklist each one is.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/warehouses/${parsedWarehouseId}/outbound/vas-rules`}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Rules &amp; settings
          </Link>
          {canAssign ? (
            <RaiseVasDialog
              warehouseId={parsedWarehouseId}
              eligibleOrders={eligibleOrders}
              employeeOptions={employeeOptions}
              disabled={!setting.isEnabled}
            />
          ) : null}
        </div>
      </div>

      {!setting.isEnabled ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Value-added services are switched off for this warehouse, so no tasks
          will be raised.{" "}
          <Link
            href={`/warehouses/${parsedWarehouseId}/outbound/vas-rules`}
            className="font-semibold underline"
          >
            Turn them on
          </Link>{" "}
          if orders here need packing.
        </div>
      ) : !setting.autoCreate ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Automatic raising is off — tasks appear here only when raised by
          hand.
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
            <tr>
              <th className="px-6 py-3">Order</th>
              <th className="px-6 py-3">Customer</th>
              <th className="px-6 py-3">Pallet</th>
              <th className="px-6 py-3">Checklist</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Routed To</th>
              <th className="px-6 py-3">Assigned To</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {rows.map((row) => {
              const pct =
                row.totalSteps > 0
                  ? Math.round((row.doneSteps / row.totalSteps) * 100)
                  : 100;
              return (
                <tr key={row.taskId} className="hover:bg-slate-50">
                  <td className="px-6 py-4">
                    <Link
                      href={`/warehouses/${parsedWarehouseId}/outbound/sales-orders/${row.soId}`}
                      className="font-mono text-xs font-bold text-teal-700 hover:underline"
                    >
                      {row.soNumber}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-xs text-slate-900">{row.customerName}</td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-500">
                    {row.lpnId ?? "-"}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-900">
                        {row.doneSteps}/{row.totalSteps}
                      </span>
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${
                            pct === 100 ? "bg-emerald-600" : "bg-teal-600"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
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
                    <VasTaskActions
                      warehouseId={parsedWarehouseId}
                      taskId={row.taskId}
                      statusCode={row.statusCode ?? "PENDING"}
                      canPack={canPack}
                      canAssign={canAssign}
                      employeeOptions={employeeOptions}
                    />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center text-slate-500">
                  <div className="flex flex-col items-center gap-2">
                    <Sparkles className="h-6 w-6 text-slate-300" />
                    No value-added work outstanding.
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
