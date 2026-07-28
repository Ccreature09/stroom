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

// pageWarehouseId is the [warehouseId] route segment this page was opened
// from -- bound onto each form action via `.bind(null, pageWarehouseId)` at
// the call site, since server actions have no direct access to the page's
// own URL. Used only to build a return URL that matches the real route
// (/warehouses/[warehouseId]/people-roles), not /dashboard/people-roles,
// which doesn't exist.
function buildReturnUrl(pageWarehouseId: number, status: "success" | "error", message: string) {
  const params = new URLSearchParams({ status, message });
  return `/warehouses/${pageWarehouseId}/people-roles?${params.toString()}`;
}

function parseBooleanFromForm(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

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

async function requireManageUsersAccess() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (!userId) {
    redirect("/sign-in");
  }

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
    throw new Error("You are not authorized to manage people and roles.");
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

async function getValidDepartmentIds(organizationId: number, departmentIds: number[]) {
  if (departmentIds.length === 0) return new Set<number>();

  const rows = await db
    .select({ departmentId: departments.departmentId, warehouseId: departments.warehouseId })
    .from(departments)
    .where(inArray(departments.departmentId, departmentIds));

  // Org-wide departments (warehouseId IS NULL) are valid for every warehouse
  // in the org; warehouse-scoped departments must belong to this org.
  const scopedWarehouseIds = rows
    .map((row) => row.warehouseId)
    .filter((warehouseId): warehouseId is number => warehouseId !== null);
  const validWarehouseIds = await getValidWarehouseIds(organizationId, scopedWarehouseIds);

  return new Set(
    rows
      .filter((row) => row.warehouseId === null || validWarehouseIds.has(row.warehouseId))
      .map((row) => row.departmentId)
  );
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

export async function createRole(pageWarehouseId: number, formData: FormData) {
  const actor = await requireManageUsersAccess();

  const title = String(formData.get("title") ?? "").trim();
  const warehouseId = parseOptionalNumber(formData.get("warehouseId"));
  const isOfficeRole = parseBooleanFromForm(formData, "isOfficeRole");
  const permissions = parsePermissionValues(formData);

  if (!title) {
    redirect(buildReturnUrl(pageWarehouseId, "error", "Role title is required."));
  }
  if (title.length > 50) {
    redirect(buildReturnUrl(pageWarehouseId, "error", "Role title must be 50 characters or fewer."));
  }

  // Validate warehouse assignment against organization if provided
  if (warehouseId !== null) {
    const validWarehouseIds = await getValidWarehouseIds(actor.organizationId, [warehouseId]);
    if (!validWarehouseIds.has(warehouseId)) {
      redirect(buildReturnUrl(pageWarehouseId, "error", "Selected warehouse is invalid for your organization."));
    }
  }

  try {
    await db.insert(positionTypes).values({
      title,
      warehouseId,
      isOfficeRole,
      ...permissions,
    });

    revalidatePath(`/warehouses/${pageWarehouseId}/people-roles`);
    redirect(buildReturnUrl(pageWarehouseId, "success", `Role "${title}" created.`));
  } catch (error) {
    if (isUniqueViolation(error)) {
      redirect(buildReturnUrl(pageWarehouseId, "error", "A role with this title already exists."));
    }

    throw error;
  }
}

export async function updateRole(pageWarehouseId: number, formData: FormData) {
  const actor = await requireManageUsersAccess();

  const positionId = parseOptionalNumber(formData.get("positionId"));
  const warehouseId = parseOptionalNumber(formData.get("warehouseId"));
  const title = String(formData.get("title") ?? "").trim();
  const isOfficeRole = parseBooleanFromForm(formData, "isOfficeRole");
  const permissions = parsePermissionValues(formData);

  if (!positionId) {
    redirect(buildReturnUrl(pageWarehouseId, "error", "Invalid role selected."));
  }
  if (!title) {
    redirect(buildReturnUrl(pageWarehouseId, "error", "Role title is required."));
  }
  if (title.length > 50) {
    redirect(buildReturnUrl(pageWarehouseId, "error", "Role title must be 50 characters or fewer."));
  }

  // Validate warehouse assignment against organization if provided
  if (warehouseId !== null) {
    const validWarehouseIds = await getValidWarehouseIds(actor.organizationId, [warehouseId]);
    if (!validWarehouseIds.has(warehouseId)) {
      redirect(buildReturnUrl(pageWarehouseId, "error", "Selected warehouse is invalid for your organization."));
    }
  }

  try {
    const updated = await db
      .update(positionTypes)
      .set({
        title,
        warehouseId,
        isOfficeRole,
        ...permissions,
      })
      .where(eq(positionTypes.positionId, positionId))
      .returning({ positionId: positionTypes.positionId });

    if (updated.length === 0) {
      redirect(buildReturnUrl(pageWarehouseId, "error", "Role not found."));
    }

    revalidatePath(`/warehouses/${pageWarehouseId}/people-roles`);
    redirect(buildReturnUrl(pageWarehouseId, "success", `Role "${title}" updated.`));
  } catch (error) {
    if (isUniqueViolation(error)) {
      redirect(buildReturnUrl(pageWarehouseId, "error", "A role with this title already exists."));
    }

    throw error;
  }
}

export async function createEmployee(pageWarehouseId: number, formData: FormData) {
  const actor = await requireManageUsersAccess();

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

  if (!workEmail) {
    redirect(buildReturnUrl(pageWarehouseId, "error", "Work email is required."));
  }
  if (workEmail.length > 150) {
    redirect(buildReturnUrl(pageWarehouseId, "error", "Work email must be 150 characters or fewer."));
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workEmail)) {
    redirect(buildReturnUrl(pageWarehouseId, "error", "Enter a valid work email address."));
  }
  if (firstName.length > 50 || middleName.length > 50 || lastName.length > 50) {
    redirect(buildReturnUrl(pageWarehouseId, "error", "Name fields must be 50 characters or fewer."));
  }
  if (!positionId) {
    redirect(buildReturnUrl(pageWarehouseId, "error", "A role must be assigned."));
  }

  const validRoleIds = await getValidRoleIds([positionId]);
  if (!validRoleIds.has(positionId)) {
    redirect(buildReturnUrl(pageWarehouseId, "error", "Selected role is invalid."));
  }

  const warehouseIds = [primaryWarehouseId, currentWarehouseId].filter(
    (value): value is number => value !== null
  );
  const validWarehouseIds = await getValidWarehouseIds(actor.organizationId, warehouseIds);
  if (warehouseIds.some((warehouseId) => !validWarehouseIds.has(warehouseId))) {
    redirect(buildReturnUrl(pageWarehouseId, "error", "One of the selected warehouses is invalid for your organization."));
  }

  const validDepartmentIds = await getValidDepartmentIds(actor.organizationId, departmentIds);
  if (departmentIds.some((departmentId) => !validDepartmentIds.has(departmentId))) {
    redirect(buildReturnUrl(pageWarehouseId, "error", "One or more selected departments are invalid."));
  }
  if (primaryDepartmentId !== null && !validDepartmentIds.has(primaryDepartmentId)) {
    redirect(buildReturnUrl(pageWarehouseId, "error", "Primary department must be one of the selected departments."));
  }

  const validMheTypeIds = await getValidMheTypeIds(mheTypeIds);
  if (mheTypeIds.some((mheTypeId) => !validMheTypeIds.has(mheTypeId))) {
    redirect(buildReturnUrl(pageWarehouseId, "error", "One or more selected licenses are invalid."));
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

      if (!createdEmployee) {
        throw new Error("Employee could not be created.");
      }

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

    revalidatePath(`/warehouses/${pageWarehouseId}/people-roles`);
    redirect(buildReturnUrl(pageWarehouseId, "success", `Employee "${workEmail}" created.`));
  } catch (error) {
    if (isUniqueViolation(error)) {
      redirect(buildReturnUrl(pageWarehouseId, "error", "An employee with that work email already exists."));
    }

    throw error;
  }
}

export async function updateEmployee(pageWarehouseId: number, formData: FormData) {
  const actor = await requireManageUsersAccess();

  const employeeId = parseOptionalNumber(formData.get("employeeId"));
  const positionId = parseOptionalNumber(formData.get("positionId"));
  const primaryWarehouseId = parseOptionalNumber(formData.get("primaryWarehouseId"));
  const currentWarehouseId = parseOptionalNumber(formData.get("currentWarehouseId"));
  const isActive = String(formData.get("employmentStatus") ?? "active") === "active";
  const hireDate = parseOptionalDate(formData.get("hireDate"));
  const terminationDate = parseOptionalDate(formData.get("terminationDate"));

  if (!employeeId) {
    redirect(buildReturnUrl(pageWarehouseId, "error", "Invalid employee selected."));
  }

  const existingEmployee = await ensureEmployeeBelongsToOrg(employeeId, actor.organizationId);
  if (!existingEmployee) {
    redirect(buildReturnUrl(pageWarehouseId, "error", "Employee not found for your organization."));
  }

  if (!positionId) {
    redirect(buildReturnUrl(pageWarehouseId, "error", "A role must be assigned."));
  }

  const validRoleIds = await getValidRoleIds([positionId]);
  if (!validRoleIds.has(positionId)) {
    redirect(buildReturnUrl(pageWarehouseId, "error", "Selected role is invalid."));
  }

  const warehouseIds = [primaryWarehouseId, currentWarehouseId].filter(
    (value): value is number => value !== null
  );
  const validWarehouseIds = await getValidWarehouseIds(actor.organizationId, warehouseIds);
  if (warehouseIds.some((warehouseId) => !validWarehouseIds.has(warehouseId))) {
    redirect(buildReturnUrl(pageWarehouseId, "error", "One of the selected warehouses is invalid for your organization."));
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

  revalidatePath(`/warehouses/${pageWarehouseId}/people-roles`);
  redirect(buildReturnUrl(pageWarehouseId, "success", "Employee details updated."));
}

export async function syncEmployeeDepartments(pageWarehouseId: number, formData: FormData) {
  const actor = await requireManageUsersAccess();

  const employeeId = parseOptionalNumber(formData.get("employeeId"));
  const departmentIds = parseNumberList(formData, "departmentIds");
  const primaryDepartmentId = parseOptionalNumber(formData.get("primaryDepartmentId"));

  if (!employeeId) {
    redirect(buildReturnUrl(pageWarehouseId, "error", "Invalid employee selected."));
  }

  const existingEmployee = await ensureEmployeeBelongsToOrg(employeeId, actor.organizationId);
  if (!existingEmployee) {
    redirect(buildReturnUrl(pageWarehouseId, "error", "Employee not found for your organization."));
  }

  const validDepartmentIds = await getValidDepartmentIds(actor.organizationId, departmentIds);
  if (departmentIds.some((departmentId) => !validDepartmentIds.has(departmentId))) {
    redirect(buildReturnUrl(pageWarehouseId, "error", "One or more selected departments are invalid."));
  }
  if (primaryDepartmentId !== null && !validDepartmentIds.has(primaryDepartmentId)) {
    redirect(buildReturnUrl(pageWarehouseId, "error", "Primary department must be one of the selected departments."));
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

  revalidatePath(`/warehouses/${pageWarehouseId}/people-roles`);
  redirect(buildReturnUrl(pageWarehouseId, "success", "Employee departments updated."));
}

export async function syncEmployeeLicenses(pageWarehouseId: number, formData: FormData) {
  const actor = await requireManageUsersAccess();

  const employeeId = parseOptionalNumber(formData.get("employeeId"));
  const mheTypeIds = parseNumberList(formData, "mheTypeIds");

  if (!employeeId) {
    redirect(buildReturnUrl(pageWarehouseId, "error", "Invalid employee selected."));
  }

  const existingEmployee = await ensureEmployeeBelongsToOrg(employeeId, actor.organizationId);
  if (!existingEmployee) {
    redirect(buildReturnUrl(pageWarehouseId, "error", "Employee not found for your organization."));
  }

  const validMheTypeIds = await getValidMheTypeIds(mheTypeIds);
  if (mheTypeIds.some((mheTypeId) => !validMheTypeIds.has(mheTypeId))) {
    redirect(buildReturnUrl(pageWarehouseId, "error", "One or more selected licenses are invalid."));
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

  revalidatePath(`/warehouses/${pageWarehouseId}/people-roles`);
  redirect(buildReturnUrl(pageWarehouseId, "success", "Employee licenses updated."));
}
