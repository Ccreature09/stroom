"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  assignUnloadingTask,
  completeUnloadingTask,
  startUnloadingTask,
} from "../../../inbound/unloading/actions";

export function UnloadingFloorControls({
  warehouseId,
  taskId,
  statusCode,
  assignedEmployeeId,
  myEmployeeId,
  canUnload,
  expectedPallets,
}: {
  warehouseId: number;
  taskId: string;
  statusCode: string;
  assignedEmployeeId: number | null;
  myEmployeeId: number;
  canUnload: boolean;
  expectedPallets: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingCount, setConfirmingCount] = useState(false);
  const [actualPallets, setActualPallets] = useState(String(expectedPallets));
  const [acknowledgedMismatch, setAcknowledgedMismatch] = useState(false);

  function run(action: (formData: FormData) => Promise<{ error?: string }>, extra?: Record<string, string>) {
    setError(null);
    const formData = new FormData();
    formData.append("warehouseId", String(warehouseId));
    formData.append("taskId", taskId);
    for (const [k, v] of Object.entries(extra ?? {})) formData.append(k, v);
    startTransition(async () => {
      const res = await action(formData);
      if (res?.error) setError(res.error);
      else router.refresh();
    });
  }

  if (statusCode === "COMPLETED") {
    return <p className="text-sm font-medium text-emerald-700">This truck has been unloaded.</p>;
  }
  if (statusCode === "CANCELLED") {
    return <p className="text-sm font-medium text-slate-500">This task was cancelled.</p>;
  }
  if (!canUnload) return null;

  const isMine = assignedEmployeeId === myEmployeeId;
  const parsedActual = Number(actualPallets);
  const validCount = Number.isInteger(parsedActual) && parsedActual >= 0;
  const mismatch = validCount && parsedActual !== expectedPallets;

  if (!assignedEmployeeId) {
    return (
      <div className="space-y-3">
        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
        ) : null}
        <Button
          size="lg"
          disabled={isPending}
          onClick={() => run(assignUnloadingTask, { assignedEmployeeId: String(myEmployeeId) })}
          className="h-14 w-full bg-teal-700 text-base hover:bg-teal-800"
        >
          Claim This Task
        </Button>
      </div>
    );
  }

  if (!isMine) {
    return <p className="text-sm text-slate-500">This task is assigned to someone else.</p>;
  }

  if (statusCode === "PENDING") {
    return (
      <div className="space-y-3">
        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
        ) : null}
        <Button
          size="lg"
          disabled={isPending}
          onClick={() => run(startUnloadingTask)}
          className="h-14 w-full bg-teal-700 text-base hover:bg-teal-800"
        >
          Start Unloading
        </Button>
      </div>
    );
  }

  // IN_PROGRESS: count the pallets that actually came off the truck before
  // completing -- a bare "mark complete" button trusts nothing. The count
  // itself has nowhere to be stored yet (unloading_tasks has no column for
  // it), so this is a verification gate, not a permanent record: it forces
  // a real count and a deliberate acknowledgement of any mismatch instead
  // of letting a wrong number vanish silently on a blind click.
  if (!confirmingCount) {
    return (
      <div className="space-y-3">
        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
        ) : null}
        <Button
          size="lg"
          disabled={isPending}
          onClick={() => setConfirmingCount(true)}
          className="h-14 w-full bg-teal-700 text-base hover:bg-teal-800"
        >
          Count Pallets &amp; Complete
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="space-y-1">
        <Label htmlFor="actual-pallets">
          How many pallets came off this trailer? (expected {expectedPallets})
        </Label>
        <Input
          id="actual-pallets"
          type="number"
          min={0}
          step={1}
          autoFocus
          value={actualPallets}
          onChange={(e) => {
            setActualPallets(e.target.value);
            setAcknowledgedMismatch(false);
          }}
          className="h-14 text-lg"
        />
      </div>

      {mismatch ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="text-sm text-amber-800">
            <p className="font-semibold">
              That&apos;s {parsedActual > expectedPallets ? "more" : "fewer"} than expected.
            </p>
            <label className="mt-1.5 flex items-center gap-2 font-normal">
              <input
                type="checkbox"
                checked={acknowledgedMismatch}
                onChange={(e) => setAcknowledgedMismatch(e.target.checked)}
                className="h-4 w-4 rounded border-amber-400"
              />
              Yes, {parsedActual} is correct -- complete anyway
            </label>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
      ) : null}

      <div className="flex gap-2">
        <Button
          size="lg"
          variant="outline"
          disabled={isPending}
          onClick={() => setConfirmingCount(false)}
          className="h-14 flex-1 text-base"
        >
          Back
        </Button>
        <Button
          size="lg"
          disabled={isPending || !validCount || (mismatch && !acknowledgedMismatch)}
          onClick={() => run(completeUnloadingTask)}
          className="h-14 flex-1 bg-teal-700 text-base hover:bg-teal-800"
        >
          Confirm Received
        </Button>
      </div>
    </div>
  );
}
