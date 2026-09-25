import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { carriers, employees, locations, taskStatuses, tasks, taskTypes, unloadingTasks } from "@/drizzle/schema";
import { requireWarehouseAccess } from "@/lib/warehouse-access";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { ArrowLeft, PackagePlus } from "lucide-react";
import Link from "next/link";
import { UnloadingFloorControls } from "./unloading-floor-controls";

export default async function FloorUnloadingDetailPage({
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
      dockDoorCode: locations.locationCode,
      trailerNumber: unloadingTasks.trailerNumber,
      expectedPallets: unloadingTasks.expectedPallets,
      carrierName: carriers.name,
    })
    .from(unloadingTasks)
    .innerJoin(tasks, eq(unloadingTasks.taskId, tasks.taskId))
    .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
    .innerJoin(taskTypes, eq(tasks.taskTypeId, taskTypes.taskTypeId))
    .leftJoin(locations, eq(unloadingTasks.dockDoorLocationId, locations.locationId))
    .leftJoin(carriers, eq(unloadingTasks.carrierId, carriers.carrierId))
    .leftJoin(employees, eq(tasks.assignedEmployeeId, employees.employeeId))
    .where(
      and(
        eq(unloadingTasks.taskId, taskId),
        eq(tasks.warehouseId, parsedWarehouseId),
        eq(taskTypes.code, "UNLOADING"),
      ),
    )
    .limit(1);

  if (!row) redirect(`/warehouses/${parsedWarehouseId}/floor`);

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
        <h1 className="text-xl font-bold text-slate-900">Receive Truck</h1>
        <dl className="mt-4 space-y-2.5 text-sm">
          <Row label="Dock door" value={row.dockDoorCode ?? "Not set"} />
          <Row label="Trailer" value={row.trailerNumber ?? "-"} />
          <Row label="Carrier" value={row.carrierName ?? "-"} />
          <Row label="Expected pallets" value={String(row.expectedPallets)} />
          <Row label="Assigned to" value={assigneeName ?? "Unclaimed"} />
        </dl>
      </div>

      <UnloadingFloorControls
        warehouseId={parsedWarehouseId}
        taskId={row.taskId}
        statusCode={row.statusCode ?? "PENDING"}
        assignedEmployeeId={row.assignedEmployeeId}
        myEmployeeId={employee.employeeId}
        canUnload={employee.canUnload === true}
        expectedPallets={row.expectedPallets}
      />

      {(row.statusCode === "IN_PROGRESS" || row.statusCode === "COMPLETED") &&
      employee.canModifyInventory ? (
        <Link
          href={`/warehouses/${parsedWarehouseId}/floor/receive`}
          className="flex items-center gap-3 rounded-2xl border-2 border-teal-600 bg-teal-50 px-5 py-4 text-teal-900 shadow-sm transition hover:bg-teal-100"
        >
          <PackagePlus className="h-6 w-6 shrink-0" />
          <div>
            <div className="text-base font-bold">Book Items From This Truck</div>
            <div className="text-sm text-teal-800">
              Bulk-book untracked stock, or scan batches in one at a time
            </div>
          </div>
        </Link>
      ) : null}
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
