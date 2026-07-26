"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
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
import { Checkbox } from "@/components/ui/checkbox";
import { createItem } from "./actions";

export function AddItemDialog({ warehouseId }: { warehouseId: number }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.append("warehouseId", String(warehouseId));

    startTransition(async () => {
      const res = await createItem(formData);
      if (res?.success) {
        setOpen(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-teal-700 hover:bg-teal-800">
          <Plus className="mr-2 h-4 w-4" /> Add Item
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add New Master Item</DialogTitle>
            <DialogDescription>
              Catalog a new SKU into your organization inventory master.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sku">
                  SKU <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="sku"
                  name="sku"
                  required
                  placeholder="e.g. WGT-1001"
                  className="uppercase"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="barcode">Barcode</Label>
                <Input
                  id="barcode"
                  name="barcode"
                  placeholder="e.g. 012345678905"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">
                  Item Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  name="name"
                  required
                  placeholder="e.g. Stainless Steel Bolt 10mm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Input
                  id="category"
                  name="category"
                  placeholder="e.g. Fasteners"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                rows={2}
                placeholder="Detailed product specification or handling instructions..."
                className="resize-none"
              />
            </div>

            {/* Dimensions & Weight */}
            <div className="border-t border-border pt-3">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Dimensions & Physical Spec
              </span>
              <div className="mt-2 grid grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="lengthCm" className="text-[11px]">
                    Length (cm)
                  </Label>
                  <Input
                    id="lengthCm"
                    type="number"
                    step="0.01"
                    name="lengthCm"
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="widthCm" className="text-[11px]">
                    Width (cm)
                  </Label>
                  <Input
                    id="widthCm"
                    type="number"
                    step="0.01"
                    name="widthCm"
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="heightCm" className="text-[11px]">
                    Height (cm)
                  </Label>
                  <Input
                    id="heightCm"
                    type="number"
                    step="0.01"
                    name="heightCm"
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="weightKg" className="text-[11px]">
                    Weight (kg)
                  </Label>
                  <Input
                    id="weightKg"
                    type="number"
                    step="0.001"
                    name="weightKg"
                    placeholder="0.000"
                  />
                </div>
              </div>
            </div>

            {/* Stock & Hazards */}
            <div className="grid grid-cols-3 gap-4 border-t border-border pt-3">
              <div className="space-y-2">
                <Label htmlFor="hazardClass">Hazard Class</Label>
                <Input
                  id="hazardClass"
                  name="hazardClass"
                  defaultValue="None"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="minStockLevel">Min Stock Level</Label>
                <Input
                  id="minStockLevel"
                  type="number"
                  name="minStockLevel"
                  defaultValue={0}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="shelfLifeDays">Shelf Life (Days)</Label>
                <Input
                  id="shelfLifeDays"
                  type="number"
                  name="shelfLifeDays"
                  placeholder="e.g. 365"
                />
              </div>
            </div>

            {/* Tracking Flags */}
            <div className="border-t border-border pt-3">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Tracking Controls
              </span>
              <div className="mt-2 flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/40 p-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="isBatchTracked"
                    name="isBatchTracked"
                    value="on"
                  />
                  <Label
                    htmlFor="isBatchTracked"
                    className="text-xs cursor-pointer"
                  >
                    Batch Tracked
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox id="isLotTracked" name="isLotTracked" value="on" />
                  <Label
                    htmlFor="isLotTracked"
                    className="text-xs cursor-pointer"
                  >
                    Lot Tracked
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox id="hasExpiry" name="hasExpiry" value="on" />
                  <Label htmlFor="hasExpiry" className="text-xs cursor-pointer">
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
              {isPending ? "Saving..." : "Save Item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
