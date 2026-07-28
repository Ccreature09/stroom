"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toggleCustomerStatus } from "./actions";
import { EditCustomerDialog } from "./edit-customer-dialog";
import type { customers } from "@/drizzle/schema";

type Customer = typeof customers.$inferSelect;

export function CustomerRowActions({
  customer,
  warehouseId,
}: {
  customer: Customer;
  warehouseId: number;
}) {
  const [editOpen, setEditOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="h-8 w-8 p-0 inline-flex items-center justify-center rounded-md text-sm font-medium hover:bg-slate-100 focus:outline-none">
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setEditOpen(true)}>
              Edit Customer
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <form action={toggleCustomerStatus}>
            <input
              type="hidden"
              name="customerId"
              value={customer.customerId}
            />
            <input type="hidden" name="warehouseId" value={warehouseId} />
            <input
              type="hidden"
              name="isActive"
              value={String(customer.isActive)}
            />
            <button type="submit" className="w-full text-left">
              <DropdownMenuItem
                className={
                  customer.isActive ? "text-red-600" : "text-emerald-700"
                }
              >
                {customer.isActive ? "Deactivate Customer" : "Activate Customer"}
              </DropdownMenuItem>
            </button>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditCustomerDialog
        customer={customer}
        warehouseId={warehouseId}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  );
}
