"use client";

import { updateRole } from "./actions";
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
import { Checkbox } from "@/components/ui/checkbox";
import { PermissionMatrix } from "./permission-matrix";
import { ShieldAlert } from "lucide-react";

interface RoleRecord {
  positionId: number;
  title: string;
  isOfficeRole: boolean | null;
  [key: string]: unknown;
}

interface RolesTableProps {
  roles: RoleRecord[];
  roleUsage: Map<number, number>;
}

export function RolesTable({ roles, roleUsage }: RolesTableProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <Table>
        <TableHeader className="bg-slate-50">
          <TableRow>
            <TableHead className="font-bold text-slate-900">
              Role Title
            </TableHead>
            <TableHead className="font-bold text-slate-900">
              Classification
            </TableHead>
            <TableHead className="font-bold text-slate-900">
              Assigned Workforce
            </TableHead>
            <TableHead className="text-right font-bold text-slate-900">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {roles.map((role) => (
            <TableRow key={role.positionId} className="hover:bg-slate-50/80">
              <TableCell>
                <div className="font-medium text-slate-950">{role.title}</div>
                <div className="text-xs text-slate-500">
                  Role ID: #{role.positionId}
                </div>
              </TableCell>
              <TableCell>
                {role.isOfficeRole ? (
                  <Badge
                    variant="secondary"
                    className="bg-teal-100 text-teal-800 hover:bg-teal-100"
                  >
                    Office
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-slate-50">
                    Warehouse
                  </Badge>
                )}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="bg-white">
                  {roleUsage.get(role.positionId) ?? 0} assigned
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                      <ShieldAlert className="h-4 w-4 text-slate-600" />
                      <span className="sr-only">Edit permissions</span>
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto sm:max-w-3xl">
                    <DialogHeader>
                      <DialogTitle className="text-xl font-bold">
                        Edit Role & Permissions
                      </DialogTitle>
                      <DialogDescription>
                        Update title, office classification, and permission
                        matrix for {role.title}.
                      </DialogDescription>
                    </DialogHeader>

                    <form action={updateRole} className="space-y-4 pt-2">
                      <input
                        type="hidden"
                        name="positionId"
                        value={role.positionId}
                      />
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor={`role-title-${role.positionId}`}>
                            Title
                          </Label>
                          <Input
                            id={`role-title-${role.positionId}`}
                            name="title"
                            required
                            maxLength={50}
                            defaultValue={role.title}
                          />
                        </div>
                        <div className="flex items-center space-x-2 pt-2 sm:pt-0 sm:self-end">
                          <Checkbox
                            id={`role-isOffice-${role.positionId}`}
                            name="isOfficeRole"
                            defaultChecked={role.isOfficeRole === true}
                          />
                          <Label
                            htmlFor={`role-isOffice-${role.positionId}`}
                            className="cursor-pointer text-sm font-normal text-slate-700"
                          >
                            Office role
                          </Label>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-sm font-semibold text-slate-900">
                          Permissions
                        </Label>
                        <PermissionMatrix
                          prefix={`role-${role.positionId}`}
                          defaults={role as Record<string, boolean | null>}
                        />
                      </div>

                      <div className="flex justify-end pt-4">
                        <Button type="submit">Update role permissions</Button>
                      </div>
                    </form>
                  </DialogContent>
                </Dialog>
              </TableCell>
            </TableRow>
          ))}

          {roles.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={4}
                className="py-8 text-center text-sm text-slate-500"
              >
                No roles have been created yet.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}
