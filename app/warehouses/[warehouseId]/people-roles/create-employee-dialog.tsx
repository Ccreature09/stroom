"use client";

import { useState } from "react";
import { createEmployee } from "./actions";
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
import { UserPlus } from "lucide-react";

const multiSelectClassName =
  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

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

interface CreateEmployeeDialogProps {
  pageWarehouseId: number;
  roles: RoleOption[];
  warehouses: WarehouseOption[];
  departments: DepartmentOption[];
  mheTypes: MheTypeOption[];
}

export function CreateEmployeeDialog({
  pageWarehouseId,
  roles,
  warehouses,
  departments,
  mheTypes,
}: CreateEmployeeDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-teal-700 text-white hover:bg-teal-800">
          <UserPlus className="mr-2 h-4 w-4" />
          Create employee
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            Create employee
          </DialogTitle>
          <DialogDescription>
            Add a new worker profile and assign their initial department and
            equipment licenses.
          </DialogDescription>
        </DialogHeader>

        <form action={createEmployee.bind(null, pageWarehouseId)} className="space-y-4 pt-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="create-workEmail">Work email</Label>
              <Input
                id="create-workEmail"
                name="workEmail"
                type="email"
                required
                maxLength={150}
                placeholder="worker@company.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-positionId">Role</Label>
              <Select name="positionId" required>
                <SelectTrigger id="create-positionId" className="bg-white">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem
                      key={role.positionId}
                      value={String(role.positionId)}
                    >
                      {role.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-firstName">First name</Label>
              <Input id="create-firstName" name="firstName" maxLength={50} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-middleName">Middle name</Label>
              <Input id="create-middleName" name="middleName" maxLength={50} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-lastName">Last name</Label>
              <Input id="create-lastName" name="lastName" maxLength={50} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-hireDate">Hire date</Label>
              <Input id="create-hireDate" name="hireDate" type="date" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-primaryWarehouseId">
                Primary warehouse
              </Label>
              <Select name="primaryWarehouseId">
                <SelectTrigger
                  id="create-primaryWarehouseId"
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
                      {warehouse.name || `Warehouse #${warehouse.warehouseId}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-currentWarehouseId">
                Current warehouse
              </Label>
              <Select name="currentWarehouseId">
                <SelectTrigger
                  id="create-currentWarehouseId"
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
                      {warehouse.name || `Warehouse #${warehouse.warehouseId}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="create-employmentStatus">Employment status</Label>
              <Select name="employmentStatus" defaultValue="active">
                <SelectTrigger
                  id="create-employmentStatus"
                  className="bg-white"
                >
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 pt-2">
            <div className="space-y-2">
              <Label htmlFor="create-departmentIds">
                Departments (multi-select)
              </Label>
              <select
                id="create-departmentIds"
                name="departmentIds"
                multiple
                size={Math.min(5, Math.max(3, departments.length || 3))}
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
              <Label htmlFor="create-primaryDepartmentId">
                Primary department
              </Label>
              <Select name="primaryDepartmentId">
                <SelectTrigger
                  id="create-primaryDepartmentId"
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
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="create-mheTypeIds">
                Equipment licenses (multi-select)
              </Label>
              <select
                id="create-mheTypeIds"
                name="mheTypeIds"
                multiple
                size={Math.min(5, Math.max(3, mheTypes.length || 3))}
                className={multiSelectClassName}
              >
                {mheTypes.map((license) => (
                  <option key={license.mheTypeId} value={license.mheTypeId}>
                    {license.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Create employee</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
