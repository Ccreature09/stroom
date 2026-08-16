"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { checklistProgress } from "@/lib/vas/rules";
import {
  assignVasTask,
  completeVasTask,
  startVasTask,
  toggleVasStep,
} from "../../../outbound/vas/actions";

export type ChecklistStep = {
  stepId: number;
  instruction: string;
  isDone: boolean;
  doneAt: string | null;
  doneBy: string | null;
};

/**
 * The packer's checklist.
 *
 * Each instruction is a big tap target with its own state -- no scanning
 * here, because "apply the customer's logo" is not something a barcode can
 * confirm. What the system can do is make sure every instruction was
 * consciously acknowledged, record who acknowledged it, and refuse to close
 * the task while any remain.
 */
export function VasChecklist({
  warehouseId,
  taskId,
  statusCode,
  assignedEmployeeId,
  myEmployeeId,
  canPack,
  soNumber,
  customerName,
  lpnId,
  notes,
  steps,
}: {
  warehouseId: number;
  taskId: string;
  statusCode: string;
  assignedEmployeeId: number | null;
  myEmployeeId: number;
  canPack: boolean;
  soNumber: string;
  customerName: string;
  lpnId: string | null;
  notes: string | null;
  steps: ChecklistStep[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pendingStep, setPendingStep] = useState<number | null>(null);

  const progress = checklistProgress(steps);

  function run(
    action: (fd: FormData) => Promise<{ error?: string }>,
    extra?: Record<string, string>,
  ) {
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

  function toggle(step: ChecklistStep) {
    setError(null);
    setPendingStep(step.stepId);
    const formData = new FormData();
    formData.append("warehouseId", String(warehouseId));
    formData.append("stepId", String(step.stepId));
    formData.append("isDone", String(!step.isDone));
    startTransition(async () => {
      const res = await toggleVasStep(formData);
      setPendingStep(null);
      if (res?.error) setError(res.error);
      else router.refresh();
    });
  }

  const card = (
    <div className="rounded-2xl border-2 border-teal-600 bg-teal-50 p-5">
      <span className="text-[11px] font-bold uppercase tracking-wider text-teal-700">
        Order
      </span>
      <div className="font-mono text-2xl font-bold text-slate-900">{soNumber}</div>
      <div className="mt-1 text-sm text-slate-600">{customerName}</div>
      {lpnId ? (
        <div className="mt-3 border-t border-teal-200 pt-3">
          <span className="text-[11px] font-bold uppercase tracking-wider text-teal-700">
            Pallet
          </span>
          <div className="font-mono text-lg font-bold text-slate-900">{lpnId}</div>
        </div>
      ) : null}
      {notes ? (
        <p className="mt-3 border-t border-teal-200 pt-3 text-sm text-slate-700">
          {notes}
        </p>
      ) : null}
    </div>
  );

  if (statusCode === "COMPLETED") {
    return (
      <div className="space-y-4">
        {card}
        <p className="text-sm font-medium text-emerald-700">
          This order is packed and ready to load.
        </p>
      </div>
    );
  }
  if (statusCode === "CANCELLED") {
    return <p className="text-sm font-medium text-slate-500">This task was cancelled.</p>;
  }
  if (!canPack) return null;

  const isMine = assignedEmployeeId === myEmployeeId;

  if (!assignedEmployeeId) {
    return (
      <div className="space-y-3">
        {card}
        {error ? <ErrorNote text={error} /> : null}
        <Button
          size="lg"
          disabled={isPending}
          onClick={() => run(assignVasTask, { assignedEmployeeId: String(myEmployeeId) })}
          className="h-14 w-full bg-teal-700 text-base hover:bg-teal-800"
        >
          Claim This Job
        </Button>
      </div>
    );
  }

  if (!isMine) {
    return <p className="text-sm text-slate-500">This job is assigned to someone else.</p>;
  }

  if (statusCode === "PENDING") {
    return (
      <div className="space-y-3">
        {card}
        {error ? <ErrorNote text={error} /> : null}
        <Button
          size="lg"
          disabled={isPending}
          onClick={() => run(startVasTask)}
          className="h-14 w-full bg-teal-700 text-base hover:bg-teal-800"
        >
          Start
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {card}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-bold text-slate-900">
            {progress.done} of {progress.total} done
          </span>
          {progress.isComplete ? (
            <span className="text-xs font-semibold text-emerald-700">All done</span>
          ) : (
            <span className="text-xs text-slate-500">
              {progress.remaining} to go
            </span>
          )}
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-all ${
              progress.isComplete ? "bg-emerald-600" : "bg-teal-600"
            }`}
            style={{
              width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 100}%`,
            }}
          />
        </div>
      </div>

      <div className="space-y-2">
        {steps.map((step) => (
          <button
            key={step.stepId}
            type="button"
            disabled={isPending}
            onClick={() => toggle(step)}
            className={`flex w-full items-start gap-3 rounded-xl border-2 px-4 py-4 text-left transition disabled:opacity-60 ${
              step.isDone
                ? "border-emerald-300 bg-emerald-50"
                : "border-slate-200 bg-white hover:border-teal-400"
            }`}
          >
            <span
              className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 ${
                step.isDone
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : "border-slate-300 bg-white"
              }`}
            >
              {step.isDone ? <Check className="h-4 w-4" /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={`block text-base ${
                  step.isDone ? "text-emerald-900 line-through" : "text-slate-900"
                }`}
              >
                {step.instruction}
              </span>
              {step.isDone && step.doneBy ? (
                <span className="mt-0.5 block text-[11px] text-emerald-700">
                  {step.doneBy}
                  {step.doneAt ? ` · ${step.doneAt.replace("T", " ").slice(11, 16)}` : ""}
                </span>
              ) : null}
              {pendingStep === step.stepId ? (
                <span className="mt-0.5 block text-[11px] text-slate-400">Saving…</span>
              ) : null}
            </span>
          </button>
        ))}

        {steps.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400">
            No instructions on this job.
          </p>
        ) : null}
      </div>

      {error ? <ErrorNote text={error} /> : null}

      <Button
        size="lg"
        disabled={isPending || !progress.isComplete}
        onClick={() => run(completeVasTask)}
        className="h-14 w-full bg-teal-700 text-base hover:bg-teal-800"
      >
        <Package className="mr-2 h-5 w-5" />
        {progress.isComplete
          ? "Mark Packed"
          : `${progress.remaining} still to do`}
      </Button>
    </div>
  );
}

function ErrorNote({ text }: { text: string }) {
  return (
    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{text}</p>
  );
}
