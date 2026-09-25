// Replenishment core: deciding when a pick face is running dry and which
// reserve stock should top it up.
//
// Pure, no DB and no React -- same functional-core split as the outbound
// allocator, and this deliberately *reuses* that allocator rather than
// growing a second one: "cover N units from these candidates, oldest stock
// first" is the identical problem whether the demand is a customer order or
// an empty pick face.

import { planAllocation, type AllocationPlan, type StockCandidate } from "@/lib/outbound/allocation";

export type LocationRole = "PICK_FACE" | "RESERVE" | "OTHER";

/**
 * Where a location sits in the pick-face/reserve split.
 *
 * There is no `is_pick_face` column, so this is derived from the rack tier,
 * which is the convention real racking already follows: you pick from the
 * level you can reach and store the rest above it. Level 1 (or an unset
 * level, which is how shelving and single-tier storage come through) is the
 * face; anything higher is reserve.
 *
 * Isolated in one function precisely because it *is* a convention rather
 * than a fact -- a warehouse that flags pick faces explicitly later only has
 * to change this.
 */
export function classifyLocationRole(
  locationType: string,
  level: number | null,
): LocationRole {
  if (locationType === "SHELF") return "PICK_FACE";
  if (locationType !== "RACKING") return "OTHER";
  return level === null || level <= 1 ? "PICK_FACE" : "RESERVE";
}

export type ReplenishmentNeed = {
  itemId: number;
  sku: string;
  itemName: string;
  /** Total units currently across this item's pick faces. */
  pickFaceQuantity: number;
  /** items.min_stock_level -- the level the face should be kept at. */
  minStockLevel: number;
  /** How far below the minimum the face has fallen. */
  deficit: number;
  /** Where to pull from, oldest stock first. */
  plan: AllocationPlan;
  /** The face the stock should land on. */
  destinationLocationId: number;
  destinationLocationCode: string;
};

/**
 * Works out whether an item needs topping up and where from.
 *
 * Returns null when there is nothing to do, so a caller can map over every
 * item and filter -- "no need" and "need we cannot meet" are different
 * answers, and only the second one is worth a supervisor's attention.
 * A need with an empty plan is still returned: a face that is empty with no
 * reserve behind it is exactly the situation someone has to know about.
 */
export function planReplenishment(input: {
  itemId: number;
  sku: string;
  itemName: string;
  minStockLevel: number;
  pickFaceQuantity: number;
  /** Candidate pick faces for this item, most-stocked first. */
  destination: { locationId: number; locationCode: string } | null;
  reserveCandidates: StockCandidate[];
}): ReplenishmentNeed | null {
  if (input.minStockLevel <= 0) return null;
  if (input.pickFaceQuantity >= input.minStockLevel) return null;
  if (!input.destination) return null;

  const deficit = input.minStockLevel - input.pickFaceQuantity;
  return {
    itemId: input.itemId,
    sku: input.sku,
    itemName: input.itemName,
    pickFaceQuantity: input.pickFaceQuantity,
    minStockLevel: input.minStockLevel,
    deficit,
    // Same greedy FEFO cover the outbound allocator uses.
    plan: planAllocation(input.reserveCandidates, deficit),
    destinationLocationId: input.destination.locationId,
    destinationLocationCode: input.destination.locationCode,
  };
}
