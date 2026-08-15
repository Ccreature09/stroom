"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  submitPurchaseOrder,
} from "./actions";

export type SupplierOption = { supplierId: number; name: string };
export type ItemOption = { itemId: number; sku: string; name: string };

const selectClassName =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

function NativeSelect({
  id,
  value,
  onChange,
  required,
  className,
  children,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <select
      id={id}
      value={value}
      required={required}
      onChange={(e) => onChange(e.target.value)}
      className={className ?? selectClassName}
    >
      {children}
    </select>
  );
}

type DraftLine = {
  key: number;
  itemId: string;
  quantityOrdered: string;
  unitCost: string;
  batchNumber: string;
  lotNumber: string;
  expiryDate: string;
};

function emptyLine(key: number): DraftLine {
  return {
    key,
    itemId: "",
    quantityOrdered: "",
    unitCost: "",
    batchNumber: "",
    lotNumber: "",
    expiryDate: "",
  };
}

export function CreatePurchaseOrderDialog({
  warehouseId,
  supplierOptions,
  itemOptions,
}: {
  warehouseId: number;
  supplierOptions: SupplierOption[];
  itemOptions: ItemOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [supplierId, setSupplierId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [nextKey, setNextKey] = useState(1);
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(0)]);

  const blocked = supplierOptions.length === 0 || itemOptions.length === 0;

  function updateLine(key: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine(nextKey)]);
    setNextKey((k) => k + 1);
  }

  function removeLine(key: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  function reset() {
    setSupplierId("");
    setExpectedDate("");
    setLines([emptyLine(0)]);
    setNextKey(1);
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!supplierId) {
      setError("Select a supplier.");
      return;
    }
    const linesJson = lines.map((l) => ({
      itemId: l.itemId,
      quantityOrdered: l.quantityOrdered,
      unitCost: l.unitCost,
      batchNumber: l.batchNumber,
      lotNumber: l.lotNumber,
      expiryDate: l.expiryDate,
    }));
    if (linesJson.some((l) => !l.itemId || !l.quantityOrdered)) {
      setError("Every line needs an item and a quantity.");
      return;
    }

    const formData = new FormData();
    formData.append("warehouseId", String(warehouseId));
    formData.append("supplierId", supplierId);
    if (expectedDate) formData.append("expectedDate", expectedDate);
    formData.append("linesJson", JSON.stringify(linesJson));

    startTransition(async () => {
      const res = await createPurchaseOrder(formData);
      if (res?.success) {
        setOpen(false);
        reset();
        if (res.poId) {
          router.push(`/warehouses/${warehouseId}/inbound/purchase-orders/${res.poId}`);
        } else {
          router.refresh();
        }
      } else {
        setError(res?.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button className="bg-teal-700 hover:bg-teal-800" disabled={blocked}>
          <FileText className="mr-2 h-4 w-4" /> New Purchase Order
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[720px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New Purchase Order</DialogTitle>
            <DialogDescription>
              Starts as a draft -- submit it once you&apos;re ready for the
              supplier to fulfil it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="po-supplier">
                  Supplier <span className="text-destructive">*</span>
                </Label>
                <NativeSelect id="po-supplier" value={supplierId} onChange={setSupplierId} required>
                  <option value="">Select a supplier...</option>
                  {supplierOptions.map((s) => (
                    <option key={s.supplierId} value={s.supplierId}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="po-expected">Expected Date</Label>
                <Input
                  id="po-expected"
                  type="date"
                  value={expectedDate}
                  onChange={(e) => setExpectedDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2 border-t border-border pt-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Order Lines
                </Label>
                <Button type="button" variant="outline" size="sm" onClick={addLine}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add line
                </Button>
              </div>

              {lines.map((line, index) => (
                <div
                  key={line.key}
                  className="grid grid-cols-12 items-end gap-2 rounded-md border bg-card p-2"
                >
                  <div className="col-span-4 space-y-1">
                    {index === 0 && <Label className="text-[11px]">Item</Label>}
                    <NativeSelect
                      value={line.itemId}
                      onChange={(v) => updateLine(line.key, { itemId: v })}
                      className={`${selectClassName} h-8 text-xs`}
                    >
                      <option value="">Select item...</option>
                      {itemOptions.map((item) => (
                        <option key={item.itemId} value={item.itemId}>
                          {item.sku} — {item.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="col-span-2 space-y-1">
                    {index === 0 && <Label className="text-[11px]">Qty</Label>}
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      className="h-8 text-xs"
                      value={line.quantityOrdered}
                      onChange={(e) =>
                        updateLine(line.key, { quantityOrdered: e.target.value })
                      }
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    {index === 0 && <Label className="text-[11px]">Unit cost</Label>}
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      className="h-8 text-xs"
                      value={line.unitCost}
                      onChange={(e) => updateLine(line.key, { unitCost: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    {index === 0 && <Label className="text-[11px]">Batch/Lot</Label>}
                    <Input
                      className="h-8 text-xs"
                      placeholder="Batch"
                      value={line.batchNumber}
                      onChange={(e) =>
                        updateLine(line.key, { batchNumber: e.target.value })
                      }
                    />
                  </div>
                  <div className="col-span-1 space-y-1">
                    {index === 0 && <Label className="text-[11px]">Expiry</Label>}
                    <Input
                      type="date"
                      className="h-8 text-xs px-1"
                      value={line.expiryDate}
                      onChange={(e) =>
                        updateLine(line.key, { expiryDate: e.target.value })
                      }
                    />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={lines.length === 1}
                      onClick={() => removeLine(line.key)}
                      className="h-8 px-1.5"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {error ? (
              <p className="text-sm font-medium text-red-600">{error}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="bg-teal-700 hover:bg-teal-800"
            >
              {isPending ? "Creating..." : "Create Draft"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SubmitPurchaseOrderButton({
  warehouseId,
  poId,
}: {
  warehouseId: number;
  poId: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    const formData = new FormData();
    formData.append("warehouseId", String(warehouseId));
    formData.append("poId", String(poId));
    startTransition(async () => {
      const res = await submitPurchaseOrder(formData);
      if (res?.error) setError(res.error);
    });
  }

  return (
    <div className="flex items-center gap-2">
      {error ? <span className="text-xs font-medium text-red-600">{error}</span> : null}
      <Button
        size="sm"
        disabled={isPending}
        onClick={handleClick}
        className="bg-teal-700 hover:bg-teal-800"
      >
        {isPending ? "Submitting..." : "Submit to Supplier"}
      </Button>
    </div>
  );
}

export function CancelPurchaseOrderButton({
  warehouseId,
  poId,
}: {
  warehouseId: number;
  poId: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    const formData = new FormData();
    formData.append("warehouseId", String(warehouseId));
    formData.append("poId", String(poId));
    startTransition(async () => {
      const res = await cancelPurchaseOrder(formData);
      if (res?.error) setError(res.error);
    });
  }

  return (
    <div className="flex items-center gap-2">
      {error ? <span className="text-xs font-medium text-red-600">{error}</span> : null}
      <Button size="sm" variant="outline" disabled={isPending} onClick={handleClick}>
        {isPending ? "Cancelling..." : "Cancel Order"}
      </Button>
    </div>
  );
}
