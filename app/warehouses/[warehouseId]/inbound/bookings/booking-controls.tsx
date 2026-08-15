"use client";

import { useState, useTransition } from "react";
import { CalendarPlus } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  assignBookingTask,
  cancelBookingTask,
  completeBookingTask,
  createBooking,
  startBookingTask,
} from "./actions";

import { DepartmentPicker, type DepartmentOption } from "../../task-routing";

export type LocationOption = { locationId: number; locationCode: string };
export type ItemOption = { itemId: number; sku: string; name: string };
export type EmployeeOption = {
  employeeId: number;
  firstName: string | null;
  lastName: string | null;
};

const selectClassName =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

function employeeLabel(e: EmployeeOption) {
  return [e.firstName, e.lastName].filter(Boolean).join(" ") || `#${e.employeeId}`;
}

export function CreateBookingDialog({
  warehouseId,
  locationOptions,
  itemOptions,
  employeeOptions,
  departmentOptions,
}: {
  warehouseId: number;
  locationOptions: LocationOption[];
  itemOptions: ItemOption[];
  employeeOptions: EmployeeOption[];
  departmentOptions: DepartmentOption[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [departmentIds, setDepartmentIds] = useState<number[]>([]);

  const blocked = locationOptions.length === 0 || itemOptions.length === 0;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    formData.append("warehouseId", String(warehouseId));

    startTransition(async () => {
      const res = await createBooking(formData);
      if (res?.success) setOpen(false);
      else setError(res?.error ?? "Something went wrong.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-teal-700 hover:bg-teal-800" disabled={blocked}>
          <CalendarPlus className="mr-2 h-4 w-4" /> New Booking
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Book a Dock Appointment</DialogTitle>
            <DialogDescription>
              Reserves a dock door for an expected inbound delivery.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="booking-dock">
                Dock Door / Location <span className="text-destructive">*</span>
              </Label>
              <select id="booking-dock" name="dockDoorLocationId" required className={selectClassName}>
                <option value="">Select a location...</option>
                {locationOptions.map((l) => (
                  <option key={l.locationId} value={l.locationId}>
                    {l.locationCode}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="booking-item">
                  Item <span className="text-destructive">*</span>
                </Label>
                <select id="booking-item" name="itemId" required className={selectClassName}>
                  <option value="">Select an item...</option>
                  {itemOptions.map((item) => (
                    <option key={item.itemId} value={item.itemId}>
                      {item.sku} — {item.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="booking-quantity">
                  Quantity <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="booking-quantity"
                  name="productQuantity"
                  type="number"
                  min={1}
                  step={1}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="booking-product-type">
                  Product Type <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="booking-product-type"
                  name="productType"
                  placeholder="e.g. Palletized, Loose carton"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="booking-pallet-height">
                  Pallet Height (cm) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="booking-pallet-height"
                  name="palletHeightCm"
                  type="number"
                  min={1}
                  step={1}
                  required
                />
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Traceability (optional)
              </span>
              <div className="mt-2 grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="booking-batch" className="text-[11px]">Batch</Label>
                  <Input id="booking-batch" name="batchNumber" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="booking-lot" className="text-[11px]">Lot</Label>
                  <Input id="booking-lot" name="lotNumber" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="booking-expiry" className="text-[11px]">Expiry</Label>
                  <Input id="booking-expiry" name="expiryDate" type="date" />
                </div>
              </div>
            </div>

            {employeeOptions.length > 0 ? (
              <div className="space-y-2">
                <Label htmlFor="booking-assignee">Assign To (optional)</Label>
                <select id="booking-assignee" name="assignedEmployeeId" className={selectClassName}>
                  <option value="">Leave unassigned</option>
                  {employeeOptions.map((e) => (
                    <option key={e.employeeId} value={e.employeeId}>
                      {employeeLabel(e)}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <DepartmentPicker
              options={departmentOptions}
              value={departmentIds}
              onChange={setDepartmentIds}
            />

            {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending} className="bg-teal-700 hover:bg-teal-800">
              {isPending ? "Booking..." : "Book Appointment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BookingTaskActions({
  warehouseId,
  taskId,
  statusCode,
  canBook,
  canAssign,
  employeeOptions,
}: {
  warehouseId: number;
  taskId: string;
  statusCode: string;
  canBook: boolean;
  canAssign: boolean;
  employeeOptions: EmployeeOption[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [assignOpen, setAssignOpen] = useState(false);
  const [assigneeId, setAssigneeId] = useState("");

  function run(action: (formData: FormData) => Promise<{ error?: string }>) {
    setError(null);
    const formData = new FormData();
    formData.append("warehouseId", String(warehouseId));
    formData.append("taskId", taskId);
    startTransition(async () => {
      const res = await action(formData);
      if (res?.error) setError(res.error);
    });
  }

  function handleAssign() {
    if (!assigneeId) return;
    setError(null);
    const formData = new FormData();
    formData.append("warehouseId", String(warehouseId));
    formData.append("taskId", taskId);
    formData.append("assignedEmployeeId", assigneeId);
    startTransition(async () => {
      const res = await assignBookingTask(formData);
      if (res?.error) setError(res.error);
      else setAssignOpen(false);
    });
  }

  if (statusCode === "COMPLETED" || statusCode === "CANCELLED") {
    return <span className="text-xs text-slate-400">-</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {error ? <span className="text-xs font-medium text-red-600">{error}</span> : null}
      <div className="flex items-center justify-end gap-1.5">
        {canAssign && employeeOptions.length > 0 && !assignOpen ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => setAssignOpen(true)}
          >
            Assign
          </Button>
        ) : null}
        {assignOpen ? (
          <>
            <select
              className={`${selectClassName} h-7 w-36 text-xs`}
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">Select...</option>
              {employeeOptions.map((e) => (
                <option key={e.employeeId} value={e.employeeId}>
                  {employeeLabel(e)}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={isPending || !assigneeId}
              onClick={handleAssign}
              className="h-7 bg-teal-700 text-xs hover:bg-teal-800"
            >
              Set
            </Button>
          </>
        ) : null}
        {statusCode === "PENDING" && canBook ? (
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => run(startBookingTask)}
            className="h-7 bg-teal-700 text-xs hover:bg-teal-800"
          >
            Start
          </Button>
        ) : null}
        {statusCode === "IN_PROGRESS" && canBook ? (
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => run(completeBookingTask)}
            className="h-7 bg-teal-700 text-xs hover:bg-teal-800"
          >
            Complete
          </Button>
        ) : null}
        {canAssign ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() => run(cancelBookingTask)}
            className="h-7 text-xs text-destructive hover:text-destructive"
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}
