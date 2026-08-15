"use client";

import { useState, useTransition } from "react";
import { TruckIcon } from "lucide-react";
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
  assignUnloadingTask,
  cancelUnloadingTask,
  completeUnloadingTask,
  createUnloadingTask,
  startUnloadingTask,
} from "./actions";

import { DepartmentPicker, type DepartmentOption } from "../../task-routing";

export type LocationOption = { locationId: number; locationCode: string };
export type CarrierOption = { carrierId: number; name: string };
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

export function CreateUnloadingDialog({
  warehouseId,
  locationOptions,
  carrierOptions,
  employeeOptions,
  departmentOptions,
}: {
  warehouseId: number;
  locationOptions: LocationOption[];
  carrierOptions: CarrierOption[];
  employeeOptions: EmployeeOption[];
  departmentOptions: DepartmentOption[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [departmentIds, setDepartmentIds] = useState<number[]>([]);

  const blocked = locationOptions.length === 0;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    formData.append("warehouseId", String(warehouseId));

    startTransition(async () => {
      const res = await createUnloadingTask(formData);
      if (res?.success) setOpen(false);
      else setError(res?.error ?? "Something went wrong.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-teal-700 hover:bg-teal-800" disabled={blocked}>
          <TruckIcon className="mr-2 h-4 w-4" /> New Unloading Task
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Log an Arriving Trailer</DialogTitle>
            <DialogDescription>
              Creates an unloading task for a trailer at the dock.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="unload-dock">
                Dock Door / Location <span className="text-destructive">*</span>
              </Label>
              <select id="unload-dock" name="dockDoorLocationId" required className={selectClassName}>
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
                <Label htmlFor="unload-trailer">Trailer Number</Label>
                <Input id="unload-trailer" name="trailerNumber" placeholder="e.g. TRL-4821" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="unload-pallets">
                  Expected Pallets <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="unload-pallets"
                  name="expectedPallets"
                  type="number"
                  min={1}
                  step={1}
                  required
                />
              </div>
            </div>

            {carrierOptions.length > 0 ? (
              <div className="space-y-2">
                <Label htmlFor="unload-carrier">Carrier</Label>
                <select id="unload-carrier" name="carrierId" className={selectClassName}>
                  <option value="">Unknown / not set</option>
                  {carrierOptions.map((c) => (
                    <option key={c.carrierId} value={c.carrierId}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {employeeOptions.length > 0 ? (
              <div className="space-y-2">
                <Label htmlFor="unload-assignee">Assign To (optional)</Label>
                <select id="unload-assignee" name="assignedEmployeeId" className={selectClassName}>
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
              {isPending ? "Creating..." : "Create Task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function UnloadingTaskActions({
  warehouseId,
  taskId,
  statusCode,
  canUnload,
  canAssign,
  employeeOptions,
}: {
  warehouseId: number;
  taskId: string;
  statusCode: string;
  canUnload: boolean;
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
      const res = await assignUnloadingTask(formData);
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
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAssignOpen(true)}>
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
        {statusCode === "PENDING" && canUnload ? (
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => run(startUnloadingTask)}
            className="h-7 bg-teal-700 text-xs hover:bg-teal-800"
          >
            Start
          </Button>
        ) : null}
        {statusCode === "IN_PROGRESS" && canUnload ? (
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => run(completeUnloadingTask)}
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
            onClick={() => run(cancelUnloadingTask)}
            className="h-7 text-xs text-destructive hover:text-destructive"
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}
