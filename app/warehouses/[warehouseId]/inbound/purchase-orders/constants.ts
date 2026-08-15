// Kept out of actions.ts because every export of a "use server" module must
// be an async server action -- a plain const there is a build error.

// RECEIVED/PARTIALLY_RECEIVED are derived from line receipts, never set
// directly -- see receivePurchaseOrderLine in actions.ts.
export const PO_STATUSES = [
  "DRAFT",
  "OPEN",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
] as const;
export type PurchaseOrderStatus = (typeof PO_STATUSES)[number];

export const PO_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  DRAFT: "Draft",
  OPEN: "Open",
  PARTIALLY_RECEIVED: "Partially Received",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
};
