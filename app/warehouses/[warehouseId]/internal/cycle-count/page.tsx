import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  cycleCountTasks,
  employees,
  inventory,
  items,
  locations,
  positionTypes,
  taskStatuses,
  tasks,
  taskTypes,
  warehouseConfigs,
  warehouses,
} from "@/drizzle/schema";
import { requireInternalManagerAccess } from "@/lib/warehouse-access";
import { getTaskLookups } from "@/lib/inbound/task-lookups";
import { computeVariance, needsReview } from "@/lib/internal/cycle-count";
import { listWarehouseDepartments, loadTaskDepartments } from "@/lib/tasks/routing";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { ClipboardList } from "lucide-react";
import { CountTaskActions, GenerateCountsForm } from "./count-controls";
import { TaskRouting } from "../../task-routing";

const statusStyles: Record<string, string> = {
  PENDING: "bg-slate-100 text-slate-600 border-slate-200",
  IN_PROGRESS: "bg-blue-50 text-blue-700 border-blue-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
};

const DUE_LIMIT = 25;

export default async function CycleCountPage({
  params,
}: {
  params: Promise<{ warehouseId: string }>;
}) {
  const { warehouseId } = await params;
  const { employee, warehouseId: parsedWarehouseId } =
    await requireInternalManagerAccess(warehouseId);

  await getTaskLookups();

  const [configRow] = await db
    .select({ cycleCountFrequencyDays: warehouseConfigs.cycleCountFrequencyDays })
    .from(warehouses)
    .leftJoin(warehouseConfigs, eq(warehouses.configId, warehouseConfigs.configId))
    .where(eq(warehouses.warehouseId, parsedWarehouseId))
    .limit(1);
  const frequencyDays = configRow?.cycleCountFrequencyDays ?? null;

  const [openTasks, recentDone, dueLocations, employeeOptions, locationOptions] =
    await Promise.all([
      db
        .select({
          taskId: tasks.taskId,
          statusCode: taskStatuses.code,
          assignedEmployeeId: tasks.assignedEmployeeId,
          assigneeFirstName: employees.firstName,
          assigneeLastName: employees.lastName,
          expectedQuantity: cycleCountTasks.expectedQuantity,
          countedQuantity: cycleCountTasks.countedQuantity,
          batchNumber: cycleCountTasks.batchNumber,
          lotNumber: cycleCountTasks.lotNumber,
          sku: items.sku,
          locationCode: locations.locationCode,
        })
        .from(cycleCountTasks)
        .innerJoin(tasks, eq(cycleCountTasks.taskId, tasks.taskId))
        .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
        .innerJoin(taskTypes, eq(tasks.taskTypeId, taskTypes.taskTypeId))
        .leftJoin(items, eq(cycleCountTasks.itemId, items.itemId))
        .leftJoin(locations, eq(cycleCountTasks.locationId, locations.locationId))
        .leftJoin(employees, eq(tasks.assignedEmployeeId, employees.employeeId))
        .where(
          and(
            eq(tasks.warehouseId, parsedWarehouseId),
            eq(taskTypes.code, "CYCLE_COUNT"),
            inArray(taskStatuses.code, ["PENDING", "IN_PROGRESS"]),
          ),
        )
        .orderBy(asc(locations.locationCode))
        .limit(200),
      db
        .select({
          taskId: tasks.taskId,
          completedAt: tasks.completedAt,
          expectedQuantity: cycleCountTasks.expectedQuantity,
          countedQuantity: cycleCountTasks.countedQuantity,
          sku: items.sku,
          locationCode: locations.locationCode,
        })
        .from(cycleCountTasks)
        .innerJoin(tasks, eq(cycleCountTasks.taskId, tasks.taskId))
        .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
        .innerJoin(taskTypes, eq(tasks.taskTypeId, taskTypes.taskTypeId))
        .leftJoin(items, eq(cycleCountTasks.itemId, items.itemId))
        .leftJoin(locations, eq(cycleCountTasks.locationId, locations.locationId))
        .where(
          and(
            eq(tasks.warehouseId, parsedWarehouseId),
            eq(taskTypes.code, "CYCLE_COUNT"),
            eq(taskStatuses.code, "COMPLETED"),
          ),
        )
        .orderBy(desc(tasks.completedAt))
        .limit(20),
      // Locations holding stock that have never been counted, or whose last
      // count is older than the configured frequency. Derived from completed
      // count tasks rather than a "last counted" column, which the schema
      // does not have.
      db
        .select({
          locationId: locations.locationId,
          locationCode: locations.locationCode,
          lines: sql<number>`count(distinct ${inventory.inventoryId})::int`,
          lastCounted: sql<string | null>`max(${tasks.completedAt})`,
        })
        .from(locations)
        .innerJoin(inventory, eq(inventory.locationId, locations.locationId))
        .leftJoin(cycleCountTasks, eq(cycleCountTasks.locationId, locations.locationId))
        .leftJoin(
          tasks,
          and(eq(tasks.taskId, cycleCountTasks.taskId), eq(tasks.warehouseId, parsedWarehouseId)),
        )
        .where(
          and(eq(locations.warehouseId, parsedWarehouseId), eq(locations.isBlocked, false)),
        )
        .groupBy(locations.locationId, locations.locationCode)
        .orderBy(sql`max(${tasks.completedAt}) asc nulls first`)
        .limit(DUE_LIMIT),
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
      db
        .select({ locationId: locations.locationId, locationCode: locations.locationCode })
        .from(locations)
        .where(
          and(eq(locations.warehouseId, parsedWarehouseId), eq(locations.isBlocked, false)),
        )
        .orderBy(asc(locations.locationCode)),
    ]);

  const [departmentOptions, taskDepartments] = await Promise.all([
    listWarehouseDepartments(parsedWarehouseId),
    loadTaskDepartments(openTasks.map((r) => r.taskId)),
  ]);

  const canCount = employee.canModifyInventory === true;
  const canAssign = employee.canAssignTasks === true;

  return (
    <main className="flex-1 space-y-6 p-8">
      <div>
        <DynamicBreadcrumb />
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Cycle Count</h1>
          <p className="text-sm text-slate-500">
            Counting stock in place, and correcting the record where it
            disagrees with the shelf.
            {frequencyDays
              ? ` Target frequency: every ${frequencyDays} days.`
              : " No count frequency configured."}
          </p>
        </div>
        {canCount ? (
          <GenerateCountsForm
            warehouseId={parsedWarehouseId}
            departmentOptions={departmentOptions}
            locationOptions={locationOptions}
            employeeOptions={employeeOptions}
          />
        ) : null}
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
          Least recently counted
        </h2>
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-6 py-3">Location</th>
                <th className="px-6 py-3 text-right">Stock lines</th>
                <th className="px-6 py-3">Last counted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {dueLocations.map((loc) => (
                <tr key={loc.locationId} className="hover:bg-slate-50">
                  <td className="px-6 py-3 font-mono text-xs font-bold text-slate-900">
                    {loc.locationCode}
                  </td>
                  <td className="px-6 py-3 text-right font-mono text-xs text-slate-600">
                    {loc.lines}
                  </td>
                  <td className="px-6 py-3 text-xs text-slate-600">
                    {loc.lastCounted ? (
                      loc.lastCounted.replace("T", " ").slice(0, 16)
                    ) : (
                      <span className="font-medium text-amber-700">Never</span>
                    )}
                  </td>
                </tr>
              ))}
              {dueLocations.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-6 text-center text-slate-500">
                    No stocked locations found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
          Open counts ({openTasks.length})
        </h2>
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-6 py-3">Location</th>
                <th className="px-6 py-3">Item</th>
                <th className="px-6 py-3">Batch / Lot</th>
                <th className="px-6 py-3 text-right">Expected</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Routed To</th>
                <th className="px-6 py-3">Assigned To</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {openTasks.map((row) => (
                <tr key={row.taskId} className="hover:bg-slate-50">
                  <td className="px-6 py-4 font-mono text-xs font-bold text-slate-900">
                    {row.locationCode ?? "-"}
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-600">
                    {row.sku ?? "-"}
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-500">
                    {row.batchNumber ?? "-"}
                    {row.lotNumber ? ` / ${row.lotNumber}` : ""}
                  </td>
                  <td className="px-6 py-4 text-right font-mono text-xs text-slate-500">
                    {/* Deliberately shown to supervisors only -- the floor
                        screen keeps it hidden so the count is blind. */}
                    {row.expectedQuantity}
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
                    <CountTaskActions
                      warehouseId={parsedWarehouseId}
                      taskId={row.taskId}
                      statusCode={row.statusCode ?? "PENDING"}
                      canCount={canCount}
                      canAssign={canAssign}
                      employeeOptions={employeeOptions}
                    />
                  </td>
                </tr>
              ))}
              {openTasks.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-slate-500">
                    <div className="flex flex-col items-center gap-2">
                      <ClipboardList className="h-6 w-6 text-slate-300" />
                      No counts in progress.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {recentDone.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
            Recently counted
          </h2>
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3">Location</th>
                  <th className="px-6 py-3">Item</th>
                  <th className="px-6 py-3 text-right">Expected</th>
                  <th className="px-6 py-3 text-right">Counted</th>
                  <th className="px-6 py-3 text-right">Variance</th>
                  <th className="px-6 py-3">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {recentDone.map((row) => {
                  const variance = computeVariance(
                    row.expectedQuantity,
                    row.countedQuantity ?? row.expectedQuantity,
                  );
                  return (
                    <tr key={row.taskId} className="hover:bg-slate-50">
                      <td className="px-6 py-3 font-mono text-xs font-bold text-slate-900">
                        {row.locationCode ?? "-"}
                      </td>
                      <td className="px-6 py-3 font-mono text-xs text-slate-600">
                        {row.sku ?? "-"}
                      </td>
                      <td className="px-6 py-3 text-right font-mono text-xs text-slate-500">
                        {row.expectedQuantity}
                      </td>
                      <td className="px-6 py-3 text-right font-mono text-xs text-slate-900">
                        {row.countedQuantity ?? "-"}
                      </td>
                      <td
                        className={`px-6 py-3 text-right font-mono text-xs font-semibold ${
                          variance.isMatch
                            ? "text-emerald-700"
                            : needsReview(variance)
                              ? "text-red-700"
                              : "text-amber-700"
                        }`}
                      >
                        {variance.isMatch
                          ? "—"
                          : `${variance.delta > 0 ? "+" : ""}${variance.delta}`}
                      </td>
                      <td className="px-6 py-3 text-xs text-slate-500">
                        {row.completedAt
                          ? row.completedAt.replace("T", " ").slice(0, 16)
                          : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}
