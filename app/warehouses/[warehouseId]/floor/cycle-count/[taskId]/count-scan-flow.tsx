"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, MapPin, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  assignCountTask,
  startCountTask,
  submitCount,
  type SubmitCountResult,
} from "../../../internal/cycle-count/actions";

type Step = "location" | "item" | "count";

/**
 * Blind count: scan the bay, scan the item, type what you actually see.
 *
 * The expected quantity is never sent to this screen (see the page's query),
 * so there is no number here to anchor against. When the count comes back
 * far enough off that it needs a second look, the server says so and the
 * discrepancy is shown *then* -- after the count is committed, where it can
 * no longer influence it.
 */
export function CountScanFlow({
  warehouseId,
  taskId,
  statusCode,
  assignedEmployeeId,
  myEmployeeId,
  canCount,
  canForceRecount,
  locationCode,
  sku,
  itemName,
  barcode,
  batchNumber,
  lotNumber,
}: {
  warehouseId: number;
  taskId: string;
  statusCode: string;
  assignedEmployeeId: number | null;
  myEmployeeId: number;
  canCount: boolean;
  canForceRecount: boolean;
  locationCode: string;
  sku: string;
  itemName: string;
  barcode: string | null;
  batchNumber: string | null;
  lotNumber: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("location");
  const [locationScan, setLocationScan] = useState("");
  const [itemScan, setItemScan] = useState("");
  const [counted, setCounted] = useState("");
  const [review, setReview] = useState<SubmitCountResult | null>(null);

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

  const card = (
    <div className="rounded-2xl border-2 border-teal-600 bg-teal-50 p-5">
      <span className="text-[11px] font-bold uppercase tracking-wider text-teal-700">
        Count at
      </span>
      <div className="font-mono text-3xl font-bold text-slate-900">{locationCode}</div>
      <div className="mt-3 border-t border-teal-200 pt-3">
        <div className="font-mono text-lg font-bold text-slate-900">{sku}</div>
        <div className="text-sm text-slate-600">{itemName}</div>
        {batchNumber || lotNumber ? (
          <div className="mt-1 font-mono text-xs text-teal-800">
            {batchNumber ? `Batch ${batchNumber}` : ""}
            {batchNumber && lotNumber ? " · " : ""}
            {lotNumber ? `Lot ${lotNumber}` : ""}
          </div>
        ) : null}
      </div>
    </div>
  );

  if (statusCode === "COMPLETED" && !review) {
    return <p className="text-sm font-medium text-emerald-700">This count is done.</p>;
  }
  if (statusCode === "CANCELLED") {
    return <p className="text-sm font-medium text-slate-500">This count was cancelled.</p>;
  }
  if (!canCount) return null;

  // Variance held back for review -- shown only after the count was recorded.
  if (review?.needsReview) {
    const delta = review.delta ?? 0;
    return (
      <div className="space-y-4">
        {card}
        <div className="space-y-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="text-sm text-amber-900">
              <p className="font-bold">That&apos;s a big difference.</p>
              <p className="mt-1">
                You counted <span className="font-mono font-bold">{review.counted}</span>;
                the system expected{" "}
                <span className="font-mono font-bold">{review.expected}</span> (
                {delta > 0 ? "+" : ""}
                {delta}).
              </p>
              <p className="mt-1.5">
                Your count has been recorded, but stock has <em>not</em> been
                changed yet. Recount to be sure.
              </p>
            </div>
          </div>

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {error}
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            <Button
              size="lg"
              variant="outline"
              onClick={() => {
                setReview(null);
                setCounted("");
                setStep("count");
              }}
              className="h-14 w-full text-base"
            >
              Recount
            </Button>
            {canForceRecount ? (
              <Button
                size="lg"
                disabled={isPending}
                onClick={() =>
                  run(submitCount, {
                    countedQuantity: String(review.counted ?? 0),
                    force: "true",
                  })
                }
                className="h-14 w-full bg-amber-700 text-base hover:bg-amber-800"
              >
                My count is right — apply it
              </Button>
            ) : (
              <p className="text-center text-xs text-amber-800">
                A supervisor has to confirm a difference this size.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const isMine = assignedEmployeeId === myEmployeeId;

  if (!assignedEmployeeId) {
    return (
      <div className="space-y-3">
        {card}
        {error ? <ErrorNote text={error} /> : null}
        <Button
          size="lg"
          disabled={isPending}
          onClick={() => run(assignCountTask, { assignedEmployeeId: String(myEmployeeId) })}
          className="h-14 w-full bg-teal-700 text-base hover:bg-teal-800"
        >
          Claim This Count
        </Button>
      </div>
    );
  }

  if (!isMine) {
    return <p className="text-sm text-slate-500">This count is assigned to someone else.</p>;
  }

  if (statusCode === "PENDING") {
    return (
      <div className="space-y-3">
        {card}
        {error ? <ErrorNote text={error} /> : null}
        <Button
          size="lg"
          disabled={isPending}
          onClick={() => run(startCountTask)}
          className="h-14 w-full bg-teal-700 text-base hover:bg-teal-800"
        >
          Start Count
        </Button>
      </div>
    );
  }

  function handleLocationScan(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (locationScan.trim().toUpperCase() !== locationCode.toUpperCase()) {
      setError(`That's ${locationScan.trim() || "empty"} -- this count is at ${locationCode}.`);
      setLocationScan("");
      return;
    }
    setLocationScan("");
    setStep("item");
  }

  function handleItemScan(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const v = itemScan.trim().toLowerCase();
    const matches = v === sku.toLowerCase() || (barcode !== null && v === barcode.toLowerCase());
    if (!matches) {
      setError(`That's not ${sku}. Check the label.`);
      setItemScan("");
      return;
    }
    setItemScan("");
    setStep("count");
  }

  function handleCountSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const qty = Number(counted);
    if (!Number.isInteger(qty) || qty < 0) {
      setError("Enter a whole number (0 is allowed).");
      return;
    }
    const formData = new FormData();
    formData.append("warehouseId", String(warehouseId));
    formData.append("taskId", taskId);
    formData.append("countedQuantity", String(qty));
    startTransition(async () => {
      const res = await submitCount(formData);
      if (res?.error) {
        setError(res.error);
        return;
      }
      if (res?.needsReview) {
        setReview(res);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {card}

      {step === "location" ? (
        <form onSubmit={handleLocationScan} className="space-y-2">
          <Label
            htmlFor="count-location-scan"
            className="flex items-center gap-1.5 text-sm font-semibold text-slate-700"
          >
            <MapPin className="h-4 w-4" /> Scan the bay
          </Label>
          <Input
            id="count-location-scan"
            autoFocus
            value={locationScan}
            onChange={(e) => setLocationScan(e.target.value)}
            placeholder="Scan location label..."
            className="h-14 text-lg"
          />
        </form>
      ) : null}

      {step === "item" ? (
        <form onSubmit={handleItemScan} className="space-y-2">
          <Label
            htmlFor="count-item-scan"
            className="flex items-center gap-1.5 text-sm font-semibold text-slate-700"
          >
            <ScanLine className="h-4 w-4" /> Scan the item
          </Label>
          <Input
            id="count-item-scan"
            autoFocus
            value={itemScan}
            onChange={(e) => setItemScan(e.target.value)}
            placeholder="Scan barcode..."
            className="h-14 text-lg"
          />
        </form>
      ) : null}

      {step === "count" ? (
        <form onSubmit={handleCountSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="counted-qty" className="text-sm font-semibold text-slate-700">
              How many are actually there?
            </Label>
            <Input
              id="counted-qty"
              type="number"
              min={0}
              autoFocus
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              placeholder="Count them"
              className="h-14 text-lg"
            />
            <p className="text-xs text-slate-500">
              Enter what you see. 0 is a valid answer.
            </p>
          </div>
          {error ? <ErrorNote text={error} /> : null}
          <Button
            type="submit"
            size="lg"
            disabled={isPending}
            className="h-14 w-full bg-teal-700 text-base hover:bg-teal-800"
          >
            {isPending ? "Submitting..." : "Submit Count"}
          </Button>
        </form>
      ) : null}

      {step !== "count" && error ? <ErrorNote text={error} /> : null}
    </div>
  );
}

function ErrorNote({ text }: { text: string }) {
  return (
    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{text}</p>
  );
}
