"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TruckIcon } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { createShipment, dispatchShipment } from "./actions";

export type PickedOrder = { soId: number; soNumber: string };
export type CarrierOption = { carrierId: number; name: string };
export type DockOption = { locationId: number; locationCode: string };

const selectClassName =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function CreateShipmentDialog({
  warehouseId,
  pickedOrders,
  carrierOptions,
  dockOptions,
}: {
  warehouseId: number;
  pickedOrders: PickedOrder[];
  carrierOptions: CarrierOption[];
  dockOptions: DockOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<number[]>([]);

  const blocked = pickedOrders.length === 0 || dockOptions.length === 0;

  function toggle(soId: number) {
    setSelected((prev) =>
      prev.includes(soId) ? prev.filter((id) => id !== soId) : [...prev, soId],
    );
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (selected.length === 0) return setError("Select at least one order.");

    const formData = new FormData(e.currentTarget);
    formData.append("warehouseId", String(warehouseId));
    formData.append("soIds", selected.join(","));

    startTransition(async () => {
      const res = await createShipment(formData);
      if (res?.success) {
        setOpen(false);
        setSelected([]);
        if (res.shipmentId) {
          router.push(`/warehouses/${warehouseId}/outbound/shipments/${res.shipmentId}`);
        } else {
          router.refresh();
        }
      } else {
        setError(res?.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-teal-700 hover:bg-teal-800" disabled={blocked}>
          <TruckIcon className="mr-2 h-4 w-4" /> Build Shipment
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Build a Shipment</DialogTitle>
            <DialogDescription>
              Groups picked orders onto one trailer and raises a loading task
              per order pallet.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Picked orders
              </Label>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border bg-card p-2">
                {pickedOrders.map((order) => (
                  <label
                    key={order.soId}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/60"
                  >
                    <Checkbox
                      checked={selected.includes(order.soId)}
                      onCheckedChange={() => toggle(order.soId)}
                    />
                    <span className="font-mono text-xs font-semibold">{order.soNumber}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ship-dock">
                Dock door <span className="text-destructive">*</span>
              </Label>
              <select id="ship-dock" name="dockDoorLocationId" required className={selectClassName}>
                <option value="">Select a dock...</option>
                {dockOptions.map((d) => (
                  <option key={d.locationId} value={d.locationId}>
                    {d.locationCode}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ship-carrier">Carrier</Label>
                <select id="ship-carrier" name="carrierId" className={selectClassName}>
                  <option value="">Not set</option>
                  {carrierOptions.map((c) => (
                    <option key={c.carrierId} value={c.carrierId}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ship-trailer">Trailer number</Label>
                <Input id="ship-trailer" name="trailerNumber" placeholder="e.g. TRL-7781" />
              </div>
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
              {isPending ? "Building..." : "Build Shipment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DispatchShipmentButton({
  warehouseId,
  shipmentId,
}: {
  warehouseId: number;
  shipmentId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState("");

  function handleDispatch() {
    setError(null);
    const formData = new FormData();
    formData.append("warehouseId", String(warehouseId));
    formData.append("shipmentId", shipmentId);
    if (trackingNumber.trim()) formData.append("trackingNumber", trackingNumber.trim());
    startTransition(async () => {
      const res = await dispatchShipment(formData);
      if (res?.error) setError(res.error);
      else setConfirming(false);
    });
  }

  if (!confirming) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        {error ? <span className="text-xs font-medium text-red-600">{error}</span> : null}
        <Button
          size="sm"
          onClick={() => setConfirming(true)}
          className="bg-teal-700 hover:bg-teal-800"
        >
          Dispatch
        </Button>
      </div>
    );
  }

  return (
    <div className="w-72 space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <Label htmlFor="dispatch-tracking" className="text-xs">
        Tracking number (optional)
      </Label>
      <Input
        id="dispatch-tracking"
        value={trackingNumber}
        onChange={(e) => setTrackingNumber(e.target.value)}
        placeholder="Carrier tracking reference"
        className="h-9 text-sm"
      />
      {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setConfirming(false)}
          className="flex-1"
        >
          Back
        </Button>
        <Button
          size="sm"
          disabled={isPending}
          onClick={handleDispatch}
          className="flex-1 bg-teal-700 hover:bg-teal-800"
        >
          {isPending ? "Dispatching..." : "Confirm"}
        </Button>
      </div>
    </div>
  );
}
