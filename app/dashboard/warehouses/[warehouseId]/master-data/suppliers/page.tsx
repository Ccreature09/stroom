"use client";

import React, { useState } from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Search, MoreHorizontal, Building2, Mail, Phone, MapPin } from "lucide-react";

export type SupplierRow = {
  supplier_id: number;
  code: string;
  name: string;
  contact_email: string;
  contact_phone: string;
  address_summary: string;
  is_active: boolean;
};

const mockSuppliers: SupplierRow[] = [
  {
    supplier_id: 1,
    code: "SUP-010",
    name: "Acme Logistics & Packaging Ltd.",
    contact_email: "orders@acmepackaging.com",
    contact_phone: "+31 20 555 0192",
    address_summary: "Rotterdam, Netherlands",
    is_active: true,
  },
  {
    supplier_id: 2,
    code: "SUP-014",
    name: "Nordic ChemTech GmbH",
    contact_email: "supply@nordicchem.de",
    contact_phone: "+49 30 112 884",
    address_summary: "Hamburg, Germany",
    is_active: true,
  },
];

export const columns: ColumnDef<SupplierRow>[] = [
  {
    accessorKey: "code",
    header: "Vendor Code",
    cell: ({ row }) => <span className="font-mono font-semibold">{row.getValue("code")}</span>,
  },
  {
    accessorKey: "name",
    header: "Supplier Name",
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{row.getValue("name")}</span>
      </div>
    ),
  },
  {
    id: "contact",
    header: "Contact Details",
    cell: ({ row }) => (
      <div className="text-xs space-y-0.5">
        <div className="flex items-center gap-1.5">
          <Mail className="h-3 w-3 text-muted-foreground" />
          <span>{row.original.contact_email}</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Phone className="h-3 w-3" />
          <span>{row.original.contact_phone}</span>
        </div>
      </div>
    ),
  },
  {
    accessorKey: "address_summary",
    header: "Location",
    cell: ({ row }) => (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <MapPin className="h-3.5 w-3.5" />
        <span>{row.getValue("address_summary")}</span>
      </div>
    ),
  },
  {
    accessorKey: "is_active",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={row.getValue("is_active") ? "default" : "secondary"}>
        {row.getValue("is_active") ? "Active" : "Inactive"}
      </Badge>
    ),
  },
  {
    id: "actions",
    cell: ({ row }) => (
      <DropdownMenu>
        <DropdownMenuTrigger>
          <Button variant="ghost" className="h-8 w-8 p-0">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Actions</DropdownMenuLabel>
          <DropdownMenuItem>Edit Supplier</DropdownMenuItem>
          <DropdownMenuItem>View Inbound POs</DropdownMenuItem>
          <DropdownMenuItem className="text-destructive">
            {row.original.is_active ? "Deactivate" : "Activate"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  },
];

export default function SuppliersPage() {
  const [data] = useState<SupplierRow[]>(mockSuppliers);
  const [globalFilter, setGlobalFilter] = useState("");

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: { globalFilter },
    onGlobalFilterChange: setGlobalFilter,
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Suppliers Registry</h1>
          <p className="text-sm text-muted-foreground">
            Manage vendors supplying goods for inbound purchase orders.
          </p>
        </div>
        <Button className="flex items-center gap-2">
          <Plus className="h-4 w-4" /> Add Supplier
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search suppliers..."
          value={globalFilter ?? ""}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="pl-8"
        />
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead key={h.id}>
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No suppliers registered.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}