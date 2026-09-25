import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  salesOrderLines,
  salesOrders,
  taskStatuses,
  taskTypes,
  tasks,
  vasRuleSteps,
  vasRules,
  vasTaskSteps,
  vasTasks,
  warehouseTaskSettings,
} from "@/drizzle/schema";
import { createTask } from "@/lib/inbound/task-lifecycle";
import { getTaskLookups, type TaskTypeCode } from "@/lib/inbound/task-lookups";
import { orderPickLpn } from "@/lib/outbound/fulfilment";
import { buildChecklist, matchRules, type VasRuleMatch } from "./rules";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = typeof db | Tx;

export type TaskSetting = { isEnabled: boolean; autoCreate: boolean };

/**
 * Whether a task type is in use here, and whether it self-raises.
 *
 * An absent row means "default" rather than "off": every task type worked
 * without this table before it existed, and a missing row must not silently
 * switch a step off. VAS is the exception -- a warehouse that has never
 * touched the setting is not doing value-added work, so it defaults off and
 * has to be opted into.
 */
export async function loadTaskSetting(
  tx: DbOrTx,
  warehouseId: number,
  typeCode: TaskTypeCode,
): Promise<TaskSetting> {
  const { typeIdByCode } = await getTaskLookups();
  const [row] = await tx
    .select({
      isEnabled: warehouseTaskSettings.isEnabled,
      autoCreate: warehouseTaskSettings.autoCreate,
    })
    .from(warehouseTaskSettings)
    .where(
      and(
        eq(warehouseTaskSettings.warehouseId, warehouseId),
        eq(warehouseTaskSettings.taskTypeId, typeIdByCode[typeCode]),
      ),
    )
    .limit(1);

  if (row) return { isEnabled: row.isEnabled, autoCreate: row.autoCreate };
  return typeCode === "VAS"
    ? { isEnabled: false, autoCreate: false }
    : { isEnabled: true, autoCreate: false };
}

/** Standing VAS rules for a warehouse, with their instruction steps. */
export async function loadVasRules(
  tx: DbOrTx,
  warehouseId: number,
): Promise<VasRuleMatch[]> {
  const ruleRows = await tx
    .select({
      ruleId: vasRules.ruleId,
      name: vasRules.name,
      appliesTo: vasRules.appliesTo,
      customerId: vasRules.customerId,
      itemId: vasRules.itemId,
    })
    .from(vasRules)
    .where(and(eq(vasRules.warehouseId, warehouseId), eq(vasRules.isActive, true)))
    .orderBy(asc(vasRules.ruleId));
  if (ruleRows.length === 0) return [];

  const stepRows = await tx
    .select({
      ruleId: vasRuleSteps.ruleId,
      sortOrder: vasRuleSteps.sortOrder,
      instruction: vasRuleSteps.instruction,
    })
    .from(vasRuleSteps)
    .where(inArray(vasRuleSteps.ruleId, ruleRows.map((r) => r.ruleId)))
    .orderBy(asc(vasRuleSteps.sortOrder));

  const stepsByRule = new Map<number, { sortOrder: number; instruction: string }[]>();
  for (const s of stepRows) {
    const list = stepsByRule.get(s.ruleId) ?? [];
    list.push({ sortOrder: s.sortOrder, instruction: s.instruction });
    stepsByRule.set(s.ruleId, list);
  }

  return ruleRows.map((r) => ({
    ruleId: r.ruleId,
    name: r.name,
    appliesTo: r.appliesTo as VasRuleMatch["appliesTo"],
    customerId: r.customerId,
    itemId: r.itemId,
    steps: stepsByRule.get(r.ruleId) ?? [],
  }));
}

/** Is there already a VAS task on this order that hasn't been cancelled? */
export async function findVasTaskForOrder(
  tx: DbOrTx,
  warehouseId: number,
  soId: number,
): Promise<{ taskId: string; statusCode: string } | null> {
  const [row] = await tx
    .select({ taskId: vasTasks.taskId, statusCode: taskStatuses.code })
    .from(vasTasks)
    .innerJoin(tasks, eq(vasTasks.taskId, tasks.taskId))
    .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
    .where(
      and(
        eq(vasTasks.soId, soId),
        eq(tasks.warehouseId, warehouseId),
        inArray(taskStatuses.code, ["PENDING", "IN_PROGRESS", "COMPLETED"]),
      ),
    )
    .limit(1);
  return row ?? null;
}

export type RaiseVasResult =
  | { created: false; reason: "disabled" | "no-rules" | "already-exists" }
  | { created: true; taskId: string; stepCount: number };

/**
 * Raises the VAS task for a picked order, seeding its checklist from whatever
 * standing rules match.
 *
 * `explicitInstructions` is how a supervisor raises one by hand for an order
 * no rule covers -- the "this one needs a gift box because the customer rang
 * up" case that no standing rule will ever predict.
 *
 * Steps are copied, not referenced: editing a rule next month must not
 * rewrite what someone was told to do last week.
 */
export async function raiseVasForOrder(
  tx: Tx,
  warehouseId: number,
  soId: number,
  options: {
    /** Bypass the auto-create setting -- a manual raise is a deliberate act. */
    manual?: boolean;
    explicitInstructions?: string[];
    assignedEmployeeId?: number | null;
  } = {},
): Promise<RaiseVasResult> {
  const setting = await loadTaskSetting(tx, warehouseId, "VAS");
  if (!setting.isEnabled) return { created: false, reason: "disabled" };
  if (!options.manual && !setting.autoCreate) {
    return { created: false, reason: "disabled" };
  }

  const existing = await findVasTaskForOrder(tx, warehouseId, soId);
  if (existing) return { created: false, reason: "already-exists" };

  const [order] = await tx
    .select({
      soId: salesOrders.soId,
      soNumber: salesOrders.soNumber,
      customerId: salesOrders.customerId,
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.soId, soId), eq(salesOrders.warehouseId, warehouseId)))
    .limit(1);
  if (!order) return { created: false, reason: "no-rules" };

  let checklist: { sortOrder: number; instruction: string }[];
  const explicit = (options.explicitInstructions ?? [])
    .map((s) => s.trim())
    .filter(Boolean);

  if (explicit.length > 0) {
    checklist = explicit.map((instruction, i) => ({ sortOrder: i, instruction }));
  } else {
    const lineRows = await tx
      .select({ itemId: salesOrderLines.itemId })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.soId, soId));
    const itemIds = lineRows
      .map((l) => l.itemId)
      .filter((id): id is number => id !== null);

    const rules = await loadVasRules(tx, warehouseId);
    const matched = matchRules(rules, { customerId: order.customerId, itemIds });
    checklist = buildChecklist(matched);
  }

  // An automatic raise with nothing to do is not a task, it is noise. A
  // manual one still goes ahead -- the supervisor can type the steps in.
  if (checklist.length === 0 && !options.manual) {
    return { created: false, reason: "no-rules" };
  }

  const taskId = await createTask(tx, {
    warehouseId,
    typeCode: "VAS",
    assignedEmployeeId: options.assignedEmployeeId ?? null,
    // Ahead of routine work: an order sitting unpacked is blocking a truck.
    priority: 60,
  });

  await tx.insert(vasTasks).values({
    taskId,
    soId,
    lpnId: orderPickLpn(order.soNumber),
  });

  if (checklist.length > 0) {
    await tx.insert(vasTaskSteps).values(
      checklist.map((step) => ({
        taskId,
        sortOrder: step.sortOrder,
        instruction: step.instruction,
      })),
    );
  }

  return { created: true, taskId, stepCount: checklist.length };
}

/**
 * Moves an order across the VAS leg of its lifecycle: PICKED -> PACKING once
 * value-added work is outstanding, PACKING -> PACKED once it is done.
 *
 * Deliberately separate from `syncSalesOrderStatus`, which owns the picking
 * leg. Two reasons: the picking roll-up has no business knowing what VAS is,
 * and folding this into it would make `fulfilment.ts` and this module import
 * each other. Each function owns one leg and neither walks the other's back.
 *
 * Never touches SHIPPED or CANCELLED -- an order that has left or been
 * killed is not waiting on a box.
 */
export async function syncOrderVasStatus(
  tx: DbOrTx,
  warehouseId: number,
  soId: number,
): Promise<void> {
  const [current] = await tx
    .select({ status: salesOrders.status })
    .from(salesOrders)
    .where(and(eq(salesOrders.soId, soId), eq(salesOrders.warehouseId, warehouseId)))
    .limit(1);
  if (!current) return;
  if (!["PICKED", "PACKING", "PACKED"].includes(current.status ?? "")) return;

  const vas = await findVasTaskForOrder(tx, warehouseId, soId);

  // No VAS task at all means this warehouse doesn't pack (or nothing
  // matched), so PICKED is already the shippable state.
  let next: string;
  if (!vas) next = "PICKED";
  else if (vas.statusCode === "COMPLETED") next = "PACKED";
  else next = "PACKING";

  if (next !== current.status) {
    await tx
      .update(salesOrders)
      .set({ status: next, updatedAt: new Date().toISOString() })
      .where(eq(salesOrders.soId, soId));
  }
}

/**
 * Orders blocked from shipping because their VAS is not finished.
 *
 * Used by the shipment builder: loading an order that still needs a logo
 * applied is the mistake this whole module exists to prevent.
 */
export async function findOrdersWithOpenVas(
  tx: DbOrTx,
  warehouseId: number,
  soIds: number[],
): Promise<Set<number>> {
  if (soIds.length === 0) return new Set();
  const rows = await tx
    .select({ soId: vasTasks.soId })
    .from(vasTasks)
    .innerJoin(tasks, eq(vasTasks.taskId, tasks.taskId))
    .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
    .innerJoin(taskTypes, eq(tasks.taskTypeId, taskTypes.taskTypeId))
    .where(
      and(
        eq(tasks.warehouseId, warehouseId),
        inArray(vasTasks.soId, soIds),
        inArray(taskStatuses.code, ["PENDING", "IN_PROGRESS"]),
      ),
    );
  return new Set(rows.map((r) => r.soId));
}
