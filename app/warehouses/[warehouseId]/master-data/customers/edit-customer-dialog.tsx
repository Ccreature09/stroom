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
import { Textarea } from "@/components/ui/textarea";
import { updateCustomer } from "./actions";
import type { customers } from "@/drizzle/schema";

type Customer = typeof customers.$inferSelect;

export function EditCustomerDialog({
  customer,
  warehouseId,
  open,
  onOpenChange,
}: {
  customer: Customer;
  warehouseId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.append("customerId", String(customer.customerId));
    formData.append("warehouseId", String(warehouseId));

    startTransition(async () => {
      const res = await updateCustomer(formData);
      if (res?.success) {
        onOpenChange(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Customer</DialogTitle>
          <DialogDescription>
            Update this client&apos;s account details.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-customer-name">
              Customer Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="edit-customer-name"
              name="name"
              required
              defaultValue={customer.name}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-customer-email">Email</Label>
              <Input
                id="edit-customer-email"
                type="email"
                name="email"
                defaultValue={customer.contactEmail ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-customer-phone">Phone</Label>
              <Input
                id="edit-customer-phone"
                type="tel"
                name="phone"
                defaultValue={customer.contactPhone ?? ""}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-customer-defaultShippingAddress">
              Default Shipping Address
            </Label>
            <Textarea
              id="edit-customer-defaultShippingAddress"
              name="defaultShippingAddress"
              rows={3}
              defaultValue={customer.defaultShippingAddress ?? ""}
              className="resize-none"
            />
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
