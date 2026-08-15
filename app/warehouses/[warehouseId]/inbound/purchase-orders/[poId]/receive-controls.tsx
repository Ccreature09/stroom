"use client";

import { useState, useTransition } from "react";
import { PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { receivePurchaseOrderLine } from "../actions";

export type LocationOption = { locationId: number; locationCode: string };
export type StatusOption = { statusId: number; name: string };

const selectClassName =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

export function ReceiveLineButton({
  warehouseId,
  poLineId,
  remaining,
  itemLabel,
  locationOptions,
  statusOptions,
}: {
  warehouseId: number;
  poLineId: number;
  remaining: number;
  itemLabel: string;
  locationOptions: LocationOption[];
  statusOptions: StatusOption[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const blocked = locationOptions.length === 0 || statusOptions.length === 0;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    formData.append("warehouseId", String(warehouseId));
    formData.append("poLineId", String(poLineId));

    startTransition(async () => {
      const res = await receivePurchaseOrderLine(formData);
      if (res?.success) setOpen(false);
      else setError(res?.error ?? "Something went wrong.");
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={blocked}
        onClick={() => setOpen(true)}
        className="h-8 text-xs"
      >
        <PackageCheck className="mr-1.5 h-3.5 w-3.5" /> Receive
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Receive Line</DialogTitle>
              <DialogDescription>
                {itemLabel} — {remaining} unit{remaining === 1 ? "" : "s"} still
                expected on this line.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor={`receive-qty-${poLineId}`}>
                    Quantity <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id={`receive-qty-${poLineId}`}
                    name="quantity"
                    type="number"
                    min={1}
                    max={remaining}
                    step={1}
                    required
                    defaultValue={remaining}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`receive-status-${poLineId}`}>
                    Inventory Status <span className="text-destructive">*</span>
                  </Label>
                  <select
                    id={`receive-status-${poLineId}`}
                    name="statusId"
                    required
                    className={selectClassName}
                  >
                    <option value="">Select...</option>
                    {statusOptions.map((s) => (
                      <option key={s.statusId} value={s.statusId}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor={`receive-location-${poLineId}`}>
                  Location <span className="text-destructive">*</span>
                </Label>
                <select
                  id={`receive-location-${poLineId}`}
                  name="locationId"
                  required
                  className={selectClassName}
                >
                  <option value="">Select a location...</option>
                  {locationOptions.map((l) => (
                    <option key={l.locationId} value={l.locationId}>
                      {l.locationCode}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground">
                  Usually a dock or staging location -- this booking gets
                  put away to its final home separately.
                </p>
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
                {isPending ? "Receiving..." : "Receive"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
