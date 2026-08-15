"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  customers,
  items,
  pallets,
  pickingTasks,
  salesOrderLines,
  salesOrders,
} from "@/drizzle/schema";
import { requireWarehouseActionAccess } from "@/lib/warehouse-access";
import { createTask } from "@/lib/inbound/task-lifecycle";
import { planAllocation } from "@/lib/outbound/allocation";
import { loadAllocatableStock } from "@/lib/outbound/allocation-server";
import { cancelOpenPicksForOrder, orderPickLpn } from "@/lib/outbound/fulfilment";
import {
  parseDepartmentIds,
  validateDepartmentIds,
} from "@/lib/tasks/routing";

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  );
}

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

type DraftLine = { itemId: number; quantityRequested: number };

/** Same JSON-blob approach the PO create dialog uses -- see the note there. */
function parseLines(raw: FormDataEntryValue | null): DraftLine[] | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  const lines: DraftLine[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) return null;
    const e = entry as Record<string, unknown>;
    const itemId = Number(e.itemId);
    const quantityRequested = Number(e.quantityRequested);
    if (!Number.isInteger(itemId) || itemId <= 0) return null;
    if (!Number.isInteger(quantityRequested) || quantityRequested <= 0) return null;
    lines.push({ itemId, quantityRequested });
  }
  return lines;
}

function revalidateSalesOrders(warehouseId: number, soId?: number) {
  revalidatePath(`/warehouses/${warehouseId}/outbound/sales-orders`);
  if (soId) revalidatePath(`/warehouses/${warehouseId}/outbound/sales-orders/${soId}`);
  revalidatePath(`/warehouses/${warehouseId}/outbound/picking`);
}

export async function createSalesOrder(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireModifyInventory: true },
  );
  if (!access.ok) return { error: access.error };

  const { employee, warehouseId } = access.context;

  const customerId = parsePositiveInt(formData.get("customerId"));
  const shippingAddress = parseOptionalText(formData.get("shippingAddress"));
  const lines = parseLines(formData.get("linesJson"));

  if (!customerId) return { error: "Select a customer." };
  if (!shippingAddress) return { error: "Enter a shipping address." };
  if (!lines) return { error: "Add at least one valid order line." };

  const [customer] = await db
    .select({ customerId: customers.customerId })
    .from(customers)
    .where(
      and(
        eq(customers.customerId, customerId),
        eq(customers.organizationId, employee.organizationId),
      ),
    )
    .limit(1);
  if (!customer) return { error: "Customer not found for your organization." };

  const itemIds = [...new Set(lines.map((l) => l.itemId))];
  const itemRows = await db
    .select({ itemId: items.itemId })
    .from(items)
    .where(
      and(inArray(items.itemId, itemIds), eq(items.organizationId, employee.organizationId)),
    );
  if (itemRows.length !== itemIds.length) {
    return { error: "One or more items were not found for your organization." };
  }

  const soNumber = `SO-${Date.now().toString(36).toUpperCase()}${Math.random()
    .toString(36)
    .slice(2, 5)
    .toUpperCase()}`;

  let soId: number;
  try {
    soId = await db.transaction(async (tx) => {
      const [so] = await tx
        .insert(salesOrders)
        .values({
          soNumber,
          organizationId: employee.organizationId,
          warehouseId,
          customerId,
          shippingAddress,
          status: "DRAFT",
        })
        .returning({ soId: salesOrders.soId });

      await tx.insert(salesOrderLines).values(
        lines.map((line) => ({
          soId: so.soId,
          itemId: line.itemId,
          quantityRequested: line.quantityRequested,
        })),
      );
      return so.soId;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { error: "Order number collided -- try again." };
    }
    throw error;
  }

  revalidateSalesOrders(warehouseId, soId);
  return { success: true, soId };
}

export type ReleaseResult = {
  error?: string;
  success?: true;
  /** Per-line outcome, so the UI can name exactly what could not be covered. */
  shortfalls?: { sku: string; requested: number; allocated: number }[];
  picksCreated?: number;
};

/**
 * Releases an order to the floor: reserves real stock against every line and
 * turns each reservation into a pick task someone can walk to.
 *
 * Allocation is FEFO and resolves to *specific* inventory rows rather than
 * "item + quantity", which is not a nicety -- `picking_tasks` carries the
 * `enforce_item_tracking_flags` trigger, so a pick for a batch- or
 * lot-tracked item is rejected outright unless it names the batch/lot it is
 * pulling. Choosing the stock at release time is what makes that possible,
 * and it is also what lets the picker be told the exact bay and batch
 * instead of hunting for one.
 *
 * A line that cannot be fully covered is released short and reported, not
 * refused: partial availability is the normal state of a warehouse, and
 * blocking an entire order because one line is two units light would be
 * worse than useless on a real floor.
 */
export async function releaseSalesOrder(formData: FormData): Promise<ReleaseResult> {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireReleaseOrders: true },
  );
  if (!access.ok) return { error: access.error };

  const { warehouseId } = access.context;
  const soId = parsePositiveInt(formData.get("soId"));
  if (!soId) return { error: "Invalid sales order." };

  const [so] = await db
    .select({
      soId: salesOrders.soId,
      soNumber: salesOrders.soNumber,
      status: salesOrders.status,
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.soId, soId), eq(salesOrders.warehouseId, warehouseId)))
    .limit(1);
  if (!so) return { error: "Sales order not found in this warehouse." };
  if (so.status !== "DRAFT") {
    return { error: "Only a draft order can be released." };
  }

  const lineRows = await db
    .select({
      soLineId: salesOrderLines.soLineId,
      itemId: salesOrderLines.itemId,
      sku: items.sku,
      quantityRequested: salesOrderLines.quantityRequested,
      quantityAllocated: salesOrderLines.quantityAllocated,
    })
    .from(salesOrderLines)
    .innerJoin(items, eq(salesOrderLines.itemId, items.itemId))
    .where(eq(salesOrderLines.soId, soId));
  if (lineRows.length === 0) return { error: "This order has no lines." };

  // Every pick raised by this release is routed the same way -- an order is
  // picked by one team, so per-task routing here would be noise.
  const routing = await validateDepartmentIds(
    warehouseId,
    parseDepartmentIds(formData.get("departmentIds")),
  );
  if (!routing.ok) return { error: routing.error };

  const shortfalls: ReleaseResult["shortfalls"] = [];
  let picksCreated = 0;

  try {
    await db.transaction(async (tx) => {
      // One pick container per order: `picking_tasks.lpn_id` is NOT NULL, so
      // every pick has to land on something physical. An order pallet is
      // what a picker actually pushes around, and it gives loading a single
      // scannable unit later.
      const lpnId = orderPickLpn(so.soNumber);
      await tx
        .insert(pallets)
        .values({ lpnId, warehouseId, status: "ACTIVE" })
        .onConflictDoNothing({ target: pallets.lpnId });

      for (const line of lineRows) {
        if (line.itemId === null) continue;
        const alreadyAllocated = line.quantityAllocated ?? 0;
        const stillNeeded = line.quantityRequested - alreadyAllocated;
        if (stillNeeded <= 0) continue;

        const candidates = await loadAllocatableStock(tx, warehouseId, line.itemId);
        const plan = planAllocation(candidates, stillNeeded);

        for (const pick of plan.picks) {
          const taskId = await createTask(tx, { warehouseId, typeCode: "PICKING", departmentIds: routing.ids });
          await tx.insert(pickingTasks).values({
            taskId,
            pickLocationId: pick.candidate.locationId,
            itemId: line.itemId,
            batchNumber: pick.candidate.batchNumber,
            lotNumber: pick.candidate.lotNumber,
            pickQuantity: pick.quantity,
            lpnId,
          });
          picksCreated += 1;
        }

        if (plan.allocated > 0) {
          await tx
            .update(salesOrderLines)
            .set({ quantityAllocated: alreadyAllocated + plan.allocated })
            .where(eq(salesOrderLines.soLineId, line.soLineId));
        }
        if (plan.shortfall > 0) {
          shortfalls.push({
            sku: line.sku,
            requested: line.quantityRequested,
            allocated: alreadyAllocated + plan.allocated,
          });
        }
      }

      await tx
        .update(salesOrders)
        .set({ status: "RELEASED", updatedAt: new Date().toISOString() })
        .where(eq(salesOrders.soId, soId));
    });
  } catch (error) {
    return { error: (error as Error).message || "Failed to release the order." };
  }

  revalidateSalesOrders(warehouseId, soId);
  return { success: true, shortfalls, picksCreated };
}

export async function cancelSalesOrder(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireReleaseOrders: true },
  );
  if (!access.ok) return { error: access.error };

  const { warehouseId } = access.context;
  const soId = parsePositiveInt(formData.get("soId"));
  if (!soId) return { error: "Invalid sales order." };

  const [so] = await db
    .select({ status: salesOrders.status, soNumber: salesOrders.soNumber })
    .from(salesOrders)
    .where(and(eq(salesOrders.soId, soId), eq(salesOrders.warehouseId, warehouseId)))
    .limit(1);
  if (!so) return { error: "Sales order not found in this warehouse." };
  if (so.status === "SHIPPED") {
    return { error: "A shipped order cannot be cancelled." };
  }

  // Anything already shipped has physically left the building, so unwinding
  // it is a returns problem, not an order-status problem.
  const [shipped] = await db
    .select({ total: sql<number>`coalesce(sum(${salesOrderLines.quantityShipped}), 0)::int` })
    .from(salesOrderLines)
    .where(eq(salesOrderLines.soId, soId));
  if ((shipped?.total ?? 0) > 0) {
    return { error: "Part of this order has already shipped -- it cannot be cancelled." };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(salesOrders)
      .set({ status: "CANCELLED", updatedAt: new Date().toISOString() })
      .where(eq(salesOrders.soId, soId));

    // Releasing the reservation is the point, and it is two writes that must
    // happen together: the open pick tasks are what actually hold the stock
    // (availability is derived from them), while quantityAllocated is what
    // the order claims to hold. Clearing one without the other would leave
    // stock either permanently reserved or double-promised.
    await cancelOpenPicksForOrder(tx, warehouseId, so.soNumber);
    await tx
      .update(salesOrderLines)
      .set({ quantityAllocated: 0 })
      .where(eq(salesOrderLines.soId, soId));
  });

  revalidateSalesOrders(warehouseId, soId);
  return { success: true };
}
