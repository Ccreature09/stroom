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
import { toggleCarrierStatus } from "./actions";
import { EditCarrierDialog } from "./edit-carrier-dialog";
import type { carriers } from "@/drizzle/schema";

type Carrier = typeof carriers.$inferSelect;

export function CarrierRowActions({
  carrier,
  warehouseId,
}: {
  carrier: Carrier;
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
          {/* DropdownMenuGroup provides the required Base UI context */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setEditOpen(true)}>
              Edit Carrier
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <form action={toggleCarrierStatus}>
            <input type="hidden" name="carrierId" value={carrier.carrierId} />
            <input type="hidden" name="warehouseId" value={warehouseId} />
            <input
              type="hidden"
              name="isActive"
              value={String(carrier.isActive)}
            />
            <button type="submit" className="w-full text-left">
              <DropdownMenuItem
                className={
                  carrier.isActive ? "text-red-600" : "text-emerald-700"
                }
              >
                {carrier.isActive ? "Deactivate Carrier" : "Activate Carrier"}
              </DropdownMenuItem>
            </button>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditCarrierDialog
        carrier={carrier}
        warehouseId={warehouseId}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  );
}
