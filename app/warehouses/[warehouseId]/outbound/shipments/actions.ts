"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  carriers,
  loadingTasks,
  locations,
  salesOrderLines,
  salesOrders,
  shipmentSalesOrders,
  shipments,
  taskStatuses,
  tasks,
} from "@/drizzle/schema";
import { requireWarehouseActionAccess } from "@/lib/warehouse-access";
import {
  assignTask,
  cancelTask,
  completeTask,
  createTask,
  startTask,
} from "@/lib/inbound/task-lifecycle";
import { orderPickLpn } from "@/lib/outbound/fulfilment";
import { findOrdersWithOpenVas } from "@/lib/vas/vas-server";
import { markSerialsShipped } from "@/lib/inventory/serials-server";
import {
  parseDepartmentIds,
  validateDepartmentIds,
} from "@/lib/tasks/routing";

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

function parseIdList(raw: FormDataEntryValue | null): number[] | null {
  if (raw === null) return null;
  const ids = String(raw)
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return ids.length > 0 ? [...new Set(ids)] : null;
}

function revalidateShipments(warehouseId: number, shipmentId?: string) {
  revalidatePath(`/warehouses/${warehouseId}/outbound/shipments`);
  if (shipmentId) {
    revalidatePath(`/warehouses/${warehouseId}/outbound/shipments/${shipmentId}`);
  }
  revalidatePath(`/warehouses/${warehouseId}/outbound/sales-orders`);
  revalidatePath(`/warehouses/${warehouseId}/floor`);
}

/**
 * Builds a shipment from fully-picked orders and raises one loading task per
 * order pallet.
 *
 * Only PICKED orders are eligible: loading a pallet whose picks are still
 * outstanding would put a half-built order on a truck, which is the kind of
 * mistake that is very expensive to discover at the customer's dock.
 */
export async function createShipment(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requireLoad: true,
  });
  if (!access.ok) return { error: access.error };
  const { organizationId, warehouseId } = {
    organizationId: access.context.employee.organizationId,
    warehouseId: access.context.warehouseId,
  };

  const soIds = parseIdList(formData.get("soIds"));
  const carrierId = parsePositiveInt(formData.get("carrierId"));
  const trailerNumber = parseOptionalText(formData.get("trailerNumber"));
  const dockDoorLocationId = parsePositiveInt(formData.get("dockDoorLocationId"));

  if (!soIds) return { error: "Select at least one picked order." };
  if (!dockDoorLocationId) return { error: "Select a dock door." };

  const [dock] = await db
    .select({ locationId: locations.locationId })
    .from(locations)
    .where(
      and(
        eq(locations.locationId, dockDoorLocationId),
        eq(locations.warehouseId, warehouseId),
      ),
    )
    .limit(1);
  if (!dock) return { error: "Dock door not found in this warehouse." };

  if (carrierId) {
    const [carrier] = await db
      .select({ carrierId: carriers.carrierId })
      .from(carriers)
      .where(
        and(
          eq(carriers.carrierId, carrierId),
          eq(carriers.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!carrier) return { error: "Carrier not found for your organization." };
  }

  const orderRows = await db
    .select({
      soId: salesOrders.soId,
      soNumber: salesOrders.soNumber,
      status: salesOrders.status,
    })
    .from(salesOrders)
    .where(
      and(inArray(salesOrders.soId, soIds), eq(salesOrders.warehouseId, warehouseId)),
    );
  if (orderRows.length !== soIds.length) {
    return { error: "One or more orders were not found in this warehouse." };
  }
  // PACKED is the shippable state where value-added work is switched on;
  // PICKED is the shippable state where it is not.
  const notReady = orderRows.filter(
    (o) => o.status !== "PICKED" && o.status !== "PACKED",
  );
  if (notReady.length > 0) {
    return {
      error: `Not ready to load: ${notReady.map((o) => `${o.soNumber} (${o.status})`).join(", ")}.`,
    };
  }

  // Belt and braces on top of the status check -- an order whose VAS task is
  // still open must not get on a truck, and loading something that still
  // needs a logo applied is precisely the mistake this module exists to
  // prevent.
  const blocked = await findOrdersWithOpenVas(
    db,
    warehouseId,
    orderRows.map((o) => o.soId),
  );
  if (blocked.size > 0) {
    const names = orderRows.filter((o) => blocked.has(o.soId)).map((o) => o.soNumber);
    return { error: `Value-added work still outstanding on: ${names.join(", ")}.` };
  }

  const routing = await validateDepartmentIds(
    warehouseId,
    parseDepartmentIds(formData.get("departmentIds")),
  );
  if (!routing.ok) return { error: routing.error };

  let shipmentId: string;
  try {
    shipmentId = await db.transaction(async (tx) => {
      const [shipment] = await tx
        .insert(shipments)
        .values({
          organizationId,
          warehouseId,
          carrierId: carrierId ?? null,
          trailerNumber,
          status: "STAGING",
        })
        .returning({ shipmentId: shipments.shipmentId });

      await tx
        .insert(shipmentSalesOrders)
        .values(orderRows.map((o) => ({ shipmentId: shipment.shipmentId, soId: o.soId })));

      // One loading task per order pallet, sequenced so the trailer is
      // loaded in a deliberate order rather than whatever gets grabbed first.
      let sequenceNumber = 1;
      for (const order of orderRows) {
        const taskId = await createTask(tx, { warehouseId, typeCode: "LOADING", departmentIds: routing.ids });
        await tx.insert(loadingTasks).values({
          taskId,
          dockDoorLocationId,
          lpnId: orderPickLpn(order.soNumber),
          shipmentId: shipment.shipmentId,
          sequenceNumber,
        });
        sequenceNumber += 1;
      }

      return shipment.shipmentId;
    });
  } catch (error) {
    return { error: (error as Error).message || "Failed to create the shipment." };
  }

  revalidateShipments(warehouseId, shipmentId);
  return { success: true, shipmentId };
}

export async function assignLoadingTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requireLoad: true,
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

  revalidateShipments(warehouseId);
  return { success: true };
}

export async function startLoadingTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requireLoad: true,
  });
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) return { error: "Invalid task." };

  const result = await db.transaction((tx) => startTask(tx, taskId, warehouseId));
  if (result.error) return { error: result.error };

  revalidateShipments(warehouseId);
  return { success: true };
}

/**
 * Confirms one pallet is physically on the trailer.
 *
 * The scanned LPN must match the task's own pallet: loading is precisely
 * the step where the wrong pallet goes to the wrong customer, and a
 * free-text confirmation would catch none of that.
 */
export async function completeLoadingTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requireLoad: true,
  });
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const taskId = String(formData.get("taskId") ?? "");
  const scannedLpn = parseOptionalText(formData.get("scannedLpn"));
  if (!taskId) return { error: "Invalid task." };

  const [task] = await db
    .select({ lpnId: loadingTasks.lpnId, shipmentId: loadingTasks.shipmentId })
    .from(loadingTasks)
    .where(eq(loadingTasks.taskId, taskId))
    .limit(1);
  if (!task) return { error: "Loading task not found." };

  if (scannedLpn !== null && scannedLpn.toUpperCase() !== task.lpnId.toUpperCase()) {
    return {
      error: `That's ${scannedLpn}, but this slot expects ${task.lpnId}. Check the pallet.`,
    };
  }

  const result = await db.transaction(async (tx) => {
    const completion = await completeTask(tx, taskId, warehouseId);
    if (completion.error) return completion;

    // The shipment moves to LOADING on its first loaded pallet -- it is no
    // longer merely staged once something is physically on the trailer.
    await tx
      .update(shipments)
      .set({ status: "LOADING" })
      .where(
        and(
          eq(shipments.shipmentId, task.shipmentId),
          eq(shipments.warehouseId, warehouseId),
          eq(shipments.status, "STAGING"),
        ),
      );
    return { success: true as const };
  });
  if (result.error) return { error: result.error };

  revalidateShipments(warehouseId, task.shipmentId);
  return { success: true };
}

export async function cancelLoadingTask(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requireAssignTasks: true,
  });
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) return { error: "Invalid task." };

  const result = await db.transaction((tx) => cancelTask(tx, taskId, warehouseId));
  if (result.error) return { error: result.error };

  revalidateShipments(warehouseId);
  return { success: true };
}

/**
 * Dispatches the trailer: the shipment leaves, and every order on it is
 * marked shipped.
 *
 * `quantity_shipped` is set from `quantity_allocated` rather than requested,
 * and the schema enforces that relationship (`quantity_shipped <=
 * quantity_allocated`) -- an order released short ships short, and saying
 * otherwise would be a lie the database itself would reject.
 */
export async function dispatchShipment(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requireLoad: true,
  });
  if (!access.ok) return { error: access.error };
  const { warehouseId } = access.context;

  const shipmentId = String(formData.get("shipmentId") ?? "");
  const trackingNumber = parseOptionalText(formData.get("trackingNumber"));
  if (!shipmentId) return { error: "Invalid shipment." };

  const [shipment] = await db
    .select({ status: shipments.status })
    .from(shipments)
    .where(
      and(eq(shipments.shipmentId, shipmentId), eq(shipments.warehouseId, warehouseId)),
    )
    .limit(1);
  if (!shipment) return { error: "Shipment not found in this warehouse." };
  if (shipment.status === "DISPATCHED") return { error: "This shipment already left." };
  if (shipment.status === "CANCELLED") return { error: "This shipment was cancelled." };

  // Refuse to dispatch with pallets still on the dock -- that is the whole
  // point of tracking loading tasks.
  const [outstanding] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loadingTasks)
    .innerJoin(tasks, eq(loadingTasks.taskId, tasks.taskId))
    .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
    .where(
      and(
        eq(loadingTasks.shipmentId, shipmentId),
        eq(tasks.warehouseId, warehouseId),
        inArray(taskStatuses.code, ["PENDING", "IN_PROGRESS"]),
      ),
    );
  const stillOnDock = outstanding?.n ?? 0;
  if (stillOnDock > 0) {
    return {
      error: `${stillOnDock} pallet${stillOnDock === 1 ? " is" : "s are"} still not loaded.`,
    };
  }

  const orderRows = await db
    .select({ soId: shipmentSalesOrders.soId })
    .from(shipmentSalesOrders)
    .where(eq(shipmentSalesOrders.shipmentId, shipmentId));

  await db.transaction(async (tx) => {
    await tx
      .update(shipments)
      .set({ status: "DISPATCHED", dispatchedAt: new Date().toISOString() })
      .where(eq(shipments.shipmentId, shipmentId));

    const soIds = orderRows.map((o) => o.soId);
    if (soIds.length > 0) {
      await tx
        .update(salesOrderLines)
        .set({ quantityShipped: sql`${salesOrderLines.quantityAllocated}` })
        .where(inArray(salesOrderLines.soId, soIds));

      await tx
        .update(salesOrders)
        .set({
          status: "SHIPPED",
          trackingNumber: trackingNumber ?? undefined,
          updatedAt: new Date().toISOString(),
        })
        .where(inArray(salesOrders.soId, soIds));

      // The moment that makes serial tracking worth doing: each unit stops
      // being stock and becomes a record of what a named customer received.
      // Same transaction as the dispatch itself, so a shipped order can never
      // exist without its units marked shipped.
      for (const soId of soIds) {
        await markSerialsShipped(tx, { soId, shipmentId });
      }
    }
  });

  revalidateShipments(warehouseId, shipmentId);
  return { success: true };
}
