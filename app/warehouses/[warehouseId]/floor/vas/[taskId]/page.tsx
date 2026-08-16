import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customers,
  employees,
  salesOrders,
  taskStatuses,
  tasks,
  taskTypes,
  vasTaskSteps,
  vasTasks,
} from "@/drizzle/schema";
import { requireWarehouseAccess } from "@/lib/warehouse-access";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { ArrowLeft } from "lucide-react";
import { VasChecklist } from "./vas-checklist";

export default async function FloorVasPage({
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
      soNumber: salesOrders.soNumber,
      customerName: customers.name,
      shippingAddress: salesOrders.shippingAddress,
      lpnId: vasTasks.lpnId,
      notes: vasTasks.notes,
    })
    .from(vasTasks)
    .innerJoin(tasks, eq(vasTasks.taskId, tasks.taskId))
    .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
    .innerJoin(taskTypes, eq(tasks.taskTypeId, taskTypes.taskTypeId))
    .innerJoin(salesOrders, eq(vasTasks.soId, salesOrders.soId))
    .innerJoin(customers, eq(salesOrders.customerId, customers.customerId))
    .where(
      and(
        eq(vasTasks.taskId, taskId),
        eq(tasks.warehouseId, parsedWarehouseId),
        eq(taskTypes.code, "VAS"),
      ),
    )
    .limit(1);

  if (!row) redirect(`/warehouses/${parsedWarehouseId}/floor`);

  const doneBy = employees;
  const steps = await db
    .select({
      stepId: vasTaskSteps.stepId,
      instruction: vasTaskSteps.instruction,
      isDone: vasTaskSteps.isDone,
      doneAt: vasTaskSteps.doneAt,
      doneByFirstName: doneBy.firstName,
      doneByLastName: doneBy.lastName,
    })
    .from(vasTaskSteps)
    .leftJoin(doneBy, eq(vasTaskSteps.doneByEmployeeId, doneBy.employeeId))
    .where(eq(vasTaskSteps.taskId, taskId))
    .orderBy(asc(vasTaskSteps.sortOrder));

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
        <h1 className="text-xl font-bold text-slate-900">Pack &amp; Finish</h1>
        <p className="text-sm text-slate-500">
          Order <span className="font-mono font-semibold">{row.soNumber}</span> ·{" "}
          {row.customerName}
        </p>
      </div>

      <VasChecklist
        warehouseId={parsedWarehouseId}
        taskId={row.taskId}
        statusCode={row.statusCode ?? "PENDING"}
        assignedEmployeeId={row.assignedEmployeeId}
        myEmployeeId={employee.employeeId}
        canPack={employee.canPack === true}
        soNumber={row.soNumber}
        customerName={row.customerName}
        lpnId={row.lpnId}
        notes={row.notes}
        steps={steps.map((s) => ({
          stepId: s.stepId,
          instruction: s.instruction,
          isDone: s.isDone,
          doneAt: s.doneAt,
          doneBy:
            [s.doneByFirstName, s.doneByLastName].filter(Boolean).join(" ") || null,
        }))}
      />
    </main>
  );
}
