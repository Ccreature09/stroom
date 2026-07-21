"use server";

import { db } from "@/lib/db";
import { employees, organizations, positionTypes, warehouseConfigs, warehouses } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import {
  validateAdminAccountStep,
  validateOrganizationStep,
  validateWarehouseConfigStep,
  validateWarehouseStep,
  hasErrors,
  type OnboardingFieldErrors,
} from "@/lib/onboarding/validation";
import type { OnboardingActionState } from "@/lib/onboarding/state";

function isUniqueViolation(error: unknown): error is { code: string; constraint_name?: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  );
}

export async function createOnboardingSubmission(
  _prevState: OnboardingActionState,
  formData: FormData
): Promise<OnboardingActionState> {
  // --- Extract raw values -------------------------------------------------
  const organizationValues = {
    name: String(formData.get("organizationName") ?? "").trim(),
    isActive: formData.get("organizationIsActive") === "on",
  };

  const configValues = {
    requireStagingBeforePutaway: formData.get("requireStagingBeforePutaway") === "on",
    allowMixedSkuPerLocation: formData.get("allowMixedSkuPerLocation") === "on",
    allowMixedLpnPerLocation: formData.get("allowMixedLpnPerLocation") === "on",
    defaultPutawayStrategy: String(formData.get("defaultPutawayStrategy") ?? "NEAREST_EMPTY"),
    cycleCountFrequencyDays: String(formData.get("cycleCountFrequencyDays") ?? ""),
  };

  const warehouseValues = {
    name: String(formData.get("warehouseName") ?? "").trim(),
    street: String(formData.get("street") ?? "").trim(),
    city: String(formData.get("city") ?? "").trim(),
    postalCode: String(formData.get("postalCode") ?? "").trim(),
    country: String(formData.get("country") ?? "").trim(),
    timezone: String(formData.get("timezone") ?? "").trim(),
    isActive: formData.get("warehouseIsActive") === "on",
  };

  const adminAccountValues = {
    firstName: String(formData.get("adminFirstName") ?? "").trim(),
    lastName: String(formData.get("adminLastName") ?? "").trim(),
    email: String(formData.get("adminEmail") ?? "").trim().toLowerCase(),
    password: String(formData.get("adminPassword") ?? ""),
    confirmPassword: String(formData.get("adminConfirmPassword") ?? ""),
  };

  // --- Authoritative server-side validation (never trust the client) -----
  const fieldErrors: OnboardingFieldErrors = {
    ...validateOrganizationStep(organizationValues),
    ...validateWarehouseConfigStep(configValues),
    ...validateWarehouseStep(warehouseValues),
    ...validateAdminAccountStep(adminAccountValues),
  };

  if (hasErrors(fieldErrors)) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors,
    };
  }

  const cycleCountFrequencyDays =
    configValues.cycleCountFrequencyDays.trim() === ""
      ? null
      : Number(configValues.cycleCountFrequencyDays);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    return {
      status: "error",
      message: "Administrator accounts require Supabase configuration. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY before continuing.",
    };
  }

  let authUserId: string | undefined;

  try {
    const authResponse = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: secretKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: adminAccountValues.email,
        password: adminAccountValues.password,
        email_confirm: true,
      }),
      cache: "no-store",
    });

    if (!authResponse.ok) {
      const details = (await authResponse.json().catch(() => null)) as { message?: string } | null;
      if (authResponse.status === 422 || authResponse.status === 400) {
        return {
          status: "error",
          message: "An account could not be created with that email address.",
          fieldErrors: { adminEmail: details?.message ?? "This email address may already be in use." },
        };
      }
      throw new Error(details?.message ?? "Supabase could not create the administrator account.");
    }

    const authUser = (await authResponse.json()) as { id?: string };
    if (!authUser.id) throw new Error("Supabase did not return an administrator user ID.");
    authUserId = authUser.id;

    const result = await db.transaction(async (tx) => {
      const [organization] = await tx
        .insert(organizations)
        .values({
          name: organizationValues.name,
          isActive: organizationValues.isActive,
        })
        .returning({ organizationId: organizations.organizationId });

      const [config] = await tx
        .insert(warehouseConfigs)
        .values({
          requireStagingBeforePutaway: configValues.requireStagingBeforePutaway,
          allowMixedSkuPerLocation: configValues.allowMixedSkuPerLocation,
          allowMixedLpnPerLocation: configValues.allowMixedLpnPerLocation,
          defaultPutawayStrategy: configValues.defaultPutawayStrategy,
          cycleCountFrequencyDays,
        })
        .returning({ configId: warehouseConfigs.configId });

      const [warehouse] = await tx
        .insert(warehouses)
        .values({
          organizationId: organization.organizationId,
          configId: config.configId,
          name: warehouseValues.name || null,
          street: warehouseValues.street || null,
          city: warehouseValues.city || null,
          postalCode: warehouseValues.postalCode || null,
          country: warehouseValues.country || null,
          timezone: warehouseValues.timezone || null,
          isActive: warehouseValues.isActive,
        })
        .returning({ warehouseId: warehouses.warehouseId });

      const createdRoles = await tx
        .insert(positionTypes)
        .values({
          title: "Administrator",
          isOfficeRole: true,
          canViewMetrics: true,
          canAssignTasks: true,
          canBook: true,
          canUnload: true,
          canLoad: true,
          canPick: true,
          canPack: true,
          canModifyInventory: true,
          canOverrideUnexpectedDeliveries: true,
          canRegisterDamages: true,
          canModifyLocations: true,
          canReplenish: true,
          canForceRecount: true,
          canReleaseOrders: true,
          canVoidShipments: true,
          canManageUsers: true,
          canModifyConfigs: true,
        })
        .onConflictDoUpdate({
          target: positionTypes.title,
          set: {
            isOfficeRole: true,
            canViewMetrics: true,
            canAssignTasks: true,
            canBook: true,
            canUnload: true,
            canLoad: true,
            canPick: true,
            canPack: true,
            canModifyInventory: true,
            canOverrideUnexpectedDeliveries: true,
            canRegisterDamages: true,
            canModifyLocations: true,
            canReplenish: true,
            canForceRecount: true,
            canReleaseOrders: true,
            canVoidShipments: true,
            canManageUsers: true,
            canModifyConfigs: true,
          },
        })
        .returning({ positionId: positionTypes.positionId });
      const administratorRole =
        createdRoles[0] ??
        (await tx
          .select({ positionId: positionTypes.positionId })
          .from(positionTypes)
          .where(eq(positionTypes.title, "Administrator")))[0];

      if (!administratorRole) throw new Error("Administrator position could not be created.");

      const [administrator] = await tx
        .insert(employees)
        .values({
          organizationId: organization.organizationId,
          authUserId,
          workEmail: adminAccountValues.email,
          firstName: adminAccountValues.firstName || null,
          lastName: adminAccountValues.lastName || null,
          positionId: administratorRole.positionId,
          primaryWarehouseId: warehouse.warehouseId,
          currentWarehouseId: warehouse.warehouseId,
          isActive: true,
        })
        .returning({ employeeId: employees.employeeId });

      return { organization, warehouse, administrator };
    });

    return {
      status: "success",
      message: "Organization, warehouse configuration, and administrator account created successfully.",
      organizationId: result.organization.organizationId,
      warehouseId: result.warehouse.warehouseId,
      employeeId: result.administrator.employeeId,
    };
  } catch (error) {
    if (authUserId) {
      await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/admin/users/${authUserId}`, {
        method: "DELETE",
        headers: { apikey: secretKey },
        cache: "no-store",
      }).catch(() => undefined);
    }

    if (isUniqueViolation(error)) {
      const constraint = error.constraint_name ?? "";
      if (constraint.includes("employees_work_email")) {
        return {
          status: "error",
          message: "An employee with that email address already exists.",
          fieldErrors: { adminEmail: "This email address is already in use." },
        };
      }
      return {
        status: "error",
        message: "An organization with that name already exists.",
        fieldErrors: { organizationName: "This organization name is already taken." },
      };
    }

    console.error("Onboarding submission failed:", error);
    return {
      status: "error",
      message: "Something went wrong while creating your organization. Please try again.",
    };
  }
}
