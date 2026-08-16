"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  customers,
  items,
  vasRuleSteps,
  vasRules,
  warehouseTaskSettings,
} from "@/drizzle/schema";
import { requireWarehouseActionAccess } from "@/lib/warehouse-access";
import { getTaskLookups } from "@/lib/inbound/task-lookups";

function parsePositiveInt(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const parsed = Number(String(value).trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseInstructions(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function revalidateRules(warehouseId: number) {
  revalidatePath(`/warehouses/${warehouseId}/outbound/vas-rules`);
  revalidatePath(`/warehouses/${warehouseId}/task-routing`);
}

/**
 * Turns value-added services on or off for the warehouse, and decides
 * whether tasks self-raise when an order finishes picking.
 *
 * This is the switch that makes packing optional: a full-pallet operation
 * leaves it off and never sees a VAS task; an order-fulfilment operation
 * turns it on and gets one automatically for every order a rule matches.
 */
export async function setVasEnabled(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requireAssignTasks: true,
  });
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const isEnabled = String(formData.get("isEnabled") ?? "") === "true";
  const autoCreate = String(formData.get("autoCreate") ?? "") === "true";

  const { typeIdByCode } = await getTaskLookups();
  const taskTypeId = typeIdByCode.VAS;

  const values = {
    warehouseId,
    taskTypeId,
    isEnabled,
    autoCreate,
    updatedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
  };

  await db
    .insert(warehouseTaskSettings)
    .values(values)
    .onConflictDoUpdate({
      target: [warehouseTaskSettings.warehouseId, warehouseTaskSettings.taskTypeId],
      set: { isEnabled, autoCreate, updatedAt: values.updatedAt },
    });

  revalidateRules(warehouseId);
  return { success: true };
}

/**
 * Creates a standing rule: which orders need value-added work, and what the
 * checklist should say.
 *
 * Instructions are free text on purpose. "Apply the customer's logo to the
 * short face, centred" is not something a schema can usefully enumerate, and
 * a supervisor writing it in the words their team already uses is the point
 * -- the system's job is to make sure it gets asked for and ticked off, not
 * to understand it.
 */
export async function createVasRule(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requireAssignTasks: true,
  });
  if (!access.ok) return { error: access.error };
  const { employee, warehouseId } = access.context;

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const appliesTo = String(formData.get("appliesTo") ?? "ALL").trim();
  const customerId = parsePositiveInt(formData.get("customerId"));
  const itemId = parsePositiveInt(formData.get("itemId"));
  const instructions = parseInstructions(formData.get("instructions"));

  if (!name) return { error: "Give the rule a name." };
  if (!["ALL", "CUSTOMER", "ITEM"].includes(appliesTo)) {
    return { error: "Invalid rule scope." };
  }
  if (instructions.length === 0) {
    return { error: "Add at least one instruction, one per line." };
  }
  if (appliesTo === "CUSTOMER" && !customerId) {
    return { error: "Select the customer this rule applies to." };
  }
  if (appliesTo === "ITEM" && !itemId) {
    return { error: "Select the item this rule applies to." };
  }

  // Scope targets must belong to this organisation, or a rule could be
  // pointed at another tenant's customer.
  if (appliesTo === "CUSTOMER" && customerId) {
    const [row] = await db
      .select({ customerId: customers.customerId })
      .from(customers)
      .where(
        and(
          eq(customers.customerId, customerId),
          eq(customers.organizationId, employee.organizationId),
        ),
      )
      .limit(1);
    if (!row) return { error: "Customer not found for your organization." };
  }
  if (appliesTo === "ITEM" && itemId) {
    const [row] = await db
      .select({ itemId: items.itemId })
      .from(items)
      .where(
        and(eq(items.itemId, itemId), eq(items.organizationId, employee.organizationId)),
      )
      .limit(1);
    if (!row) return { error: "Item not found for your organization." };
  }

  await db.transaction(async (tx) => {
    const [rule] = await tx
      .insert(vasRules)
      .values({
        warehouseId,
        name,
        description,
        appliesTo,
        customerId: appliesTo === "CUSTOMER" ? customerId : null,
        itemId: appliesTo === "ITEM" ? itemId : null,
      })
      .returning({ ruleId: vasRules.ruleId });

    await tx.insert(vasRuleSteps).values(
      instructions.map((instruction, i) => ({
        ruleId: rule.ruleId,
        sortOrder: i,
        instruction,
      })),
    );
  });

  revalidateRules(warehouseId);
  return { success: true };
}

/** Retires a rule without deleting the tasks it has already produced --
 *  their steps were copied, so past work keeps its record. */
export async function setVasRuleActive(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requireAssignTasks: true,
  });
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const ruleId = parsePositiveInt(formData.get("ruleId"));
  const isActive = String(formData.get("isActive") ?? "") === "true";
  if (!ruleId) return { error: "Invalid rule." };

  const updated = await db
    .update(vasRules)
    .set({ isActive })
    .where(and(eq(vasRules.ruleId, ruleId), eq(vasRules.warehouseId, warehouseId)))
    .returning({ ruleId: vasRules.ruleId });
  if (updated.length === 0) return { error: "Rule not found in this warehouse." };

  revalidateRules(warehouseId);
  return { success: true };
}

export async function deleteVasRule(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requireAssignTasks: true,
  });
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const ruleId = parsePositiveInt(formData.get("ruleId"));
  if (!ruleId) return { error: "Invalid rule." };

  await db
    .delete(vasRules)
    .where(and(eq(vasRules.ruleId, ruleId), eq(vasRules.warehouseId, warehouseId)));

  revalidateRules(warehouseId);
  return { success: true };
}
