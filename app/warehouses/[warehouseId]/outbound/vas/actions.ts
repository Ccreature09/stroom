"use server";

import { and, asc, eq, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { tasks, vasTaskSteps, vasTasks } from "@/drizzle/schema";
import { requireWarehouseActionAccess } from "@/lib/warehouse-access";
import {
  assignTask,
  cancelTask,
  completeTask,
  startTask,
} from "@/lib/inbound/task-lifecycle";
import { getTaskLookups } from "@/lib/inbound/task-lookups";
import { checklistProgress } from "@/lib/vas/rules";
import { raiseVasForOrder, syncOrderVasStatus } from "@/lib/vas/vas-server";

function parsePositiveInt(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const parsed = Number(String(value).trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Free-text instructions, one per line -- see the note on why they are
 *  handwritten rather than enumerated. */
function parseInstructions(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function revalidateVas(warehouseId: number) {
  revalidatePath(`/warehouses/${warehouseId}/outbound/vas`);
  revalidatePath(`/warehouses/${warehouseId}/outbound/sales-orders`);
  revalidatePath(`/warehouses/${warehouseId}/outbound/shipments`);
  revalidatePath(`/warehouses/${warehouseId}/floor`);
}

/** Loads a VAS task and proves it belongs to this warehouse. */
async function findVasTask(taskId: string, warehouseId: number) {
  const [row] = await db
    .select({ taskId: vasTasks.taskId, soId: vasTasks.soId })
    .from(vasTasks)
    .innerJoin(tasks, eq(vasTasks.taskId, tasks.taskId))
    .where(and(eq(vasTasks.taskId, taskId), eq(tasks.warehouseId, warehouseId)))
    .limit(1);
  return row ?? null;
}

/**
 * Raises VAS on an order by hand.
 *
 * The escape hatch for everything a standing rule cannot predict -- the
 * customer who rang up and asked for a gift box. Passing `manual` bypasses
 * the auto-create setting (though not the master enable switch: a warehouse
 * that does not do VAS should not suddenly acquire a VAS task), and lets the
 * supervisor type the checklist directly.
 */
export async function raiseVasTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requireAssignTasks: true,
  });
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const soId = parsePositiveInt(formData.get("soId"));
  if (!soId) return { error: "Select an order." };

  const instructions = parseInstructions(formData.get("instructions"));
  const assignedEmployeeId = parsePositiveInt(formData.get("assignedEmployeeId"));

  const result = await db.transaction(async (tx) => {
    const raised = await raiseVasForOrder(tx, warehouseId, soId, {
      manual: true,
      explicitInstructions: instructions,
      assignedEmployeeId,
    });
    if (raised.created) await syncOrderVasStatus(tx, warehouseId, soId);
    return raised;
  });

  if (!result.created) {
    const messages: Record<string, string> = {
      disabled:
        "Value-added services are switched off for this warehouse. Enable them in Task Routing first.",
      "already-exists": "This order already has a VAS task.",
      "no-rules": "Nothing to do -- add at least one instruction.",
    };
    return { error: messages[result.reason] ?? "Could not raise the task." };
  }

  revalidateVas(warehouseId);
  return { success: true, taskId: result.taskId };
}

export async function assignVasTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requirePack: true,
  });
  if (!access.ok) return { error: access.error };
  const { employee, warehouseId } = access.context;

  const taskId = String(formData.get("taskId") ?? "");
  const assignedEmployeeId = parsePositiveInt(formData.get("assignedEmployeeId"));
  if (!taskId) return { error: "Invalid task." };
  if (!assignedEmployeeId) return { error: "Select an employee." };
  if (assignedEmployeeId !== employee.employeeId && employee.canAssignTasks !== true) {
    return { error: "You can only claim this task for yourself." };
  }

  const result = await db.transaction((tx) =>
    assignTask(tx, taskId, warehouseId, assignedEmployeeId),
  );
  if (result.error) return { error: result.error };

  revalidateVas(warehouseId);
  return { success: true };
}

export async function startVasTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requirePack: true,
  });
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) return { error: "Invalid task." };

  const vas = await findVasTask(taskId, warehouseId);
  if (!vas) return { error: "Task not found in this warehouse." };

  const result = await db.transaction(async (tx) => {
    const started = await startTask(tx, taskId, warehouseId);
    if (!started.error) await syncOrderVasStatus(tx, warehouseId, vas.soId);
    return started;
  });
  if (result.error) return { error: result.error };

  revalidateVas(warehouseId);
  return { success: true };
}

/**
 * Marks one instruction as applied (or un-applies it).
 *
 * Stamps who and when: "the logo was applied" is a claim someone is making,
 * and a checklist that records only the tick is worth much less than one
 * that records who ticked it.
 */
export async function toggleVasStep(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requirePack: true,
  });
  if (!access.ok) return { error: access.error };
  const { employee, warehouseId } = access.context;

  const stepId = parsePositiveInt(formData.get("stepId"));
  const isDone = String(formData.get("isDone") ?? "") === "true";
  if (!stepId) return { error: "Invalid step." };

  const [step] = await db
    .select({ stepId: vasTaskSteps.stepId, taskId: vasTaskSteps.taskId })
    .from(vasTaskSteps)
    .innerJoin(vasTasks, eq(vasTaskSteps.taskId, vasTasks.taskId))
    .innerJoin(tasks, eq(vasTasks.taskId, tasks.taskId))
    .where(and(eq(vasTaskSteps.stepId, stepId), eq(tasks.warehouseId, warehouseId)))
    .limit(1);
  if (!step) return { error: "Step not found in this warehouse." };

  await db
    .update(vasTaskSteps)
    .set({
      isDone,
      doneAt: isDone ? new Date().toISOString().slice(0, 19).replace("T", " ") : null,
      doneByEmployeeId: isDone ? employee.employeeId : null,
    })
    .where(eq(vasTaskSteps.stepId, stepId));

  revalidateVas(warehouseId);
  return { success: true };
}

/**
 * Completes the VAS task, but only once every instruction is ticked.
 *
 * The whole point of the checklist is that it cannot be waved through: a
 * task closed with three of five steps done would mean an order shipping
 * without the work that was asked for, and nothing downstream would ever
 * notice.
 */
export async function completeVasTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requirePack: true,
  });
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) return { error: "Invalid task." };

  const vas = await findVasTask(taskId, warehouseId);
  if (!vas) return { error: "Task not found in this warehouse." };

  const steps = await db
    .select({ isDone: vasTaskSteps.isDone })
    .from(vasTaskSteps)
    .where(eq(vasTaskSteps.taskId, taskId));

  const progress = checklistProgress(steps);
  if (!progress.isComplete) {
    return {
      error: `${progress.remaining} instruction${progress.remaining === 1 ? "" : "s"} still to do.`,
    };
  }

  const result = await db.transaction(async (tx) => {
    const done = await completeTask(tx, taskId, warehouseId);
    if (done.error) return done;
    await syncOrderVasStatus(tx, warehouseId, vas.soId);
    return { success: true as const };
  });
  if (result.error) return { error: result.error };

  revalidateVas(warehouseId);
  return { success: true };
}

export async function cancelVasTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requireAssignTasks: true,
  });
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) return { error: "Invalid task." };

  const vas = await findVasTask(taskId, warehouseId);
  if (!vas) return { error: "Task not found in this warehouse." };

  const result = await db.transaction(async (tx) => {
    const cancelled = await cancelTask(tx, taskId, warehouseId);
    if (cancelled.error) return cancelled;
    // Back to PICKED: with no live VAS task the order is shippable again.
    await syncOrderVasStatus(tx, warehouseId, vas.soId);
    return { success: true as const };
  });
  if (result.error) return { error: result.error };

  revalidateVas(warehouseId);
  return { success: true };
}

/** Supervisor adds an instruction to a task already on the floor. */
export async function addVasStep(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requireAssignTasks: true,
  });
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const taskId = String(formData.get("taskId") ?? "");
  const instruction = String(formData.get("instruction") ?? "").trim();
  if (!taskId) return { error: "Invalid task." };
  if (!instruction) return { error: "Enter an instruction." };

  const vas = await findVasTask(taskId, warehouseId);
  if (!vas) return { error: "Task not found in this warehouse." };

  const { statusIdByCode } = await getTaskLookups();

  await db.transaction(async (tx) => {
    const [tail] = await tx
      .select({ maxOrder: max(vasTaskSteps.sortOrder) })
      .from(vasTaskSteps)
      .where(eq(vasTaskSteps.taskId, taskId));

    await tx.insert(vasTaskSteps).values({
      taskId,
      sortOrder: (tail?.maxOrder ?? -1) + 1,
      instruction,
    });

    // Adding work to a finished task reopens it -- otherwise the new
    // instruction sits permanently unticked on a job marked done, and the
    // order would ship without it.
    await tx
      .update(tasks)
      .set({ statusId: statusIdByCode.IN_PROGRESS, completedAt: null })
      .where(
        and(
          eq(tasks.taskId, taskId),
          eq(tasks.statusId, statusIdByCode.COMPLETED),
        ),
      );

    await syncOrderVasStatus(tx, warehouseId, vas.soId);
  });

  revalidateVas(warehouseId);
  return { success: true };
}

/** Steps on a task, for the manager detail view. */
export async function listVasSteps(warehouseId: number, taskId: string) {
  const access = await requireWarehouseActionAccess(String(warehouseId), {
    requireAssignTasks: true,
  });
  if (!access.ok) return [];
  return db
    .select({
      stepId: vasTaskSteps.stepId,
      instruction: vasTaskSteps.instruction,
      isDone: vasTaskSteps.isDone,
    })
    .from(vasTaskSteps)
    .innerJoin(vasTasks, eq(vasTaskSteps.taskId, vasTasks.taskId))
    .innerJoin(tasks, eq(vasTasks.taskId, tasks.taskId))
    .where(and(eq(vasTaskSteps.taskId, taskId), eq(tasks.warehouseId, warehouseId)))
    .orderBy(asc(vasTaskSteps.sortOrder));
}
