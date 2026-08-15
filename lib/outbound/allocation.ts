// Outbound allocation core.
//
// Pure planning logic, no React / no DB -- same functional-core split the
// warehouse-map module uses, and for the same reason: "which stock should
// this order consume" is where the subtle errors live, and it should be
// readable and testable without a database.

/** One on-hand inventory row that could satisfy a demand. */
export type StockCandidate = {
  inventoryId: number;
  locationId: number;
  locationCode: string;
  quantity: number;
  batchNumber: string | null;
  lotNumber: string | null;
  expiryDate: string | null;
};

export type PlannedPick = {
  candidate: StockCandidate;
  quantity: number;
};

export type AllocationPlan = {
  picks: PlannedPick[];
  allocated: number;
  /** Requested minus allocated. > 0 means we could not fully cover it. */
  shortfall: number;
};

/**
 * FEFO ordering: first-expiring stock goes out first, then oldest batch, then
 * a stable tiebreak on location so the same request always plans the same
 * picks (the router makes the same determinism argument -- a plan that
 * reshuffles between two identical runs is one nobody can verify).
 *
 * Rows with no expiry sort last: undated stock is the safe thing to hold
 * back, since dated stock is the stock that can spoil.
 */
export function compareFefo(a: StockCandidate, b: StockCandidate): number {
  if (a.expiryDate !== b.expiryDate) {
    if (a.expiryDate === null) return 1;
    if (b.expiryDate === null) return -1;
    return a.expiryDate < b.expiryDate ? -1 : 1;
  }
  if (a.locationCode !== b.locationCode) {
    return a.locationCode < b.locationCode ? -1 : 1;
  }
  return a.inventoryId - b.inventoryId;
}

/**
 * Greedily covers `requested` from the candidates, FEFO first.
 *
 * Deliberately reports a shortfall rather than throwing: a partially
 * allocatable order is a completely normal warehouse situation (the rest is
 * on a truck somewhere), and the caller decides whether to release what it
 * has or wait. Refusing the whole order because one line is two units short
 * would be worse than useless on a real floor.
 *
 * Never splits below one unit and never emits a zero-quantity pick, so every
 * planned pick is a real instruction someone can walk to.
 */
export function planAllocation(
  candidates: StockCandidate[],
  requested: number,
): AllocationPlan {
  if (requested <= 0) return { picks: [], allocated: 0, shortfall: 0 };

  const ordered = [...candidates].sort(compareFefo);
  const picks: PlannedPick[] = [];
  let remaining = requested;

  for (const candidate of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(candidate.quantity, remaining);
    if (take <= 0) continue;
    picks.push({ candidate, quantity: take });
    remaining -= take;
  }

  return {
    picks,
    allocated: requested - remaining,
    shortfall: remaining,
  };
}

/**
 * Key for matching an inventory row against a commitment already made
 * against it. Batch/lot are nullable and NULL means "untracked", not
 * "unknown" -- two untracked rows at the same location for the same item are
 * the same stock, so they must collapse to one key.
 */
export function stockKey(
  locationId: number,
  itemId: number,
  batchNumber: string | null,
  lotNumber: string | null,
): string {
  return `${locationId}:${itemId}:${batchNumber ?? ""}:${lotNumber ?? ""}`;
}

/**
 * Subtracts stock already promised to open pick tasks from what the shelf
 * physically holds.
 *
 * This is "soft allocation": there is no reserved-quantity column on
 * `inventory`, so a commitment lives only as an open picking task. Deriving
 * availability from those tasks means two orders released back to back can
 * never both be told the same pallet is free, without needing a migration
 * or a second source of truth that could drift from the tasks themselves.
 */
export function subtractCommitted(
  candidates: StockCandidate[],
  itemId: number,
  committedByKey: Map<string, number>,
): StockCandidate[] {
  const available: StockCandidate[] = [];
  for (const candidate of candidates) {
    const committed =
      committedByKey.get(
        stockKey(candidate.locationId, itemId, candidate.batchNumber, candidate.lotNumber),
      ) ?? 0;
    const free = candidate.quantity - committed;
    if (free > 0) available.push({ ...candidate, quantity: free });
  }
  return available;
}
