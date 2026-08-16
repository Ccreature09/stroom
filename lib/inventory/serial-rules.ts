/**
 * Pure rules for serial numbers. No database, no React.
 *
 * A serial is the only identifier in this system that names one physical
 * object rather than a group of them, which changes what "correct" means:
 * every unit has to be accounted for individually, the count has to reconcile
 * exactly, and the same unit must never appear twice. Those rules live here so
 * they're stated once and can't drift between the receiving screen, the
 * picking screen, and the server actions behind both.
 */

/**
 * Trim and collapse whitespace, but preserve case.
 *
 * Manufacturers do print case-sensitive serials, and rewriting what was on the
 * label would make the stored value disagree with the physical unit. Matching
 * is case-insensitive (see `serialKey`) because scanners and keyboards
 * disagree about case far more often than two real units do; storage keeps
 * whatever was actually scanned.
 */
export function normaliseSerial(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** The comparison form. Uniqueness is enforced on this in the database too. */
export function serialKey(raw: string): string {
  return normaliseSerial(raw).toUpperCase();
}

/**
 * Split pasted text into serials. Accepts newlines, commas, tabs and
 * semicolons, because the supplier's spreadsheet column, the emailed list and
 * the scanner's output are each shaped differently and none of them is worth
 * making the receiver reformat by hand.
 */
export function parseSerialList(text: string): string[] {
  return text
    .split(/[\n,;\t]+/)
    .map(normaliseSerial)
    .filter((s) => s.length > 0);
}

export type SerialListProblem =
  | { kind: "empty" }
  | { kind: "duplicate"; serial: string }
  | { kind: "too-long"; serial: string }
  | { kind: "count-mismatch"; expected: number; actual: number };

/** Storage limit; matches the column width so a rejection happens here with a
 * readable message rather than as a database error. */
export const MAX_SERIAL_LENGTH = 100;

/**
 * Check a batch of scanned serials before anything is written.
 *
 * `expectedCount` is optional: receiving derives the quantity from the count,
 * so there is nothing to check it against, but picking knows how many units
 * the task reserved and a mismatch there means the picker took the wrong
 * number of things.
 */
export function validateSerialList(
  serials: string[],
  expectedCount?: number,
): SerialListProblem | null {
  if (serials.length === 0) return { kind: "empty" };

  const seen = new Set<string>();
  for (const serial of serials) {
    if (serial.length > MAX_SERIAL_LENGTH) return { kind: "too-long", serial };
    const key = serialKey(serial);
    if (seen.has(key)) return { kind: "duplicate", serial };
    seen.add(key);
  }

  if (expectedCount !== undefined && serials.length !== expectedCount) {
    return {
      kind: "count-mismatch",
      expected: expectedCount,
      actual: serials.length,
    };
  }
  return null;
}

export function describeSerialProblem(problem: SerialListProblem): string {
  switch (problem.kind) {
    case "empty":
      return "Scan at least one serial number.";
    case "duplicate":
      return `"${problem.serial}" was scanned twice. Each unit is scanned once.`;
    case "too-long":
      return `"${problem.serial.slice(0, 20)}..." is longer than ${MAX_SERIAL_LENGTH} characters.`;
    case "count-mismatch":
      return `Scanned ${problem.actual} serial${problem.actual === 1 ? "" : "s"} but the quantity is ${problem.expected}.`;
  }
}

export type ScanProgress = {
  scanned: number;
  expected: number | null;
  remaining: number | null;
  isComplete: boolean;
};

/**
 * The "how many left on this pallet" helper.
 *
 * When there's no expected total -- an ad-hoc receipt where the count is
 * whatever turns up -- `remaining` is null rather than zero, so the screen can
 * say "12 scanned" instead of falsely claiming the job is finished.
 */
export function scanProgress(
  scanned: number,
  expected: number | null,
): ScanProgress {
  if (expected === null) {
    return { scanned, expected: null, remaining: null, isComplete: false };
  }
  const remaining = Math.max(0, expected - scanned);
  return { scanned, expected, remaining, isComplete: remaining === 0 };
}

/**
 * Which of `scanned` are not in `available`, compared case-insensitively.
 *
 * Used at pick time: a serial the picker scanned that isn't actually in that
 * bin means either the unit is misplaced or they picked the wrong thing, and
 * both need stopping rather than recording.
 */
export function findUnavailable(
  scanned: string[],
  available: string[],
): string[] {
  const availableKeys = new Set(available.map(serialKey));
  return scanned.filter((s) => !availableKeys.has(serialKey(s)));
}

/** Serials that already exist, compared case-insensitively. */
export function findAlreadyKnown(
  scanned: string[],
  existing: string[],
): string[] {
  const existingKeys = new Set(existing.map(serialKey));
  return scanned.filter((s) => existingKeys.has(serialKey(s)));
}

export type TrackingRequirement = {
  batch: boolean;
  lot: boolean;
  expiry: boolean;
  serial: boolean;
};

/**
 * What a given item demands at capture time. Mirrors the flags the
 * `enforce_item_tracking_flags` database trigger enforces for batch, lot and
 * expiry -- serials are rows rather than columns, so that trigger can't see
 * them and the application is the only thing that can require them.
 */
export function trackingRequirement(item: {
  isBatchTracked: boolean;
  isLotTracked: boolean;
  hasExpiry: boolean;
  isSerialTracked: boolean;
}): TrackingRequirement {
  return {
    batch: item.isBatchTracked,
    lot: item.isLotTracked,
    expiry: item.hasExpiry,
    serial: item.isSerialTracked,
  };
}
