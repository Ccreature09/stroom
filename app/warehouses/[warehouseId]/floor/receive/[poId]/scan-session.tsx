"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { receivePurchaseOrderLine } from "../../../inbound/purchase-orders/actions";

export type PoLine = {
  poLineId: number;
  itemId: number;
  sku: string;
  itemName: string;
  barcode: string | null;
  isBatchTracked: boolean;
  isLotTracked: boolean;
  hasExpiry: boolean;
  quantityOrdered: number;
  quantityReceived: number | null;
};
export type LocationOption = { locationId: number; locationCode: string };
export type StatusOption = { statusId: number; name: string };

const selectClassName =
  "w-full rounded-lg border border-input bg-transparent px-3 py-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type FieldStep = "batch" | "lot" | "expiry" | "quantity";

function requiredSteps(line: PoLine): FieldStep[] {
  const steps: FieldStep[] = [];
  if (line.isBatchTracked) steps.push("batch");
  if (line.isLotTracked) steps.push("lot");
  if (line.hasExpiry) steps.push("expiry");
  steps.push("quantity");
  return steps;
}

/**
 * Scan the item, scan whatever the item actually requires (batch, lot,
 * expiry -- skipped entirely for a plain item), enter the quantity that
 * batch/lot covers, and it's booked. Every Enter both commits the field
 * you're on and moves to the next one; nothing here needs a mouse.
 *
 * Deliberately batch/lot-as-a-group, not per-unit: a batch or lot code
 * covers however many units share it (a whole pallet, typically), so the
 * quantity field always comes last, after whatever traceability the item
 * needs -- scanning a 200-unit pallet is ~4 scans, not 200.
 */
export function ScanSession({
  warehouseId,
  initialLines,
  locationOptions,
  statusOptions,
}: {
  warehouseId: number;
  initialLines: PoLine[];
  locationOptions: LocationOption[];
  statusOptions: StatusOption[];
}) {
  const router = useRouter();
  const [lines, setLines] = useState<PoLine[]>(
    initialLines.map((l) => ({ ...l, quantityReceived: l.quantityReceived ?? 0 })),
  );
  const [locationId, setLocationId] = useState(String(locationOptions[0]?.locationId ?? ""));
  const [statusId, setStatusId] = useState(String(statusOptions[0]?.statusId ?? ""));

  const [itemScan, setItemScan] = useState("");
  const [matchedLine, setMatchedLine] = useState<PoLine | null>(null);
  const [pendingSteps, setPendingSteps] = useState<FieldStep[]>([]);
  const [batchValue, setBatchValue] = useState("");
  const [lotValue, setLotValue] = useState("");
  const [expiryValue, setExpiryValue] = useState("");
  const [quantityValue, setQuantityValue] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [lastBooked, setLastBooked] = useState<{ sku: string; quantity: number } | null>(null);
  const [isPending, startTransition] = useTransition();

  const allReceived = lines.every((l) => (l.quantityReceived ?? 0) >= l.quantityOrdered);
  const currentStep = pendingSteps[0];

  function remainingOf(line: PoLine) {
    return line.quantityOrdered - (line.quantityReceived ?? 0);
  }

  function findLine(raw: string): PoLine | null {
    const v = raw.trim().toLowerCase();
    if (!v) return null;
    return (
      lines.find(
        (l) => l.sku.toLowerCase() === v || (l.barcode && l.barcode.toLowerCase() === v),
      ) ?? null
    );
  }

  function handleItemScan(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLastBooked(null);
    const line = findLine(itemScan);
    setItemScan("");
    if (!line) {
      setError(`"${itemScan.trim()}" isn't expected on this delivery.`);
      return;
    }
    const remaining = remainingOf(line);
    if (remaining <= 0) {
      setError(`${line.sku} is already fully received on this order.`);
      return;
    }
    setMatchedLine(line);
    setBatchValue("");
    setLotValue("");
    setExpiryValue("");
    setQuantityValue(String(remaining));
    setPendingSteps(requiredSteps(line));
  }

  function backToItemScan() {
    setMatchedLine(null);
    setPendingSteps([]);
  }

  function handleFieldSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!matchedLine || !currentStep) return;
    setError(null);

    if (currentStep === "batch" && !batchValue.trim()) {
      setError("Scan or enter the batch number.");
      return;
    }
    if (currentStep === "lot" && !lotValue.trim()) {
      setError("Scan or enter the lot number.");
      return;
    }
    if (currentStep === "expiry" && !expiryValue) {
      setError("Enter the expiry date.");
      return;
    }
    if (currentStep === "quantity") {
      const qty = Number(quantityValue);
      if (!Number.isInteger(qty) || qty <= 0) {
        setError("Quantity must be a positive whole number.");
        return;
      }
      submitLine(matchedLine, qty);
      return;
    }

    setPendingSteps((prev) => prev.slice(1));
  }

  function submitLine(line: PoLine, quantity: number) {
    const formData = new FormData();
    formData.append("warehouseId", String(warehouseId));
    formData.append("poLineId", String(line.poLineId));
    formData.append("quantity", String(quantity));
    formData.append("locationId", locationId);
    formData.append("statusId", statusId);
    if (batchValue.trim()) formData.append("batchNumber", batchValue.trim());
    if (lotValue.trim()) formData.append("lotNumber", lotValue.trim());
    if (expiryValue) formData.append("expiryDate", expiryValue);

    startTransition(async () => {
      const res = await receivePurchaseOrderLine(formData);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setLines((prev) =>
        prev.map((l) =>
          l.poLineId === line.poLineId
            ? { ...l, quantityReceived: (l.quantityReceived ?? 0) + quantity }
            : l,
        ),
      );
      setLastBooked({ sku: line.sku, quantity });
      setMatchedLine(null);
      setPendingSteps([]);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex-1 space-y-1">
          <Label htmlFor="scan-location" className="text-[11px] text-slate-500">
            Receiving to
          </Label>
          <select
            id="scan-location"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className={`${selectClassName} h-9 py-1 text-sm`}
          >
            {locationOptions.map((l) => (
              <option key={l.locationId} value={l.locationId}>
                {l.locationCode}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 space-y-1">
          <Label htmlFor="scan-status" className="text-[11px] text-slate-500">
            Status
          </Label>
          <select
            id="scan-status"
            value={statusId}
            onChange={(e) => setStatusId(e.target.value)}
            className={`${selectClassName} h-9 py-1 text-sm`}
          >
            {statusOptions.map((s) => (
              <option key={s.statusId} value={s.statusId}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {allReceived ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <p className="text-sm font-semibold">Everything on this order has been received.</p>
        </div>
      ) : null}

      {!matchedLine ? (
        <form onSubmit={handleItemScan} className="space-y-2">
          <Label htmlFor="scan-item" className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            <ScanLine className="h-4 w-4" /> Scan next item
          </Label>
          <Input
            id="scan-item"
            autoFocus
            value={itemScan}
            onChange={(e) => setItemScan(e.target.value)}
            placeholder="Scan barcode or type SKU..."
            className="h-14 text-lg"
          />
        </form>
      ) : (
        <form onSubmit={handleFieldSubmit} className="space-y-3 rounded-2xl border-2 border-teal-600 bg-teal-50 p-4">
          <div>
            <div className="font-mono text-sm font-bold text-slate-900">{matchedLine.sku}</div>
            <div className="text-xs text-slate-600">{matchedLine.itemName}</div>
            <div className="mt-0.5 text-xs text-teal-700">
              {(matchedLine.quantityReceived ?? 0)} of {matchedLine.quantityOrdered} received so far
            </div>
          </div>

          {currentStep === "batch" ? (
            <ScanField
              label="Scan batch number"
              value={batchValue}
              onChange={setBatchValue}
              autoFocus
            />
          ) : null}
          {currentStep === "lot" ? (
            <ScanField label="Scan lot number" value={lotValue} onChange={setLotValue} autoFocus />
          ) : null}
          {currentStep === "expiry" ? (
            <div className="space-y-1">
              <Label htmlFor="scan-expiry" className="text-sm">
                Expiry date
              </Label>
              <Input
                id="scan-expiry"
                type="date"
                autoFocus
                value={expiryValue}
                onChange={(e) => setExpiryValue(e.target.value)}
                className="h-14 text-lg"
              />
            </div>
          ) : null}
          {currentStep === "quantity" ? (
            <div className="space-y-1">
              <Label htmlFor="scan-quantity" className="text-sm">
                Quantity in this batch
              </Label>
              <Input
                id="scan-quantity"
                type="number"
                min={1}
                autoFocus
                value={quantityValue}
                onChange={(e) => setQuantityValue(e.target.value)}
                className="h-14 text-lg"
              />
            </div>
          ) : null}

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
          ) : null}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={backToItemScan}
              className="h-12 flex-1 text-sm"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="h-12 flex-[2] bg-teal-700 text-base hover:bg-teal-800"
            >
              {isPending
                ? "Booking..."
                : currentStep === "quantity"
                  ? "Book It"
                  : "Next"}
            </Button>
          </div>
        </form>
      )}

      {error && !matchedLine ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
      ) : null}
      {lastBooked ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
          Booked {lastBooked.quantity} × {lastBooked.sku}.
        </p>
      ) : null}

      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          This delivery
        </p>
        {lines.map((line) => {
          const received = line.quantityReceived ?? 0;
          const pct = Math.min(100, Math.round((received / line.quantityOrdered) * 100));
          const done = received >= line.quantityOrdered;
          return (
            <div
              key={line.poLineId}
              className={`rounded-lg border px-3 py-2 text-xs ${
                done ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold text-slate-800">{line.sku}</span>
                <span className={done ? "font-semibold text-emerald-700" : "text-slate-500"}>
                  {received} / {line.quantityOrdered}
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${done ? "bg-emerald-600" : "bg-teal-600"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScanField({
  label,
  value,
  onChange,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-sm">{label}</Label>
      <Input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-14 text-lg"
      />
    </div>
  );
}
