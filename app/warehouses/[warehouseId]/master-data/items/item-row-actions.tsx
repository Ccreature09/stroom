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
import { deleteItem } from "./actions";
import { EditItemDialog } from "./edit-item-dialog";
import type { items } from "@/drizzle/schema";

type Item = typeof items.$inferSelect;

export function ItemRowActions({
  item,
  warehouseId,
}: {
  item: Item;
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
              Edit Item
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <form action={deleteItem}>
            <input type="hidden" name="itemId" value={item.itemId} />
            <input type="hidden" name="warehouseId" value={warehouseId} />
            <button type="submit" className="w-full text-left">
              <DropdownMenuItem className="text-red-600">
                Delete Item
              </DropdownMenuItem>
            </button>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditItemDialog
        item={item}
        warehouseId={warehouseId}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  );
}
