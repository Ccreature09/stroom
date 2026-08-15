"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  assignPutawayTask,
  completePutawayTask,
  startPutawayTask,
} from "../../../inbound/putaway/actions";

type LocationOption = { locationId: number; locationCode: string };

const selectClassName =
  "w-full rounded-lg border border-input bg-transparent px-3 py-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function PutawayFloorControls({
  warehouseId,
  taskId,
  statusCode,
  assignedEmployeeId,
  myEmployeeId,
  canModify,
  suggestedDestLocationId,
  destinationOptions,
}: {
  warehouseId: number;
  taskId: string;
  statusCode: string;
  assignedEmployeeId: number | null;
  myEmployeeId: number;
  canModify: boolean;
  suggestedDestLocationId: number;
  destinationOptions: LocationOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingDest, setConfirmingDest] = useState(false);
  const [destLocationId, setDestLocationId] = useState(String(suggestedDestLocationId));

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
    return <p className="text-sm font-medium text-emerald-700">This pallet has been put away.</p>;
  }
  if (statusCode === "CANCELLED") {
    return <p className="text-sm font-medium text-slate-500">This task was cancelled.</p>;
  }
  if (!canModify) return null;

  const isMine = assignedEmployeeId === myEmployeeId;

  if (!assignedEmployeeId) {
    return (
      <div className="space-y-3">
        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
        ) : null}
        <Button
          size="lg"
          disabled={isPending}
          onClick={() => run(assignPutawayTask, { assignedEmployeeId: String(myEmployeeId) })}
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
          onClick={() => run(startPutawayTask)}
          className="h-14 w-full bg-teal-700 text-base hover:bg-teal-800"
        >
          Start
        </Button>
      </div>
    );
  }

  // IN_PROGRESS: confirm wherever the pallet actually ended up before
  // completing -- the suggested bay being full and using the next one over
  // is normal, not an error, so this is a confirm step, not a formality.
  if (!confirmingDest) {
    return (
      <div className="space-y-3">
        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
        ) : null}
        <Button
          size="lg"
          disabled={isPending}
          onClick={() => setConfirmingDest(true)}
          className="h-14 w-full bg-teal-700 text-base hover:bg-teal-800"
        >
          Mark Put Away
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <Label htmlFor="floor-putaway-dest">Where did you actually put it?</Label>
      <select
        id="floor-putaway-dest"
        value={destLocationId}
        onChange={(e) => setDestLocationId(e.target.value)}
        className={selectClassName}
      >
        {destinationOptions.map((l) => (
          <option key={l.locationId} value={l.locationId}>
            {l.locationCode}
          </option>
        ))}
      </select>
      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
      ) : null}
      <div className="flex gap-2">
        <Button
          size="lg"
          variant="outline"
          disabled={isPending}
          onClick={() => setConfirmingDest(false)}
          className="h-14 flex-1 text-base"
        >
          Back
        </Button>
        <Button
          size="lg"
          disabled={isPending}
          onClick={() =>
            run(completePutawayTask, { actualDestLocationId: destLocationId })
          }
          className="h-14 flex-1 bg-teal-700 text-base hover:bg-teal-800"
        >
          Confirm
        </Button>
      </div>
    </div>
  );
}
