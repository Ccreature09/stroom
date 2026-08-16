// Kept out of actions.ts because every export of a "use server" module must
// be an async server action -- a plain const there is a build error.

// PICKING/PICKED are derived from pick-task progress, never set directly;
// SHIPPED is set by dispatching a shipment. See sales-orders/actions.ts and
// shipments/actions.ts.
// PACKING/PACKED only occur where value-added services are switched on for
// the warehouse (see warehouse_task_settings) -- a full-pallet operation goes
// PICKED straight to SHIPPED and never sees them.
export const SO_STATUSES = [
  "DRAFT",
  "RELEASED",
  "PICKING",
  "PICKED",
  "PACKING",
  "PACKED",
  "SHIPPED",
  "CANCELLED",
] as const;
export type SalesOrderStatus = (typeof SO_STATUSES)[number];

export const SO_STATUS_LABEL: Record<SalesOrderStatus, string> = {
  DRAFT: "Draft",
  RELEASED: "Released",
  PICKING: "Picking",
  PICKED: "Picked",
  PACKING: "Packing / VAS",
  PACKED: "Packed",
  SHIPPED: "Shipped",
  CANCELLED: "Cancelled",
};

export const SO_STATUS_STYLE: Record<SalesOrderStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-600 border-slate-200",
  RELEASED: "bg-blue-50 text-blue-700 border-blue-200",
  PICKING: "bg-amber-50 text-amber-700 border-amber-200",
  PICKED: "bg-violet-50 text-violet-700 border-violet-200",
  PACKING: "bg-orange-50 text-orange-700 border-orange-200",
  PACKED: "bg-cyan-50 text-cyan-700 border-cyan-200",
  SHIPPED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
};
