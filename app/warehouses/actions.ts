"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { employees, positionTypes, warehouseConfigs, warehouses } from "@/drizzle/schema";
import { createClient } from "@/lib/server";

function buildReturnUrl(status: "success" | "error", message: string) {
  const params = new URLSearchParams({ status, message });
  return `/warehouses?${params.toString()}`;
}

function parsePositiveInt(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const parsed = Number(String(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function requireManageUsersContext() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (!userId) redirect("/sign-in");

  const [employee] = await db
    .select({
      organizationId: employees.organizationId,
      canManageUsers: positionTypes.canManageUsers,
    })
    .from(employees)
    .innerJoin(positionTypes, eq(employees.positionId, positionTypes.positionId))
    .where(and(eq(employees.authUserId, userId), eq(employees.isActive, true)))
    .limit(1);

  if (!employee) redirect("/sign-in");
  if (employee.canManageUsers !== true) redirect("/warehouses");

  return employee;
}

export async function createWarehouse(formData: FormData) {
  const employee = await requireManageUsersContext();

  const name = String(formData.get("name") ?? "").trim();
  const street = String(formData.get("street") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const postalCode = String(formData.get("postalCode") ?? "").trim();
  const country = String(formData.get("country") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();
  const isActive = formData.get("isActive") === "on";

  if (!name) {
    redirect(buildReturnUrl("error", "Warehouse name is required."));
  }
  if (name.length > 100) {
    redirect(buildReturnUrl("error", "Warehouse name must be 100 characters or fewer."));
  }

  await db.transaction(async (tx) => {
    const [config] = await tx
      .insert(warehouseConfigs)
      .values({})
      .returning({ configId: warehouseConfigs.configId });

    await tx.insert(warehouses).values({
      organizationId: employee.organizationId,
      configId: config.configId,
      name,
      street: street || null,
      city: city || null,
      postalCode: postalCode || null,
      country: country || null,
      timezone: timezone || null,
      isActive,
    });
  });

  revalidatePath("/warehouses");
  redirect(buildReturnUrl("success", "Warehouse created."));
}

export async function updateWarehouse(formData: FormData) {
  const employee = await requireManageUsersContext();

  const warehouseId = parsePositiveInt(formData.get("warehouseId"));
  const name = String(formData.get("name") ?? "").trim();
  const street = String(formData.get("street") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const postalCode = String(formData.get("postalCode") ?? "").trim();
  const country = String(formData.get("country") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();
  const isActive = formData.get("isActive") === "on";

  if (!warehouseId) {
    redirect(buildReturnUrl("error", "Invalid warehouse selected."));
  }
  if (!name) {
    redirect(buildReturnUrl("error", "Warehouse name is required."));
  }
  if (name.length > 100) {
    redirect(buildReturnUrl("error", "Warehouse name must be 100 characters or fewer."));
  }

  const updated = await db
    .update(warehouses)
    .set({
      name,
      street: street || null,
      city: city || null,
      postalCode: postalCode || null,
      country: country || null,
      timezone: timezone || null,
      isActive,
    })
    .where(and(eq(warehouses.warehouseId, warehouseId), eq(warehouses.organizationId, employee.organizationId)))
    .returning({ warehouseId: warehouses.warehouseId });

  if (updated.length === 0) {
    redirect(buildReturnUrl("error", "Warehouse not found for your organization."));
  }

  revalidatePath("/warehouses");
  revalidatePath(`/warehouses/${warehouseId}`);
  redirect(buildReturnUrl("success", "Warehouse updated."));
}

export async function deleteWarehouse(formData: FormData) {
  const employee = await requireManageUsersContext();

  const warehouseId = parsePositiveInt(formData.get("warehouseId"));
  if (!warehouseId) {
    redirect(buildReturnUrl("error", "Invalid warehouse selected."));
  }

  try {
    const deleted = await db
      .delete(warehouses)
      .where(and(eq(warehouses.warehouseId, warehouseId), eq(warehouses.organizationId, employee.organizationId)))
      .returning({ warehouseId: warehouses.warehouseId });

    if (deleted.length === 0) {
      redirect(buildReturnUrl("error", "Warehouse not found for your organization."));
    }

    revalidatePath("/warehouses");
    redirect(buildReturnUrl("success", "Warehouse deleted."));
  } catch {
    redirect(
      buildReturnUrl(
        "error",
        "Warehouse could not be deleted because related records exist. Deactivate it or clean dependencies first."
      )
    );
  }
}

export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: "We couldn’t sign you in with those details. Please try again." };
  }

  redirect("/warehouses");
}
