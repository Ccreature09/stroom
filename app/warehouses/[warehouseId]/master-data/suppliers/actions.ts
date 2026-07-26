"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { suppliers, employees } from "@/drizzle/schema";
import { createClient } from "@/lib/server";

export async function createSupplier(formData: FormData) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (!userId) {
    return { success: false, error: "Unauthorized" };
  }

  const [employee] = await db
    .select({ organizationId: employees.organizationId })
    .from(employees)
    .where(and(eq(employees.authUserId, userId), eq(employees.isActive, true)))
    .limit(1);

  if (!employee) {
    return { success: false, error: "Unauthorized" };
  }

  const warehouseId = formData.get("warehouseId");
  const name = formData.get("name") as string;
  const contactName = formData.get("contactName") as string;
  const contactEmail = formData.get("contactEmail") as string;
  const contactPhone = formData.get("contactPhone") as string;
  const address = formData.get("address") as string;
  const leadTimeDaysRaw = formData.get("leadTimeDays");

  if (!name) {
    return { success: false, error: "Supplier name is required" };
  }

  const leadTimeDays = leadTimeDaysRaw ? Number(leadTimeDaysRaw) : null;

  try {
    await db.insert(suppliers).values({
      organizationId: employee.organizationId,
      name,
      contactName: contactName || null,
      contactEmail: contactEmail || null,
      contactPhone: contactPhone || null,
      address: address || null,
      leadTimeDays,
      isActive: true,
    });

    if (warehouseId) {
      revalidatePath(
        `/dashboard/warehouses/${warehouseId}/master-data/suppliers`,
      );
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to create supplier:", error);
    return { success: false, error: "Failed to create supplier" };
  }
}

export async function deleteSupplier(formData: FormData) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (!userId) return;

  const [employee] = await db
    .select({ organizationId: employees.organizationId })
    .from(employees)
    .where(and(eq(employees.authUserId, userId), eq(employees.isActive, true)))
    .limit(1);

  if (!employee) return;

  const supplierId = Number(formData.get("supplierId"));
  const warehouseId = formData.get("warehouseId");

  if (!supplierId) return;

  await db
    .delete(suppliers)
    .where(
      and(
        eq(suppliers.supplierId, supplierId),
        eq(suppliers.organizationId, employee.organizationId),
      ),
    );

  if (warehouseId) {
    revalidatePath(
      `/dashboard/warehouses/${warehouseId}/master-data/suppliers`,
    );
  }
}
