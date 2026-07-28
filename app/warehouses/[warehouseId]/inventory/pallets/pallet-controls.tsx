"use client";

import { useState, useTransition } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
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
import { createPallet, deletePallet, updatePallet } from "./actions";
import { PALLET_STATUSES } from "./constants";

export type LocationOption = {
  locationId: number;
  locationCode: string;
};

export type PalletRow = {
  lpnId: string;
  status: string | null;
  currentLocationId: number | null;
  currentLocationCode: string | null;
  createdAt: string | null;
};

const selectClassName =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function AddPalletDialog({
  warehouseId,
  locationOptions,
}: {
  warehouseId: number;
  locationOptions: LocationOption[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    formData.append("warehouseId", String(warehouseId));

    startTransition(async () => {
      const res = await createPallet(formData);
      if (res?.success) setOpen(false);
      else setError(res?.error ?? "Something went wrong.");
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-teal-700 hover:bg-teal-800">
          <Plus className="mr-2 h-4 w-4" /> Create Pallet
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Pallet (LPN)</DialogTitle>
            <DialogDescription>
              Register a license plate number for a physical pallet.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="add-pallet-lpnId">
                LPN <span className="text-destructive">*</span>
              </Label>
              <Input
                id="add-pallet-lpnId"
                name="lpnId"
                required
                maxLength={50}
                placeholder="e.g. LPN00001234"
                className="font-mono uppercase"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="add-pallet-status">Status</Label>
              <select
                id="add-pallet-status"
                name="status"
                defaultValue="ACTIVE"
                className={selectClassName}
              >
                {PALLET_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="add-pallet-location">Current Location</Label>
              <select
                id="add-pallet-location"
                name="currentLocationId"
                defaultValue=""
                className={selectClassName}
              >
                <option value="">Unassigned</option>
                {locationOptions.map((location) => (
                  <option key={location.locationId} value={location.locationId}>
                    {location.locationCode}
                  </option>
                ))}
              </select>
            </div>

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
              {isPending ? "Saving..." : "Create Pallet"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditPalletDialog({
  pallet,
  warehouseId,
  locationOptions,
  open,
  onOpenChange,
}: {
  pallet: PalletRow;
  warehouseId: number;
  locationOptions: LocationOption[];
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
    formData.append("lpnId", pallet.lpnId);

    startTransition(async () => {
      const res = await updatePallet(formData);
      if (res?.success) onOpenChange(false);
      else setError(res?.error ?? "Something went wrong.");
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Pallet</DialogTitle>
            <DialogDescription className="font-mono">
              {pallet.lpnId}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor={`edit-pallet-status-${pallet.lpnId}`}>
                Status
              </Label>
              <select
                id={`edit-pallet-status-${pallet.lpnId}`}
                name="status"
                defaultValue={pallet.status ?? "ACTIVE"}
                className={selectClassName}
              >
                {PALLET_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`edit-pallet-location-${pallet.lpnId}`}>
                Current Location
              </Label>
              <select
                id={`edit-pallet-location-${pallet.lpnId}`}
                name="currentLocationId"
                defaultValue={pallet.currentLocationId ?? ""}
                className={selectClassName}
              >
                <option value="">Unassigned</option>
                {locationOptions.map((location) => (
                  <option key={location.locationId} value={location.locationId}>
                    {location.locationCode}
                  </option>
                ))}
              </select>
            </div>

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

export function PalletRowActions({
  pallet,
  warehouseId,
  locationOptions,
}: {
  pallet: PalletRow;
  warehouseId: number;
  locationOptions: LocationOption[];
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    setError(null);
    const formData = new FormData();
    formData.append("warehouseId", String(warehouseId));
    formData.append("lpnId", pallet.lpnId);

    startTransition(async () => {
      const res = await deletePallet(formData);
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
                Edit Pallet
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-red-600"
              disabled={isPending}
              onSelect={handleDelete}
            >
              Delete Pallet
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <EditPalletDialog
        pallet={pallet}
        warehouseId={warehouseId}
        locationOptions={locationOptions}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  );
}
