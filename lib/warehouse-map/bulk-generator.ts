// Pure layout generation for the bulk location generator (racking, floor
// lines, shelving) -- turns "N aisles of M bays" into a flat list of location
// drafts with real physical coordinates and rendered codes.
//
// No FormData, no db, no auth: this is the same category of pure geometry as
// the rest of lib/warehouse-map, split out of the server action that reads a
// form submission, validates it, and inserts the result. That action
// (bulkGenerateLocations, in layout-designer/actions.ts) is what calls into
// this module; nothing here calls back into it.

import { renderLocationTemplate } from "./naming";
import type { LocationType } from "./naming";

export type BulkGeneratorType = "racking" | "floor_line" | "shelving";
export type Orientation = "horizontal" | "vertical";
export type Axis1DDirection = "forward" | "reverse";

// ---------------------------------------------------------------------------
// Layout patterns -- a repeating rhythm of occupied/empty runs along a
// generator's primary axis (aisles for racking, slots for a floor line, bays
// for shelving), e.g. "1, empty, 2, empty, 2" for a block of single aisles
// followed by wider double blocks, each separated by a cross-aisle gap. This
// is the one thing the plain "N aisles, uniform gap" generator cannot express
// on its own: real racking is laid out in blocks, not one undifferentiated run.
// ---------------------------------------------------------------------------

export type PatternPhase = { occupied: boolean; length: number };

const PATTERN_EMPTY_WORDS = new Set(["empty", "gap", "skip", "none"]);

/**
 * Parses "1, empty, 2, empty, 2" into alternating occupied/empty runs. Each
 * comma-separated token is either a positive whole number (an occupied run of
 * that length) or one of empty/gap/skip/none (one empty slot) -- write the
 * word twice for a two-slot gap rather than inventing a count syntax for it.
 */
export function parsePattern(input: string): PatternPhase[] | { error: string } {
  const tokens = input
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return { error: "The pattern is empty." };

  const phases: PatternPhase[] = [];
  for (const token of tokens) {
    if (PATTERN_EMPTY_WORDS.has(token.toLowerCase())) {
      phases.push({ occupied: false, length: 1 });
      continue;
    }
    const n = Number(token);
    if (!Number.isInteger(n) || n <= 0) {
      return {
        error: `"${token}" in the pattern isn't a positive whole number or "empty".`,
      };
    }
    phases.push({ occupied: true, length: n });
  }
  if (!phases.some((p) => p.occupied)) {
    return {
      error: "The pattern needs at least one occupied run, not just gaps.",
    };
  }
  return phases;
}

/**
 * Rough worst-case slot count for laying out `targetOccupied` occupied
 * positions under a pattern -- not exact, since the final cycle is usually
 * cut short, but enough to catch a degenerate pattern (mostly gaps) before it
 * tries to walk tens of thousands of empty slots to place a modest count.
 */
export const MAX_PATTERN_SLOTS = 20_000;
export function estimatePatternSlots(
  phases: PatternPhase[],
  targetOccupied: number,
): number {
  const perCycle = phases.reduce((sum, p) => sum + p.length, 0);
  const occupiedPerCycle = phases.reduce(
    (sum, p) => sum + (p.occupied ? p.length : 0),
    0,
  );
  const cycles = Math.ceil(targetOccupied / occupiedPerCycle);
  return cycles * perCycle;
}

/**
 * Expands a pattern into a flat sequence of occupied/empty slots, cycling
 * until exactly `targetOccupied` occupied slots have been emitted. Stops
 * immediately once that's reached -- even mid-run -- so the last requested
 * position is never followed by a dangling trailing gap.
 */
function expandPattern(
  phases: PatternPhase[],
  targetOccupied: number,
): boolean[] {
  const slots: boolean[] = [];
  let occupied = 0;
  let phaseIndex = 0;
  while (occupied < targetOccupied) {
    const phase = phases[phaseIndex % phases.length];
    for (let i = 0; i < phase.length && occupied < targetOccupied; i++) {
      slots.push(phase.occupied);
      if (phase.occupied) occupied++;
    }
    phaseIndex++;
  }
  return slots;
}

/**
 * Walks one repeating axis under an optional pattern, calling `place` once
 * per occupied position with two indices that deliberately diverge under a
 * pattern: `occupiedIndex` (0-based count of placements so far) is what
 * numbering keys off, so a gap never leaves a hole in the sequence;
 * `slotIndex` (0-based physical position, gaps included) is what spacing
 * keys off, so a gap still consumes its share of floor. With no pattern,
 * every slot is occupied and the two indices are identical -- today's plain
 * contiguous layout, unchanged.
 */
function forEachPatternSlot(
  targetOccupied: number,
  pattern: PatternPhase[] | null,
  place: (occupiedIndex: number, slotIndex: number) => void,
): void {
  const slots = pattern
    ? expandPattern(pattern, targetOccupied)
    : new Array(targetOccupied).fill(true);
  let occupiedIndex = 0;
  for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
    if (!slots[slotIndex]) continue;
    place(occupiedIndex, slotIndex);
    occupiedIndex++;
  }
}

export const GENERATOR_TO_LOCATION_TYPE: Record<BulkGeneratorType, LocationType> = {
  racking: "RACKING",
  floor_line: "FLOOR",
  shelving: "SHELF",
};

export const DEFAULT_TEMPLATES: Record<BulkGeneratorType, string> = {
  racking: "{Aisle:letter}-{Bay:number}-{Level:number}",
  floor_line: "{Bay:number}",
  shelving: "{Bay:number}-{Level:number}",
};

// 1 Row groups every 4 bays within an aisle, and is optional -- only relevant
// to racking. Rows are a labeling/grouping convenience, not a physical change.
const BAYS_PER_ROW = 4;
function rowForBayIndex(
  bayIndexZeroBased: number,
  useRows: boolean,
): number | null {
  if (!useRows) return null;
  return Math.floor(bayIndexZeroBased / BAYS_PER_ROW) + 1;
}

export type BulkLocationDraft = {
  locationCode: string;
  aisle: number | null;
  bay: number | null;
  level: number | null;
  row: number | null;
  physicalX: number;
  physicalY: number;
  physicalWidthMm: number;
  physicalLengthMm: number;
};

/**
 * Racking is a true 2D grid (aisle x bay), so it gets full independent
 * horizontal/vertical directional numbering, per spec. Physical placement on
 * the canvas always proceeds top-to-bottom / left-to-right; only the
 * *numbers* assigned to each bay/aisle are reversed when a direction is
 * flipped, so "RTL" racking still occupies the same physical footprint,
 * just numbered from the other end.
 */
export function buildRackingLocations(params: {
  template: string;
  aisleCount: number;
  aisleStart: number;
  /** Optional rhythm along the aisle axis -- see the "Layout patterns"
   *  section above. Null lays out aisleCount aisles contiguously, exactly as
   *  before this existed. */
  aislePattern: PatternPhase[] | null;
  bayCount: number;
  bayStart: number;
  levelCount: number;
  levelStart: number;
  bayWidthMm: number;
  bayDepthMm: number;
  aisleGapMm: number;
  bayGapMm: number;
  startX: number;
  startY: number;
  horizontalDirection: "ltr" | "rtl";
  verticalDirection: "utd" | "dtu";
  useRows: boolean;
}): BulkLocationDraft[] {
  const drafts: BulkLocationDraft[] = [];

  forEachPatternSlot(
    params.aisleCount,
    params.aislePattern,
    (occupiedIndex, slotIndex) => {
      const aisleIndexForNumber =
        params.verticalDirection === "utd"
          ? occupiedIndex
          : params.aisleCount - 1 - occupiedIndex;
      const aisleNum = params.aisleStart + aisleIndexForNumber;

      // slotIndex, not occupiedIndex: an empty slot in the pattern still
      // consumes one aisle-pitch of Y, which is the entire point of it --
      // that's the cross-aisle gap, not a discount on physical space.
      const y =
        params.startY + slotIndex * (params.bayDepthMm + params.aisleGapMm);

      for (let j = 0; j < params.bayCount; j++) {
        const bayIndexForNumber =
          params.horizontalDirection === "ltr" ? j : params.bayCount - 1 - j;
        const bayNum = params.bayStart + bayIndexForNumber;
        const rowNum = rowForBayIndex(bayIndexForNumber, params.useRows);

        const x = params.startX + j * (params.bayWidthMm + params.bayGapMm);

        for (let k = 0; k < params.levelCount; k++) {
          const levelNum = params.levelStart + k;
          drafts.push({
            locationCode: renderLocationTemplate(params.template, {
              aisle: aisleNum,
              row: rowNum,
              bay: bayNum,
              level: levelNum,
            }),
            aisle: aisleNum,
            bay: bayNum,
            level: levelNum,
            row: rowNum,
            physicalX: Math.round(x),
            physicalY: Math.round(y),
            physicalWidthMm: Math.round(params.bayWidthMm),
            physicalLengthMm: Math.round(params.bayDepthMm),
          });
        }
      }
    },
  );
  return drafts;
}

/**
 * Floor lines and shelving are single-axis layouts (one row of slots/bays),
 * so rather than two independent axes we expose one "sequenceDirection"
 * toggle: forward numbers from the start point, reverse numbers from the
 * far end. This is a deliberate simplification of the general 2-axis
 * direction control, since there is no second axis to reverse here.
 */
export function buildFloorLineLocations(params: {
  template: string;
  slotCount: number;
  slotStart: number;
  /** Optional rhythm along the slot axis -- see "Layout patterns" above. */
  slotPattern: PatternPhase[] | null;
  slotWidthMm: number;
  slotDepthMm: number;
  gapMm: number;
  startX: number;
  startY: number;
  orientation: Orientation;
  sequenceDirection: Axis1DDirection;
}): BulkLocationDraft[] {
  const drafts: BulkLocationDraft[] = [];
  forEachPatternSlot(
    params.slotCount,
    params.slotPattern,
    (occupiedIndex, slotIndex) => {
      const slotIndexForNumber =
        params.sequenceDirection === "forward"
          ? occupiedIndex
          : params.slotCount - 1 - occupiedIndex;
      const slotNum = params.slotStart + slotIndexForNumber;

      const x =
        params.orientation === "horizontal"
          ? params.startX + slotIndex * (params.slotWidthMm + params.gapMm)
          : params.startX;
      const y =
        params.orientation === "horizontal"
          ? params.startY
          : params.startY + slotIndex * (params.slotDepthMm + params.gapMm);

      drafts.push({
        locationCode: renderLocationTemplate(params.template, {
          aisle: null,
          row: null,
          bay: slotNum,
          level: null,
        }),
        aisle: null,
        bay: slotNum,
        level: null,
        row: null,
        physicalX: Math.round(x),
        physicalY: Math.round(y),
        physicalWidthMm: Math.round(params.slotWidthMm),
        physicalLengthMm: Math.round(params.slotDepthMm),
      });
    },
  );
  return drafts;
}

export function buildShelvingLocations(params: {
  template: string;
  bayCount: number;
  bayStart: number;
  /** Optional rhythm along the bay axis -- see "Layout patterns" above. */
  bayPattern: PatternPhase[] | null;
  levelCount: number;
  levelStart: number;
  bayWidthMm: number;
  bayDepthMm: number;
  bayGapMm: number;
  startX: number;
  startY: number;
  orientation: Orientation;
  sequenceDirection: Axis1DDirection;
}): BulkLocationDraft[] {
  const drafts: BulkLocationDraft[] = [];
  forEachPatternSlot(
    params.bayCount,
    params.bayPattern,
    (occupiedIndex, slotIndex) => {
      const bayIndexForNumber =
        params.sequenceDirection === "forward"
          ? occupiedIndex
          : params.bayCount - 1 - occupiedIndex;
      const bayNum = params.bayStart + bayIndexForNumber;

      let x: number, y: number, width: number, length: number;
      if (params.orientation === "horizontal") {
        x = params.startX + slotIndex * (params.bayWidthMm + params.bayGapMm);
        y = params.startY;
        width = params.bayWidthMm;
        length = params.bayDepthMm;
      } else {
        x = params.startX;
        y = params.startY + slotIndex * (params.bayWidthMm + params.bayGapMm);
        width = params.bayDepthMm;
        length = params.bayWidthMm;
      }

      for (let k = 0; k < params.levelCount; k++) {
        const levelNum = params.levelStart + k;
        drafts.push({
          locationCode: renderLocationTemplate(params.template, {
            aisle: null,
            row: null,
            bay: bayNum,
            level: levelNum,
          }),
          aisle: null,
          bay: bayNum,
          level: levelNum,
          row: null,
          physicalX: Math.round(x),
          physicalY: Math.round(y),
          physicalWidthMm: Math.round(width),
          physicalLengthMm: Math.round(length),
        });
      }
    },
  );
  return drafts;
}
