"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  departments,
  employeeDepartments,
  employeeLicenses,
  employees,
  mheTypes,
  positionTypes,
  warehouses,
} from "@/drizzle/schema";
import { createClient } from "@/lib/server";
import { PERMISSION_FIELDS, type PermissionField } from "@/lib/people-roles/constants";

function parseOptionalNumber(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseOptionalDate(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  return raw;
}

function parseBooleanFromForm(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function parsePermissionValues(formData: FormData) {
  return Object.fromEntries(
    PERMISSION_FIELDS.map((field) => [field, parseBooleanFromForm(formData, field)])
  ) as Record<PermissionField, boolean>;
}

function parseNumberList(formData: FormData, key: string) {
  return formData
    .getAll(key)
    .map((entry) => Number(String(entry)))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function isUniqueViolation(error: unknown): error is { code: string; constraint_name?: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  );
}

function buildReturnUrl(warehouseId: number, status: "success" | "error", message: string) {
  const params = new URLSearchParams({ status, message });
  return `/dashboard/warehouses/${warehouseId}/people-roles?${params.toString()}`;
}

function parseRequiredWarehouseId(formData: FormData) {
  const warehouseId = parseOptionalNumber(formData.get("warehouseId"));
  if (!warehouseId) {
    redirect("/dashboard/warehouses");
  }
  return warehouseId;
}

async function requireManageUsersAccessForWarehouse(warehouseId: number) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (!userId) redirect("/sign-in");

  const [employee] = await db
    .select({
      employeeId: employees.employeeId,
      organizationId: employees.organizationId,
      canManageUsers: positionTypes.canManageUsers,
    })
    .from(employees)
    .innerJoin(positionTypes, eq(employees.positionId, positionTypes.positionId))
    .where(and(eq(employees.authUserId, userId), eq(employees.isActive, true)))
    .limit(1);

  if (!employee || employee.canManageUsers !== true) {
    redirect("/dashboard");
  }

  const [warehouse] = await db
    .select({ warehouseId: warehouses.warehouseId })
    .from(warehouses)
    .where(and(eq(warehouses.warehouseId, warehouseId), eq(warehouses.organizationId, employee.organizationId)))
    .limit(1);

  if (!warehouse) {
    redirect("/dashboard/warehouses");
  }

  return employee;
}

async function getValidWarehouseIds(organizationId: number, warehouseIds: number[]) {
  if (warehouseIds.length === 0) return new Set<number>();

  const rows = await db
    .select({ warehouseId: warehouses.warehouseId })
    .from(warehouses)
    .where(and(eq(warehouses.organizationId, organizationId), inArray(warehouses.warehouseId, warehouseIds)));

  return new Set(rows.map((row) => row.warehouseId));
}

async function getValidDepartmentIdsForWarehouse(warehouseId: number, departmentIds: number[]) {
  if (departmentIds.length === 0) return new Set<number>();

  const rows = await db
    .select({ departmentId: departments.departmentId })
    .from(departments)
    .where(and(eq(departments.warehouseId, warehouseId), inArray(departments.departmentId, departmentIds)));

  return new Set(rows.map((row) => row.departmentId));
}

async function getValidRoleIds(roleIds: number[]) {
  if (roleIds.length === 0) return new Set<number>();

  const rows = await db
    .select({ positionId: positionTypes.positionId })
    .from(positionTypes)
    .where(inArray(positionTypes.positionId, roleIds));

  return new Set(rows.map((row) => row.positionId));
}

async function getValidMheTypeIds(typeIds: number[]) {
  if (typeIds.length === 0) return new Set<number>();

  const rows = await db
    .select({ mheTypeId: mheTypes.mheTypeId })
    .from(mheTypes)
    .where(inArray(mheTypes.mheTypeId, typeIds));

  return new Set(rows.map((row) => row.mheTypeId));
}

async function ensureEmployeeBelongsToOrg(employeeId: number, organizationId: number) {
  const [row] = await db
    .select({ employeeId: employees.employeeId })
    .from(employees)
    .where(and(eq(employees.employeeId, employeeId), eq(employees.organizationId, organizationId)))
    .limit(1);

  return row;
}

export async function createRole(formData: FormData) {
  const warehouseId = parseRequiredWarehouseId(formData);
  await requireManageUsersAccessForWarehouse(warehouseId);

  const title = String(formData.get("title") ?? "").trim();
  const isOfficeRole = parseBooleanFromForm(formData, "isOfficeRole");
  const permissions = parsePermissionValues(formData);

  if (!title) redirect(buildReturnUrl(warehouseId, "error", "Role title is required."));
  if (title.length > 50) {
    redirect(buildReturnUrl(warehouseId, "error", "Role title must be 50 characters or fewer."));
  }

  try {
    await db.insert(positionTypes).values({ title, isOfficeRole, ...permissions });
    revalidatePath(`/dashboard/warehouses/${warehouseId}/people-roles`);
    redirect(buildReturnUrl(warehouseId, "success", `Role \"${title}\" created.`));
  } catch (error) {
    if (isUniqueViolation(error)) {
      redirect(buildReturnUrl(warehouseId, "error", "A role with this title already exists."));
    }
    throw error;
  }
}

export async function updateRole(formData: FormData) {
  const warehouseId = parseRequiredWarehouseId(formData);
  await requireManageUsersAccessForWarehouse(warehouseId);

  const positionId = parseOptionalNumber(formData.get("positionId"));
  const title = String(formData.get("title") ?? "").trim();
  const isOfficeRole = parseBooleanFromForm(formData, "isOfficeRole");
  const permissions = parsePermissionValues(formData);

  if (!positionId) redirect(buildReturnUrl(warehouseId, "error", "Invalid role selected."));
  if (!title) redirect(buildReturnUrl(warehouseId, "error", "Role title is required."));
  if (title.length > 50) {
    redirect(buildReturnUrl(warehouseId, "error", "Role title must be 50 characters or fewer."));
  }

  try {
    const updated = await db
      .update(positionTypes)
      .set({ title, isOfficeRole, ...permissions })
      .where(eq(positionTypes.positionId, positionId))
      .returning({ positionId: positionTypes.positionId });

    if (updated.length === 0) redirect(buildReturnUrl(warehouseId, "error", "Role not found."));

    revalidatePath(`/dashboard/warehouses/${warehouseId}/people-roles`);
    redirect(buildReturnUrl(warehouseId, "success", `Role \"${title}\" updated.`));
  } catch (error) {
    if (isUniqueViolation(error)) {
      redirect(buildReturnUrl(warehouseId, "error", "A role with this title already exists."));
    }
    throw error;
  }
}

export async function createEmployee(formData: FormData) {
  const warehouseId = parseRequiredWarehouseId(formData);
  const actor = await requireManageUsersAccessForWarehouse(warehouseId);

  const workEmail = String(formData.get("workEmail") ?? "").trim().toLowerCase();
  const firstName = String(formData.get("firstName") ?? "").trim();
  const middleName = String(formData.get("middleName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const positionId = parseOptionalNumber(formData.get("positionId"));
  const primaryWarehouseId = parseOptionalNumber(formData.get("primaryWarehouseId"));
  const currentWarehouseId = parseOptionalNumber(formData.get("currentWarehouseId"));
  const isActive = String(formData.get("employmentStatus") ?? "active") === "active";
  const hireDate = parseOptionalDate(formData.get("hireDate"));

  const departmentIds = parseNumberList(formData, "departmentIds");
  const primaryDepartmentId = parseOptionalNumber(formData.get("primaryDepartmentId"));
  const mheTypeIds = parseNumberList(formData, "mheTypeIds");

  if (!workEmail) redirect(buildReturnUrl(warehouseId, "error", "Work email is required."));
  if (workEmail.length > 150) {
    redirect(buildReturnUrl(warehouseId, "error", "Work email must be 150 characters or fewer."));
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workEmail)) {
    redirect(buildReturnUrl(warehouseId, "error", "Enter a valid work email address."));
  }
  if (firstName.length > 50 || middleName.length > 50 || lastName.length > 50) {
    redirect(buildReturnUrl(warehouseId, "error", "Name fields must be 50 characters or fewer."));
  }
  if (!positionId) redirect(buildReturnUrl(warehouseId, "error", "A role must be assigned."));

  const validRoleIds = await getValidRoleIds([positionId]);
  if (!validRoleIds.has(positionId)) {
    redirect(buildReturnUrl(warehouseId, "error", "Selected role is invalid."));
  }

  const warehouseIds = [primaryWarehouseId, currentWarehouseId].filter(
    (value): value is number => value !== null
  );
  const validWarehouseIds = await getValidWarehouseIds(actor.organizationId, warehouseIds);
  if (warehouseIds.some((id) => !validWarehouseIds.has(id))) {
    redirect(buildReturnUrl(warehouseId, "error", "One of the selected warehouses is invalid for your organization."));
  }

  const validDepartmentIds = await getValidDepartmentIdsForWarehouse(warehouseId, departmentIds);
  if (departmentIds.some((id) => !validDepartmentIds.has(id))) {
    redirect(buildReturnUrl(warehouseId, "error", "One or more selected departments are invalid for this warehouse."));
  }
  if (primaryDepartmentId !== null && !validDepartmentIds.has(primaryDepartmentId)) {
    redirect(buildReturnUrl(warehouseId, "error", "Primary department must be one of the selected departments."));
  }

  const validMheTypeIds = await getValidMheTypeIds(mheTypeIds);
  if (mheTypeIds.some((id) => !validMheTypeIds.has(id))) {
    redirect(buildReturnUrl(warehouseId, "error", "One or more selected licenses are invalid."));
  }

  try {
    await db.transaction(async (tx) => {
      const [createdEmployee] = await tx
        .insert(employees)
        .values({
          organizationId: actor.organizationId,
          workEmail,
          firstName: firstName || null,
          middleName: middleName || null,
          lastName: lastName || null,
          positionId,
          primaryWarehouseId,
          currentWarehouseId,
          isActive,
          hireDate,
        })
        .returning({ employeeId: employees.employeeId });

      if (!createdEmployee) throw new Error("Employee could not be created.");

      if (departmentIds.length > 0) {
        await tx.insert(employeeDepartments).values(
          departmentIds.map((departmentId) => ({
            employeeId: createdEmployee.employeeId,
            departmentId,
            isPrimary: primaryDepartmentId
              ? departmentId === primaryDepartmentId
              : departmentId === departmentIds[0],
          }))
        );
      }

      if (mheTypeIds.length > 0) {
        await tx.insert(employeeLicenses).values(
          mheTypeIds.map((mheTypeId) => ({
            employeeId: createdEmployee.employeeId,
            mheTypeId,
          }))
        );
      }
    });

    revalidatePath(`/dashboard/warehouses/${warehouseId}/people-roles`);
    redirect(buildReturnUrl(warehouseId, "success", `Employee \"${workEmail}\" created.`));
  } catch (error) {
    if (isUniqueViolation(error)) {
      redirect(buildReturnUrl(warehouseId, "error", "An employee with that work email already exists."));
    }
    throw error;
  }
}

export async function updateEmployee(formData: FormData) {
  const warehouseId = parseRequiredWarehouseId(formData);
  const actor = await requireManageUsersAccessForWarehouse(warehouseId);

  const employeeId = parseOptionalNumber(formData.get("employeeId"));
  const positionId = parseOptionalNumber(formData.get("positionId"));
  const primaryWarehouseId = parseOptionalNumber(formData.get("primaryWarehouseId"));
  const currentWarehouseId = parseOptionalNumber(formData.get("currentWarehouseId"));
  const isActive = String(formData.get("employmentStatus") ?? "active") === "active";
  const hireDate = parseOptionalDate(formData.get("hireDate"));
  const terminationDate = parseOptionalDate(formData.get("terminationDate"));

  if (!employeeId) redirect(buildReturnUrl(warehouseId, "error", "Invalid employee selected."));

  const existingEmployee = await ensureEmployeeBelongsToOrg(employeeId, actor.organizationId);
  if (!existingEmployee) {
    redirect(buildReturnUrl(warehouseId, "error", "Employee not found for your organization."));
  }

  if (!positionId) redirect(buildReturnUrl(warehouseId, "error", "A role must be assigned."));

  const validRoleIds = await getValidRoleIds([positionId]);
  if (!validRoleIds.has(positionId)) {
    redirect(buildReturnUrl(warehouseId, "error", "Selected role is invalid."));
  }

  const warehouseIds = [primaryWarehouseId, currentWarehouseId].filter(
    (value): value is number => value !== null
  );
  const validWarehouseIds = await getValidWarehouseIds(actor.organizationId, warehouseIds);
  if (warehouseIds.some((id) => !validWarehouseIds.has(id))) {
    redirect(buildReturnUrl(warehouseId, "error", "One of the selected warehouses is invalid for your organization."));
  }

  await db
    .update(employees)
    .set({
      positionId,
      primaryWarehouseId,
      currentWarehouseId,
      isActive,
      hireDate,
      terminationDate,
    })
    .where(and(eq(employees.employeeId, employeeId), eq(employees.organizationId, actor.organizationId)));

  revalidatePath(`/dashboard/warehouses/${warehouseId}/people-roles`);
  redirect(buildReturnUrl(warehouseId, "success", "Employee details updated."));
}

export async function syncEmployeeDepartments(formData: FormData) {
  const warehouseId = parseRequiredWarehouseId(formData);
  const actor = await requireManageUsersAccessForWarehouse(warehouseId);

  const employeeId = parseOptionalNumber(formData.get("employeeId"));
  const departmentIds = parseNumberList(formData, "departmentIds");
  const primaryDepartmentId = parseOptionalNumber(formData.get("primaryDepartmentId"));

  if (!employeeId) redirect(buildReturnUrl(warehouseId, "error", "Invalid employee selected."));

  const existingEmployee = await ensureEmployeeBelongsToOrg(employeeId, actor.organizationId);
  if (!existingEmployee) {
    redirect(buildReturnUrl(warehouseId, "error", "Employee not found for your organization."));
  }

  const validDepartmentIds = await getValidDepartmentIdsForWarehouse(warehouseId, departmentIds);
  if (departmentIds.some((id) => !validDepartmentIds.has(id))) {
    redirect(buildReturnUrl(warehouseId, "error", "One or more selected departments are invalid for this warehouse."));
  }
  if (primaryDepartmentId !== null && !validDepartmentIds.has(primaryDepartmentId)) {
    redirect(buildReturnUrl(warehouseId, "error", "Primary department must be one of the selected departments."));
  }

  await db.transaction(async (tx) => {
    await tx.delete(employeeDepartments).where(eq(employeeDepartments.employeeId, employeeId));

    if (departmentIds.length > 0) {
      await tx.insert(employeeDepartments).values(
        departmentIds.map((departmentId) => ({
          employeeId,
          departmentId,
          isPrimary: primaryDepartmentId
            ? departmentId === primaryDepartmentId
            : departmentId === departmentIds[0],
        }))
      );
    }
  });

  revalidatePath(`/dashboard/warehouses/${warehouseId}/people-roles`);
  redirect(buildReturnUrl(warehouseId, "success", "Employee departments updated."));
}

export async function syncEmployeeLicenses(formData: FormData) {
  const warehouseId = parseRequiredWarehouseId(formData);
  const actor = await requireManageUsersAccessForWarehouse(warehouseId);

  const employeeId = parseOptionalNumber(formData.get("employeeId"));
  const mheTypeIds = parseNumberList(formData, "mheTypeIds");

  if (!employeeId) redirect(buildReturnUrl(warehouseId, "error", "Invalid employee selected."));

  const existingEmployee = await ensureEmployeeBelongsToOrg(employeeId, actor.organizationId);
  if (!existingEmployee) {
    redirect(buildReturnUrl(warehouseId, "error", "Employee not found for your organization."));
  }

  const validMheTypeIds = await getValidMheTypeIds(mheTypeIds);
  if (mheTypeIds.some((id) => !validMheTypeIds.has(id))) {
    redirect(buildReturnUrl(warehouseId, "error", "One or more selected licenses are invalid."));
  }

  await db.transaction(async (tx) => {
    await tx.delete(employeeLicenses).where(eq(employeeLicenses.employeeId, employeeId));

    if (mheTypeIds.length > 0) {
      await tx.insert(employeeLicenses).values(
        mheTypeIds.map((mheTypeId) => ({
          employeeId,
          mheTypeId,
        }))
      );
    }
  });

  revalidatePath(`/dashboard/warehouses/${warehouseId}/people-roles`);
  redirect(buildReturnUrl(warehouseId, "success", "Employee licenses updated."));
}
