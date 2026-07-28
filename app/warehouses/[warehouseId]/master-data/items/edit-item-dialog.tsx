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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { updateItem } from "./actions";
import type { items } from "@/drizzle/schema";

type Item = typeof items.$inferSelect;

export function EditItemDialog({
  item,
  warehouseId,
  open,
  onOpenChange,
}: {
  item: Item;
  warehouseId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.append("itemId", String(item.itemId));
    formData.append("warehouseId", String(warehouseId));

    startTransition(async () => {
      const res = await updateItem(formData);
      if (res?.success) {
        onOpenChange(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Master Item</DialogTitle>
            <DialogDescription>
              Update the SKU details for this catalog item.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-sku">
                  SKU <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="edit-sku"
                  name="sku"
                  required
                  defaultValue={item.sku}
                  className="uppercase"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-barcode">Barcode</Label>
                <Input
                  id="edit-barcode"
                  name="barcode"
                  defaultValue={item.barcode ?? ""}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">
                  Item Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="edit-name"
                  name="name"
                  required
                  defaultValue={item.name}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-category">Category</Label>
                <Input
                  id="edit-category"
                  name="category"
                  defaultValue={item.category ?? ""}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                name="description"
                rows={2}
                defaultValue={item.description ?? ""}
                className="resize-none"
              />
            </div>

            <div className="border-t border-border pt-3">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Dimensions & Physical Spec
              </span>
              <div className="mt-2 grid grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="edit-lengthCm" className="text-[11px]">
                    Length (cm)
                  </Label>
                  <Input
                    id="edit-lengthCm"
                    type="number"
                    step="0.01"
                    name="lengthCm"
                    defaultValue={item.lengthCm}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edit-widthCm" className="text-[11px]">
                    Width (cm)
                  </Label>
                  <Input
                    id="edit-widthCm"
                    type="number"
                    step="0.01"
                    name="widthCm"
                    defaultValue={item.widthCm}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edit-heightCm" className="text-[11px]">
                    Height (cm)
                  </Label>
                  <Input
                    id="edit-heightCm"
                    type="number"
                    step="0.01"
                    name="heightCm"
                    defaultValue={item.heightCm}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edit-weightKg" className="text-[11px]">
                    Weight (kg)
                  </Label>
                  <Input
                    id="edit-weightKg"
                    type="number"
                    step="0.001"
                    name="weightKg"
                    defaultValue={item.weightKg}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 border-t border-border pt-3">
              <div className="space-y-2">
                <Label htmlFor="edit-hazardClass">Hazard Class</Label>
                <Input
                  id="edit-hazardClass"
                  name="hazardClass"
                  defaultValue={item.hazardClass ?? "None"}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-minStockLevel">Min Stock Level</Label>
                <Input
                  id="edit-minStockLevel"
                  type="number"
                  name="minStockLevel"
                  defaultValue={item.minStockLevel ?? 0}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-shelfLifeDays">Shelf Life (Days)</Label>
                <Input
                  id="edit-shelfLifeDays"
                  type="number"
                  name="shelfLifeDays"
                  defaultValue={item.shelfLifeDays ?? ""}
                />
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Tracking Controls
              </span>
              <div className="mt-2 flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/40 p-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="edit-isBatchTracked"
                    name="isBatchTracked"
                    value="on"
                    defaultChecked={item.isBatchTracked}
                  />
                  <Label
                    htmlFor="edit-isBatchTracked"
                    className="text-xs cursor-pointer"
                  >
                    Batch Tracked
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="edit-isLotTracked"
                    name="isLotTracked"
                    value="on"
                    defaultChecked={item.isLotTracked}
                  />
                  <Label
                    htmlFor="edit-isLotTracked"
                    className="text-xs cursor-pointer"
                  >
                    Lot Tracked
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="edit-hasExpiry"
                    name="hasExpiry"
                    value="on"
                    defaultChecked={item.hasExpiry}
                  />
                  <Label
                    htmlFor="edit-hasExpiry"
                    className="text-xs cursor-pointer"
                  >
                    Has Expiration
                  </Label>
                </div>
              </div>
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
