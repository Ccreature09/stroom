// Value-added services core: deciding whether an order needs VAS and what
// the worker's checklist should say.
//
// Pure -- no DB, no React. "Which standing rules apply to this order" is the
// kind of thing that should be readable without a database in the way.

export type VasRuleMatch = {
  ruleId: number;
  name: string;
  appliesTo: "ALL" | "CUSTOMER" | "ITEM";
  customerId: number | null;
  itemId: number | null;
  steps: { sortOrder: number; instruction: string }[];
};

export type OrderContext = {
  customerId: number;
  /** Every item on the order, so ITEM-scoped rules can be matched. */
  itemIds: number[];
};

/**
 * Which rules apply to this order.
 *
 * A rule matches if it is warehouse-wide (`ALL`), targets this order's
 * customer, or targets any item on the order. Matching is additive -- an
 * order for a fussy customer containing a fragile item gets both rule sets,
 * because both instructions genuinely need doing.
 */
export function matchRules(
  rules: VasRuleMatch[],
  order: OrderContext,
): VasRuleMatch[] {
  const itemIds = new Set(order.itemIds);
  return rules.filter((rule) => {
    if (rule.appliesTo === "ALL") return true;
    if (rule.appliesTo === "CUSTOMER") return rule.customerId === order.customerId;
    if (rule.appliesTo === "ITEM") return rule.itemId !== null && itemIds.has(rule.itemId);
    return false;
  });
}

/**
 * Flattens matched rules into the checklist a worker sees.
 *
 * Instructions are de-duplicated on their text: two rules both saying "apply
 * the customer logo" is a normal consequence of layering a customer rule over
 * a warehouse-wide one, and showing it twice would just look like a bug.
 * Order follows rule order then step order, so related instructions stay
 * together rather than interleaving.
 */
export function buildChecklist(
  matched: VasRuleMatch[],
): { sortOrder: number; instruction: string }[] {
  const seen = new Set<string>();
  const out: { sortOrder: number; instruction: string }[] = [];

  for (const rule of matched) {
    const ordered = [...rule.steps].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const step of ordered) {
      const key = step.instruction.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ sortOrder: out.length, instruction: step.instruction.trim() });
    }
  }
  return out;
}

export type ChecklistProgress = {
  total: number;
  done: number;
  remaining: number;
  isComplete: boolean;
};

/** How far through the checklist the worker is. An empty checklist counts as
 *  complete -- there is nothing left to do, and blocking on it would strand
 *  the task. */
export function checklistProgress(
  steps: { isDone: boolean }[],
): ChecklistProgress {
  const total = steps.length;
  const done = steps.filter((s) => s.isDone).length;
  return { total, done, remaining: total - done, isComplete: done >= total };
}
