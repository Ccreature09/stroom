"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ClipboardList, Plus, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  cancelSalesOrder,
  createSalesOrder,
  releaseSalesOrder,
  type ReleaseResult,
} from "./actions";

import { DepartmentPicker, type DepartmentOption } from "../../task-routing";

export type CustomerOption = {
  customerId: number;
  name: string;
  address: string | null;
};
export type ItemOption = { itemId: number; sku: string; name: string };

const selectClassName =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type DraftLine = { key: number; itemId: string; quantityRequested: string };

export function CreateSalesOrderDialog({
  warehouseId,
  customerOptions,
  itemOptions,
}: {
  warehouseId: number;
  customerOptions: CustomerOption[];
  itemOptions: ItemOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [customerId, setCustomerId] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [nextKey, setNextKey] = useState(1);
  const [lines, setLines] = useState<DraftLine[]>([
    { key: 0, itemId: "", quantityRequested: "" },
  ]);

  const blocked = customerOptions.length === 0 || itemOptions.length === 0;

  function handleCustomerChange(value: string) {
    setCustomerId(value);
    // Prefill from the customer's default address -- it's right most of the
    // time and still editable for a one-off ship-to.
    const customer = customerOptions.find((c) => String(c.customerId) === value);
    if (customer?.address && !shippingAddress.trim()) {
      setShippingAddress(customer.address);
    }
  }

  function reset() {
    setCustomerId("");
    setShippingAddress("");
    setLines([{ key: 0, itemId: "", quantityRequested: "" }]);
    setNextKey(1);
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!customerId) return setError("Select a customer.");
    if (!shippingAddress.trim()) return setError("Enter a shipping address.");
    if (lines.some((l) => !l.itemId || !l.quantityRequested)) {
      return setError("Every line needs an item and a quantity.");
    }

    const formData = new FormData();
    formData.append("warehouseId", String(warehouseId));
    formData.append("customerId", customerId);
    formData.append("shippingAddress", shippingAddress.trim());
    formData.append(
      "linesJson",
      JSON.stringify(
        lines.map((l) => ({ itemId: l.itemId, quantityRequested: l.quantityRequested })),
      ),
    );

    startTransition(async () => {
      const res = await createSalesOrder(formData);
      if (res?.success) {
        setOpen(false);
        reset();
        if (res.soId) {
          router.push(`/warehouses/${warehouseId}/outbound/sales-orders/${res.soId}`);
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
          <ClipboardList className="mr-2 h-4 w-4" /> New Sales Order
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New Sales Order</DialogTitle>
            <DialogDescription>
              Starts as a draft. Releasing it reserves real stock and creates
              the pick tasks.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="so-customer">
                Customer <span className="text-destructive">*</span>
              </Label>
              <select
                id="so-customer"
                value={customerId}
                onChange={(e) => handleCustomerChange(e.target.value)}
                className={selectClassName}
              >
                <option value="">Select a customer...</option>
                {customerOptions.map((c) => (
                  <option key={c.customerId} value={c.customerId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="so-address">
                Shipping address <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="so-address"
                rows={2}
                value={shippingAddress}
                onChange={(e) => setShippingAddress(e.target.value)}
              />
            </div>

            <div className="space-y-2 border-t border-border pt-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Order Lines
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setLines((prev) => [
                      ...prev,
                      { key: nextKey, itemId: "", quantityRequested: "" },
                    ]);
                    setNextKey((k) => k + 1);
                  }}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add line
                </Button>
              </div>

              {lines.map((line, index) => (
                <div
                  key={line.key}
                  className="grid grid-cols-12 items-end gap-2 rounded-md border bg-card p-2"
                >
                  <div className="col-span-8 space-y-1">
                    {index === 0 && <Label className="text-[11px]">Item</Label>}
                    <select
                      value={line.itemId}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l) =>
                            l.key === line.key ? { ...l, itemId: e.target.value } : l,
                          ),
                        )
                      }
                      className={`${selectClassName} h-8 py-0 text-xs`}
                    >
                      <option value="">Select item...</option>
                      {itemOptions.map((item) => (
                        <option key={item.itemId} value={item.itemId}>
                          {item.sku} — {item.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-3 space-y-1">
                    {index === 0 && <Label className="text-[11px]">Qty</Label>}
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      className="h-8 text-xs"
                      value={line.quantityRequested}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l) =>
                            l.key === line.key
                              ? { ...l, quantityRequested: e.target.value }
                              : l,
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={lines.length === 1}
                      onClick={() =>
                        setLines((prev) =>
                          prev.length > 1 ? prev.filter((l) => l.key !== line.key) : prev,
                        )
                      }
                      className="h-8 px-1.5"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
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

export function ReleaseSalesOrderButton({
  warehouseId,
  soId,
  departmentOptions,
}: {
  warehouseId: number;
  soId: number;
  departmentOptions: DepartmentOption[];
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ReleaseResult | null>(null);
  const [departmentIds, setDepartmentIds] = useState<number[]>([]);

  function handleClick() {
    setResult(null);
    const formData = new FormData();
    formData.append("warehouseId", String(warehouseId));
    formData.append("soId", String(soId));
    formData.append("departmentIds", departmentIds.join(","));
    startTransition(async () => {
      setResult(await releaseSalesOrder(formData));
    });
  }

  return (
    <div className="flex w-72 flex-col items-end gap-2">
      {departmentOptions.length > 0 ? (
        <div className="w-full rounded-xl border border-slate-200 bg-white p-3">
          <DepartmentPicker
            options={departmentOptions}
            value={departmentIds}
            onChange={setDepartmentIds}
            label="Route picks to"
            hint="Empty = any picker can take them."
          />
        </div>
      ) : null}
      <Button
        size="sm"
        disabled={isPending}
        onClick={handleClick}
        className="bg-teal-700 hover:bg-teal-800"
      >
        {isPending ? "Releasing..." : "Release to Floor"}
      </Button>
      {result?.error ? (
        <span className="text-xs font-medium text-red-600">{result.error}</span>
      ) : null}
      {result?.shortfalls && result.shortfalls.length > 0 ? (
        <div className="max-w-sm rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs text-amber-800">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5" /> Released short on{" "}
            {result.shortfalls.length} line
            {result.shortfalls.length === 1 ? "" : "s"}
          </p>
          {result.shortfalls.map((s) => (
            <p key={s.sku}>
              {s.sku}: reserved {s.allocated} of {s.requested}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function CancelSalesOrderButton({
  warehouseId,
  soId,
}: {
  warehouseId: number;
  soId: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    const formData = new FormData();
    formData.append("warehouseId", String(warehouseId));
    formData.append("soId", String(soId));
    startTransition(async () => {
      const res = await cancelSalesOrder(formData);
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
