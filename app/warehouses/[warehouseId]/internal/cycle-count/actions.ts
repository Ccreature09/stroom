"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  cycleCountTasks,
  inventory,
  locations,
  stockMovements,
} from "@/drizzle/schema";
import { requireWarehouseActionAccess } from "@/lib/warehouse-access";
import {
  assignTask,
  cancelTask,
  completeTask,
  createTask,
  startTask,
} from "@/lib/inbound/task-lifecycle";
import { notifyLocationInventoryChanged } from "@/lib/inventory/receiving";
import { reportEmployeeAtLocation } from "@/lib/warehouse-map/asset-positions";
import {
  computeVariance,
  movementTypeForVariance,
  needsReview,
} from "@/lib/internal/cycle-count";
import {
  parseDepartmentIds,
  validateDepartmentIds,
} from "@/lib/tasks/routing";

function parsePositiveInt(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const parsed = Number(String(value).trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseNonNegativeInt(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function revalidateCounts(warehouseId: number) {
  revalidatePath(`/warehouses/${warehouseId}/internal/cycle-count`);
  revalidatePath(`/warehouses/${warehouseId}/floor`);
  revalidatePath(`/warehouses/${warehouseId}/inventory/stock`);
}

/**
 * Raises a count for every stock line currently at a location.
 *
 * `expected_quantity` is snapshotted now rather than read at count time,
 * which is the entire point of a cycle count: it freezes what the system
 * believed *before* anyone went to look, so the comparison afterwards is
 * against the belief being tested rather than against a figure that may have
 * moved in the meantime.
 *
 * A location with no stock produces no tasks -- counting an empty bay is a
 * different exercise (confirming it is empty) that this schema has nowhere
 * to record, since a count row needs an item.
 */
export async function generateCountsForLocation(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requireModifyInventory: true,
  });
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const locationId = parsePositiveInt(formData.get("locationId"));
  const assignedEmployeeId = parsePositiveInt(formData.get("assignedEmployeeId"));
  if (!locationId) return { error: "Select a location to count." };

  const [location] = await db
    .select({ locationId: locations.locationId, locationCode: locations.locationCode })
    .from(locations)
    .where(
      and(eq(locations.locationId, locationId), eq(locations.warehouseId, warehouseId)),
    )
    .limit(1);
  if (!location) return { error: "Location not found in this warehouse." };

  const stockRows = await db
    .select({
      itemId: inventory.itemId,
      quantity: inventory.quantity,
      batchNumber: inventory.batchNumber,
      lotNumber: inventory.lotNumber,
    })
    .from(inventory)
    .where(eq(inventory.locationId, locationId));

  const countable = stockRows.filter(
    (r): r is typeof r & { itemId: number } => r.itemId !== null,
  );
  if (countable.length === 0) {
    return { error: `${location.locationCode} holds no stock to count.` };
  }

  const routing = await validateDepartmentIds(
    warehouseId,
    parseDepartmentIds(formData.get("departmentIds")),
  );
  if (!routing.ok) return { error: routing.error };

  let created = 0;
  await db.transaction(async (tx) => {
    for (const row of countable) {
      const taskId = await createTask(tx, {
        warehouseId,
        typeCode: "CYCLE_COUNT",
        assignedEmployeeId,
        departmentIds: routing.ids,
      });
      await tx.insert(cycleCountTasks).values({
        taskId,
        locationId,
        itemId: row.itemId,
        batchNumber: row.batchNumber,
        lotNumber: row.lotNumber,
        expectedQuantity: row.quantity ?? 0,
      });
      created += 1;
    }
  });

  revalidateCounts(warehouseId);
  return { success: true, created };
}

export async function assignCountTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requireModifyInventory: true,
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

  revalidateCounts(warehouseId);
  return { success: true };
}

export async function startCountTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requireModifyInventory: true,
  });
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) return { error: "Invalid task." };

  const result = await db.transaction((tx) => startTask(tx, taskId, warehouseId));
  if (result.error) return { error: result.error };

  revalidateCounts(warehouseId);
  return { success: true };
}

export type SubmitCountResult = {
  error?: string;
  success?: true;
  /** Set when the count differs enough that it was not auto-applied. */
  needsReview?: boolean;
  expected?: number;
  counted?: number;
  delta?: number;
  applied?: boolean;
};

/**
 * Records a count and, when the variance is small, corrects inventory to
 * match what was actually on the shelf.
 *
 * A large variance is recorded but deliberately NOT applied: writing a big
 * correction straight into inventory on one person's say-so is how a
 * miscount becomes the new truth. Those come back needing `canForceRecount`
 * to confirm, which is exactly what that permission is for.
 */
export async function submitCount(formData: FormData): Promise<SubmitCountResult> {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requireModifyInventory: true,
  });
  if (!access.ok) return { error: access.error };
  const { employee, warehouseId } = access.context;

  const taskId = String(formData.get("taskId") ?? "");
  const countedQuantity = parseNonNegativeInt(formData.get("countedQuantity"));
  const force = String(formData.get("force") ?? "") === "true";
  if (!taskId) return { error: "Invalid task." };
  if (countedQuantity === null) {
    return { error: "Enter the counted quantity (0 is allowed)." };
  }

  const [count] = await db
    .select({
      locationId: cycleCountTasks.locationId,
      itemId: cycleCountTasks.itemId,
      batchNumber: cycleCountTasks.batchNumber,
      lotNumber: cycleCountTasks.lotNumber,
      expectedQuantity: cycleCountTasks.expectedQuantity,
    })
    .from(cycleCountTasks)
    .where(eq(cycleCountTasks.taskId, taskId))
    .limit(1);
  if (!count) return { error: "Count task not found." };

  const variance = computeVariance(count.expectedQuantity, countedQuantity);

  // Always record what was counted, even when the correction is held back --
  // the count itself is evidence and must not be lost.
  await db
    .update(cycleCountTasks)
    .set({ countedQuantity })
    .where(eq(cycleCountTasks.taskId, taskId));

  if (needsReview(variance) && !force) {
    revalidateCounts(warehouseId);
    return {
      success: true,
      needsReview: true,
      applied: false,
      expected: variance.expected,
      counted: variance.counted,
      delta: variance.delta,
    };
  }
  if (needsReview(variance) && force && employee.canForceRecount !== true) {
    return { error: "Confirming a variance this large needs recount permission." };
  }

  const matchStock = and(
    eq(inventory.locationId, count.locationId),
    eq(inventory.itemId, count.itemId),
    count.batchNumber === null
      ? isNull(inventory.batchNumber)
      : eq(inventory.batchNumber, count.batchNumber),
    count.lotNumber === null
      ? isNull(inventory.lotNumber)
      : eq(inventory.lotNumber, count.lotNumber),
  );

  const outcome = await db.transaction(async (tx) => {
    if (!variance.isMatch) {
      const [stock] = await tx
        .select({ inventoryId: inventory.inventoryId })
        .from(inventory)
        .where(matchStock)
        .limit(1);

      if (stock) {
        if (countedQuantity === 0) {
          await tx.delete(inventory).where(eq(inventory.inventoryId, stock.inventoryId));
        } else {
          await tx
            .update(inventory)
            .set({ quantity: countedQuantity, updatedAt: new Date().toISOString() })
            .where(eq(inventory.inventoryId, stock.inventoryId));
        }
      }
      // A count that finds stock where the record has none cannot create the
      // line here: the row's inventory status is unknowable from a count, and
      // guessing it would silently classify found stock as sellable.
      else if (countedQuantity > 0) {
        return {
          error:
            "This stock line no longer exists in the record -- book it in through Receive Stock so its status is set deliberately.",
        } as const;
      }

      const movementType = movementTypeForVariance(variance);
      if (movementType) {
        await tx.insert(stockMovements).values({
          employeeId: employee.employeeId,
          itemId: count.itemId,
          batchNumber: count.batchNumber,
          lotNumber: count.lotNumber,
          quantity: variance.absDelta,
          sourceLocationId: variance.isShortage ? count.locationId : null,
          destinationLocationId: variance.isOverage ? count.locationId : null,
          movementType,
          reasonCode: "Cycle count",
        });
      }
    }

    const completion = await completeTask(tx, taskId, warehouseId);
    if (completion.error) return { error: completion.error } as const;
    return { success: true as const };
  });

  if ("error" in outcome && outcome.error) return { error: outcome.error };

  revalidateCounts(warehouseId);
  if (!variance.isMatch) {
    await notifyLocationInventoryChanged(warehouseId, count.locationId);
  }
  await reportEmployeeAtLocation(
    warehouseId,
    employee.organizationId,
    employee,
    count.locationId,
  );

  return {
    success: true,
    applied: true,
    expected: variance.expected,
    counted: variance.counted,
    delta: variance.delta,
  };
}

export async function cancelCountTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requireAssignTasks: true,
  });
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) return { error: "Invalid task." };

  const result = await db.transaction((tx) => cancelTask(tx, taskId, warehouseId));
  if (result.error) return { error: result.error };

  revalidateCounts(warehouseId);
  return { success: true };
}
