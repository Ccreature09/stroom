import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
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
import { PERMISSION_FIELDS, PERMISSION_LABELS } from "@/lib/people-roles/constants";
import {
  createEmployee,
  createRole,
  syncEmployeeDepartments,
  syncEmployeeLicenses,
  updateEmployee,
  updateRole,
} from "./actions";

type SearchParams = {
  status?: "success" | "error";
  message?: string;
};

function PermissionMatrix({
  prefix,
  defaults,
}: {
  prefix: string;
  defaults?: Record<string, boolean | null>;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {PERMISSION_FIELDS.map((field) => (
        <label key={`${prefix}-${field}`} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name={field}
            defaultChecked={defaults?.[field] === true}
            className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
          />
          {PERMISSION_LABELS[field]}
        </label>
      ))}
    </div>
  );
}

export default async function PeopleRolesPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = (await searchParams) ?? {};

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/sign-in");

  const [currentEmployee] = await db
    .select({
      employeeId: employees.employeeId,
      organizationId: employees.organizationId,
      firstName: employees.firstName,
      lastName: employees.lastName,
      canManageUsers: positionTypes.canManageUsers,
    })
    .from(employees)
    .innerJoin(positionTypes, eq(employees.positionId, positionTypes.positionId))
    .where(and(eq(employees.authUserId, userId), eq(employees.isActive, true)))
    .limit(1);

  if (!currentEmployee) redirect("/sign-in");
  if (currentEmployee.canManageUsers !== true) redirect("/dashboard");

  const [roles, orgWarehouses, orgDepartments, allMheTypes, orgEmployees] = await Promise.all([
    db.select().from(positionTypes),
    db
      .select({
        warehouseId: warehouses.warehouseId,
        name: warehouses.name,
        city: warehouses.city,
        isActive: warehouses.isActive,
      })
      .from(warehouses)
      .where(eq(warehouses.organizationId, currentEmployee.organizationId)),
    db
      .select({
        departmentId: departments.departmentId,
        departmentName: departments.departmentName,
        warehouseId: departments.warehouseId,
        isActive: departments.isActive,
      })
      .from(departments)
      .innerJoin(warehouses, eq(departments.warehouseId, warehouses.warehouseId))
      .where(eq(warehouses.organizationId, currentEmployee.organizationId)),
    db.select().from(mheTypes),
    db
      .select({
        employeeId: employees.employeeId,
        workEmail: employees.workEmail,
        firstName: employees.firstName,
        middleName: employees.middleName,
        lastName: employees.lastName,
        positionId: employees.positionId,
        primaryWarehouseId: employees.primaryWarehouseId,
        currentWarehouseId: employees.currentWarehouseId,
        isActive: employees.isActive,
        hireDate: employees.hireDate,
        terminationDate: employees.terminationDate,
        createdAt: employees.createdAt,
      })
      .from(employees)
      .where(eq(employees.organizationId, currentEmployee.organizationId)),
  ]);

  const employeeIds = orgEmployees.map((employee) => employee.employeeId);

  const [departmentAssignments, licenseAssignments] = employeeIds.length
    ? await Promise.all([
        db
          .select({
            employeeId: employeeDepartments.employeeId,
            departmentId: employeeDepartments.departmentId,
            isPrimary: employeeDepartments.isPrimary,
          })
          .from(employeeDepartments)
          .where(inArray(employeeDepartments.employeeId, employeeIds)),
        db
          .select({
            employeeId: employeeLicenses.employeeId,
            mheTypeId: employeeLicenses.mheTypeId,
          })
          .from(employeeLicenses)
          .where(inArray(employeeLicenses.employeeId, employeeIds)),
      ])
    : [[], []];

  const roleUsage = new Map<number, number>();
  for (const employee of orgEmployees) {
    if (!employee.positionId) continue;
    roleUsage.set(employee.positionId, (roleUsage.get(employee.positionId) ?? 0) + 1);
  }

  const warehouseById = new Map(orgWarehouses.map((warehouse) => [warehouse.warehouseId, warehouse]));

  const departmentsByEmployeeId = new Map<number, number[]>();
  const primaryDepartmentByEmployeeId = new Map<number, number>();
  for (const assignment of departmentAssignments) {
    const current = departmentsByEmployeeId.get(assignment.employeeId) ?? [];
    current.push(assignment.departmentId);
    departmentsByEmployeeId.set(assignment.employeeId, current);
    if (assignment.isPrimary) {
      primaryDepartmentByEmployeeId.set(assignment.employeeId, assignment.departmentId);
    }
  }

  const licensesByEmployeeId = new Map<number, number[]>();
  for (const assignment of licenseAssignments) {
    const current = licensesByEmployeeId.get(assignment.employeeId) ?? [];
    current.push(assignment.mheTypeId);
    licensesByEmployeeId.set(assignment.employeeId, current);
  }

  const statusClass =
    params.status === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-red-200 bg-red-50 text-red-800";

  return (
    <main className="flex-1 bg-slate-50 px-5 py-10 sm:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="rounded-2xl border border-slate-200 bg-white px-6 py-6 shadow-sm sm:px-8">
          <Link href="/dashboard" className="text-sm font-semibold text-teal-700 hover:text-teal-800">
            ← Back to dashboard
          </Link>
          <h1 className="mt-3 text-3xl font-bold tracking-[-0.04em] text-slate-950">People & roles</h1>
          <p className="mt-2 text-sm text-slate-600">
            Manage position permissions, workforce records, department assignments, and operating licenses.
          </p>
          <p className="mt-2 text-xs uppercase tracking-[0.14em] text-slate-500">
            Signed in as {[currentEmployee.firstName, currentEmployee.lastName].filter(Boolean).join(" ") || "Administrator"}
          </p>
        </header>

        {params.message ? (
          <div className={`rounded-xl border px-4 py-3 text-sm font-medium ${statusClass}`}>{params.message}</div>
        ) : null}

        <section className="grid gap-8 xl:grid-cols-2">
          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold tracking-[-0.03em] text-slate-950">Create role</h2>
            <p className="mt-1 text-sm text-slate-600">Define role title and permissions from the WMS position model.</p>
            <form action={createRole} className="mt-5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-semibold text-slate-700">
                  Title
                  <input
                    name="title"
                    required
                    maxLength={50}
                    className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                    placeholder="Warehouse Supervisor"
                  />
                </label>
                <label className="mt-7 flex items-center gap-2 text-sm text-slate-700 sm:mt-0 sm:self-end">
                  <input type="checkbox" name="isOfficeRole" className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600" />
                  Office role
                </label>
              </div>

              <PermissionMatrix prefix="create-role" />

              <button
                type="submit"
                className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Create role
              </button>
            </form>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold tracking-[-0.03em] text-slate-950">Create employee</h2>
            <p className="mt-1 text-sm text-slate-600">Create a worker profile, then assign departments and licenses.</p>
            <form action={createEmployee} className="mt-5 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-semibold text-slate-700">
                  Work email
                  <input
                    name="workEmail"
                    type="email"
                    required
                    maxLength={150}
                    className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                    placeholder="worker@company.com"
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Role
                  <select
                    name="positionId"
                    required
                    className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Select role
                    </option>
                    {roles.map((role) => (
                      <option key={role.positionId} value={role.positionId}>
                        {role.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  First name
                  <input
                    name="firstName"
                    maxLength={50}
                    className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Middle name
                  <input
                    name="middleName"
                    maxLength={50}
                    className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Last name
                  <input
                    name="lastName"
                    maxLength={50}
                    className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Hire date
                  <input
                    name="hireDate"
                    type="date"
                    className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Primary warehouse
                  <select
                    name="primaryWarehouseId"
                    defaultValue=""
                    className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                  >
                    <option value="">Unassigned</option>
                    {orgWarehouses.map((warehouse) => (
                      <option key={warehouse.warehouseId} value={warehouse.warehouseId}>
                        {warehouse.name || `Warehouse #${warehouse.warehouseId}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Current warehouse
                  <select
                    name="currentWarehouseId"
                    defaultValue=""
                    className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                  >
                    <option value="">Unassigned</option>
                    {orgWarehouses.map((warehouse) => (
                      <option key={warehouse.warehouseId} value={warehouse.warehouseId}>
                        {warehouse.name || `Warehouse #${warehouse.warehouseId}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Employment status
                  <select
                    name="employmentStatus"
                    defaultValue="active"
                    className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-semibold text-slate-700">
                  Departments (multi-select)
                  <select
                    name="departmentIds"
                    multiple
                    size={Math.min(6, Math.max(3, orgDepartments.length || 3))}
                    className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                  >
                    {orgDepartments.map((department) => (
                      <option key={department.departmentId} value={department.departmentId}>
                        {department.departmentName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Primary department
                  <select
                    name="primaryDepartmentId"
                    defaultValue=""
                    className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                  >
                    <option value="">First selected department</option>
                    {orgDepartments.map((department) => (
                      <option key={department.departmentId} value={department.departmentId}>
                        {department.departmentName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-semibold text-slate-700 sm:col-span-2">
                  Equipment licenses (multi-select)
                  <select
                    name="mheTypeIds"
                    multiple
                    size={Math.min(5, Math.max(3, allMheTypes.length || 3))}
                    className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                  >
                    {allMheTypes.map((license) => (
                      <option key={license.mheTypeId} value={license.mheTypeId}>
                        {license.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <button
                type="submit"
                className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Create employee
              </button>
            </form>
          </article>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold tracking-[-0.03em] text-slate-950">Existing roles</h2>
          <p className="mt-1 text-sm text-slate-600">Update role titles, office classification, and permission grants.</p>

          <div className="mt-5 space-y-4">
            {roles.map((role) => (
              <details key={role.positionId} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-slate-900">{role.title}</p>
                      <p className="text-xs text-slate-600">Role #{role.positionId}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="rounded-full bg-white px-2.5 py-1 font-semibold text-slate-700">
                        {roleUsage.get(role.positionId) ?? 0} assigned
                      </span>
                      {role.isOfficeRole ? (
                        <span className="rounded-full bg-teal-100 px-2.5 py-1 font-semibold text-teal-800">Office</span>
                      ) : null}
                    </div>
                  </div>
                </summary>

                <form action={updateRole} className="mt-4 space-y-4 border-t border-slate-200 pt-4">
                  <input type="hidden" name="positionId" value={role.positionId} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-semibold text-slate-700">
                      Title
                      <input
                        name="title"
                        required
                        maxLength={50}
                        defaultValue={role.title}
                        className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                      />
                    </label>
                    <label className="mt-7 flex items-center gap-2 text-sm text-slate-700 sm:mt-0 sm:self-end">
                      <input
                        type="checkbox"
                        name="isOfficeRole"
                        defaultChecked={role.isOfficeRole === true}
                        className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                      />
                      Office role
                    </label>
                  </div>

                  <PermissionMatrix prefix={`role-${role.positionId}`} defaults={role} />

                  <button
                    type="submit"
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                  >
                    Update role
                  </button>
                </form>
              </details>
            ))}

            {roles.length === 0 ? <p className="text-sm text-slate-500">No roles have been created yet.</p> : null}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold tracking-[-0.03em] text-slate-950">Employees</h2>
          <p className="mt-1 text-sm text-slate-600">Update role assignments, status, warehouses, departments, and licenses.</p>

          <div className="mt-5 space-y-4">
            {orgEmployees.map((employee) => {
              const displayName = [employee.firstName, employee.middleName, employee.lastName]
                .filter(Boolean)
                .join(" ");
              const role = roles.find((roleItem) => roleItem.positionId === employee.positionId);
              const assignedDepartments = (departmentsByEmployeeId.get(employee.employeeId) ?? []).map(String);
              const assignedLicenses = (licensesByEmployeeId.get(employee.employeeId) ?? []).map(String);
              const primaryDepartment = primaryDepartmentByEmployeeId.get(employee.employeeId);

              return (
                <details key={employee.employeeId} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <summary className="cursor-pointer list-none">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-slate-900">{displayName || employee.workEmail}</p>
                        <p className="text-xs text-slate-600">{employee.workEmail}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-full bg-white px-2.5 py-1 font-semibold text-slate-700">
                          {role?.title ?? "No role"}
                        </span>
                        <span
                          className={`rounded-full px-2.5 py-1 font-semibold ${
                            employee.isActive ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {employee.isActive ? "Active" : "Inactive"}
                        </span>
                      </div>
                    </div>
                  </summary>

                  <div className="mt-4 space-y-4 border-t border-slate-200 pt-4">
                    <form action={updateEmployee} className="space-y-3">
                      <input type="hidden" name="employeeId" value={employee.employeeId} />
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <label className="text-sm font-semibold text-slate-700">
                          Role
                          <select
                            name="positionId"
                            defaultValue={employee.positionId ? String(employee.positionId) : ""}
                            required
                            className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                          >
                            <option value="" disabled>
                              Select role
                            </option>
                            {roles.map((roleItem) => (
                              <option key={roleItem.positionId} value={roleItem.positionId}>
                                {roleItem.title}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="text-sm font-semibold text-slate-700">
                          Employment status
                          <select
                            name="employmentStatus"
                            defaultValue={employee.isActive ? "active" : "inactive"}
                            className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                          >
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                          </select>
                        </label>

                        <label className="text-sm font-semibold text-slate-700">
                          Hire date
                          <input
                            name="hireDate"
                            type="date"
                            defaultValue={employee.hireDate ?? ""}
                            className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                          />
                        </label>

                        <label className="text-sm font-semibold text-slate-700">
                          Termination date
                          <input
                            name="terminationDate"
                            type="date"
                            defaultValue={employee.terminationDate ?? ""}
                            className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                          />
                        </label>

                        <label className="text-sm font-semibold text-slate-700">
                          Primary warehouse
                          <select
                            name="primaryWarehouseId"
                            defaultValue={employee.primaryWarehouseId ? String(employee.primaryWarehouseId) : ""}
                            className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                          >
                            <option value="">Unassigned</option>
                            {orgWarehouses.map((warehouse) => (
                              <option key={warehouse.warehouseId} value={warehouse.warehouseId}>
                                {warehouse.name || `Warehouse #${warehouse.warehouseId}`}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="text-sm font-semibold text-slate-700">
                          Current warehouse
                          <select
                            name="currentWarehouseId"
                            defaultValue={employee.currentWarehouseId ? String(employee.currentWarehouseId) : ""}
                            className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                          >
                            <option value="">Unassigned</option>
                            {orgWarehouses.map((warehouse) => (
                              <option key={warehouse.warehouseId} value={warehouse.warehouseId}>
                                {warehouse.name || `Warehouse #${warehouse.warehouseId}`}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <div className="grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                        <p>
                          Primary: {employee.primaryWarehouseId ? (warehouseById.get(employee.primaryWarehouseId)?.name ?? "Unknown") : "None"}
                        </p>
                        <p>
                          Current: {employee.currentWarehouseId ? (warehouseById.get(employee.currentWarehouseId)?.name ?? "Unknown") : "None"}
                        </p>
                      </div>

                      <button
                        type="submit"
                        className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                      >
                        Save employee details
                      </button>
                    </form>

                    <div className="grid gap-4 xl:grid-cols-2">
                      <form action={syncEmployeeDepartments} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
                        <input type="hidden" name="employeeId" value={employee.employeeId} />
                        <h3 className="text-sm font-bold text-slate-900">Departments</h3>
                        <label className="block text-sm font-semibold text-slate-700">
                          Assigned departments
                          <select
                            name="departmentIds"
                            multiple
                            defaultValue={assignedDepartments}
                            size={Math.min(6, Math.max(3, orgDepartments.length || 3))}
                            className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                          >
                            {orgDepartments.map((department) => (
                              <option key={department.departmentId} value={department.departmentId}>
                                {department.departmentName}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-sm font-semibold text-slate-700">
                          Primary department
                          <select
                            name="primaryDepartmentId"
                            defaultValue={primaryDepartment ? String(primaryDepartment) : ""}
                            className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                          >
                            <option value="">First selected department</option>
                            {orgDepartments.map((department) => (
                              <option key={department.departmentId} value={department.departmentId}>
                                {department.departmentName}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="submit"
                          className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                        >
                          Save departments
                        </button>
                      </form>

                      <form action={syncEmployeeLicenses} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
                        <input type="hidden" name="employeeId" value={employee.employeeId} />
                        <h3 className="text-sm font-bold text-slate-900">Equipment licenses</h3>
                        <label className="block text-sm font-semibold text-slate-700">
                          Assigned licenses
                          <select
                            name="mheTypeIds"
                            multiple
                            defaultValue={assignedLicenses}
                            size={Math.min(5, Math.max(3, allMheTypes.length || 3))}
                            className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
                          >
                            {allMheTypes.map((license) => (
                              <option key={license.mheTypeId} value={license.mheTypeId}>
                                {license.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="submit"
                          className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                        >
                          Save licenses
                        </button>
                      </form>
                    </div>
                  </div>
                </details>
              );
            })}

            {orgEmployees.length === 0 ? (
              <p className="text-sm text-slate-500">No employees have been created for this organization yet.</p>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
