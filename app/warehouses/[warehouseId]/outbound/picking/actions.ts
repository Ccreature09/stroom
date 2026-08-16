"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { inventory, pickingTasks, salesOrders, stockMovements } from "@/drizzle/schema";
import { requireWarehouseActionAccess } from "@/lib/warehouse-access";
import {
  consumeSerialsForPick,
  itemTracking,
} from "@/lib/inventory/serials-server";
import {
  describeSerialProblem,
  parseSerialList,
  validateSerialList,
} from "@/lib/inventory/serial-rules";
import {
  assignTask,
  cancelTask,
  completeTask,
  startTask,
} from "@/lib/inbound/task-lifecycle";
import { notifyLocationInventoryChanged } from "@/lib/inventory/receiving";
import { reportEmployeeAtLocation } from "@/lib/warehouse-map/asset-positions";
import { syncSalesOrderStatus } from "@/lib/outbound/fulfilment";
import { raiseVasForOrder, syncOrderVasStatus } from "@/lib/vas/vas-server";

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
  const serials = parseSerialList(String(formData.get("serials") ?? ""));
  if (!taskId) return { error: "Invalid task." };

  const [pick] = await db
    .select({
      pickLocationId: pickingTasks.pickLocationId,
      itemId: pickingTasks.itemId,
      batchNumber: pickingTasks.batchNumber,
      lotNumber: pickingTasks.lotNumber,
      pickQuantity: pickingTasks.pickQuantity,
      lpnId: pickingTasks.lpnId,
      soId: pickingTasks.soId,
    })
    .from(pickingTasks)
    .where(eq(pickingTasks.taskId, taskId))
    .limit(1);
  if (!pick) return { error: "Pick task not found." };

  // Same rule as receiving: for a serialised item the quantity is the number
  // of units actually scanned, never a separately typed figure.
  const tracking = await itemTracking(db, pick.itemId);
  if (tracking?.isSerialTracked) {
    const problem = validateSerialList(serials);
    if (problem) return { error: describeSerialProblem(problem) };
  } else if (serials.length > 0) {
    return { error: "This item is not serial tracked, so serials can't be recorded against it." };
  }

  const pickedQuantity = tracking?.isSerialTracked
    ? serials.length
    : (pickedQuantityInput ?? pick.pickQuantity);
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

    // Move the named units onto the pallet before the stock line is touched.
    // Conditioned on each unit still being IN_STOCK here, so two pickers
    // racing for the same box produces a refusal rather than one of them
    // walking off with stock the system has given to the other.
    if (tracking?.isSerialTracked && serials.length > 0) {
      const consumed = await consumeSerialsForPick(tx, {
        organizationId: tracking.organizationId,
        itemId: pick.itemId,
        locationId: pick.pickLocationId,
        serials,
        lpnId: pick.lpnId,
        soId: pick.soId,
        employeeId: employee.employeeId,
      });
      if (!consumed.ok) {
        const shown = consumed.serials.slice(0, 5).join(", ");
        return {
          error: `Not in this bin: ${shown}${consumed.serials.length > 5 ? ` (+${consumed.serials.length - 5} more)` : ""}. Check the label or report a discrepancy.`,
        } as const;
      }
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

    // Which order this pick belongs to now comes from `picking_tasks.so_id`
    // rather than from parsing the pallet's name. The name convention still
    // exists for humans reading a label, but it is no longer load-bearing --
    // renaming a pallet used to silently sever the pick from its order.
    if (pick.soId !== null) {
      const [so] = await tx
        .select({ soId: salesOrders.soId, soNumber: salesOrders.soNumber })
        .from(salesOrders)
        .where(
          and(eq(salesOrders.soId, pick.soId), eq(salesOrders.warehouseId, warehouseId)),
        )
        .limit(1);
      if (so) {
        await syncSalesOrderStatus(tx, warehouseId, so.soId);

        // The moment an order finishes picking is the moment value-added
        // work becomes possible, so that is where it is raised -- inside the
        // same transaction, so a completed pick can never leave an order
        // that needs packing without a task telling anyone.
        // No-ops when VAS is switched off, not set to auto-raise, or when no
        // standing rule matches this order.
        await raiseVasForOrder(tx, warehouseId, so.soId);
        await syncOrderVasStatus(tx, warehouseId, so.soId);
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
