"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  inventory,
  inventoryStatuses,
  items,
  locations,
  stockMovements,
} from "@/drizzle/schema";
import { requireWarehouseActionAccess } from "@/lib/warehouse-access";

// Movement types written to stock_movements. Every quantity change to the
// inventory table goes through one of these so the movements log stays a
// complete audit trail -- nothing mutates stock without a matching row.
const MOVEMENT_RECEIPT = "RECEIPT";
const MOVEMENT_ADJUSTMENT_IN = "ADJUSTMENT_IN";
const MOVEMENT_ADJUSTMENT_OUT = "ADJUSTMENT_OUT";
const MOVEMENT_TRANSFER = "TRANSFER";

type StockKey = {
  locationId: number;
  itemId: number;
  batchNumber: string | null;
  lotNumber: string | null;
};

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

function parseOptionalText(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const raw = String(value).trim();
  return raw ? raw : null;
}

// The unique constraint on (location, item, batch, lot) treats NULLs as
// distinct, so onConflict can't be used to upsert -- a NULL batch would insert
// a duplicate row instead of merging. Match explicitly with IS NULL instead.
function stockKeyCondition(key: StockKey) {
  return and(
    eq(inventory.locationId, key.locationId),
    eq(inventory.itemId, key.itemId),
    key.batchNumber === null
      ? isNull(inventory.batchNumber)
      : eq(inventory.batchNumber, key.batchNumber),
    key.lotNumber === null
      ? isNull(inventory.lotNumber)
      : eq(inventory.lotNumber, key.lotNumber),
  );
}

/** Confirms a location is inside this warehouse before stock is written to it. */
async function findLocationInWarehouse(locationId: number, warehouseId: number) {
  const [row] = await db
    .select({
      locationId: locations.locationId,
      locationCode: locations.locationCode,
      isBlocked: locations.isBlocked,
    })
    .from(locations)
    .where(
      and(
        eq(locations.locationId, locationId),
        eq(locations.warehouseId, warehouseId),
      ),
    )
    .limit(1);

  return row ?? null;
}

async function findItemInOrg(itemId: number, organizationId: number) {
  const [row] = await db
    .select({ itemId: items.itemId })
    .from(items)
    .where(
      and(eq(items.itemId, itemId), eq(items.organizationId, organizationId)),
    )
    .limit(1);

  return row ?? null;
}

async function findStatusInOrg(statusId: number, organizationId: number) {
  const [row] = await db
    .select({
      statusId: inventoryStatuses.statusId,
      name: inventoryStatuses.name,
      allowMovement: inventoryStatuses.allowMovement,
    })
    .from(inventoryStatuses)
    .where(
      and(
        eq(inventoryStatuses.statusId, statusId),
        eq(inventoryStatuses.organizationId, organizationId),
      ),
    )
    .limit(1);

  return row ?? null;
}

/** Loads an inventory row and proves it sits in this warehouse via its location. */
async function findInventoryInWarehouse(
  inventoryId: number,
  warehouseId: number,
) {
  const [row] = await db
    .select({
      inventoryId: inventory.inventoryId,
      locationId: inventory.locationId,
      itemId: inventory.itemId,
      quantity: inventory.quantity,
      batchNumber: inventory.batchNumber,
      lotNumber: inventory.lotNumber,
      expiryDate: inventory.expiryDate,
      statusId: inventory.statusId,
    })
    .from(inventory)
    .innerJoin(locations, eq(inventory.locationId, locations.locationId))
    .where(
      and(
        eq(inventory.inventoryId, inventoryId),
        eq(locations.warehouseId, warehouseId),
      ),
    )
    .limit(1);

  return row ?? null;
}

function revalidateStock(warehouseId: number) {
  revalidatePath(`/warehouses/${warehouseId}/inventory/stock`);
  revalidatePath(`/warehouses/${warehouseId}/inventory/movements`);
  revalidatePath(`/warehouses/${warehouseId}/inventory`);
}

export async function receiveStock(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireModifyInventory: true },
  );
  if (!access.ok) return { error: access.error };

  const { employee, warehouseId } = access.context;

  const itemId = parsePositiveInt(formData.get("itemId"));
  const locationId = parsePositiveInt(formData.get("locationId"));
  const statusId = parsePositiveInt(formData.get("statusId"));
  const quantity = parsePositiveInt(formData.get("quantity"));
  const batchNumber = parseOptionalText(formData.get("batchNumber"));
  const lotNumber = parseOptionalText(formData.get("lotNumber"));
  const expiryDate = parseOptionalText(formData.get("expiryDate"));
  const reasonCode = parseOptionalText(formData.get("reasonCode"));

  if (!itemId) return { error: "Select an item." };
  if (!locationId) return { error: "Select a location." };
  if (!statusId) return { error: "Select an inventory status." };
  if (!quantity) return { error: "Quantity must be a positive whole number." };

  const location = await findLocationInWarehouse(locationId, warehouseId);
  if (!location) return { error: "Location not found in this warehouse." };
  if (location.isBlocked) {
    return { error: `Location ${location.locationCode} is blocked.` };
  }
  if (!(await findItemInOrg(itemId, employee.organizationId))) {
    return { error: "Item not found for your organization." };
  }
  if (!(await findStatusInOrg(statusId, employee.organizationId))) {
    return { error: "Inventory status not found for your organization." };
  }

  const key: StockKey = { locationId, itemId, batchNumber, lotNumber };

  const conflict = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        inventoryId: inventory.inventoryId,
        quantity: inventory.quantity,
        statusId: inventory.statusId,
      })
      .from(inventory)
      .where(stockKeyCondition(key))
      .limit(1);

    if (existing) {
      // One row per location+item+batch+lot, so status is a property of that
      // line. Merging stock of a different status would silently reclassify
      // what's already there -- refuse and let the user adjust deliberately.
      if (existing.statusId !== statusId) {
        return "status-mismatch" as const;
      }

      await tx
        .update(inventory)
        .set({
          quantity: (existing.quantity ?? 0) + quantity,
          expiryDate: expiryDate ?? undefined,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(inventory.inventoryId, existing.inventoryId));
    } else {
      await tx.insert(inventory).values({
        locationId,
        itemId,
        quantity,
        batchNumber,
        lotNumber,
        expiryDate,
        statusId,
      });
    }

    await tx.insert(stockMovements).values({
      employeeId: employee.employeeId,
      itemId,
      batchNumber,
      lotNumber,
      expiryDate,
      quantity,
      destinationLocationId: locationId,
      movementType: MOVEMENT_RECEIPT,
      reasonCode,
    });

    return null;
  });

  if (conflict === "status-mismatch") {
    return {
      error:
        "Stock for this item/batch/lot already exists at that location under a different status. Adjust the existing line instead.",
    };
  }

  revalidateStock(warehouseId);
  return { success: true };
}

export async function adjustStock(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireModifyInventory: true },
  );
  if (!access.ok) return { error: access.error };

  const { employee, warehouseId } = access.context;

  const inventoryId = parsePositiveInt(formData.get("inventoryId"));
  const newQuantity = parseNonNegativeInt(formData.get("quantity"));
  const statusId = parsePositiveInt(formData.get("statusId"));
  const reasonCode = parseOptionalText(formData.get("reasonCode"));

  if (!inventoryId) return { error: "Invalid stock line." };
  if (newQuantity === null) {
    return { error: "Quantity must be zero or a positive whole number." };
  }
  if (!statusId) return { error: "Select an inventory status." };

  const existing = await findInventoryInWarehouse(inventoryId, warehouseId);
  if (!existing) return { error: "Stock line not found in this warehouse." };
  if (!(await findStatusInOrg(statusId, employee.organizationId))) {
    return { error: "Inventory status not found for your organization." };
  }

  const currentQuantity = existing.quantity ?? 0;
  const delta = newQuantity - currentQuantity;

  await db.transaction(async (tx) => {
    await tx
      .update(inventory)
      .set({
        quantity: newQuantity,
        statusId,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(inventory.inventoryId, inventoryId));

    // stock_movements has a quantity > 0 check constraint, so a no-op edit
    // (status change only) records no movement.
    if (delta !== 0) {
      await tx.insert(stockMovements).values({
        employeeId: employee.employeeId,
        itemId: existing.itemId,
        batchNumber: existing.batchNumber,
        lotNumber: existing.lotNumber,
        expiryDate: existing.expiryDate,
        quantity: Math.abs(delta),
        sourceLocationId: delta < 0 ? existing.locationId : null,
        destinationLocationId: delta > 0 ? existing.locationId : null,
        movementType:
          delta > 0 ? MOVEMENT_ADJUSTMENT_IN : MOVEMENT_ADJUSTMENT_OUT,
        reasonCode,
      });
    }
  });

  revalidateStock(warehouseId);
  return { success: true };
}

export async function moveStock(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireModifyInventory: true },
  );
  if (!access.ok) return { error: access.error };

  const { employee, warehouseId } = access.context;

  const inventoryId = parsePositiveInt(formData.get("inventoryId"));
  const destinationLocationId = parsePositiveInt(
    formData.get("destinationLocationId"),
  );
  const quantity = parsePositiveInt(formData.get("quantity"));
  const reasonCode = parseOptionalText(formData.get("reasonCode"));

  if (!inventoryId) return { error: "Invalid stock line." };
  if (!destinationLocationId) return { error: "Select a destination location." };
  if (!quantity) return { error: "Quantity must be a positive whole number." };

  const source = await findInventoryInWarehouse(inventoryId, warehouseId);
  if (!source) return { error: "Stock line not found in this warehouse." };
  if (source.locationId === destinationLocationId) {
    return { error: "Source and destination locations are the same." };
  }
  if ((source.quantity ?? 0) < quantity) {
    return { error: `Only ${source.quantity ?? 0} available to move.` };
  }

  const destination = await findLocationInWarehouse(
    destinationLocationId,
    warehouseId,
  );
  if (!destination) {
    return { error: "Destination location not found in this warehouse." };
  }
  if (destination.isBlocked) {
    return { error: `Location ${destination.locationCode} is blocked.` };
  }

  if (source.statusId !== null) {
    const status = await findStatusInOrg(
      source.statusId,
      employee.organizationId,
    );
    if (status && status.allowMovement === false) {
      return {
        error: `Stock in status "${status.name}" cannot be moved.`,
      };
    }
  }

  // itemId is nullable on the inventory table but a move is meaningless
  // without it, and stock_movements would lose the audit link.
  if (source.itemId === null || source.locationId === null) {
    return { error: "This stock line is missing an item or location." };
  }

  const sourceItemId = source.itemId;
  const sourceLocationId = source.locationId;

  const conflict = await db.transaction(async (tx) => {
    const [destinationRow] = await tx
      .select({
        inventoryId: inventory.inventoryId,
        quantity: inventory.quantity,
        statusId: inventory.statusId,
      })
      .from(inventory)
      .where(
        stockKeyCondition({
          locationId: destinationLocationId,
          itemId: sourceItemId,
          batchNumber: source.batchNumber,
          lotNumber: source.lotNumber,
        }),
      )
      .limit(1);

    if (destinationRow && destinationRow.statusId !== source.statusId) {
      return "status-mismatch" as const;
    }

    const remaining = (source.quantity ?? 0) - quantity;
    if (remaining === 0) {
      await tx.delete(inventory).where(eq(inventory.inventoryId, inventoryId));
    } else {
      await tx
        .update(inventory)
        .set({ quantity: remaining, updatedAt: new Date().toISOString() })
        .where(eq(inventory.inventoryId, inventoryId));
    }

    if (destinationRow) {
      await tx
        .update(inventory)
        .set({
          quantity: (destinationRow.quantity ?? 0) + quantity,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(inventory.inventoryId, destinationRow.inventoryId));
    } else {
      await tx.insert(inventory).values({
        locationId: destinationLocationId,
        itemId: sourceItemId,
        quantity,
        batchNumber: source.batchNumber,
        lotNumber: source.lotNumber,
        expiryDate: source.expiryDate,
        statusId: source.statusId,
      });
    }

    await tx.insert(stockMovements).values({
      employeeId: employee.employeeId,
      itemId: sourceItemId,
      batchNumber: source.batchNumber,
      lotNumber: source.lotNumber,
      expiryDate: source.expiryDate,
      quantity,
      sourceLocationId,
      destinationLocationId,
      movementType: MOVEMENT_TRANSFER,
      reasonCode,
    });

    return null;
  });

  if (conflict === "status-mismatch") {
    return {
      error:
        "The destination already holds this item/batch/lot under a different status.",
    };
  }

  revalidateStock(warehouseId);
  return { success: true };
}

export async function deleteStockLine(formData: FormData) {
  const access = await requireWarehouseActionAccess(
    formData.get("warehouseId"),
    { requireModifyInventory: true },
  );
  if (!access.ok) return { error: access.error };

  const { employee, warehouseId } = access.context;
  const inventoryId = parsePositiveInt(formData.get("inventoryId"));
  if (!inventoryId) return { error: "Invalid stock line." };

  const existing = await findInventoryInWarehouse(inventoryId, warehouseId);
  if (!existing) return { error: "Stock line not found in this warehouse." };

  const quantity = existing.quantity ?? 0;

  await db.transaction(async (tx) => {
    await tx.delete(inventory).where(eq(inventory.inventoryId, inventoryId));

    // Writing off a zero-quantity line has nothing to record, and the
    // quantity > 0 constraint would reject the movement row anyway.
    if (quantity > 0) {
      await tx.insert(stockMovements).values({
        employeeId: employee.employeeId,
        itemId: existing.itemId,
        batchNumber: existing.batchNumber,
        lotNumber: existing.lotNumber,
        expiryDate: existing.expiryDate,
        quantity,
        sourceLocationId: existing.locationId,
        movementType: MOVEMENT_ADJUSTMENT_OUT,
        reasonCode: "WRITE_OFF",
      });
    }
  });

  revalidateStock(warehouseId);
  return { success: true };
}
