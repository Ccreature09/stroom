"use client";

import { useState } from "react";
import { createRole } from "./actions";
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
import { ShieldPlus } from "lucide-react";

export function CreateRoleDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-teal-700 text-white hover:bg-teal-800">
          <ShieldPlus className="mr-2 h-4 w-4" />
          Create role
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Create role</DialogTitle>
          <DialogDescription>
            Define position title and permissions across system modules.
          </DialogDescription>
        </DialogHeader>

        <form action={createRole} className="space-y-5 pt-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="create-role-title">Title</Label>
              <Input
                id="create-role-title"
                name="title"
                required
                maxLength={50}
                placeholder="Warehouse Supervisor"
              />
            </div>
            <div className="flex items-center space-x-2 pt-2 sm:pt-0 sm:self-end">
              <Checkbox id="create-isOfficeRole" name="isOfficeRole" />
              <Label
                htmlFor="create-isOfficeRole"
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
            <PermissionMatrix prefix="create-role" />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Create role</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
