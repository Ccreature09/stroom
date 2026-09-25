// Cycle-count core: comparing what was counted against what was expected,
// and deciding what that means. Pure -- no DB, no React.

export type CountVariance = {
  expected: number;
  counted: number;
  /** counted - expected. Negative is a shortage, positive an overage. */
  delta: number;
  absDelta: number;
  isMatch: boolean;
  isShortage: boolean;
  isOverage: boolean;
  /** |delta| / expected, or null when expected is 0 (no meaningful ratio). */
  variancePct: number | null;
};

export function computeVariance(expected: number, counted: number): CountVariance {
  const delta = counted - expected;
  return {
    expected,
    counted,
    delta,
    absDelta: Math.abs(delta),
    isMatch: delta === 0,
    isShortage: delta < 0,
    isOverage: delta > 0,
    variancePct: expected > 0 ? Math.abs(delta) / expected : null,
  };
}

/**
 * Whether a variance is big enough that someone should look before it is
 * written into inventory.
 *
 * Counting turns up small discrepancies constantly and stopping for each one
 * would mean nobody ever counts. The threshold is deliberately two-sided --
 * a proportional band for ordinary lines, plus an absolute floor so that a
 * large absolute swing on a big quantity is not waved through just because
 * it is a small percentage.
 */
export const VARIANCE_REVIEW_PCT = 0.1;
export const VARIANCE_REVIEW_UNITS = 25;

export function needsReview(variance: CountVariance): boolean {
  if (variance.isMatch) return false;
  if (variance.absDelta >= VARIANCE_REVIEW_UNITS) return true;
  if (variance.variancePct === null) return true; // counted stock where none was expected
  return variance.variancePct >= VARIANCE_REVIEW_PCT;
}

/**
 * Which stock movement a variance implies.
 *
 * A count never "moves" stock anywhere -- it corrects the record to match
 * the shelf -- so both directions are adjustments, matching what the manual
 * stock-adjust path already writes.
 */
export function movementTypeForVariance(variance: CountVariance): string | null {
  if (variance.isMatch) return null;
  return variance.isOverage ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT";
}
