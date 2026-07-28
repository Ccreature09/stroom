"use client";

import { useTransition } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateSupplier } from "./actions";
import type { suppliers } from "@/drizzle/schema";

type Supplier = typeof suppliers.$inferSelect;

export function EditSupplierDialog({
  supplier,
  warehouseId,
  open,
  onOpenChange,
}: {
  supplier: Supplier;
  warehouseId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.append("supplierId", String(supplier.supplierId));
    formData.append("warehouseId", String(warehouseId));

    startTransition(async () => {
      const res = await updateSupplier(formData);
      if (res?.success) {
        onOpenChange(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Supplier</DialogTitle>
            <DialogDescription>
              Update this vendor&apos;s contact details.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2">
                <Label htmlFor="edit-supplier-name">
                  Supplier Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="edit-supplier-name"
                  name="name"
                  required
                  defaultValue={supplier.name}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-supplier-contactName">
                  Contact Person
                </Label>
                <Input
                  id="edit-supplier-contactName"
                  name="contactName"
                  defaultValue={supplier.contactName ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-supplier-contactEmail">
                  Contact Email
                </Label>
                <Input
                  id="edit-supplier-contactEmail"
                  type="email"
                  name="contactEmail"
                  defaultValue={supplier.contactEmail ?? ""}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-supplier-contactPhone">
                  Contact Phone
                </Label>
                <Input
                  id="edit-supplier-contactPhone"
                  name="contactPhone"
                  defaultValue={supplier.contactPhone ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-supplier-leadTimeDays">
                  Lead Time (Days)
                </Label>
                <Input
                  id="edit-supplier-leadTimeDays"
                  type="number"
                  name="leadTimeDays"
                  defaultValue={supplier.leadTimeDays ?? ""}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-supplier-address">Address</Label>
              <Textarea
                id="edit-supplier-address"
                name="address"
                rows={3}
                defaultValue={supplier.address ?? ""}
                className="resize-none"
              />
            </div>
          </div>

          <DialogFooter className="pt-4">
            <DialogClose asChild>
              <Button variant="outline" type="button">
                Cancel
              </Button>
            </DialogClose>
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
