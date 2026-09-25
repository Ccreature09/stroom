"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  assignPickingTask,
  cancelPickingTask,
  completePickingTask,
  startPickingTask,
} from "./actions";

export type EmployeeOption = {
  employeeId: number;
  firstName: string | null;
  lastName: string | null;
};

const selectClassName =
  "rounded-lg border border-input bg-transparent px-2 py-1 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function employeeLabel(e: EmployeeOption) {
  return [e.firstName, e.lastName].filter(Boolean).join(" ") || `#${e.employeeId}`;
}

export function PickingTaskActions({
  warehouseId,
  taskId,
  statusCode,
  canPick,
  canAssign,
  employeeOptions,
}: {
  warehouseId: number;
  taskId: string;
  statusCode: string;
  canPick: boolean;
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
      const res = await assignPickingTask(formData);
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
              className={`${selectClassName} h-7 w-32`}
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
        {statusCode === "PENDING" && canPick ? (
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => run(startPickingTask)}
            className="h-7 bg-teal-700 text-xs hover:bg-teal-800"
          >
            Start
          </Button>
        ) : null}
        {statusCode === "IN_PROGRESS" && canPick ? (
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => run(completePickingTask)}
            className="h-7 bg-teal-700 text-xs hover:bg-teal-800"
            title="Completes at the full planned quantity -- use the floor screen to record a short pick"
          >
            Picked
          </Button>
        ) : null}
        {canAssign ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() => run(cancelPickingTask)}
            className="h-7 text-xs text-destructive hover:text-destructive"
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}
