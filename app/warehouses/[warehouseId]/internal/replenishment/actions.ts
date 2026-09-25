"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  inventory,
  locations,
  replenishmentTasks,
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
  parseDepartmentIds,
  validateDepartmentIds,
} from "@/lib/tasks/routing";

/** Internal move between two of our own locations. */
const MOVEMENT_TRANSFER = "TRANSFER";

function parsePositiveInt(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const parsed = Number(String(value).trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseOptionalText(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const raw = String(value).trim();
  return raw ? raw : null;
}

function revalidateReplenishment(warehouseId: number) {
  revalidatePath(`/warehouses/${warehouseId}/internal/replenishment`);
  revalidatePath(`/warehouses/${warehouseId}/floor`);
  revalidatePath(`/warehouses/${warehouseId}/inventory/stock`);
}

/**
 * Raises a replenishment move.
 *
 * Batch/lot come from the specific reserve row the planner chose, not from
 * the item: `replenishment_tasks` carries the `enforce_item_tracking_flags`
 * trigger, so a move of tracked stock is rejected outright unless it names
 * what it is moving -- and naming it is also what lets the operator be sent
 * to one pallet rather than a bay full of them.
 */
export async function createReplenishmentTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requireReplenish: true,
  });
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const itemId = parsePositiveInt(formData.get("itemId"));
  const sourceLocationId = parsePositiveInt(formData.get("sourceLocationId"));
  const destinationLocationId = parsePositiveInt(formData.get("destinationLocationId"));
  const quantity = parsePositiveInt(formData.get("quantity"));
  const batchNumber = parseOptionalText(formData.get("batchNumber"));
  const lotNumber = parseOptionalText(formData.get("lotNumber"));
  const assignedEmployeeId = parsePositiveInt(formData.get("assignedEmployeeId"));

  if (!itemId) return { error: "Select an item." };
  if (!sourceLocationId) return { error: "Select a source location." };
  if (!destinationLocationId) return { error: "Select a destination." };
  if (!quantity) return { error: "Quantity must be a positive whole number." };
  if (sourceLocationId === destinationLocationId) {
    return { error: "Source and destination must be different." };
  }

  const bothLocations = await db
    .select({ locationId: locations.locationId })
    .from(locations)
    .where(
      and(
        eq(locations.warehouseId, warehouseId),
        eq(locations.isBlocked, false),
      ),
    );
  const validIds = new Set(bothLocations.map((l) => l.locationId));
  if (!validIds.has(sourceLocationId) || !validIds.has(destinationLocationId)) {
    return { error: "Location not found in this warehouse (or is blocked)." };
  }

  const routing = await validateDepartmentIds(
    warehouseId,
    parseDepartmentIds(formData.get("departmentIds")),
  );
  if (!routing.ok) return { error: routing.error };

  const taskId = await db.transaction(async (tx) => {
    const id = await createTask(tx, {
      warehouseId,
      typeCode: "REPLENISHMENT",
      assignedEmployeeId,
      // Replenishment beats routine work: a picker standing at an empty face
      // is blocked, so these should surface above the default 100.
      priority: 50,
      departmentIds: routing.ids,
    });
    await tx.insert(replenishmentTasks).values({
      taskId: id,
      itemId,
      batchNumber,
      lotNumber,
      sourceLocationId,
      destinationLocationId,
      quantity,
    });
    return id;
  });

  revalidateReplenishment(warehouseId);
  return { success: true, taskId };
}

export async function assignReplenishmentTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requireReplenish: true,
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

  revalidateReplenishment(warehouseId);
  return { success: true };
}

export async function startReplenishmentTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requireReplenish: true,
  });
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) return { error: "Invalid task." };

  const result = await db.transaction((tx) => startTask(tx, taskId, warehouseId));
  if (result.error) return { error: result.error };

  revalidateReplenishment(warehouseId);
  return { success: true };
}

/**
 * Completes the move: stock actually leaves the reserve bay and lands on the
 * pick face, in one transaction, with a TRANSFER movement recording it.
 *
 * The moved quantity may be less than planned (the reserve pallet held less
 * than the record said, which is what going to look at it discovers), so the
 * actual figure is what moves and what gets recorded.
 */
export async function completeReplenishmentTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requireReplenish: true,
  });
  if (!access.ok) return { error: access.error };
  const { employee, warehouseId } = access.context;

  const taskId = String(formData.get("taskId") ?? "");
  const movedQuantityInput = parsePositiveInt(formData.get("movedQuantity"));
  if (!taskId) return { error: "Invalid task." };

  const [task] = await db
    .select({
      itemId: replenishmentTasks.itemId,
      batchNumber: replenishmentTasks.batchNumber,
      lotNumber: replenishmentTasks.lotNumber,
      sourceLocationId: replenishmentTasks.sourceLocationId,
      destinationLocationId: replenishmentTasks.destinationLocationId,
      quantity: replenishmentTasks.quantity,
    })
    .from(replenishmentTasks)
    .where(eq(replenishmentTasks.taskId, taskId))
    .limit(1);
  if (!task) return { error: "Replenishment task not found." };

  const movedQuantity = movedQuantityInput ?? task.quantity;
  if (movedQuantity > task.quantity) {
    return { error: `This move was planned for ${task.quantity}. Moving more needs a new task.` };
  }

  // NULL batch/lot means "untracked", so it has to be matched with IS NULL
  // rather than `=` -- the same identity rule the picking path uses.
  const matchStock = (locationId: number) =>
    and(
      eq(inventory.locationId, locationId),
      eq(inventory.itemId, task.itemId),
      task.batchNumber === null
        ? isNull(inventory.batchNumber)
        : eq(inventory.batchNumber, task.batchNumber),
      task.lotNumber === null
        ? isNull(inventory.lotNumber)
        : eq(inventory.lotNumber, task.lotNumber),
    );

  const outcome = await db.transaction(async (tx) => {
    const [source] = await tx
      .select({
        inventoryId: inventory.inventoryId,
        quantity: inventory.quantity,
        statusId: inventory.statusId,
        expiryDate: inventory.expiryDate,
      })
      .from(inventory)
      .where(matchStock(task.sourceLocationId))
      .limit(1);

    const onHand = source?.quantity ?? 0;
    if (!source || onHand < movedQuantity) {
      return { error: `Only ${onHand} available at the source location.` } as const;
    }

    const remaining = onHand - movedQuantity;
    if (remaining === 0) {
      await tx.delete(inventory).where(eq(inventory.inventoryId, source.inventoryId));
    } else {
      await tx
        .update(inventory)
        .set({ quantity: remaining, updatedAt: new Date().toISOString() })
        .where(eq(inventory.inventoryId, source.inventoryId));
    }

    const [destination] = await tx
      .select({
        inventoryId: inventory.inventoryId,
        quantity: inventory.quantity,
        statusId: inventory.statusId,
      })
      .from(inventory)
      .where(matchStock(task.destinationLocationId))
      .limit(1);

    if (destination) {
      // Merging stock of a different status would silently reclassify what
      // is already on the face -- the same rule receiving enforces.
      if (destination.statusId !== source.statusId) {
        return {
          error:
            "The pick face already holds this batch under a different inventory status.",
        } as const;
      }
      await tx
        .update(inventory)
        .set({
          quantity: (destination.quantity ?? 0) + movedQuantity,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(inventory.inventoryId, destination.inventoryId));
    } else {
      await tx.insert(inventory).values({
        locationId: task.destinationLocationId,
        itemId: task.itemId,
        quantity: movedQuantity,
        batchNumber: task.batchNumber,
        lotNumber: task.lotNumber,
        expiryDate: source.expiryDate,
        statusId: source.statusId,
      });
    }

    await tx.insert(stockMovements).values({
      employeeId: employee.employeeId,
      itemId: task.itemId,
      batchNumber: task.batchNumber,
      lotNumber: task.lotNumber,
      expiryDate: source.expiryDate,
      quantity: movedQuantity,
      sourceLocationId: task.sourceLocationId,
      destinationLocationId: task.destinationLocationId,
      movementType: MOVEMENT_TRANSFER,
      reasonCode: "Replenishment",
    });

    if (movedQuantity !== task.quantity) {
      await tx
        .update(replenishmentTasks)
        .set({ quantity: movedQuantity })
        .where(eq(replenishmentTasks.taskId, taskId));
    }

    const completion = await completeTask(tx, taskId, warehouseId);
    if (completion.error) return { error: completion.error } as const;
    return { success: true as const };
  });

  if ("error" in outcome && outcome.error) return { error: outcome.error };

  revalidateReplenishment(warehouseId);
  await notifyLocationInventoryChanged(warehouseId, task.sourceLocationId);
  await notifyLocationInventoryChanged(warehouseId, task.destinationLocationId);
  await reportEmployeeAtLocation(
    warehouseId,
    employee.organizationId,
    employee,
    task.destinationLocationId,
  );

  return { success: true };
}

export async function cancelReplenishmentTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requireAssignTasks: true,
  });
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) return { error: "Invalid task." };

  const result = await db.transaction((tx) => cancelTask(tx, taskId, warehouseId));
  if (result.error) return { error: result.error };

  revalidateReplenishment(warehouseId);
  return { success: true };
}
