/**
 * Pure KPI arithmetic. No database, no React, no clock.
 *
 * Warehouse metrics are easy to get subtly wrong in ways nobody notices until
 * someone makes a staffing decision on them, so the rules this module encodes
 * are deliberate:
 *
 *   - A metric with no observations is `null`, never `0`. "Nobody picked
 *     anything today" and "the median pick took no time at all" are different
 *     statements and only one of them is ever true.
 *   - Medians, not means. One task left open over a weekend drags a mean into
 *     nonsense; the median tells you what the shift actually felt like.
 *   - Impossible durations are dropped rather than clamped. A task that
 *     finished before it started is bad data (an imported record, a hand-edited
 *     timestamp), and folding a zero into the sample pretends it was instant.
 */

export type DurationSummary = {
  /** Observations that survived validation. */
  count: number;
  /** Observations discarded as impossible (negative durations). */
  discarded: number;
  medianMinutes: number | null;
  p90Minutes: number | null;
  meanMinutes: number | null;
};

const EMPTY_SUMMARY: DurationSummary = {
  count: 0,
  discarded: 0,
  medianMinutes: null,
  p90Minutes: null,
  meanMinutes: null,
};

/**
 * Linear-interpolated percentile over an already-sorted ascending array.
 * Returns null for an empty sample rather than guessing.
 */
export function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const clamped = Math.min(Math.max(p, 0), 1);
  const position = clamped * (sortedAsc.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedAsc[lower];
  const weight = position - lower;
  return sortedAsc[lower] * (1 - weight) + sortedAsc[upper] * weight;
}

/**
 * Summarise a set of durations in minutes.
 *
 * Negative samples are counted separately and excluded -- see the module note.
 * Callers should surface a non-zero `discarded` rather than hide it, because
 * it means something upstream is writing timestamps out of order.
 */
export function summariseDurations(minutes: number[]): DurationSummary {
  const valid: number[] = [];
  let discarded = 0;
  for (const m of minutes) {
    if (!Number.isFinite(m) || m < 0) {
      discarded += 1;
      continue;
    }
    valid.push(m);
  }
  if (valid.length === 0) return { ...EMPTY_SUMMARY, discarded };

  valid.sort((a, b) => a - b);
  const total = valid.reduce((sum, m) => sum + m, 0);
  return {
    count: valid.length,
    discarded,
    medianMinutes: percentile(valid, 0.5),
    p90Minutes: percentile(valid, 0.9),
    meanMinutes: total / valid.length,
  };
}

/**
 * Division that refuses to invent a number. Returns null when the denominator
 * is zero or absent -- "12 picks in 0 clocked minutes" is not infinity picks
 * per hour, it is a question about the time clock.
 */
export function safeRate(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0) return null;
  return numerator / denominator;
}

/**
 * A rate needs enough elapsed time to mean anything. Three tasks against a
 * forty-second shift is arithmetically 270/hour and factually nothing at all;
 * publishing it would put a fantasy at the top of a productivity table.
 */
export const MIN_MINUTES_FOR_RATE = 30;

/**
 * Tasks completed per clocked hour.
 *
 * Null when nobody was clocked in, and null when the clocked time is too short
 * to divide by -- see `MIN_MINUTES_FOR_RATE`. Callers should render that as
 * "not enough shift time", never as zero.
 */
export function tasksPerHour(
  completed: number,
  clockedMinutes: number,
): number | null {
  if (clockedMinutes < MIN_MINUTES_FOR_RATE) return null;
  return safeRate(completed, clockedMinutes / 60);
}

export type DayBucket<T> = { day: string; value: T };

/**
 * Expand sparse per-day rows into a dense series ending on `endDay`.
 *
 * A bar chart that silently omits the days nothing happened reads as a busy
 * week. Days are ISO `YYYY-MM-DD` strings and are compared as strings, so this
 * stays timezone-agnostic: whatever zone the caller bucketed in is the zone
 * the chart is in.
 */
export function densifyDays(
  rows: { day: string; value: number }[],
  endDay: string,
  days: number,
): DayBucket<number>[] {
  const byDay = new Map(rows.map((r) => [r.day, r.value]));
  const end = new Date(`${endDay}T00:00:00Z`);
  const out: DayBucket<number>[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, value: byDay.get(key) ?? 0 });
  }
  return out;
}

/**
 * Share of counts that matched the book, 0..1. Null when nothing was counted --
 * an unmeasured warehouse is not a 100% accurate one.
 */
export function accuracyRate(matched: number, counted: number): number | null {
  return safeRate(matched, counted);
}

export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return "--";
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) {
    const h = Math.floor(hours);
    const m = Math.round(minutes - h * 60);
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
  const days = Math.floor(hours / 24);
  const h = Math.round(hours - days * 24);
  return h === 0 ? `${days}d` : `${days}d ${h}h`;
}

export function formatPercent(ratio: number | null, digits = 1): string {
  if (ratio === null) return "--";
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatRate(value: number | null, digits = 1): string {
  if (value === null) return "--";
  return value.toFixed(digits);
}

/** Short axis label for a `YYYY-MM-DD` day key. */
export function formatDayLabel(day: string): string {
  const [, month, date] = day.split("-");
  return `${Number(date)}/${Number(month)}`;
}

export type Trend = { direction: "up" | "down" | "flat"; changeRatio: number | null };

/**
 * Compare a window against the one immediately before it.
 *
 * Deliberately makes no claim about whether the change is good: "up" on cycle
 * time is bad and "up" on throughput is good, and only the caller knows which
 * of those it is holding.
 */
export function compareWindows(
  current: number | null,
  previous: number | null,
): Trend {
  if (current === null || previous === null || previous === 0) {
    return { direction: "flat", changeRatio: null };
  }
  const changeRatio = (current - previous) / previous;
  if (Math.abs(changeRatio) < 0.01) return { direction: "flat", changeRatio };
  return { direction: changeRatio > 0 ? "up" : "down", changeRatio };
}
