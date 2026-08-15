"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  assignBookingTask,
  completeBookingTask,
  startBookingTask,
} from "../../../inbound/bookings/actions";

export function BookingFloorControls({
  warehouseId,
  taskId,
  statusCode,
  assignedEmployeeId,
  myEmployeeId,
  canBook,
}: {
  warehouseId: number;
  taskId: string;
  statusCode: string;
  assignedEmployeeId: number | null;
  myEmployeeId: number;
  canBook: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
    return <p className="text-sm font-medium text-emerald-700">This appointment is complete.</p>;
  }
  if (statusCode === "CANCELLED") {
    return <p className="text-sm font-medium text-slate-500">This appointment was cancelled.</p>;
  }
  if (!canBook) {
    return null;
  }

  const isMine = assignedEmployeeId === myEmployeeId;

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
      ) : null}

      {!assignedEmployeeId ? (
        <Button
          size="lg"
          disabled={isPending}
          onClick={() => run(assignBookingTask, { assignedEmployeeId: String(myEmployeeId) })}
          className="h-14 w-full bg-teal-700 text-base hover:bg-teal-800"
        >
          Claim This Task
        </Button>
      ) : !isMine ? (
        <p className="text-sm text-slate-500">This task is assigned to someone else.</p>
      ) : statusCode === "PENDING" ? (
        <Button
          size="lg"
          disabled={isPending}
          onClick={() => run(startBookingTask)}
          className="h-14 w-full bg-teal-700 text-base hover:bg-teal-800"
        >
          Start
        </Button>
      ) : (
        <Button
          size="lg"
          disabled={isPending}
          onClick={() => run(completeBookingTask)}
          className="h-14 w-full bg-teal-700 text-base hover:bg-teal-800"
        >
          Mark Complete
        </Button>
      )}
    </div>
  );
}
