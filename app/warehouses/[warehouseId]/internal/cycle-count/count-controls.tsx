"use client";

import { useState, useTransition } from "react";
import { ClipboardPlus } from "lucide-react";
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
  assignCountTask,
  cancelCountTask,
  generateCountsForLocation,
  startCountTask,
} from "./actions";

import { DepartmentPicker, type DepartmentOption } from "../../task-routing";

export type EmployeeOption = {
  employeeId: number;
  firstName: string | null;
  lastName: string | null;
};
export type LocationOption = { locationId: number; locationCode: string };

const selectClassName =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const smallSelectClassName =
  "rounded-lg border border-input bg-transparent px-2 py-1 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function employeeLabel(e: EmployeeOption) {
  return [e.firstName, e.lastName].filter(Boolean).join(" ") || `#${e.employeeId}`;
}

export function GenerateCountsForm({
  warehouseId,
  locationOptions,
  employeeOptions,
  departmentOptions,
}: {
  warehouseId: number;
  locationOptions: LocationOption[];
  employeeOptions: EmployeeOption[];
  departmentOptions: DepartmentOption[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [departmentIds, setDepartmentIds] = useState<number[]>([]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNote(null);
    const formData = new FormData(e.currentTarget);
    formData.append("warehouseId", String(warehouseId));

    startTransition(async () => {
      const res = await generateCountsForLocation(formData);
      if (res?.success) {
        setNote(`Raised ${res.created} count${res.created === 1 ? "" : "s"}.`);
        setOpen(false);
      } else {
        setError(res?.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {note ? <span className="text-xs font-medium text-emerald-700">{note}</span> : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            className="bg-teal-700 hover:bg-teal-800"
            disabled={locationOptions.length === 0}
          >
            <ClipboardPlus className="mr-2 h-4 w-4" /> Count a Location
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[480px]">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Count a Location</DialogTitle>
              <DialogDescription>
                Raises one count per stock line at that location, freezing
                what the system currently believes is there.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="count-location">
                  Location <span className="text-destructive">*</span>
                </Label>
                <select id="count-location" name="locationId" required className={selectClassName}>
                  <option value="">Select a location...</option>
                  {locationOptions.map((l) => (
                    <option key={l.locationId} value={l.locationId}>
                      {l.locationCode}
                    </option>
                  ))}
                </select>
              </div>

              {employeeOptions.length > 0 ? (
                <div className="space-y-2">
                  <Label htmlFor="count-assignee">Assign to (optional)</Label>
                  <select id="count-assignee" name="assignedEmployeeId" className={selectClassName}>
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
              <Button
                type="submit"
                disabled={isPending}
                className="bg-teal-700 hover:bg-teal-800"
              >
                {isPending ? "Raising..." : "Raise Counts"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function CountTaskActions({
  warehouseId,
  taskId,
  statusCode,
  canCount,
  canAssign,
  employeeOptions,
}: {
  warehouseId: number;
  taskId: string;
  statusCode: string;
  canCount: boolean;
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
      const res = await assignCountTask(formData);
      if (res?.error) setError(res.error);
      else setAssignOpen(false);
    });
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
              className={`${smallSelectClassName} h-7 w-32`}
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
        {statusCode === "PENDING" && canCount ? (
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => run(startCountTask)}
            className="h-7 bg-teal-700 text-xs hover:bg-teal-800"
          >
            Start
          </Button>
        ) : null}
        {canAssign ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() => run(cancelCountTask)}
            className="h-7 text-xs text-destructive hover:text-destructive"
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}
