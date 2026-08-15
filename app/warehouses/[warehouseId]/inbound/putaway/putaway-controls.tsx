"use client";

import { useMemo, useState, useTransition } from "react";
import { PackagePlus } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import {
  assignPutawayTask,
  cancelPutawayTask,
  completePutawayTask,
  createPutawayTask,
  startPutawayTask,
} from "./actions";

import { DepartmentPicker, type DepartmentOption } from "../../task-routing";

export type PalletOption = {
  lpnId: string;
  currentLocationId: number | null;
  currentLocationCode: string | null;
};
export type LocationOption = { locationId: number; locationCode: string };
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

export function CreatePutawayDialog({
  warehouseId,
  palletOptions,
  locationOptions,
  employeeOptions,
  departmentOptions,
}: {
  warehouseId: number;
  palletOptions: PalletOption[];
  locationOptions: LocationOption[];
  employeeOptions: EmployeeOption[];
  departmentOptions: DepartmentOption[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [departmentIds, setDepartmentIds] = useState<number[]>([]);
  const [lpnId, setLpnId] = useState("");
  const [sourceLocationId, setSourceLocationId] = useState("");

  const palletByLpn = useMemo(
    () => new Map(palletOptions.map((p) => [p.lpnId, p])),
    [palletOptions],
  );

  function handlePalletChange(value: string) {
    setLpnId(value);
    // Prefills the source with wherever the pallet is now -- the common
    // case is putting away exactly where it was staged, and this saves the
    // second lookup for that case without hiding the field entirely.
    const pallet = palletByLpn.get(value);
    if (pallet?.currentLocationId) {
      setSourceLocationId(String(pallet.currentLocationId));
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    formData.append("warehouseId", String(warehouseId));
    formData.append("lpnId", lpnId);
    formData.append("sourceLocationId", sourceLocationId);

    startTransition(async () => {
      const res = await createPutawayTask(formData);
      if (res?.success) {
        setOpen(false);
        setLpnId("");
        setSourceLocationId("");
      } else {
        setError(res?.error ?? "Something went wrong.");
      }
    });
  }

  const blocked = palletOptions.length === 0 || locationOptions.length < 2;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-teal-700 hover:bg-teal-800" disabled={blocked}>
          <PackagePlus className="mr-2 h-4 w-4" /> New Putaway Task
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create a Putaway Task</DialogTitle>
            <DialogDescription>
              Directs a pallet from where it is now to a storage location.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="putaway-lpn">
                Pallet (LPN) <span className="text-destructive">*</span>
              </Label>
              <select
                id="putaway-lpn"
                required
                value={lpnId}
                onChange={(e) => handlePalletChange(e.target.value)}
                className={selectClassName}
              >
                <option value="">Select a pallet...</option>
                {palletOptions.map((p) => (
                  <option key={p.lpnId} value={p.lpnId}>
                    {p.lpnId}
                    {p.currentLocationCode ? ` — at ${p.currentLocationCode}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="putaway-source">
                Source Location <span className="text-destructive">*</span>
              </Label>
              <select
                id="putaway-source"
                required
                value={sourceLocationId}
                onChange={(e) => setSourceLocationId(e.target.value)}
                className={selectClassName}
              >
                <option value="">Select a location...</option>
                {locationOptions.map((l) => (
                  <option key={l.locationId} value={l.locationId}>
                    {l.locationCode}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="putaway-dest">
                Suggested Destination <span className="text-destructive">*</span>
              </Label>
              <select id="putaway-dest" name="suggestedDestLocationId" required className={selectClassName}>
                <option value="">Select a location...</option>
                {locationOptions
                  .filter((l) => String(l.locationId) !== sourceLocationId)
                  .map((l) => (
                    <option key={l.locationId} value={l.locationId}>
                      {l.locationCode}
                    </option>
                  ))}
              </select>
            </div>

            {employeeOptions.length > 0 ? (
              <div className="space-y-2">
                <Label htmlFor="putaway-assignee">Assign To (optional)</Label>
                <select id="putaway-assignee" name="assignedEmployeeId" className={selectClassName}>
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

function CompletePutawayDialog({
  warehouseId,
  taskId,
  suggestedDestLocationId,
  locationOptions,
  open,
  onOpenChange,
}: {
  warehouseId: number;
  taskId: string;
  suggestedDestLocationId: number;
  locationOptions: LocationOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    formData.append("warehouseId", String(warehouseId));
    formData.append("taskId", taskId);

    startTransition(async () => {
      const res = await completePutawayTask(formData);
      if (res?.success) onOpenChange(false);
      else setError(res?.error ?? "Something went wrong.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Complete Putaway</DialogTitle>
            <DialogDescription>
              Confirm where the pallet actually ended up -- it may differ
              from the suggested bay if that one turned out to be full.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor={`putaway-actual-${taskId}`}>Actual Destination</Label>
              <select
                id={`putaway-actual-${taskId}`}
                name="actualDestLocationId"
                defaultValue={suggestedDestLocationId}
                className={selectClassName}
              >
                {locationOptions.map((l) => (
                  <option key={l.locationId} value={l.locationId}>
                    {l.locationCode}
                  </option>
                ))}
              </select>
            </div>

            {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending} className="bg-teal-700 hover:bg-teal-800">
              {isPending ? "Completing..." : "Complete"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PutawayTaskActions({
  warehouseId,
  taskId,
  statusCode,
  suggestedDestLocationId,
  canModify,
  canAssign,
  locationOptions,
  employeeOptions,
}: {
  warehouseId: number;
  taskId: string;
  statusCode: string;
  suggestedDestLocationId: number;
  canModify: boolean;
  canAssign: boolean;
  locationOptions: LocationOption[];
  employeeOptions: EmployeeOption[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [assignOpen, setAssignOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
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
      const res = await assignPutawayTask(formData);
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
        {statusCode === "PENDING" && canModify ? (
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => run(startPutawayTask)}
            className="h-7 bg-teal-700 text-xs hover:bg-teal-800"
          >
            Start
          </Button>
        ) : null}
        {statusCode === "IN_PROGRESS" && canModify ? (
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => setCompleteOpen(true)}
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
            onClick={() => run(cancelPutawayTask)}
            className="h-7 text-xs text-destructive hover:text-destructive"
          >
            Cancel
          </Button>
        ) : null}
      </div>

      <CompletePutawayDialog
        warehouseId={warehouseId}
        taskId={taskId}
        suggestedDestLocationId={suggestedDestLocationId}
        locationOptions={locationOptions}
        open={completeOpen}
        onOpenChange={setCompleteOpen}
      />
    </div>
  );
}
