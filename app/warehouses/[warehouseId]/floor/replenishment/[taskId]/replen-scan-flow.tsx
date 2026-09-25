"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, MapPin, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  assignReplenishmentTask,
  completeReplenishmentTask,
  startReplenishmentTask,
} from "../../../internal/replenishment/actions";

type Step = "source" | "item" | "quantity" | "destination";

/**
 * Scan the reserve bay, scan the item, say how much you took, then scan the
 * face you put it on.
 *
 * The destination scan is last and mandatory for the same reason loading
 * scans the pallet: the move is only real once the stock is on the right
 * face, and putting it on the wrong one is both easy and invisible
 * afterwards.
 */
export function ReplenScanFlow({
  warehouseId,
  taskId,
  statusCode,
  assignedEmployeeId,
  myEmployeeId,
  canReplenish,
  sourceCode,
  destinationCode,
  sku,
  itemName,
  barcode,
  batchNumber,
  lotNumber,
  quantity,
}: {
  warehouseId: number;
  taskId: string;
  statusCode: string;
  assignedEmployeeId: number | null;
  myEmployeeId: number;
  canReplenish: boolean;
  sourceCode: string;
  destinationCode: string;
  sku: string;
  itemName: string;
  barcode: string | null;
  batchNumber: string | null;
  lotNumber: string | null;
  quantity: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("source");
  const [sourceScan, setSourceScan] = useState("");
  const [itemScan, setItemScan] = useState("");
  const [moved, setMoved] = useState(String(quantity));
  const [destScan, setDestScan] = useState("");

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
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-teal-700">
            From
          </span>
          <div className="font-mono text-2xl font-bold text-slate-900">{sourceCode}</div>
        </div>
        <div className="text-right">
          <span className="text-[11px] font-bold uppercase tracking-wider text-teal-700">
            To
          </span>
          <div className="font-mono text-2xl font-bold text-slate-900">
            {destinationCode}
          </div>
        </div>
      </div>
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
      <div className="mt-3 border-t border-teal-200 pt-3">
        <span className="text-[11px] font-bold uppercase tracking-wider text-teal-700">
          Move
        </span>
        <div className="text-3xl font-bold text-slate-900">{quantity}</div>
      </div>
    </div>
  );

  if (statusCode === "COMPLETED") {
    return <p className="text-sm font-medium text-emerald-700">This move is done.</p>;
  }
  if (statusCode === "CANCELLED") {
    return <p className="text-sm font-medium text-slate-500">This move was cancelled.</p>;
  }
  if (!canReplenish) return null;

  const isMine = assignedEmployeeId === myEmployeeId;

  if (!assignedEmployeeId) {
    return (
      <div className="space-y-3">
        {card}
        {error ? <ErrorNote text={error} /> : null}
        <Button
          size="lg"
          disabled={isPending}
          onClick={() =>
            run(assignReplenishmentTask, { assignedEmployeeId: String(myEmployeeId) })
          }
          className="h-14 w-full bg-teal-700 text-base hover:bg-teal-800"
        >
          Claim This Move
        </Button>
      </div>
    );
  }

  if (!isMine) {
    return <p className="text-sm text-slate-500">This move is assigned to someone else.</p>;
  }

  if (statusCode === "PENDING") {
    return (
      <div className="space-y-3">
        {card}
        {error ? <ErrorNote text={error} /> : null}
        <Button
          size="lg"
          disabled={isPending}
          onClick={() => run(startReplenishmentTask)}
          className="h-14 w-full bg-teal-700 text-base hover:bg-teal-800"
        >
          Start Move
        </Button>
      </div>
    );
  }

  const short = Number(moved) > 0 && Number(moved) < quantity;

  return (
    <div className="space-y-4">
      {card}

      {step === "source" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (sourceScan.trim().toUpperCase() !== sourceCode.toUpperCase()) {
              setError(`That's ${sourceScan.trim() || "empty"} -- pull from ${sourceCode}.`);
              setSourceScan("");
              return;
            }
            setSourceScan("");
            setStep("item");
          }}
          className="space-y-2"
        >
          <Label
            htmlFor="replen-source-scan"
            className="flex items-center gap-1.5 text-sm font-semibold text-slate-700"
          >
            <MapPin className="h-4 w-4" /> Scan the reserve bay
          </Label>
          <Input
            id="replen-source-scan"
            autoFocus
            value={sourceScan}
            onChange={(e) => setSourceScan(e.target.value)}
            placeholder="Scan location label..."
            className="h-14 text-lg"
          />
        </form>
      ) : null}

      {step === "item" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            const v = itemScan.trim().toLowerCase();
            const ok =
              v === sku.toLowerCase() || (barcode !== null && v === barcode.toLowerCase());
            if (!ok) {
              setError(`That's not ${sku}. Check the label.`);
              setItemScan("");
              return;
            }
            setItemScan("");
            setStep("quantity");
          }}
          className="space-y-2"
        >
          <Label
            htmlFor="replen-item-scan"
            className="flex items-center gap-1.5 text-sm font-semibold text-slate-700"
          >
            <ScanLine className="h-4 w-4" /> Scan the item
          </Label>
          <Input
            id="replen-item-scan"
            autoFocus
            value={itemScan}
            onChange={(e) => setItemScan(e.target.value)}
            placeholder="Scan barcode..."
            className="h-14 text-lg"
          />
        </form>
      ) : null}

      {step === "quantity" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            const qty = Number(moved);
            if (!Number.isInteger(qty) || qty <= 0) {
              setError("Quantity must be a positive whole number.");
              return;
            }
            if (qty > quantity) {
              setError(`This move was planned for ${quantity}.`);
              return;
            }
            setStep("destination");
          }}
          className="space-y-3"
        >
          <div className="space-y-1">
            <Label htmlFor="replen-qty" className="text-sm font-semibold text-slate-700">
              How many did you take?
            </Label>
            <Input
              id="replen-qty"
              type="number"
              min={1}
              max={quantity}
              autoFocus
              value={moved}
              onChange={(e) => setMoved(e.target.value)}
              className="h-14 text-lg"
            />
          </div>
          {short ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Short by {quantity - Number(moved)} -- the reserve bay had less than
                expected. That gets recorded.
              </p>
            </div>
          ) : null}
          {error ? <ErrorNote text={error} /> : null}
          <Button
            type="submit"
            size="lg"
            className="h-14 w-full bg-teal-700 text-base hover:bg-teal-800"
          >
            Next
          </Button>
        </form>
      ) : null}

      {step === "destination" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (destScan.trim().toUpperCase() !== destinationCode.toUpperCase()) {
              setError(`That's ${destScan.trim() || "empty"} -- put it on ${destinationCode}.`);
              setDestScan("");
              return;
            }
            run(completeReplenishmentTask, { movedQuantity: String(Number(moved)) });
          }}
          className="space-y-2"
        >
          <Label
            htmlFor="replen-dest-scan"
            className="flex items-center gap-1.5 text-sm font-semibold text-slate-700"
          >
            <MapPin className="h-4 w-4" /> Scan the pick face you put it on
          </Label>
          <Input
            id="replen-dest-scan"
            autoFocus
            value={destScan}
            onChange={(e) => setDestScan(e.target.value)}
            placeholder="Scan location label..."
            className="h-14 text-lg"
          />
          {error ? <ErrorNote text={error} /> : null}
          <Button
            type="submit"
            size="lg"
            disabled={isPending}
            className="h-14 w-full bg-teal-700 text-base hover:bg-teal-800"
          >
            {isPending ? "Confirming..." : "Confirm Move"}
          </Button>
        </form>
      ) : null}

      {step !== "quantity" && step !== "destination" && error ? (
        <ErrorNote text={error} />
      ) : null}
    </div>
  );
}

function ErrorNote({ text }: { text: string }) {
  return (
    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{text}</p>
  );
}
