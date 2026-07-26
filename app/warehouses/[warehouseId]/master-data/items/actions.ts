"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { items, employees } from "@/drizzle/schema";
import { createClient } from "@/lib/server";
import { and, eq } from "drizzle-orm";

export async function createItem(formData: FormData) {
  const warehouseId = Number(formData.get("warehouseId"));

  // Required fields
  const sku = formData.get("sku") as string;
  const name = formData.get("name") as string;

  // Optional text fields
  const barcode = formData.get("barcode") as string;
  const description = formData.get("description") as string;
  const category = formData.get("category") as string;
  const hazardClass = formData.get("hazardClass") as string;

  // Numeric fields (default fallback to 0)
  const lengthCm = formData.get("lengthCm")
    ? String(formData.get("lengthCm"))
    : "0.00";
  const widthCm = formData.get("widthCm")
    ? String(formData.get("widthCm"))
    : "0.00";
  const heightCm = formData.get("heightCm")
    ? String(formData.get("heightCm"))
    : "0.00";
  const weightKg = formData.get("weightKg")
    ? String(formData.get("weightKg"))
    : "0.000";

  // Integer fields
  const shelfLifeDays = formData.get("shelfLifeDays")
    ? Number(formData.get("shelfLifeDays"))
    : null;
  const minStockLevel = formData.get("minStockLevel")
    ? Number(formData.get("minStockLevel"))
    : 0;

  // Boolean flags
  const isBatchTracked = formData.get("isBatchTracked") === "on";
  const isLotTracked = formData.get("isLotTracked") === "on";
  const hasExpiry = formData.get("hasExpiry") === "on";

  if (!sku || !name || !warehouseId) {
    return { error: "SKU and Name are required." };
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return { error: "Unauthorized" };

  const [currentEmployee] = await db
    .select({ organizationId: employees.organizationId })
    .from(employees)
    .where(and(eq(employees.authUserId, userId), eq(employees.isActive, true)))
    .limit(1);

  if (!currentEmployee) return { error: "Employee profile not found." };

  await db.insert(items).values({
    organizationId: currentEmployee.organizationId,
    sku,
    name,
    barcode: barcode || null,
    description: description || null,
    category: category || null,
    lengthCm,
    widthCm,
    heightCm,
    weightKg,
    hazardClass: hazardClass || "None",
    isBatchTracked,
    isLotTracked,
    hasExpiry,
    shelfLifeDays,
    minStockLevel,
  });

  revalidatePath(`/dashboard/warehouses/${warehouseId}/master-data/items`);
  return { success: true };
}

export async function deleteItem(formData: FormData) {
  const itemId = Number(formData.get("itemId"));
  const warehouseId = Number(formData.get("warehouseId"));

  if (!itemId || !warehouseId) return;

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return;

  const [currentEmployee] = await db
    .select({ organizationId: employees.organizationId })
    .from(employees)
    .where(and(eq(employees.authUserId, userId), eq(employees.isActive, true)))
    .limit(1);

  if (!currentEmployee) return;

  await db
    .delete(items)
    .where(
      and(
        eq(items.itemId, itemId),
        eq(items.organizationId, currentEmployee.organizationId),
      ),
    );

  revalidatePath(`/dashboard/warehouses/${warehouseId}/master-data/items`);
}
