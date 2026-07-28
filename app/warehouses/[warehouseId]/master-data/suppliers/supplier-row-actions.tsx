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
import { deleteSupplier } from "./actions";
import { EditSupplierDialog } from "./edit-supplier-dialog";
import type { suppliers } from "@/drizzle/schema";

type Supplier = typeof suppliers.$inferSelect;

export function SupplierRowActions({
  supplier,
  warehouseId,
}: {
  supplier: Supplier;
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
              Edit Supplier
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <form action={deleteSupplier}>
            <input type="hidden" name="supplierId" value={supplier.supplierId} />
            <input type="hidden" name="warehouseId" value={warehouseId} />
            <button type="submit" className="w-full text-left">
              <DropdownMenuItem className="text-red-600">
                Delete Supplier
              </DropdownMenuItem>
            </button>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditSupplierDialog
        supplier={supplier}
        warehouseId={warehouseId}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  );
}
