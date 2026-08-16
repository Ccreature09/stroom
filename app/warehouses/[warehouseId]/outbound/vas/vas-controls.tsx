"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  assignVasTask,
  cancelVasTask,
  raiseVasTask,
  startVasTask,
} from "./actions";

export type EmployeeOption = {
  employeeId: number;
  firstName: string | null;
  lastName: string | null;
};
export type EligibleOrder = { soId: number; soNumber: string };

const selectClassName =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const smallSelect =
  "rounded-lg border border-input bg-transparent px-2 py-1 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function employeeLabel(e: EmployeeOption) {
  return [e.firstName, e.lastName].filter(Boolean).join(" ") || `#${e.employeeId}`;
}

/**
 * Raise VAS on an order by hand -- the "customer rang up and asked for a gift
 * box" case no standing rule will ever predict. Leaving the instructions
 * empty falls back to whatever rules match the order.
 */
export function RaiseVasDialog({
  warehouseId,
  eligibleOrders,
  employeeOptions,
  disabled,
}: {
  warehouseId: number;
  eligibleOrders: EligibleOrder[];
  employeeOptions: EmployeeOption[];
  disabled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    formData.append("warehouseId", String(warehouseId));

    startTransition(async () => {
      const res = await raiseVasTask(formData);
      if (res?.success) {
        setOpen(false);
        router.refresh();
      } else {
        setError(res?.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          className="bg-teal-700 hover:bg-teal-800"
          disabled={disabled || eligibleOrders.length === 0}
        >
          <Sparkles className="mr-2 h-4 w-4" /> Raise VAS
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Raise Value-Added Work</DialogTitle>
            <DialogDescription>
              For a picked order that needs something doing to it before it
              ships.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="vas-order">
                Order <span className="text-destructive">*</span>
              </Label>
              <select id="vas-order" name="soId" required className={selectClassName}>
                <option value="">Select an order...</option>
                {eligibleOrders.map((o) => (
                  <option key={o.soId} value={o.soId}>
                    {o.soNumber}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="vas-instructions">Instructions</Label>
              <Textarea
                id="vas-instructions"
                name="instructions"
                rows={5}
                placeholder={"Gift wrap in green paper\nInclude handwritten card"}
              />
              <p className="text-[11px] text-muted-foreground">
                One per line. Leave empty to use whatever standing rules match
                this order.
              </p>
            </div>

            {employeeOptions.length > 0 ? (
              <div className="space-y-2">
                <Label htmlFor="vas-assignee">Assign to (optional)</Label>
                <select id="vas-assignee" name="assignedEmployeeId" className={selectClassName}>
                  <option value="">Leave unassigned</option>
                  {employeeOptions.map((e) => (
                    <option key={e.employeeId} value={e.employeeId}>
                      {employeeLabel(e)}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

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
              {isPending ? "Raising..." : "Raise Task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function VasTaskActions({
  warehouseId,
  taskId,
  statusCode,
  canPack,
  canAssign,
  employeeOptions,
}: {
  warehouseId: number;
  taskId: string;
  statusCode: string;
  canPack: boolean;
  canAssign: boolean;
  employeeOptions: EmployeeOption[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [assignOpen, setAssignOpen] = useState(false);
  const [assigneeId, setAssigneeId] = useState("");

  function run(action: (fd: FormData) => Promise<{ error?: string }>) {
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
      const res = await assignVasTask(formData);
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
              className={`${smallSelect} h-7 w-32`}
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
        {statusCode === "PENDING" && canPack ? (
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => run(startVasTask)}
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
            onClick={() => run(cancelVasTask)}
            className="h-7 text-xs text-destructive hover:text-destructive"
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}
