// Dynamic naming template engine for bulk-generated locations.
//
// Supports tags: {Aisle}, {Row}, {Bay}, {Level} with optional formatting:
//   {Aisle:number} -> "01", "02" ...
//   {Aisle:letter} -> "A", "B" ... "Z", "AA", "AB" ...
// The formatting suffix defaults to "number" if omitted, e.g. {Bay} == {Bay:number}.

export type TemplateValues = {
  aisle?: number | null;
  row?: number | null;
  bay?: number | null;
  level?: number | null;
};

const TAG_PATTERN = /\{(Aisle|Row|Bay|Level)(?::(letter|number))?\}/gi;

export function numberToLetters(n: number): string {
  // 1 -> A, 26 -> Z, 27 -> AA, 28 -> AB ...
  let result = "";
  let value = n;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result || "A";
}

function formatValue(value: number, format: "letter" | "number"): string {
  if (format === "letter") return numberToLetters(value);
  return String(value).padStart(2, "0");
}

/**
 * Renders a location code from a template string and the values available
 * for this specific location. Tags whose value is null/undefined are dropped
 * along with a directly adjacent separator dash, so a template referencing
 * {Row} still renders cleanly for locations with no row set.
 */
export function renderLocationTemplate(
  template: string,
  values: TemplateValues,
): string {
  const DROP_MARKER = "\u0000DROP\u0000";

  const rendered = template.replace(
    TAG_PATTERN,
    (_match, tagRaw: string, formatRaw?: string) => {
      const tag = tagRaw.toLowerCase() as "aisle" | "row" | "bay" | "level";
      const format: "letter" | "number" =
        formatRaw === "letter" ? "letter" : "number";
      const value = values[tag];
      if (value === null || value === undefined) return DROP_MARKER;
      return formatValue(value, format);
    },
  );

  // Clean up dangling separators left by dropped tags (e.g. "A01--02" -> "A01-02").
  return rendered
    .split(DROP_MARKER)
    .join("")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function validateTemplate(template: string): string | null {
  if (!template.trim()) return "Template cannot be empty.";
  TAG_PATTERN.lastIndex = 0;
  const hasTag = TAG_PATTERN.test(template);
  TAG_PATTERN.lastIndex = 0;
  if (!hasTag) {
    return "Template must include at least one tag ({Aisle}, {Row}, {Bay}, or {Level}).";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Location type flags
// ---------------------------------------------------------------------------

export type LocationTypeFlag = "racking" | "shelf" | "floor" | "none";

export function locationTypeFlagsFor(type: LocationTypeFlag) {
  return {
    isRacking: type === "racking",
    isShelf: type === "shelf",
    isFloorStorage: type === "floor",
  };
}

export function flagsToLocationType(flags: {
  isRacking?: boolean | null;
  isShelf?: boolean | null;
  isFloorStorage?: boolean | null;
}): LocationTypeFlag {
  if (flags.isRacking) return "racking";
  if (flags.isShelf) return "shelf";
  if (flags.isFloorStorage) return "floor";
  return "none";
}
