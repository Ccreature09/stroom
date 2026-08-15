import { redirect } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees, locations, putawayTasks, taskStatuses, tasks, taskTypes } from "@/drizzle/schema";
import { requireWarehouseAccess } from "@/lib/warehouse-access";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { PutawayFloorControls } from "./putaway-floor-controls";

export default async function FloorPutawayDetailPage({
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
    .where(
      and(
        eq(putawayTasks.taskId, taskId),
        eq(tasks.warehouseId, parsedWarehouseId),
        eq(taskTypes.code, "PUTAWAY"),
      ),
    )
    .limit(1);

  if (!row) redirect(`/warehouses/${parsedWarehouseId}/floor`);

  const locationIds = [row.sourceLocationId, row.suggestedDestLocationId, row.actualDestLocationId].filter(
    (id): id is number => id !== null,
  );
  const [locationRows, destinationOptions] = await Promise.all([
    db
      .select({ locationId: locations.locationId, locationCode: locations.locationCode })
      .from(locations)
      .where(and(eq(locations.warehouseId, parsedWarehouseId), inArray(locations.locationId, locationIds))),
    db
      .select({ locationId: locations.locationId, locationCode: locations.locationCode })
      .from(locations)
      .where(and(eq(locations.warehouseId, parsedWarehouseId), eq(locations.isBlocked, false)))
      .orderBy(asc(locations.locationCode)),
  ]);
  const codeById = new Map(locationRows.map((l) => [l.locationId, l.locationCode]));

  const assigneeName = row.assignedEmployeeId
    ? [row.assigneeFirstName, row.assigneeLastName].filter(Boolean).join(" ") ||
      `#${row.assignedEmployeeId}`
    : null;

  return (
    <main className="flex-1 space-y-6 bg-slate-50 p-5 sm:p-8">
      <div>
        <DynamicBreadcrumb />
      </div>
      <Link
        href={`/warehouses/${parsedWarehouseId}/floor`}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> My Tasks
      </Link>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">Putaway</h1>
        <dl className="mt-4 space-y-2.5 text-sm">
          <Row label="Pallet (LPN)" value={row.lpnId} />
          <Row label="From" value={codeById.get(row.sourceLocationId) ?? "-"} />
          <Row label="Suggested to" value={codeById.get(row.suggestedDestLocationId) ?? "-"} />
          {row.actualDestLocationId ? (
            <Row label="Put away at" value={codeById.get(row.actualDestLocationId) ?? "-"} />
          ) : null}
          <Row label="Assigned to" value={assigneeName ?? "Unclaimed"} />
        </dl>
      </div>

      <PutawayFloorControls
        warehouseId={parsedWarehouseId}
        taskId={row.taskId}
        statusCode={row.statusCode ?? "PENDING"}
        assignedEmployeeId={row.assignedEmployeeId}
        myEmployeeId={employee.employeeId}
        canModify={employee.canModifyInventory === true}
        suggestedDestLocationId={row.suggestedDestLocationId}
        destinationOptions={destinationOptions}
      />
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}
