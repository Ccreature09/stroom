import { and, eq, inArray, isNull, or } from "drizzle-orm";
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
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreateRoleDialog } from "./create-role-dialog";
import { CreateEmployeeDialog } from "./create-employee-dialog";
import { RolesTable } from "./roles-table";
import { EmployeeTable } from "./employee-table";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";

type SearchParams = {
  status?: "success" | "error";
  message?: string;
};

export default async function PeopleRolesPage({
  params: routeParams,
  searchParams,
}: {
  params: Promise<{ warehouseId: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { warehouseId: warehouseIdParam } = await routeParams;
  const pageWarehouseId = Number(warehouseIdParam);
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
    .innerJoin(
      positionTypes,
      eq(employees.positionId, positionTypes.positionId),
    )
    .where(and(eq(employees.authUserId, userId), eq(employees.isActive, true)))
    .limit(1);

  if (!currentEmployee) redirect("/sign-in");
  if (currentEmployee.canManageUsers !== true) redirect("/warehouses");

  const [currentWarehouse] = await db
    .select({ warehouseId: warehouses.warehouseId })
    .from(warehouses)
    .where(
      and(
        eq(warehouses.organizationId, currentEmployee.organizationId),
        eq(warehouses.warehouseId, pageWarehouseId),
      ),
    )
    .limit(1);

  if (!currentWarehouse) redirect("/warehouses");

  const [roles, orgWarehouses, orgDepartments, allMheTypes, orgEmployees] =
    await Promise.all([
      // Roles scoped to this warehouse, plus org-wide roles (warehouseId IS NULL).
      db
        .select()
        .from(positionTypes)
        .where(
          or(
            isNull(positionTypes.warehouseId),
            eq(positionTypes.warehouseId, pageWarehouseId),
          ),
        ),
      db
        .select({
          warehouseId: warehouses.warehouseId,
          name: warehouses.name,
          city: warehouses.city,
          isActive: warehouses.isActive,
        })
        .from(warehouses)
        .where(eq(warehouses.organizationId, currentEmployee.organizationId)),
      // Departments scoped to this warehouse, plus org-wide departments (warehouseId IS NULL).
      db
        .select({
          departmentId: departments.departmentId,
          departmentName: departments.departmentName,
          warehouseId: departments.warehouseId,
          isActive: departments.isActive,
        })
        .from(departments)
        .where(
          or(
            isNull(departments.warehouseId),
            eq(departments.warehouseId, pageWarehouseId),
          ),
        ),
      db.select().from(mheTypes),
      // Employees assigned to this warehouse (primary or current), plus
      // employees with no warehouse assignment at all (org-wide staff).
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
        .where(
          and(
            eq(employees.organizationId, currentEmployee.organizationId),
            or(
              eq(employees.primaryWarehouseId, pageWarehouseId),
              eq(employees.currentWarehouseId, pageWarehouseId),
              and(
                isNull(employees.primaryWarehouseId),
                isNull(employees.currentWarehouseId),
              ),
            ),
          ),
        ),
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
    roleUsage.set(
      employee.positionId,
      (roleUsage.get(employee.positionId) ?? 0) + 1,
    );
  }

  const warehouseById = new Map(
    orgWarehouses.map((warehouse) => [warehouse.warehouseId, warehouse]),
  );

  const departmentsByEmployeeId = new Map<number, number[]>();
  const primaryDepartmentByEmployeeId = new Map<number, number>();
  for (const assignment of departmentAssignments) {
    const current = departmentsByEmployeeId.get(assignment.employeeId) ?? [];
    current.push(assignment.departmentId);
    departmentsByEmployeeId.set(assignment.employeeId, current);
    if (assignment.isPrimary) {
      primaryDepartmentByEmployeeId.set(
        assignment.employeeId,
        assignment.departmentId,
      );
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
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardHeader className="px-6 py-6 sm:px-8">
            <DynamicBreadcrumb />
            <CardTitle className="mt-3 text-3xl font-bold tracking-[-0.04em] text-slate-950">
              People & roles
            </CardTitle>
            <CardDescription className="mt-2 text-sm text-slate-600">
              Manage position permissions, workforce records, department
              assignments, and operating licenses.
            </CardDescription>
            <p className="mt-2 text-xs uppercase tracking-[0.14em] text-slate-500">
              Signed in as{" "}
              {[currentEmployee.firstName, currentEmployee.lastName]
                .filter(Boolean)
                .join(" ") || "Administrator"}
            </p>
          </CardHeader>
        </Card>

        {params.message ? (
          <div
            className={`rounded-xl border px-4 py-3 text-sm font-medium ${statusClass}`}
          >
            {params.message}
          </div>
        ) : null}

        <Tabs defaultValue="employees" className="w-full space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <TabsList className="grid w-full max-w-md grid-cols-2 bg-slate-200/70 p-1">
              <TabsTrigger value="employees" className="font-semibold">
                Employees
              </TabsTrigger>
              <TabsTrigger value="roles" className="font-semibold">
                Roles & Permissions
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="employees" className="space-y-4">
            <div className="flex justify-end">
              <CreateEmployeeDialog
                pageWarehouseId={pageWarehouseId}
                roles={roles}
                warehouses={orgWarehouses}
                departments={orgDepartments}
                mheTypes={allMheTypes}
              />
            </div>
            <EmployeeTable
              pageWarehouseId={pageWarehouseId}
              employees={orgEmployees}
              roles={roles}
              warehouses={orgWarehouses}
              departments={orgDepartments}
              mheTypes={allMheTypes}
              departmentsByEmployeeId={departmentsByEmployeeId}
              primaryDepartmentByEmployeeId={primaryDepartmentByEmployeeId}
              licensesByEmployeeId={licensesByEmployeeId}
              warehouseById={warehouseById}
            />
          </TabsContent>

          <TabsContent value="roles" className="space-y-4">
            <div className="flex justify-end">
              <CreateRoleDialog pageWarehouseId={pageWarehouseId} />
            </div>
            <RolesTable pageWarehouseId={pageWarehouseId} roles={roles} roleUsage={roleUsage} />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
