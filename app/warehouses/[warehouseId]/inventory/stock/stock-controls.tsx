"use client";

import { useState, useTransition } from "react";
import { MoreHorizontal, PackagePlus } from "lucide-react";
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
import { adjustStock, deleteStockLine, moveStock, receiveStock } from "./actions";

export type ItemOption = {
  itemId: number;
  sku: string;
  name: string;
};

export type LocationOption = {
  locationId: number;
  locationCode: string;
};

export type StatusOption = {
  statusId: number;
  name: string;
};

export type StockRow = {
  inventoryId: number;
  quantity: number | null;
  batchNumber: string | null;
  lotNumber: string | null;
  expiryDate: string | null;
  statusId: number | null;
  statusName: string | null;
  locationId: number | null;
  locationCode: string | null;
  itemId: number | null;
  sku: string | null;
  itemName: string | null;
};

const selectClassName =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

function NativeSelect({
  id,
  name,
  required,
  defaultValue,
  children,
}: {
  id: string;
  name: string;
  required?: boolean;
  defaultValue?: string | number;
  children: React.ReactNode;
}) {
  return (
    <select
      id={id}
      name={name}
      required={required}
      defaultValue={defaultValue}
      className={selectClassName}
    >
      {children}
    </select>
  );
}

export function ReceiveStockDialog({
  warehouseId,
  itemOptions,
  locationOptions,
  statusOptions,
}: {
  warehouseId: number;
  itemOptions: ItemOption[];
  locationOptions: LocationOption[];
  statusOptions: StatusOption[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const blocked =
    itemOptions.length === 0 ||
    locationOptions.length === 0 ||
    statusOptions.length === 0;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    formData.append("warehouseId", String(warehouseId));

    startTransition(async () => {
      const res = await receiveStock(formData);
      if (res?.success) setOpen(false);
      else setError(res?.error ?? "Something went wrong.");
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-teal-700 hover:bg-teal-800" disabled={blocked}>
          <PackagePlus className="mr-2 h-4 w-4" /> Receive Stock
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Receive Stock</DialogTitle>
            <DialogDescription>
              Book units into a location. This records a receipt movement.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="receive-itemId">
                Item <span className="text-destructive">*</span>
              </Label>
              <NativeSelect id="receive-itemId" name="itemId" required>
                <option value="">Select an item...</option>
                {itemOptions.map((item) => (
                  <option key={item.itemId} value={item.itemId}>
                    {item.sku} — {item.name}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="receive-locationId">
                  Location <span className="text-destructive">*</span>
                </Label>
                <NativeSelect
                  id="receive-locationId"
                  name="locationId"
                  required
                >
                  <option value="">Select a location...</option>
                  {locationOptions.map((location) => (
                    <option
                      key={location.locationId}
                      value={location.locationId}
                    >
                      {location.locationCode}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="receive-quantity">
                  Quantity <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="receive-quantity"
                  name="quantity"
                  type="number"
                  min={1}
                  step={1}
                  required
                  placeholder="e.g. 100"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="receive-statusId">
                Inventory Status <span className="text-destructive">*</span>
              </Label>
              <NativeSelect id="receive-statusId" name="statusId" required>
                <option value="">Select a status...</option>
                {statusOptions.map((status) => (
                  <option key={status.statusId} value={status.statusId}>
                    {status.name}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="border-t border-border pt-3">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Traceability (optional)
              </span>
              <div className="mt-2 grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="receive-batchNumber" className="text-[11px]">
                    Batch
                  </Label>
                  <Input id="receive-batchNumber" name="batchNumber" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="receive-lotNumber" className="text-[11px]">
                    Lot
                  </Label>
                  <Input id="receive-lotNumber" name="lotNumber" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="receive-expiryDate" className="text-[11px]">
                    Expiry
                  </Label>
                  <Input
                    id="receive-expiryDate"
                    name="expiryDate"
                    type="date"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="receive-reasonCode">Reason / Reference</Label>
              <Input
                id="receive-reasonCode"
                name="reasonCode"
                placeholder="e.g. Manual entry, opening balance"
              />
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
              {isPending ? "Saving..." : "Receive Stock"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AdjustStockDialog({
  row,
  warehouseId,
  statusOptions,
  open,
  onOpenChange,
}: {
  row: StockRow;
  warehouseId: number;
  statusOptions: StatusOption[];
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
    formData.append("inventoryId", String(row.inventoryId));

    startTransition(async () => {
      const res = await adjustStock(formData);
      if (res?.success) onOpenChange(false);
      else setError(res?.error ?? "Something went wrong.");
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Adjust Stock</DialogTitle>
            <DialogDescription>
              {row.sku} at {row.locationCode} — currently {row.quantity ?? 0}{" "}
              units.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor={`adjust-quantity-${row.inventoryId}`}>
                New Quantity <span className="text-destructive">*</span>
              </Label>
              <Input
                id={`adjust-quantity-${row.inventoryId}`}
                name="quantity"
                type="number"
                min={0}
                step={1}
                required
                defaultValue={row.quantity ?? 0}
              />
              <p className="text-[11px] text-muted-foreground">
                The difference is recorded as an adjustment movement.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`adjust-statusId-${row.inventoryId}`}>
                Inventory Status <span className="text-destructive">*</span>
              </Label>
              <NativeSelect
                id={`adjust-statusId-${row.inventoryId}`}
                name="statusId"
                required
                defaultValue={row.statusId ?? ""}
              >
                <option value="">Select a status...</option>
                {statusOptions.map((status) => (
                  <option key={status.statusId} value={status.statusId}>
                    {status.name}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`adjust-reasonCode-${row.inventoryId}`}>
                Reason
              </Label>
              <Input
                id={`adjust-reasonCode-${row.inventoryId}`}
                name="reasonCode"
                placeholder="e.g. Cycle count correction, damage"
              />
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
              {isPending ? "Saving..." : "Save Adjustment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MoveStockDialog({
  row,
  warehouseId,
  locationOptions,
  open,
  onOpenChange,
}: {
  row: StockRow;
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
    formData.append("inventoryId", String(row.inventoryId));

    startTransition(async () => {
      const res = await moveStock(formData);
      if (res?.success) onOpenChange(false);
      else setError(res?.error ?? "Something went wrong.");
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Move Stock</DialogTitle>
            <DialogDescription>
              {row.sku} from {row.locationCode} — {row.quantity ?? 0} units
              available.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor={`move-destination-${row.inventoryId}`}>
                Destination Location{" "}
                <span className="text-destructive">*</span>
              </Label>
              <NativeSelect
                id={`move-destination-${row.inventoryId}`}
                name="destinationLocationId"
                required
              >
                <option value="">Select a location...</option>
                {locationOptions
                  .filter((location) => location.locationId !== row.locationId)
                  .map((location) => (
                    <option
                      key={location.locationId}
                      value={location.locationId}
                    >
                      {location.locationCode}
                    </option>
                  ))}
              </NativeSelect>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`move-quantity-${row.inventoryId}`}>
                Quantity <span className="text-destructive">*</span>
              </Label>
              <Input
                id={`move-quantity-${row.inventoryId}`}
                name="quantity"
                type="number"
                min={1}
                max={row.quantity ?? 1}
                step={1}
                required
                defaultValue={row.quantity ?? 1}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`move-reasonCode-${row.inventoryId}`}>
                Reason
              </Label>
              <Input
                id={`move-reasonCode-${row.inventoryId}`}
                name="reasonCode"
                placeholder="e.g. Consolidation, replenishment"
              />
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
              {isPending ? "Moving..." : "Move Stock"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function StockRowActions({
  row,
  warehouseId,
  locationOptions,
  statusOptions,
}: {
  row: StockRow;
  warehouseId: number;
  locationOptions: LocationOption[];
  statusOptions: StatusOption[];
}) {
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    setError(null);
    const formData = new FormData();
    formData.append("warehouseId", String(warehouseId));
    formData.append("inventoryId", String(row.inventoryId));

    startTransition(async () => {
      const res = await deleteStockLine(formData);
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
              <DropdownMenuItem onSelect={() => setAdjustOpen(true)}>
                Adjust Quantity
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setMoveOpen(true)}>
                Move Stock
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-red-600"
              disabled={isPending}
              onSelect={handleDelete}
            >
              Write Off Line
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AdjustStockDialog
        row={row}
        warehouseId={warehouseId}
        statusOptions={statusOptions}
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
      />
      <MoveStockDialog
        row={row}
        warehouseId={warehouseId}
        locationOptions={locationOptions}
        open={moveOpen}
        onOpenChange={setMoveOpen}
      />
    </>
  );
}
