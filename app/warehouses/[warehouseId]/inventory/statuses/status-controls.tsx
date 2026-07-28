"use client";

import { useState, useTransition } from "react";
import { MoreHorizontal, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  createInventoryStatus,
  deleteInventoryStatus,
  seedDefaultStatuses,
  updateInventoryStatus,
} from "./actions";
import type { inventoryStatuses } from "@/drizzle/schema";

type InventoryStatus = typeof inventoryStatuses.$inferSelect;

function FlagFields({
  idPrefix,
  status,
}: {
  idPrefix: string;
  status?: InventoryStatus;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex items-start gap-2">
        <Checkbox
          id={`${idPrefix}-allowAllocation`}
          name="allowAllocation"
          value="on"
          defaultChecked={status ? status.allowAllocation !== false : true}
        />
        <div className="grid gap-0.5">
          <Label
            htmlFor={`${idPrefix}-allowAllocation`}
            className="cursor-pointer text-sm"
          >
            Allow allocation
          </Label>
          <span className="text-[11px] text-muted-foreground">
            Stock in this status can be reserved for outbound orders.
          </span>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <Checkbox
          id={`${idPrefix}-allowMovement`}
          name="allowMovement"
          value="on"
          defaultChecked={status ? status.allowMovement !== false : true}
        />
        <div className="grid gap-0.5">
          <Label
            htmlFor={`${idPrefix}-allowMovement`}
            className="cursor-pointer text-sm"
          >
            Allow movement
          </Label>
          <span className="text-[11px] text-muted-foreground">
            Stock in this status can be transferred between locations.
          </span>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <Checkbox
          id={`${idPrefix}-isSellable`}
          name="isSellable"
          value="on"
          defaultChecked={status ? status.isSellable !== false : true}
        />
        <div className="grid gap-0.5">
          <Label
            htmlFor={`${idPrefix}-isSellable`}
            className="cursor-pointer text-sm"
          >
            Sellable
          </Label>
          <span className="text-[11px] text-muted-foreground">
            Counts toward sellable on-hand quantity.
          </span>
        </div>
      </div>
    </div>
  );
}

export function AddStatusDialog({ warehouseId }: { warehouseId: number }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    formData.append("warehouseId", String(warehouseId));

    startTransition(async () => {
      const res = await createInventoryStatus(formData);
      if (res?.success) setOpen(false);
      else setError(res?.error ?? "Something went wrong.");
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-teal-700 hover:bg-teal-800">
          <Plus className="mr-2 h-4 w-4" /> Add Status
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Inventory Status</DialogTitle>
            <DialogDescription>
              Define how stock in this status may be used.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="add-status-name">
                Status Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="add-status-name"
                name="name"
                required
                maxLength={50}
                placeholder="e.g. Available"
              />
            </div>
            <FlagFields idPrefix="add-status" />
            {error ? (
              <p className="text-sm font-medium text-red-600">{error}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="bg-teal-700 hover:bg-teal-800"
            >
              {isPending ? "Saving..." : "Save Status"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditStatusDialog({
  status,
  warehouseId,
  open,
  onOpenChange,
}: {
  status: InventoryStatus;
  warehouseId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    formData.append("warehouseId", String(warehouseId));
    formData.append("statusId", String(status.statusId));

    startTransition(async () => {
      const res = await updateInventoryStatus(formData);
      if (res?.success) onOpenChange(false);
      else setError(res?.error ?? "Something went wrong.");
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Inventory Status</DialogTitle>
            <DialogDescription>
              Update how stock in this status may be used.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor={`edit-status-name-${status.statusId}`}>
                Status Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id={`edit-status-name-${status.statusId}`}
                name="name"
                required
                maxLength={50}
                defaultValue={status.name}
              />
            </div>
            <FlagFields
              idPrefix={`edit-status-${status.statusId}`}
              status={status}
            />
            {error ? (
              <p className="text-sm font-medium text-red-600">{error}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="bg-teal-700 hover:bg-teal-800"
            >
              {isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function StatusRowActions({
  status,
  warehouseId,
}: {
  status: InventoryStatus;
  warehouseId: number;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    setError(null);
    const formData = new FormData();
    formData.append("warehouseId", String(warehouseId));
    formData.append("statusId", String(status.statusId));

    startTransition(async () => {
      const res = await deleteInventoryStatus(formData);
      if (res?.error) setError(res.error);
    });
  };

  return (
    <>
      <div className="flex items-center justify-end gap-2">
        {error ? (
          <span className="text-xs font-medium text-red-600">{error}</span>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger className="h-8 w-8 p-0 inline-flex items-center justify-center rounded-md text-sm font-medium hover:bg-slate-100 focus:outline-none">
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                Edit Status
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-red-600"
              disabled={isPending}
              onSelect={handleDelete}
            >
              Delete Status
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <EditStatusDialog
        status={status}
        warehouseId={warehouseId}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  );
}

export function SeedStatusesButton({ warehouseId }: { warehouseId: number }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSeed = () => {
    setError(null);
    const formData = new FormData();
    formData.append("warehouseId", String(warehouseId));

    startTransition(async () => {
      const res = await seedDefaultStatuses(formData);
      if (res?.error) setError(res.error);
    });
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        onClick={handleSeed}
        disabled={isPending}
        variant="outline"
        className="border-teal-200 text-teal-700 hover:bg-teal-50"
      >
        <Sparkles className="mr-2 h-4 w-4" />
        {isPending ? "Creating..." : "Create standard statuses"}
      </Button>
      <span className="text-xs text-slate-500">
        Adds Available, Quarantine, Damaged, and Expired.
      </span>
      {error ? (
        <span className="text-xs font-medium text-red-600">{error}</span>
      ) : null}
    </div>
  );
}
