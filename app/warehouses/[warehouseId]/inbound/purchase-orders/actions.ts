"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  inventoryStatuses,
  items,
  locations,
  purchaseOrderLines,
  purchaseOrders,
  suppliers,
} from "@/drizzle/schema";
import { requireWarehouseActionAccess } from "@/lib/warehouse-access";
import {
  notifyLocationInventoryChanged,
  receiveIntoInventory,
} from "@/lib/inventory/receiving";
import {
  itemTracking,
  recordReceivedSerials,
} from "@/lib/inventory/serials-server";
import {
  describeSerialProblem,
  parseSerialList,
  validateSerialList,
} from "@/lib/inventory/serial-rules";
import { reportEmployeeAtLocation } from "@/lib/warehouse-map/asset-positions";

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

type DraftLine = {
  itemId: number;
  quantityOrdered: number;
  unitCost: number | null;
  batchNumber: string | null;
  lotNumber: string | null;
  expiryDate: string | null;
};

/**
 * The create dialog manages an arbitrary number of line rows in React state,
 * which is awkward to express as repeated FormData field names once rows can
 * be added and removed -- a JSON blob is the simplest thing that is still an
 * ordinary form field, and it stays entirely client-side state until submit.
 */
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
    if (!Number.isInteger(itemId) || itemId <= 0) return null;

    const quantityOrdered = Number(e.quantityOrdered);
    if (!Number.isInteger(quantityOrdered) || quantityOrdered <= 0) return null;

    let unitCost: number | null = null;
    if (e.unitCost !== null && e.unitCost !== undefined && e.unitCost !== "") {
      unitCost = Number(e.unitCost);
      if (!Number.isFinite(unitCost) || unitCost < 0) return null;
    }

    const batchNumber =
      typeof e.batchNumber === "string" && e.batchNumber.trim()
        ? e.batchNumber.trim()
        : null;
    const lotNumber =
      typeof e.lotNumber === "string" && e.lotNumber.trim()
        ? e.lotNumber.trim()
        : null;
    const expiryDate =
      typeof e.expiryDate === "string" && e.expiryDate.trim()
        ? e.expiryDate.trim()
        : null;

    lines.push({ itemId, quantityOrdered, unitCost, batchNumber, lotNumber, expiryDate });
  }
  return lines;
}

export async function createPurchaseOrder(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireModifyInventory: true },
  );
  if (!access.ok) return { error: access.error };

  const { employee, warehouseId } = access.context;

  const supplierId = parsePositiveInt(formData.get("supplierId"));
  const expectedDate = parseOptionalText(formData.get("expectedDate"));
  const lines = parseLines(formData.get("linesJson"));

  if (!supplierId) return { error: "Select a supplier." };
  if (!lines) return { error: "Add at least one valid order line." };

  const [supplier] = await db
    .select({ supplierId: suppliers.supplierId })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.supplierId, supplierId),
        eq(suppliers.organizationId, employee.organizationId),
      ),
    )
    .limit(1);
  if (!supplier) return { error: "Supplier not found for your organization." };

  const itemIds = [...new Set(lines.map((l) => l.itemId))];
  const itemRows = await db
    .select({ itemId: items.itemId })
    .from(items)
    .where(
      and(
        inArray(items.itemId, itemIds),
        eq(items.organizationId, employee.organizationId),
      ),
    );
  if (itemRows.length !== itemIds.length) {
    return { error: "One or more items were not found for your organization." };
  }

  // Timestamp + random rather than sequential: no counter to race across
  // concurrent creates, and the unique constraint is the real backstop --
  // collision is astronomically unlikely with this much entropy.
  const poNumber = `PO-${Date.now().toString(36).toUpperCase()}${Math.random()
    .toString(36)
    .slice(2, 5)
    .toUpperCase()}`;

  let poId: number;
  try {
    poId = await db.transaction(async (tx) => {
      const [po] = await tx
        .insert(purchaseOrders)
        .values({
          poNumber,
          organizationId: employee.organizationId,
          warehouseId,
          supplierId,
          status: "DRAFT",
          expectedDate,
        })
        .returning({ poId: purchaseOrders.poId });

      await tx.insert(purchaseOrderLines).values(
        lines.map((line) => ({
          poId: po.poId,
          itemId: line.itemId,
          quantityOrdered: line.quantityOrdered,
          batchNumber: line.batchNumber,
          lotNumber: line.lotNumber,
          expiryDate: line.expiryDate,
          unitCost: line.unitCost !== null ? String(line.unitCost) : null,
        })),
      );

      return po.poId;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { error: "PO number collided with an existing order -- try again." };
    }
    throw error;
  }

  revalidatePath(`/warehouses/${warehouseId}/inbound/purchase-orders`);
  return { success: true, poId };
}

export async function submitPurchaseOrder(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireModifyInventory: true },
  );
  if (!access.ok) return { error: access.error };

  const { warehouseId } = access.context;
  const poId = parsePositiveInt(formData.get("poId"));
  if (!poId) return { error: "Invalid purchase order." };

  const updated = await db
    .update(purchaseOrders)
    .set({ status: "OPEN", updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(purchaseOrders.poId, poId),
        eq(purchaseOrders.warehouseId, warehouseId),
        eq(purchaseOrders.status, "DRAFT"),
      ),
    )
    .returning({ poId: purchaseOrders.poId });

  if (updated.length === 0) {
    return { error: "Only a draft purchase order can be submitted." };
  }

  revalidatePath(`/warehouses/${warehouseId}/inbound/purchase-orders`);
  revalidatePath(`/warehouses/${warehouseId}/inbound/purchase-orders/${poId}`);
  return { success: true };
}

export async function cancelPurchaseOrder(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireModifyInventory: true },
  );
  if (!access.ok) return { error: access.error };

  const { warehouseId } = access.context;
  const poId = parsePositiveInt(formData.get("poId"));
  if (!poId) return { error: "Invalid purchase order." };

  const [current] = await db
    .select({ status: purchaseOrders.status })
    .from(purchaseOrders)
    .where(
      and(eq(purchaseOrders.poId, poId), eq(purchaseOrders.warehouseId, warehouseId)),
    )
    .limit(1);
  if (!current) return { error: "Purchase order not found in this warehouse." };
  if (current.status !== "DRAFT" && current.status !== "OPEN") {
    return { error: "Only a draft or open purchase order can be cancelled." };
  }

  const [receivedCheck] = await db
    .select({
      total: sql<number>`coalesce(sum(${purchaseOrderLines.quantityReceived}), 0)::int`,
    })
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.poId, poId));
  if ((receivedCheck?.total ?? 0) > 0) {
    return {
      error: "This purchase order has already received stock and can no longer be cancelled.",
    };
  }

  await db
    .update(purchaseOrders)
    .set({ status: "CANCELLED", updatedAt: new Date().toISOString() })
    .where(eq(purchaseOrders.poId, poId));

  revalidatePath(`/warehouses/${warehouseId}/inbound/purchase-orders`);
  revalidatePath(`/warehouses/${warehouseId}/inbound/purchase-orders/${poId}`);
  return { success: true };
}

/**
 * Receives units against one PO line: books them into inventory (shared with
 * ad-hoc receiving, so the merge/status-mismatch rule can't drift between the
 * two entry points), bumps that line's `quantity_received`, and rolls the
 * parent PO's status up from the aggregate of all its lines -- OPEN while
 * nothing has arrived, PARTIALLY_RECEIVED once something has, RECEIVED only
 * once every line is fully satisfied.
 */
export async function receivePurchaseOrderLine(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireModifyInventory: true },
  );
  if (!access.ok) return { error: access.error };

  const { employee, warehouseId } = access.context;

  const poLineId = parsePositiveInt(formData.get("poLineId"));
  const locationId = parsePositiveInt(formData.get("locationId"));
  const statusId = parsePositiveInt(formData.get("statusId"));
  const serials = parseSerialList(String(formData.get("serials") ?? ""));

  // For a serial-tracked item the quantity is not something anybody types --
  // it is however many units were physically scanned. Trusting a typed number
  // here would let the stock line and the serial rows disagree from the very
  // first receipt.
  const quantity =
    serials.length > 0
      ? serials.length
      : parsePositiveInt(formData.get("quantity"));

  if (!poLineId) return { error: "Invalid order line." };
  if (!quantity) return { error: "Quantity must be a positive whole number." };
  if (!locationId) return { error: "Select a location." };
  if (!statusId) return { error: "Select an inventory status." };

  if (serials.length > 0) {
    const problem = validateSerialList(serials);
    if (problem) return { error: describeSerialProblem(problem) };
  }

  const [line] = await db
    .select({
      poLineId: purchaseOrderLines.poLineId,
      poId: purchaseOrderLines.poId,
      itemId: purchaseOrderLines.itemId,
      quantityOrdered: purchaseOrderLines.quantityOrdered,
      quantityReceived: purchaseOrderLines.quantityReceived,
      batchNumber: purchaseOrderLines.batchNumber,
      lotNumber: purchaseOrderLines.lotNumber,
      expiryDate: purchaseOrderLines.expiryDate,
      poStatus: purchaseOrders.status,
      poWarehouseId: purchaseOrders.warehouseId,
    })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrderLines.poId, purchaseOrders.poId))
    .where(eq(purchaseOrderLines.poLineId, poLineId))
    .limit(1);

  if (!line || line.poWarehouseId !== warehouseId) {
    return { error: "Order line not found in this warehouse." };
  }
  if (line.poStatus !== "OPEN" && line.poStatus !== "PARTIALLY_RECEIVED") {
    return { error: "This purchase order is not open for receiving." };
  }
  if (line.itemId === null) return { error: "This line has no item." };

  const remaining = line.quantityOrdered - (line.quantityReceived ?? 0);
  if (quantity > remaining) {
    return { error: `Only ${remaining} unit${remaining === 1 ? "" : "s"} remaining on this line.` };
  }

  const [location] = await db
    .select({
      locationId: locations.locationId,
      locationCode: locations.locationCode,
      isBlocked: locations.isBlocked,
    })
    .from(locations)
    .where(and(eq(locations.locationId, locationId), eq(locations.warehouseId, warehouseId)))
    .limit(1);
  if (!location) return { error: "Location not found in this warehouse." };
  if (location.isBlocked) return { error: `Location ${location.locationCode} is blocked.` };

  const [status] = await db
    .select({ statusId: inventoryStatuses.statusId })
    .from(inventoryStatuses)
    .where(
      and(
        eq(inventoryStatuses.statusId, statusId),
        eq(inventoryStatuses.organizationId, employee.organizationId),
      ),
    )
    .limit(1);
  if (!status) return { error: "Inventory status not found for your organization." };

  const itemId = line.itemId;
  const poId = line.poId;

  // The item is the authority on whether serials are required, not the form.
  // A screen that forgot to collect them must fail here rather than book
  // untraceable stock for an item the business has said it traces.
  const tracking = await itemTracking(db, itemId);
  if (tracking?.isSerialTracked && serials.length === 0) {
    return { error: "This item is serial tracked — scan each unit's serial number." };
  }
  if (!tracking?.isSerialTracked && serials.length > 0) {
    return { error: "This item is not serial tracked, so serials can't be recorded against it." };
  }

  const conflict = await db.transaction(async (tx) => {
    if (serials.length > 0 && tracking) {
      const recorded = await recordReceivedSerials(tx, {
        organizationId: tracking.organizationId,
        itemId,
        serials,
        locationId,
        batchNumber: line.batchNumber,
        lotNumber: line.lotNumber,
        expiryDate: line.expiryDate,
        inventoryStatusId: statusId,
        poLineId,
        employeeId: employee.employeeId,
      });
      if (!recorded.ok) return { duplicates: recorded.serials } as const;
    }

    const outcome = await receiveIntoInventory(tx, {
      employeeId: employee.employeeId,
      locationId,
      itemId,
      quantity,
      batchNumber: line.batchNumber,
      lotNumber: line.lotNumber,
      expiryDate: line.expiryDate,
      statusId,
      reasonCode: "PO receipt",
    });
    if (outcome === "status-mismatch") return "status-mismatch" as const;

    await tx
      .update(purchaseOrderLines)
      .set({ quantityReceived: (line.quantityReceived ?? 0) + quantity })
      .where(eq(purchaseOrderLines.poLineId, poLineId));

    // Roll the PO's own status up from its lines' aggregate progress, inside
    // the same transaction so it never observes a half-updated line set.
    const allLines = await tx
      .select({
        quantityOrdered: purchaseOrderLines.quantityOrdered,
        quantityReceived: purchaseOrderLines.quantityReceived,
      })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.poId, poId));
    const fullyReceived = allLines.every(
      (l) => (l.quantityReceived ?? 0) >= l.quantityOrdered,
    );
    const anyReceived = allLines.some((l) => (l.quantityReceived ?? 0) > 0);
    const nextStatus = fullyReceived
      ? "RECEIVED"
      : anyReceived
        ? "PARTIALLY_RECEIVED"
        : line.poStatus;
    if (nextStatus !== line.poStatus) {
      await tx
        .update(purchaseOrders)
        .set({ status: nextStatus, updatedAt: new Date().toISOString() })
        .where(eq(purchaseOrders.poId, poId));
    }

    return "ok" as const;
  });

  if (typeof conflict === "object" && "duplicates" in conflict) {
    const shown = conflict.duplicates.slice(0, 5).join(", ");
    return {
      error: `Already booked in: ${shown}${conflict.duplicates.length > 5 ? ` (+${conflict.duplicates.length - 5} more)` : ""}. Each unit is received once.`,
    };
  }

  if (conflict === "status-mismatch") {
    return {
      error:
        "Stock for this item/batch/lot already exists at that location under a different status. Adjust the existing line instead.",
    };
  }

  revalidatePath(`/warehouses/${warehouseId}/inbound/purchase-orders`);
  revalidatePath(`/warehouses/${warehouseId}/inbound/purchase-orders/${poId}`);
  revalidatePath(`/warehouses/${warehouseId}/inventory/stock`);

  // Same live-map wiring ad-hoc stock receiving uses -- a PO receipt is the
  // same physical event (units landing at a location) with different
  // paperwork behind it.
  await notifyLocationInventoryChanged(warehouseId, locationId);
  await reportEmployeeAtLocation(
    warehouseId,
    employee.organizationId,
    employee,
    locationId,
  );

  return { success: true };
}
