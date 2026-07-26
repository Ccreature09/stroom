"use client";

import {
  updateEmployee,
  syncEmployeeDepartments,
  syncEmployeeLicenses,
} from "./actions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Edit } from "lucide-react";

const multiSelectClassName =
  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

interface EmployeeRecord {
  employeeId: number;
  workEmail: string;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  positionId: number | null;
  primaryWarehouseId: number | null;
  currentWarehouseId: number | null;
  isActive: boolean | null;
  hireDate: string | null;
  terminationDate: string | null;
}

interface RoleOption {
  positionId: number;
  title: string;
}

interface WarehouseOption {
  warehouseId: number;
  name: string | null;
}

interface DepartmentOption {
  departmentId: number;
  departmentName: string;
}

interface MheTypeOption {
  mheTypeId: number;
  name: string;
}

interface EmployeeTableProps {
  employees: EmployeeRecord[];
  roles: RoleOption[];
  warehouses: WarehouseOption[];
  departments: DepartmentOption[];
  mheTypes: MheTypeOption[];
  departmentsByEmployeeId: Map<number, number[]>;
  primaryDepartmentByEmployeeId: Map<number, number>;
  licensesByEmployeeId: Map<number, number[]>;
  warehouseById: Map<number, WarehouseOption>;
}

export function EmployeeTable({
  employees,
  roles,
  warehouses,
  departments,
  mheTypes,
  departmentsByEmployeeId,
  primaryDepartmentByEmployeeId,
  licensesByEmployeeId,
  warehouseById,
}: EmployeeTableProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <Table>
        <TableHeader className="bg-slate-50">
          <TableRow>
            <TableHead className="font-bold text-slate-900">
              Name & Email
            </TableHead>
            <TableHead className="font-bold text-slate-900">Role</TableHead>
            <TableHead className="font-bold text-slate-900">Status</TableHead>
            <TableHead className="font-bold text-slate-900">
              Primary Warehouse
            </TableHead>
            <TableHead className="font-bold text-slate-900">
              Current Warehouse
            </TableHead>
            <TableHead className="text-right font-bold text-slate-900">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {employees.map((employee) => {
            const displayName = [
              employee.firstName,
              employee.middleName,
              employee.lastName,
            ]
              .filter(Boolean)
              .join(" ");
            const role = roles.find(
              (roleItem) => roleItem.positionId === employee.positionId,
            );
            const assignedDepartments = (
              departmentsByEmployeeId.get(employee.employeeId) ?? []
            ).map(String);
            const assignedLicenses = (
              licensesByEmployeeId.get(employee.employeeId) ?? []
            ).map(String);
            const primaryDepartment = primaryDepartmentByEmployeeId.get(
              employee.employeeId,
            );

            return (
              <TableRow
                key={employee.employeeId}
                className="hover:bg-slate-50/80"
              >
                <TableCell>
                  <div className="font-medium text-slate-950">
                    {displayName || employee.workEmail}
                  </div>
                  <div className="text-xs text-slate-500">
                    {employee.workEmail}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="bg-slate-50 font-normal">
                    {role?.title ?? "Unassigned"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="secondary"
                    className={
                      employee.isActive
                        ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100"
                        : "bg-amber-100 text-amber-800 hover:bg-amber-100"
                    }
                  >
                    {employee.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-slate-600">
                  {employee.primaryWarehouseId
                    ? (warehouseById.get(employee.primaryWarehouseId)?.name ??
                      `Warehouse #${employee.primaryWarehouseId}`)
                    : "—"}
                </TableCell>
                <TableCell className="text-sm text-slate-600">
                  {employee.currentWarehouseId
                    ? (warehouseById.get(employee.currentWarehouseId)?.name ??
                      `Warehouse #${employee.currentWarehouseId}`)
                    : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <Edit className="h-4 w-4 text-slate-600" />
                        <span className="sr-only">Edit employee</span>
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto sm:max-w-3xl">
                      <DialogHeader>
                        <DialogTitle className="text-xl font-bold">
                          Manage Employee
                        </DialogTitle>
                        <DialogDescription>
                          {displayName || employee.workEmail} (
                          {employee.workEmail})
                        </DialogDescription>
                      </DialogHeader>

                      <Tabs defaultValue="details" className="mt-2 w-full">
                        <TabsList className="grid w-full grid-cols-3">
                          <TabsTrigger value="details">
                            Details & Role
                          </TabsTrigger>
                          <TabsTrigger value="departments">
                            Departments
                          </TabsTrigger>
                          <TabsTrigger value="licenses">Licenses</TabsTrigger>
                        </TabsList>

                        <TabsContent value="details" className="pt-4">
                          <form action={updateEmployee} className="space-y-4">
                            <input
                              type="hidden"
                              name="employeeId"
                              value={employee.employeeId}
                            />
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="space-y-2">
                                <Label
                                  htmlFor={`emp-role-${employee.employeeId}`}
                                >
                                  Role
                                </Label>
                                <Select
                                  name="positionId"
                                  defaultValue={
                                    employee.positionId
                                      ? String(employee.positionId)
                                      : undefined
                                  }
                                  required
                                >
                                  <SelectTrigger
                                    id={`emp-role-${employee.employeeId}`}
                                    className="bg-white"
                                  >
                                    <SelectValue placeholder="Select role" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {roles.map((roleItem) => (
                                      <SelectItem
                                        key={roleItem.positionId}
                                        value={String(roleItem.positionId)}
                                      >
                                        {roleItem.title}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="space-y-2">
                                <Label
                                  htmlFor={`emp-status-${employee.employeeId}`}
                                >
                                  Employment status
                                </Label>
                                <Select
                                  name="employmentStatus"
                                  defaultValue={
                                    employee.isActive ? "active" : "inactive"
                                  }
                                >
                                  <SelectTrigger
                                    id={`emp-status-${employee.employeeId}`}
                                    className="bg-white"
                                  >
                                    <SelectValue placeholder="Select status" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="active">
                                      Active
                                    </SelectItem>
                                    <SelectItem value="inactive">
                                      Inactive
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="space-y-2">
                                <Label
                                  htmlFor={`emp-hireDate-${employee.employeeId}`}
                                >
                                  Hire date
                                </Label>
                                <Input
                                  id={`emp-hireDate-${employee.employeeId}`}
                                  name="hireDate"
                                  type="date"
                                  defaultValue={employee.hireDate ?? ""}
                                />
                              </div>

                              <div className="space-y-2">
                                <Label
                                  htmlFor={`emp-termDate-${employee.employeeId}`}
                                >
                                  Termination date
                                </Label>
                                <Input
                                  id={`emp-termDate-${employee.employeeId}`}
                                  name="terminationDate"
                                  type="date"
                                  defaultValue={employee.terminationDate ?? ""}
                                />
                              </div>

                              <div className="space-y-2">
                                <Label
                                  htmlFor={`emp-priWarehouse-${employee.employeeId}`}
                                >
                                  Primary warehouse
                                </Label>
                                <Select
                                  name="primaryWarehouseId"
                                  defaultValue={
                                    employee.primaryWarehouseId
                                      ? String(employee.primaryWarehouseId)
                                      : undefined
                                  }
                                >
                                  <SelectTrigger
                                    id={`emp-priWarehouse-${employee.employeeId}`}
                                    className="bg-white"
                                  >
                                    <SelectValue placeholder="Unassigned" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {warehouses.map((warehouse) => (
                                      <SelectItem
                                        key={warehouse.warehouseId}
                                        value={String(warehouse.warehouseId)}
                                      >
                                        {warehouse.name ||
                                          `Warehouse #${warehouse.warehouseId}`}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="space-y-2">
                                <Label
                                  htmlFor={`emp-curWarehouse-${employee.employeeId}`}
                                >
                                  Current warehouse
                                </Label>
                                <Select
                                  name="currentWarehouseId"
                                  defaultValue={
                                    employee.currentWarehouseId
                                      ? String(employee.currentWarehouseId)
                                      : undefined
                                  }
                                >
                                  <SelectTrigger
                                    id={`emp-curWarehouse-${employee.employeeId}`}
                                    className="bg-white"
                                  >
                                    <SelectValue placeholder="Unassigned" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {warehouses.map((warehouse) => (
                                      <SelectItem
                                        key={warehouse.warehouseId}
                                        value={String(warehouse.warehouseId)}
                                      >
                                        {warehouse.name ||
                                          `Warehouse #${warehouse.warehouseId}`}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>

                            <div className="flex justify-end pt-2">
                              <Button type="submit">
                                Save employee details
                              </Button>
                            </div>
                          </form>
                        </TabsContent>

                        <TabsContent value="departments" className="pt-4">
                          <form
                            action={syncEmployeeDepartments}
                            className="space-y-4"
                          >
                            <input
                              type="hidden"
                              name="employeeId"
                              value={employee.employeeId}
                            />
                            <div className="space-y-2">
                              <Label
                                htmlFor={`emp-depts-${employee.employeeId}`}
                              >
                                Assigned departments (multi-select)
                              </Label>
                              <select
                                id={`emp-depts-${employee.employeeId}`}
                                name="departmentIds"
                                multiple
                                defaultValue={assignedDepartments}
                                size={Math.min(
                                  6,
                                  Math.max(3, departments.length || 3),
                                )}
                                className={multiSelectClassName}
                              >
                                {departments.map((department) => (
                                  <option
                                    key={department.departmentId}
                                    value={department.departmentId}
                                  >
                                    {department.departmentName}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-2">
                              <Label
                                htmlFor={`emp-priDept-${employee.employeeId}`}
                              >
                                Primary department
                              </Label>
                              <Select
                                name="primaryDepartmentId"
                                defaultValue={
                                  primaryDepartment
                                    ? String(primaryDepartment)
                                    : undefined
                                }
                              >
                                <SelectTrigger
                                  id={`emp-priDept-${employee.employeeId}`}
                                  className="bg-white"
                                >
                                  <SelectValue placeholder="First selected department" />
                                </SelectTrigger>
                                <SelectContent>
                                  {departments.map((department) => (
                                    <SelectItem
                                      key={department.departmentId}
                                      value={String(department.departmentId)}
                                    >
                                      {department.departmentName}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex justify-end pt-2">
                              <Button type="submit">Save departments</Button>
                            </div>
                          </form>
                        </TabsContent>

                        <TabsContent value="licenses" className="pt-4">
                          <form
                            action={syncEmployeeLicenses}
                            className="space-y-4"
                          >
                            <input
                              type="hidden"
                              name="employeeId"
                              value={employee.employeeId}
                            />
                            <div className="space-y-2">
                              <Label
                                htmlFor={`emp-licenses-${employee.employeeId}`}
                              >
                                Assigned licenses (multi-select)
                              </Label>
                              <select
                                id={`emp-licenses-${employee.employeeId}`}
                                name="mheTypeIds"
                                multiple
                                defaultValue={assignedLicenses}
                                size={Math.min(
                                  5,
                                  Math.max(3, mheTypes.length || 3),
                                )}
                                className={multiSelectClassName}
                              >
                                {mheTypes.map((license) => (
                                  <option
                                    key={license.mheTypeId}
                                    value={license.mheTypeId}
                                  >
                                    {license.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="flex justify-end pt-2">
                              <Button type="submit">Save licenses</Button>
                            </div>
                          </form>
                        </TabsContent>
                      </Tabs>
                    </DialogContent>
                  </Dialog>
                </TableCell>
              </TableRow>
            );
          })}

          {employees.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={6}
                className="py-8 text-center text-sm text-slate-500"
              >
                No employees have been created for this organization yet.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}
