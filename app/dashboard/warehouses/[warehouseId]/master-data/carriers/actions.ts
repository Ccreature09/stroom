"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { carriers, employees } from "@/drizzle/schema";
import { createClient } from "@/lib/server";
import { and, eq } from "drizzle-orm";

export async function createCarrier(formData: FormData) {
  const warehouseId = Number(formData.get("warehouseId"));
  const name = formData.get("carrierName") as string;
  const scacCode = formData.get("scac") as string;
  const trackingUrlTemplate = formData.get("trackingUrlTemplate") as string;

  if (!name || !warehouseId) return { error: "Carrier name is required." };

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

  await db.insert(carriers).values({
    organizationId: currentEmployee.organizationId,
    name,
    scacCode: scacCode || null,
    trackingUrlTemplate: trackingUrlTemplate || null,
    isActive: true,
  });

  revalidatePath(`/dashboard/warehouses/${warehouseId}/master-data/carriers`);
  return { success: true };
}

export async function toggleCarrierStatus(formData: FormData) {
  const carrierId = Number(formData.get("carrierId"));
  const warehouseId = Number(formData.get("warehouseId"));
  const currentStatus = formData.get("isActive") === "true";

  if (!carrierId || !warehouseId) return;

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
    .update(carriers)
    .set({ isActive: !currentStatus })
    .where(
      and(
        eq(carriers.carrierId, carrierId),
        eq(carriers.organizationId, currentEmployee.organizationId)
      )
    );

  revalidatePath(`/dashboard/warehouses/${warehouseId}/master-data/carriers`);
}