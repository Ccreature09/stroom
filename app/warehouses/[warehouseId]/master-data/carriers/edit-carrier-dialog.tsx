"use client";

import { useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateCarrier } from "./actions";
import type { carriers } from "@/drizzle/schema";

type Carrier = typeof carriers.$inferSelect;

export function EditCarrierDialog({
  carrier,
  warehouseId,
  open,
  onOpenChange,
}: {
  carrier: Carrier;
  warehouseId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.append("carrierId", String(carrier.carrierId));
    formData.append("warehouseId", String(warehouseId));

    startTransition(async () => {
      const res = await updateCarrier(formData);
      if (res?.success) {
        onOpenChange(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Carrier</DialogTitle>
          <DialogDescription>
            Update this shipping partner&apos;s details.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-carrierName">
              Carrier Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="edit-carrierName"
              name="carrierName"
              required
              defaultValue={carrier.name}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-scac">
              SCAC (Standard Carrier Alpha Code)
            </Label>
            <Input
              id="edit-scac"
              name="scac"
              maxLength={4}
              defaultValue={carrier.scacCode ?? ""}
              className="uppercase"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-trackingUrlTemplate">
              Tracking URL Template
            </Label>
            <Input
              id="edit-trackingUrlTemplate"
              name="trackingUrlTemplate"
              defaultValue={carrier.trackingUrlTemplate ?? ""}
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
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="bg-teal-700 hover:bg-teal-800"
            >
              {isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
