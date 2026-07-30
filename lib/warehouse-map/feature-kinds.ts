// Per-kind attribute specifications for layout features.
//
// Split of responsibility: the `feature_kinds` table owns what the designer
// needs to *draw* a kind (category, default geometry, size, colour, obstacle
// flag) and is fetched with the rest of the layout. This module owns what a
// kind *means* -- its attribute schema -- because that is code, not data.
//
// One declaration drives both sides: `validateAttrs` runs on the server before
// every write, and the property panel renders its fields from the same specs,
// so a new attribute is added in exactly one place.

export type FeatureCategory =
  | "STRUCTURE"
  | "LOGISTICS"
  | "WORKSTATION"
  | "FACILITY"
  | "HAZARD"
  | "NAVIGATION"
  | "ANNOTATION";

export const CATEGORY_LABELS: Record<FeatureCategory, string> = {
  STRUCTURE: "Structure",
  LOGISTICS: "Inbound / outbound",
  WORKSTATION: "Workstations",
  FACILITY: "Facilities",
  HAZARD: "Hazard & security",
  NAVIGATION: "Navigation",
  ANNOTATION: "Annotation",
};

export const CATEGORY_ORDER: FeatureCategory[] = [
  "STRUCTURE",
  "LOGISTICS",
  "WORKSTATION",
  "FACILITY",
  "HAZARD",
  "NAVIGATION",
  "ANNOTATION",
];

export type AttrSpec =
  | {
      key: string;
      label: string;
      type: "string";
      maxLength?: number;
      placeholder?: string;
      hint?: string;
    }
  | {
      key: string;
      label: string;
      type: "int";
      min?: number;
      max?: number;
      hint?: string;
    }
  | { key: string; label: string; type: "bool"; hint?: string }
  | {
      key: string;
      label: string;
      type: "enum";
      options: { value: string; label: string }[];
      hint?: string;
    };

export type AttrValue = string | number | boolean;
export type FeatureAttrs = Record<string, AttrValue>;

const DIRECTION_OPTIONS = [
  { value: "INBOUND", label: "Inbound" },
  { value: "OUTBOUND", label: "Outbound" },
  { value: "BOTH", label: "Both" },
];

export const FEATURE_ATTR_SPECS: Record<string, AttrSpec[]> = {
  // --- Structure ---------------------------------------------------------
  WALL_EXTERIOR: [
    { key: "thicknessMm", label: "Thickness (mm)", type: "int", min: 1 },
    { key: "isFireRated", label: "Fire rated", type: "bool" },
  ],
  WALL_INTERIOR: [
    { key: "thicknessMm", label: "Thickness (mm)", type: "int", min: 1 },
    { key: "isFireRated", label: "Fire rated", type: "bool" },
  ],
  PARTITION: [
    { key: "thicknessMm", label: "Thickness (mm)", type: "int", min: 1 },
  ],
  COLUMN: [
    {
      key: "isLoadBearing",
      label: "Load bearing",
      type: "bool",
      hint: "Load-bearing columns cannot be removed to fit racking.",
    },
  ],
  DOOR_PERSONNEL: [
    { key: "clearWidthMm", label: "Clear width (mm)", type: "int", min: 1 },
    { key: "clearHeightMm", label: "Clear height (mm)", type: "int", min: 1 },
    { key: "isFireExit", label: "Fire exit", type: "bool" },
  ],
  GATE: [
    { key: "clearWidthMm", label: "Clear width (mm)", type: "int", min: 1 },
    { key: "clearHeightMm", label: "Clear height (mm)", type: "int", min: 1 },
    {
      key: "accessControl",
      label: "Access control",
      type: "enum",
      options: [
        { value: "NONE", label: "None" },
        { value: "BADGE", label: "Badge" },
        { value: "KEY", label: "Key" },
        { value: "GUARD", label: "Guarded" },
      ],
    },
  ],
  ROLLER_SHUTTER: [
    { key: "clearWidthMm", label: "Clear width (mm)", type: "int", min: 1 },
    { key: "clearHeightMm", label: "Clear height (mm)", type: "int", min: 1 },
    { key: "isPowered", label: "Powered", type: "bool" },
  ],
  STAIRS: [
    { key: "connectsFloorFrom", label: "From floor", type: "int" },
    { key: "connectsFloorTo", label: "To floor", type: "int" },
  ],
  GOODS_LIFT: [
    { key: "connectsFloorFrom", label: "From floor", type: "int" },
    { key: "connectsFloorTo", label: "To floor", type: "int" },
    { key: "capacityKg", label: "Capacity (kg)", type: "int", min: 1 },
    {
      key: "cycleTimeMs",
      label: "Cycle time (ms)",
      type: "int",
      min: 0,
      hint: "Round-trip time. A goods lift is often the real bottleneck of a mezzanine operation.",
    },
  ],
  RAMP: [
    { key: "gradientPercent", label: "Gradient (%)", type: "int", min: 0 },
    { key: "connectsFloorFrom", label: "From floor", type: "int" },
    { key: "connectsFloorTo", label: "To floor", type: "int" },
  ],
  MEZZANINE_DECK: [
    {
      key: "deckCapacityKgPerM2",
      label: "Deck capacity (kg/m²)",
      type: "int",
      min: 0,
    },
  ],
  FIRE_EXIT: [
    {
      key: "keepoutRadiusMm",
      label: "Keep-out radius (mm)",
      type: "int",
      min: 0,
      hint: "Legally mandated clearance -- nothing may be stored inside it.",
    },
  ],
  FIRE_EQUIPMENT: [
    {
      key: "equipmentType",
      label: "Equipment",
      type: "enum",
      options: [
        { value: "EXTINGUISHER", label: "Extinguisher" },
        { value: "HYDRANT", label: "Hydrant" },
        { value: "SPRINKLER_RISER", label: "Sprinkler riser" },
        { value: "HOSE_REEL", label: "Hose reel" },
      ],
    },
    {
      key: "keepoutRadiusMm",
      label: "Keep-out radius (mm)",
      type: "int",
      min: 0,
    },
  ],

  // --- Inbound / outbound ------------------------------------------------
  DOCK_DOOR: [
    { key: "doorNumber", label: "Door number", type: "string", maxLength: 20 },
    {
      key: "direction",
      label: "Direction",
      type: "enum",
      options: DIRECTION_OPTIONS,
    },
    { key: "clearHeightMm", label: "Clear height (mm)", type: "int", min: 1 },
    {
      key: "levelerType",
      label: "Leveler",
      type: "enum",
      options: [
        { value: "NONE", label: "None" },
        { value: "HYDRAULIC", label: "Hydraulic" },
        { value: "MECHANICAL", label: "Mechanical" },
        { value: "AIR", label: "Air" },
      ],
    },
    { key: "isRefrigerated", label: "Refrigerated", type: "bool" },
  ],
  DOCK_LEVELER: [
    { key: "capacityKg", label: "Capacity (kg)", type: "int", min: 0 },
  ],
  TRUCK_BAY: [
    { key: "slotCode", label: "Slot code", type: "string", maxLength: 20 },
    {
      key: "trailerLengthMm",
      label: "Max trailer length (mm)",
      type: "int",
      min: 1,
    },
    {
      key: "hasPower",
      label: "Reefer power",
      type: "bool",
      hint: "Required to park a refrigerated trailer here.",
    },
  ],
  TRAILER_PARKING: [
    { key: "slotCode", label: "Slot code", type: "string", maxLength: 20 },
    { key: "hasPower", label: "Reefer power", type: "bool" },
  ],
  STAGING_AREA: [
    {
      key: "direction",
      label: "Direction",
      type: "enum",
      options: DIRECTION_OPTIONS,
    },
    {
      key: "capacityPallets",
      label: "Capacity (pallets)",
      type: "int",
      min: 0,
    },
    {
      key: "dwellTargetMs",
      label: "Dwell target (ms)",
      type: "int",
      min: 0,
      hint: "Pallets sitting longer than this are flagged as aging stock.",
    },
  ],
  CROSS_DOCK_LANE: [
    { key: "laneCode", label: "Lane code", type: "string", maxLength: 20 },
  ],
  QUARANTINE_AREA: [
    { key: "requiresQaRelease", label: "Requires QA release", type: "bool" },
  ],
  RETURNS_AREA: [
    { key: "requiresQaRelease", label: "Requires QA release", type: "bool" },
  ],
  WEIGH_SCALE: [
    { key: "maxWeightKg", label: "Max weight (kg)", type: "int", min: 0 },
  ],

  // --- Workstations ------------------------------------------------------
  PACK_STATION: [
    {
      key: "stationCode",
      label: "Station code",
      type: "string",
      maxLength: 20,
    },
    { key: "headcountCapacity", label: "Headcount", type: "int", min: 0 },
    { key: "throughputUph", label: "Throughput (units/hr)", type: "int", min: 0 },
  ],
  VAS_DESK: [
    {
      key: "stationCode",
      label: "Station code",
      type: "string",
      maxLength: 20,
    },
    { key: "headcountCapacity", label: "Headcount", type: "int", min: 0 },
  ],
  QA_INSPECTION: [
    {
      key: "stationCode",
      label: "Station code",
      type: "string",
      maxLength: 20,
    },
    { key: "headcountCapacity", label: "Headcount", type: "int", min: 0 },
  ],
  RETURNS_DESK: [
    {
      key: "stationCode",
      label: "Station code",
      type: "string",
      maxLength: 20,
    },
  ],
  PUT_WALL: [
    { key: "cubbyCount", label: "Cubby count", type: "int", min: 0 },
  ],
  CONVEYOR_SEGMENT: [
    {
      key: "direction",
      label: "Direction",
      type: "enum",
      options: [
        { value: "FORWARD", label: "Forward" },
        { value: "REVERSE", label: "Reverse" },
        { value: "BIDIRECTIONAL", label: "Bidirectional" },
      ],
    },
    { key: "speedMms", label: "Speed (mm/s)", type: "int", min: 0 },
    {
      key: "isCrossable",
      label: "Crossable on foot",
      type: "bool",
      hint: "An uncrossable conveyor splits the floor and forces routes around it.",
    },
  ],
  CHARGING_STATION: [
    { key: "bayCount", label: "Bays", type: "int", min: 1 },
    { key: "chargeTimeMs", label: "Charge time (ms)", type: "int", min: 0 },
    {
      key: "requiresVentilation",
      label: "Requires ventilation",
      type: "bool",
    },
  ],
  MHE_PARKING: [{ key: "capacity", label: "Capacity", type: "int", min: 0 }],
  PRINTER: [
    { key: "deviceId", label: "Device ID", type: "string", maxLength: 40 },
  ],

  // --- Facilities --------------------------------------------------------
  OFFICE: [
    { key: "headcount", label: "Headcount", type: "int", min: 0 },
    {
      key: "excludedFromUtilizationKpi",
      label: "Exclude from utilization KPI",
      type: "bool",
      hint: "Floor area that is neither storage nor travel should not count against storage utilization.",
    },
  ],
  MEETING_ROOM: [{ key: "headcount", label: "Headcount", type: "int", min: 0 }],
  BREAK_ROOM: [{ key: "headcount", label: "Headcount", type: "int", min: 0 }],
  LOCKER_ROOM: [{ key: "headcount", label: "Headcount", type: "int", min: 0 }],
  ELECTRICAL_ROOM: [
    { key: "isRestricted", label: "Restricted access", type: "bool" },
  ],

  // --- Hazard & security -------------------------------------------------
  HAZMAT_STORAGE: [
    {
      key: "unClasses",
      label: "UN classes",
      type: "string",
      maxLength: 60,
      placeholder: "3, 8",
      hint: "Comma-separated hazard classes stored here.",
    },
    {
      key: "segregationDistanceMm",
      label: "Segregation distance (mm)",
      type: "int",
      min: 0,
    },
    { key: "maxQuantityKg", label: "Max quantity (kg)", type: "int", min: 0 },
  ],
  BATTERY_ROOM: [
    { key: "ventilationRequired", label: "Ventilation required", type: "bool" },
    {
      key: "noIgnitionRadiusMm",
      label: "No-ignition radius (mm)",
      type: "int",
      min: 0,
    },
  ],
  TEMPERATURE_CHAMBER: [
    { key: "minC", label: "Min temp (°C)", type: "int" },
    { key: "maxC", label: "Max temp (°C)", type: "int" },
    {
      key: "maxDwellMs",
      label: "Max dwell (ms)",
      type: "int",
      min: 0,
      hint: "How long stock may sit outside its temperature band during a move.",
    },
  ],
  HIGH_VALUE_CAGE: [
    { key: "requiresTwoPerson", label: "Two-person rule", type: "bool" },
  ],
  CCTV_CAMERA: [
    {
      key: "headingDeg",
      label: "Heading (deg)",
      type: "int",
      min: 0,
      max: 359,
    },
    { key: "fovDeg", label: "Field of view (deg)", type: "int", min: 1, max: 360 },
    {
      key: "rangeMm",
      label: "Range (mm)",
      type: "int",
      min: 0,
      hint: "Drawn as a coverage cone so blind spots are visible on the map.",
    },
  ],
  NO_ENTRY_ZONE: [
    {
      key: "reason",
      label: "Reason",
      type: "string",
      maxLength: 60,
      placeholder: "e.g. AGV-only aisle",
    },
  ],
};

export function attrSpecsFor(kind: string): AttrSpec[] {
  return FEATURE_ATTR_SPECS[kind] ?? [];
}

export type AttrValidationResult =
  | { ok: true; value: FeatureAttrs }
  | { ok: false; error: string };

/**
 * Validates a raw attrs object against its kind's spec. Unknown keys are
 * dropped rather than rejected -- an older client that still sends a removed
 * attribute should not fail the whole save. Postgres will not enforce any of
 * this for a jsonb column, so this is the only gate.
 */
export function validateAttrs(kind: string, raw: unknown): AttrValidationResult {
  if (raw === null || raw === undefined) return { ok: true, value: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: `Attributes for ${kind} must be an object.` };
  }

  const specs = attrSpecsFor(kind);
  const source = raw as Record<string, unknown>;
  const value: FeatureAttrs = {};

  for (const spec of specs) {
    const incoming = source[spec.key];
    // Absent and empty are both "not set" -- the key is simply omitted, so
    // reading code can rely on `key in attrs` meaning a real value.
    if (incoming === undefined || incoming === null || incoming === "") continue;

    switch (spec.type) {
      case "string": {
        if (typeof incoming !== "string") {
          return { ok: false, error: `"${spec.label}" must be text.` };
        }
        const trimmed = incoming.trim();
        if (!trimmed) continue;
        if (spec.maxLength && trimmed.length > spec.maxLength) {
          return {
            ok: false,
            error: `"${spec.label}" must be ${spec.maxLength} characters or fewer.`,
          };
        }
        value[spec.key] = trimmed;
        break;
      }
      case "int": {
        const parsed =
          typeof incoming === "number" ? incoming : Number(incoming);
        if (!Number.isFinite(parsed)) {
          return { ok: false, error: `"${spec.label}" must be a number.` };
        }
        const rounded = Math.round(parsed);
        if (spec.min !== undefined && rounded < spec.min) {
          return {
            ok: false,
            error: `"${spec.label}" must be at least ${spec.min}.`,
          };
        }
        if (spec.max !== undefined && rounded > spec.max) {
          return {
            ok: false,
            error: `"${spec.label}" must be at most ${spec.max}.`,
          };
        }
        value[spec.key] = rounded;
        break;
      }
      case "bool": {
        if (typeof incoming !== "boolean") {
          return { ok: false, error: `"${spec.label}" must be true or false.` };
        }
        value[spec.key] = incoming;
        break;
      }
      case "enum": {
        if (
          typeof incoming !== "string" ||
          !spec.options.some((o) => o.value === incoming)
        ) {
          return {
            ok: false,
            error: `"${spec.label}" must be one of: ${spec.options
              .map((o) => o.label)
              .join(", ")}.`,
          };
        }
        value[spec.key] = incoming;
        break;
      }
    }
  }

  return { ok: true, value };
}
