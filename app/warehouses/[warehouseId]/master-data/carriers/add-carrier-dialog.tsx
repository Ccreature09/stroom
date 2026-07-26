"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCarrier } from "./actions";

export function AddCarrierDialog({ warehouseId }: { warehouseId: number }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.append("warehouseId", String(warehouseId));

    startTransition(async () => {
      const res = await createCarrier(formData);
      if (res?.success) {
        setOpen(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-teal-700 hover:bg-teal-800">
          <Plus className="mr-2 h-4 w-4" /> Add Carrier
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add New Carrier</DialogTitle>
          <DialogDescription>
            Register a new shipping partner or freight provider.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="carrierName">
              Carrier Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="carrierName"
              name="carrierName"
              required
              placeholder="e.g. FedEx Express"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="scac">SCAC (Standard Carrier Alpha Code)</Label>
            <Input
              id="scac"
              name="scac"
              maxLength={4}
              placeholder="e.g. FDEG"
              className="uppercase"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="trackingUrlTemplate">Tracking URL Template</Label>
            <Input
              id="trackingUrlTemplate"
              name="trackingUrlTemplate"
              placeholder="e.g. https://www.fedex.com/fedextrack/?trknbr={tracking_number}"
            />
            <p className="text-[11px] text-muted-foreground">
              Use <code className="font-mono">{`{tracking_number}`}</code> as a
              placeholder for dynamic tracking links.
            </p>
          </div>

          <DialogFooter className="pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="bg-teal-700 hover:bg-teal-800"
            >
              {isPending ? "Saving..." : "Save Carrier"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
