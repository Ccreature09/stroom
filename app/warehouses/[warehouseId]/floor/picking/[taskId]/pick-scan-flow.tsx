"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, MapPin, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  assignPickingTask,
  completePickingTask,
  startPickingTask,
} from "../../../outbound/picking/actions";

type Step = "location" | "item" | "quantity";

/**
 * Confirm the bay, confirm the item, confirm the count.
 *
 * Picking is where the two expensive mistakes happen -- wrong bay, wrong
 * item -- so both are verified against what the task says rather than
 * trusted. Each scan is a form submit, which is exactly what a barcode
 * scanner's trailing Enter produces, so the whole flow runs without the
 * screen being touched.
 *
 * The quantity defaults to what was reserved and is editable, because the
 * shelf genuinely does hold less than the system thinks sometimes, and
 * discovering that is part of the picker's job rather than an error state.
 */
export function PickScanFlow({
  warehouseId,
  taskId,
  statusCode,
  assignedEmployeeId,
  myEmployeeId,
  canPick,
  locationCode,
  sku,
  itemName,
  barcode,
  batchNumber,
  lotNumber,
  pickQuantity,
}: {
  warehouseId: number;
  taskId: string;
  statusCode: string;
  assignedEmployeeId: number | null;
  myEmployeeId: number;
  canPick: boolean;
  locationCode: string;
  sku: string;
  itemName: string;
  barcode: string | null;
  batchNumber: string | null;
  lotNumber: string | null;
  pickQuantity: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("location");
  const [locationScan, setLocationScan] = useState("");
  const [itemScan, setItemScan] = useState("");
  const [quantity, setQuantity] = useState(String(pickQuantity));

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
    return <p className="text-sm font-medium text-emerald-700">This pick is done.</p>;
  }
  if (statusCode === "CANCELLED") {
    return <p className="text-sm font-medium text-slate-500">This pick was cancelled.</p>;
  }
  if (!canPick) return null;

  const isMine = assignedEmployeeId === myEmployeeId;

  if (!assignedEmployeeId) {
    return (
      <div className="space-y-3">
        <PickCard
          locationCode={locationCode}
          sku={sku}
          itemName={itemName}
          batchNumber={batchNumber}
          lotNumber={lotNumber}
          pickQuantity={pickQuantity}
        />
        {error ? <ErrorNote text={error} /> : null}
        <Button
          size="lg"
          disabled={isPending}
          onClick={() => run(assignPickingTask, { assignedEmployeeId: String(myEmployeeId) })}
          className="h-14 w-full bg-teal-700 text-base hover:bg-teal-800"
        >
          Claim This Pick
        </Button>
      </div>
    );
  }

  if (!isMine) {
    return <p className="text-sm text-slate-500">This pick is assigned to someone else.</p>;
  }

  if (statusCode === "PENDING") {
    return (
      <div className="space-y-3">
        <PickCard
          locationCode={locationCode}
          sku={sku}
          itemName={itemName}
          batchNumber={batchNumber}
          lotNumber={lotNumber}
          pickQuantity={pickQuantity}
        />
        {error ? <ErrorNote text={error} /> : null}
        <Button
          size="lg"
          disabled={isPending}
          onClick={() => run(startPickingTask)}
          className="h-14 w-full bg-teal-700 text-base hover:bg-teal-800"
        >
          Start Pick
        </Button>
      </div>
    );
  }

  function handleLocationScan(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (locationScan.trim().toUpperCase() !== locationCode.toUpperCase()) {
      setError(`That's ${locationScan.trim() || "empty"} -- this pick is at ${locationCode}.`);
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
    setStep("quantity");
  }

  function handleQuantitySubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      setError("Quantity must be a positive whole number.");
      return;
    }
    if (qty > pickQuantity) {
      setError(`This pick only reserved ${pickQuantity}.`);
      return;
    }
    run(completePickingTask, { pickedQuantity: String(qty) });
  }

  const short = Number(quantity) > 0 && Number(quantity) < pickQuantity;

  return (
    <div className="space-y-4">
      <PickCard
        locationCode={locationCode}
        sku={sku}
        itemName={itemName}
        batchNumber={batchNumber}
        lotNumber={lotNumber}
        pickQuantity={pickQuantity}
        activeStep={step}
      />

      {step === "location" ? (
        <form onSubmit={handleLocationScan} className="space-y-2">
          <Label htmlFor="pick-location-scan" className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            <MapPin className="h-4 w-4" /> Scan the bay you&apos;re standing at
          </Label>
          <Input
            id="pick-location-scan"
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
          <Label htmlFor="pick-item-scan" className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            <ScanLine className="h-4 w-4" /> Scan the item
          </Label>
          <Input
            id="pick-item-scan"
            autoFocus
            value={itemScan}
            onChange={(e) => setItemScan(e.target.value)}
            placeholder="Scan barcode..."
            className="h-14 text-lg"
          />
        </form>
      ) : null}

      {step === "quantity" ? (
        <form onSubmit={handleQuantitySubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="pick-quantity" className="text-sm font-semibold text-slate-700">
              How many did you take?
            </Label>
            <Input
              id="pick-quantity"
              type="number"
              min={1}
              max={pickQuantity}
              autoFocus
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="h-14 text-lg"
            />
          </div>
          {short ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Short by {pickQuantity - Number(quantity)}. That gets recorded against
                the order so someone can chase the difference.
              </p>
            </div>
          ) : null}
          {error ? <ErrorNote text={error} /> : null}
          <Button
            type="submit"
            size="lg"
            disabled={isPending}
            className="h-14 w-full bg-teal-700 text-base hover:bg-teal-800"
          >
            {isPending ? "Confirming..." : "Confirm Pick"}
          </Button>
        </form>
      ) : null}

      {step !== "quantity" && error ? <ErrorNote text={error} /> : null}
    </div>
  );
}

function ErrorNote({ text }: { text: string }) {
  return (
    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{text}</p>
  );
}

function PickCard({
  locationCode,
  sku,
  itemName,
  batchNumber,
  lotNumber,
  pickQuantity,
  activeStep,
}: {
  locationCode: string;
  sku: string;
  itemName: string;
  batchNumber: string | null;
  lotNumber: string | null;
  pickQuantity: number;
  activeStep?: Step;
}) {
  return (
    <div className="rounded-2xl border-2 border-teal-600 bg-teal-50 p-5">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-teal-700">
          Go to
        </span>
        {activeStep ? (
          <span className="text-[11px] font-medium text-teal-700">
            Step {activeStep === "location" ? 1 : activeStep === "item" ? 2 : 3} of 3
          </span>
        ) : null}
      </div>
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
      <div className="mt-3 border-t border-teal-200 pt-3">
        <span className="text-[11px] font-bold uppercase tracking-wider text-teal-700">
          Take
        </span>
        <div className="text-3xl font-bold text-slate-900">{pickQuantity}</div>
      </div>
    </div>
  );
}
