"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { employees, positionTypes, warehouseConfigs, warehouses } from "@/drizzle/schema";
import { createClient } from "@/lib/server";

function buildReturnUrl(warehouseId: number, status: "success" | "error", message: string) {
  const params = new URLSearchParams({ status, message });
  return `/dashboard/warehouses/${warehouseId}/configs?${params.toString()}`;
}

function parsePositiveInt(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const parsed = Number(String(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseNullableInt(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

async function requireWarehouseContext(warehouseId: number) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (!userId) redirect("/sign-in");

  const [employee] = await db
    .select({
      organizationId: employees.organizationId,
      canModifyConfigs: positionTypes.canModifyConfigs,
    })
    .from(employees)
    .innerJoin(positionTypes, eq(employees.positionId, positionTypes.positionId))
    .where(and(eq(employees.authUserId, userId), eq(employees.isActive, true)))
    .limit(1);

  if (!employee) redirect("/sign-in");

  const [warehouse] = await db
    .select({
      warehouseId: warehouses.warehouseId,
      configId: warehouses.configId,
    })
    .from(warehouses)
    .where(and(eq(warehouses.warehouseId, warehouseId), eq(warehouses.organizationId, employee.organizationId)))
    .limit(1);

  if (!warehouse) redirect("/dashboard/warehouses");

  return {
    employee,
    warehouse,
  };
}

export async function updateWarehouseConfig(formData: FormData) {
  const warehouseId = parsePositiveInt(formData.get("warehouseId"));
  if (!warehouseId) redirect("/dashboard/warehouses");

  const { employee, warehouse } = await requireWarehouseContext(warehouseId);
  if (employee.canModifyConfigs !== true) {
    redirect(buildReturnUrl(warehouseId, "error", "You do not have permission to modify warehouse configs."));
  }

  const requireStagingBeforePutaway = formData.get("requireStagingBeforePutaway") === "on";
  const allowMixedSkuPerLocation = formData.get("allowMixedSkuPerLocation") === "on";
  const allowMixedLpnPerLocation = formData.get("allowMixedLpnPerLocation") === "on";

  const defaultPutawayStrategy = String(formData.get("defaultPutawayStrategy") ?? "")
    .trim()
    .toUpperCase();
  if (!defaultPutawayStrategy) {
    redirect(buildReturnUrl(warehouseId, "error", "Default putaway strategy is required."));
  }
  if (defaultPutawayStrategy.length > 20) {
    redirect(buildReturnUrl(warehouseId, "error", "Default putaway strategy must be 20 characters or fewer."));
  }

  const cycleCountFrequencyDays = parseNullableInt(formData.get("cycleCountFrequencyDays"));
  if (Number.isNaN(cycleCountFrequencyDays)) {
    redirect(buildReturnUrl(warehouseId, "error", "Cycle count frequency must be a whole number."));
  }

  const updatedAtInput = String(formData.get("updatedAt") ?? "").trim();
  let updatedAtValue: string | ReturnType<typeof sql> = sql`CURRENT_TIMESTAMP`;
  if (updatedAtInput) {
    const parsedDate = new Date(updatedAtInput);
    if (Number.isNaN(parsedDate.getTime())) {
      redirect(buildReturnUrl(warehouseId, "error", "Updated at must be a valid date/time."));
    }
    updatedAtValue = parsedDate.toISOString();
  }

  await db.transaction(async (tx) => {
    let targetConfigId = warehouse.configId;

    if (!targetConfigId) {
      const [config] = await tx
        .insert(warehouseConfigs)
        .values({})
        .returning({ configId: warehouseConfigs.configId });
      targetConfigId = config.configId;

      await tx
        .update(warehouses)
        .set({ configId: targetConfigId })
        .where(eq(warehouses.warehouseId, warehouseId));
    }

    await tx
      .update(warehouseConfigs)
      .set({
        requireStagingBeforePutaway,
        allowMixedSkuPerLocation,
        allowMixedLpnPerLocation,
        defaultPutawayStrategy,
        cycleCountFrequencyDays,
        updatedAt: updatedAtValue,
      })
      .where(eq(warehouseConfigs.configId, targetConfigId));
  });

  revalidatePath("/dashboard/warehouses");
  revalidatePath(`/dashboard/warehouses/${warehouseId}`);
  revalidatePath(`/dashboard/warehouses/${warehouseId}/configs`);
  redirect(buildReturnUrl(warehouseId, "success", "Warehouse config updated."));
}
