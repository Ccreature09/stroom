// Time clock core: turning clock-in/clock-out pairs into hours worked.
//
// Pure -- no DB, no React. This is payroll-adjacent arithmetic, which is
// exactly the kind of thing that should be readable and testable without a
// database in the way.

export type ShiftEntry = {
  timeClockId: number;
  clockInAt: string;
  clockOutAt: string | null;
  breakMinutes: number | null;
};

/** A shift with no clock-out is still running. */
export function isOpenShift(entry: Pick<ShiftEntry, "clockOutAt">): boolean {
  return entry.clockOutAt === null;
}

/**
 * Minutes actually worked, breaks deducted.
 *
 * Returns null for an open shift rather than measuring against "now": a
 * value that silently grows every time the page is rendered is not a fact
 * about the shift, and totalling it would produce a different answer on
 * every refresh. Callers that want a live running figure ask for it
 * explicitly via `elapsedMinutes`.
 *
 * Clamped at zero -- a break longer than the shift is a data-entry mistake,
 * and negative hours worked is never the right thing to report.
 */
export function workedMinutes(entry: ShiftEntry): number | null {
  if (entry.clockOutAt === null) return null;
  const start = Date.parse(entry.clockInAt);
  const end = Date.parse(entry.clockOutAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const gross = Math.round((end - start) / 60000);
  return Math.max(0, gross - (entry.breakMinutes ?? 0));
}

/** Running length of an open shift, for the "on shift now" display. */
export function elapsedMinutes(
  entry: Pick<ShiftEntry, "clockInAt" | "breakMinutes">,
  nowMs: number = Date.now(),
): number {
  const start = Date.parse(entry.clockInAt);
  if (!Number.isFinite(start)) return 0;
  const gross = Math.round((nowMs - start) / 60000);
  return Math.max(0, gross - (entry.breakMinutes ?? 0));
}

/** "7h 32m" -- hours and minutes, since that is how a timesheet is read. */
export function formatDuration(minutes: number | null): string {
  if (minutes === null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** Total across a set of shifts. Open shifts contribute nothing -- see
 *  workedMinutes for why. */
export function totalWorkedMinutes(entries: ShiftEntry[]): number {
  return entries.reduce((sum, e) => sum + (workedMinutes(e) ?? 0), 0);
}

/**
 * Whether two shifts overlap in time.
 *
 * Used to reject a supervisor edit that would have someone in two places at
 * once. An open shift is treated as extending indefinitely, because that is
 * what it means: until it is closed, the person is still on it.
 */
export function shiftsOverlap(
  a: Pick<ShiftEntry, "clockInAt" | "clockOutAt">,
  b: Pick<ShiftEntry, "clockInAt" | "clockOutAt">,
): boolean {
  const aStart = Date.parse(a.clockInAt);
  const bStart = Date.parse(b.clockInAt);
  const aEnd = a.clockOutAt === null ? Infinity : Date.parse(a.clockOutAt);
  const bEnd = b.clockOutAt === null ? Infinity : Date.parse(b.clockOutAt);
  if (!Number.isFinite(aStart) || !Number.isFinite(bStart)) return false;
  // Touching endpoints are not an overlap: clocking out at 14:00 and back in
  // at 14:00 is a normal break, not a double shift.
  return aStart < bEnd && bStart < aEnd;
}

export type ShiftValidation = { ok: true } | { ok: false; error: string };

/** Sanity checks shared by clock-out and supervisor edits. */
export function validateShift(
  clockInAt: string,
  clockOutAt: string | null,
  breakMinutes: number,
): ShiftValidation {
  const start = Date.parse(clockInAt);
  if (!Number.isFinite(start)) return { ok: false, error: "Invalid clock-in time." };
  if (breakMinutes < 0) return { ok: false, error: "Break minutes cannot be negative." };

  if (clockOutAt === null) {
    return breakMinutes > 0
      ? { ok: false, error: "Breaks are recorded when the shift is closed." }
      : { ok: true };
  }

  const end = Date.parse(clockOutAt);
  if (!Number.isFinite(end)) return { ok: false, error: "Invalid clock-out time." };
  if (end <= start) return { ok: false, error: "Clock-out must be after clock-in." };

  const gross = Math.round((end - start) / 60000);
  if (breakMinutes > gross) {
    return { ok: false, error: `Breaks (${breakMinutes}m) exceed the shift length (${gross}m).` };
  }
  return { ok: true };
}

/** The calendar day a shift belongs to, taken from its start. A night shift
 *  crossing midnight counts to the day it began, which is how a rota reads. */
export function shiftDate(entry: Pick<ShiftEntry, "clockInAt">): string {
  return entry.clockInAt.slice(0, 10);
}
