"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  assignLoadingTask,
  completeLoadingTask,
  startLoadingTask,
} from "../../../outbound/shipments/actions";

/**
 * Loading is confirmed by scanning the pallet, not by pressing a button.
 *
 * The whole failure mode this step exists to prevent is the right-looking
 * wrong pallet going onto a trailer, and that is invisible to anything
 * except a scan compared against the expected LPN. The server re-checks the
 * match too -- this screen is the fast feedback, not the guarantee.
 */
export function LoadScanFlow({
  warehouseId,
  taskId,
  statusCode,
  assignedEmployeeId,
  myEmployeeId,
  canLoad,
  lpnId,
  sequenceNumber,
  dockDoorCode,
}: {
  warehouseId: number;
  taskId: string;
  statusCode: string;
  assignedEmployeeId: number | null;
  myEmployeeId: number;
  canLoad: boolean;
  lpnId: string;
  sequenceNumber: number;
  dockDoorCode: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState("");

  function run(
    action: (formData: FormData) => Promise<{ error?: string }>,
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

  if (statusCode === "COMPLETED") {
    return <p className="text-sm font-medium text-emerald-700">This pallet is on the trailer.</p>;
  }
  if (statusCode === "CANCELLED") {
    return <p className="text-sm font-medium text-slate-500">This loading task was cancelled.</p>;
  }
  if (!canLoad) return null;

  const isMine = assignedEmployeeId === myEmployeeId;

  const card = (
    <div className="rounded-2xl border-2 border-teal-600 bg-teal-50 p-5">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-teal-700">
          Load pallet
        </span>
        <span className="text-[11px] font-medium text-teal-700">#{sequenceNumber}</span>
      </div>
      <div className="font-mono text-2xl font-bold text-slate-900">{lpnId}</div>
      <div className="mt-3 border-t border-teal-200 pt-3">
        <span className="text-[11px] font-bold uppercase tracking-wider text-teal-700">
          At dock
        </span>
        <div className="font-mono text-lg font-bold text-slate-900">{dockDoorCode || "-"}</div>
      </div>
    </div>
  );

  if (!assignedEmployeeId) {
    return (
      <div className="space-y-3">
        {card}
        {error ? <ErrorNote text={error} /> : null}
        <Button
          size="lg"
          disabled={isPending}
          onClick={() => run(assignLoadingTask, { assignedEmployeeId: String(myEmployeeId) })}
          className="h-14 w-full bg-teal-700 text-base hover:bg-teal-800"
        >
          Claim This Load
        </Button>
      </div>
    );
  }

  if (!isMine) {
    return <p className="text-sm text-slate-500">This load is assigned to someone else.</p>;
  }

  if (statusCode === "PENDING") {
    return (
      <div className="space-y-3">
        {card}
        {error ? <ErrorNote text={error} /> : null}
        <Button
          size="lg"
          disabled={isPending}
          onClick={() => run(startLoadingTask)}
          className="h-14 w-full bg-teal-700 text-base hover:bg-teal-800"
        >
          Start Loading
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {card}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const value = scan.trim();
          if (!value) {
            setError("Scan the pallet label.");
            return;
          }
          setScan("");
          run(completeLoadingTask, { scannedLpn: value });
        }}
        className="space-y-2"
      >
        <Label htmlFor="load-scan" className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <ScanLine className="h-4 w-4" /> Scan the pallet as it goes on
        </Label>
        <Input
          id="load-scan"
          autoFocus
          value={scan}
          onChange={(e) => setScan(e.target.value)}
          placeholder="Scan LPN label..."
          className="h-14 text-lg"
        />
        {error ? <ErrorNote text={error} /> : null}
        <Button
          type="submit"
          size="lg"
          disabled={isPending}
          className="h-14 w-full bg-teal-700 text-base hover:bg-teal-800"
        >
          {isPending ? "Confirming..." : "Confirm Loaded"}
        </Button>
      </form>
    </div>
  );
}

function ErrorNote({ text }: { text: string }) {
  return (
    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{text}</p>
  );
}
