"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { customers, employees } from "@/drizzle/schema";
import { createClient } from "@/lib/server";
import { and, eq } from "drizzle-orm";

export async function createCustomer(formData: FormData) {
  const warehouseId = Number(formData.get("warehouseId"));
  const name = formData.get("name") as string;
  const email = formData.get("email") as string;
  const phone = formData.get("phone") as string;
  const defaultShippingAddress = formData.get(
    "defaultShippingAddress",
  ) as string;

  if (!name || !warehouseId) return { error: "Customer name is required." };

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

  await db.insert(customers).values({
    organizationId: currentEmployee.organizationId,
    name,
    contactEmail: email || null,
    contactPhone: phone || null,
    defaultShippingAddress: defaultShippingAddress || null,
    isActive: true,
  });

  revalidatePath(`/dashboard/warehouses/${warehouseId}/master-data/customers`);
  return { success: true };
}

export async function toggleCustomerStatus(formData: FormData) {
  const customerId = Number(formData.get("customerId"));
  const warehouseId = Number(formData.get("warehouseId"));
  const currentStatus = formData.get("isActive") === "true";

  if (!customerId || !warehouseId) return;

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
    .update(customers)
    .set({ isActive: !currentStatus })
    .where(
      and(
        eq(customers.customerId, customerId),
        eq(customers.organizationId, currentEmployee.organizationId),
      ),
    );

  revalidatePath(`/dashboard/warehouses/${warehouseId}/master-data/customers`);
}
