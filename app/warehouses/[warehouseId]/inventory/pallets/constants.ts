// Kept out of actions.ts because every export of a "use server" module must be
// an async server action -- a plain const there is a build error.
export const PALLET_STATUSES = [
  "ACTIVE",
  "IN_TRANSIT",
  "CONSUMED",
  "DAMAGED",
] as const;

export type PalletStatus = (typeof PALLET_STATUSES)[number];
