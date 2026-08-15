"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { inventory, pickingTasks, salesOrders, stockMovements } from "@/drizzle/schema";
import { requireWarehouseActionAccess } from "@/lib/warehouse-access";
import {
  assignTask,
  cancelTask,
  completeTask,
  startTask,
} from "@/lib/inbound/task-lifecycle";
import { notifyLocationInventoryChanged } from "@/lib/inventory/receiving";
import { reportEmployeeAtLocation } from "@/lib/warehouse-map/asset-positions";
import { orderPickLpn, syncSalesOrderStatus } from "@/lib/outbound/fulfilment";

/** Movement type for stock leaving a pick face against a customer order. */
const MOVEMENT_PICK = "PICK";

function parsePositiveInt(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const parsed = Number(String(value).trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function revalidatePicking(warehouseId: number) {
  revalidatePath(`/warehouses/${warehouseId}/outbound/picking`);
  revalidatePath(`/warehouses/${warehouseId}/outbound/sales-orders`);
  revalidatePath(`/warehouses/${warehouseId}/floor`);
  revalidatePath(`/warehouses/${warehouseId}/inventory/stock`);
}

/**
 * Assigning someone ELSE needs `canAssignTasks`; claiming an unassigned pick
 * for yourself needs only `canPick` -- same self/other split as the inbound
 * task modules.
 */
export async function assignPickingTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requirePick: true,
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

  revalidatePicking(warehouseId);
  return { success: true };
}

export async function startPickingTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requirePick: true,
  });
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) return { error: "Invalid task." };

  const result = await db.transaction((tx) => startTask(tx, taskId, warehouseId));
  if (result.error) return { error: result.error };

  revalidatePicking(warehouseId);
  return { success: true };
}

/**
 * Completing a pick is the moment stock physically leaves the shelf, so it
 * is the moment inventory has to move -- not dispatch, which is paperwork
 * that happens hours later.
 *
 * The picked quantity may be short of what was planned (the bay had less
 * than the system believed, which is exactly what picking discovers), so
 * the actual figure is what decrements inventory and what gets recorded.
 * The residual reservation is simply released rather than re-planned: a
 * short pick is a real-world discrepancy for a supervisor to look at, not
 * something to paper over by silently allocating elsewhere.
 *
 * Where the stock "is" between pick and dispatch: this model takes it out of
 * location-based inventory at pick time and treats the order pallet as
 * off-shelf. Keeping it in a staging location instead would need a
 * configured staging bay per warehouse; the movement row records the
 * departure either way.
 */
export async function completePickingTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requirePick: true,
  });
  if (!access.ok) return { error: access.error };
  const { employee, warehouseId } = access.context;

  const taskId = String(formData.get("taskId") ?? "");
  const pickedQuantityInput = parsePositiveInt(formData.get("pickedQuantity"));
  if (!taskId) return { error: "Invalid task." };

  const [pick] = await db
    .select({
      pickLocationId: pickingTasks.pickLocationId,
      itemId: pickingTasks.itemId,
      batchNumber: pickingTasks.batchNumber,
      lotNumber: pickingTasks.lotNumber,
      pickQuantity: pickingTasks.pickQuantity,
      lpnId: pickingTasks.lpnId,
    })
    .from(pickingTasks)
    .where(eq(pickingTasks.taskId, taskId))
    .limit(1);
  if (!pick) return { error: "Pick task not found." };

  const pickedQuantity = pickedQuantityInput ?? pick.pickQuantity;
  if (pickedQuantity > pick.pickQuantity) {
    return {
      error: `This pick asks for ${pick.pickQuantity}. Picking more than that needs a supervisor adjustment.`,
    };
  }

  // The pick names the exact batch/lot it is pulling, so the inventory row
  // is matched on all four parts of its identity. NULL batch/lot means
  // "untracked", so it has to be matched with IS NULL rather than `=`.
  const stockCondition = and(
    eq(inventory.locationId, pick.pickLocationId),
    eq(inventory.itemId, pick.itemId),
    pick.batchNumber === null
      ? isNull(inventory.batchNumber)
      : eq(inventory.batchNumber, pick.batchNumber),
    pick.lotNumber === null
      ? isNull(inventory.lotNumber)
      : eq(inventory.lotNumber, pick.lotNumber),
  );

  const outcome = await db.transaction(async (tx) => {
    const [stock] = await tx
      .select({ inventoryId: inventory.inventoryId, quantity: inventory.quantity })
      .from(inventory)
      .where(stockCondition)
      .limit(1);

    const onHand = stock?.quantity ?? 0;
    if (!stock || onHand < pickedQuantity) {
      return {
        error: `Only ${onHand} available at that location -- report a shortage instead of over-picking.`,
      } as const;
    }

    const remaining = onHand - pickedQuantity;
    if (remaining === 0) {
      await tx.delete(inventory).where(eq(inventory.inventoryId, stock.inventoryId));
    } else {
      await tx
        .update(inventory)
        .set({ quantity: remaining, updatedAt: new Date().toISOString() })
        .where(eq(inventory.inventoryId, stock.inventoryId));
    }

    await tx.insert(stockMovements).values({
      employeeId: employee.employeeId,
      itemId: pick.itemId,
      batchNumber: pick.batchNumber,
      lotNumber: pick.lotNumber,
      quantity: pickedQuantity,
      sourceLocationId: pick.pickLocationId,
      movementType: MOVEMENT_PICK,
      reasonCode: pick.lpnId,
    });

    // Record what was actually picked, so a short pick is visible on the
    // order rather than silently rounded up to what was planned.
    if (pickedQuantity !== pick.pickQuantity) {
      await tx
        .update(pickingTasks)
        .set({ pickQuantity: pickedQuantity })
        .where(eq(pickingTasks.taskId, taskId));
    }

    const completion = await completeTask(tx, taskId, warehouseId);
    if (completion.error) return { error: completion.error } as const;

    // The pallet is now wherever the picker is, not on the shelf it came
    // from -- keeping its last known location as the pick face would send
    // loading to the wrong end of the building.
    const soNumber = pick.lpnId.startsWith("PICK-") ? pick.lpnId.slice(5) : null;
    if (soNumber) {
      const [so] = await tx
        .select({ soId: salesOrders.soId, soNumber: salesOrders.soNumber })
        .from(salesOrders)
        .where(
          and(eq(salesOrders.soNumber, soNumber), eq(salesOrders.warehouseId, warehouseId)),
        )
        .limit(1);
      if (so && orderPickLpn(so.soNumber) === pick.lpnId) {
        await syncSalesOrderStatus(tx, warehouseId, so.soId, so.soNumber);
      }
    }

    return { success: true as const };
  });

  if ("error" in outcome && outcome.error) return { error: outcome.error };

  revalidatePicking(warehouseId);
  await notifyLocationInventoryChanged(warehouseId, pick.pickLocationId);
  await reportEmployeeAtLocation(
    warehouseId,
    employee.organizationId,
    employee,
    pick.pickLocationId,
  );

  return { success: true };
}

export async function cancelPickingTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requireAssignTasks: true,
  });
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) return { error: "Invalid task." };

  const result = await db.transaction((tx) => cancelTask(tx, taskId, warehouseId));
  if (result.error) return { error: result.error };

  revalidatePicking(warehouseId);
  return { success: true };
}
