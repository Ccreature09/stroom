import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookingTasks, employees, items, locations, taskStatuses, tasks, taskTypes } from "@/drizzle/schema";
import { requireWarehouseAccess } from "@/lib/warehouse-access";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { BookingFloorControls } from "./booking-floor-controls";

export default async function FloorBookingDetailPage({
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
      sku: items.sku,
      itemName: items.name,
      productType: bookingTasks.productType,
      productQuantity: bookingTasks.productQuantity,
      palletHeightCm: bookingTasks.palletHeightCm,
      batchNumber: bookingTasks.batchNumber,
      lotNumber: bookingTasks.lotNumber,
      expiryDate: bookingTasks.expiryDate,
    })
    .from(bookingTasks)
    .innerJoin(tasks, eq(bookingTasks.taskId, tasks.taskId))
    .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
    .innerJoin(taskTypes, eq(tasks.taskTypeId, taskTypes.taskTypeId))
    .leftJoin(locations, eq(bookingTasks.dockDoorLocationId, locations.locationId))
    .leftJoin(items, eq(bookingTasks.itemId, items.itemId))
    .leftJoin(employees, eq(tasks.assignedEmployeeId, employees.employeeId))
    .where(
      and(
        eq(bookingTasks.taskId, taskId),
        eq(tasks.warehouseId, parsedWarehouseId),
        eq(taskTypes.code, "BOOKING"),
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
        <h1 className="text-xl font-bold text-slate-900">Dock Appointment</h1>
        <dl className="mt-4 space-y-2.5 text-sm">
          <Row label="Dock door" value={row.dockDoorCode ?? "Not set"} />
          <Row label="Item" value={`${row.sku ?? "-"} — ${row.itemName ?? "Unknown item"}`} />
          <Row label="Product type" value={row.productType} />
          <Row label="Quantity" value={String(row.productQuantity)} />
          <Row label="Pallet height" value={`${row.palletHeightCm} cm`} />
          {row.batchNumber || row.lotNumber ? (
            <Row
              label="Batch / Lot"
              value={`${row.batchNumber ?? "-"} / ${row.lotNumber ?? "-"}`}
            />
          ) : null}
          <Row label="Assigned to" value={assigneeName ?? "Unclaimed"} />
        </dl>
      </div>

      <BookingFloorControls
        warehouseId={parsedWarehouseId}
        taskId={row.taskId}
        statusCode={row.statusCode ?? "PENDING"}
        assignedEmployeeId={row.assignedEmployeeId}
        myEmployeeId={employee.employeeId}
        canBook={employee.canBook === true}
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
