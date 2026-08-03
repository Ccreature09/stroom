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

import type { ResizeAxis } from "./geometry";

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

// Every POLYLINE kind is drawn as a band of real floor width, so each one needs
// an editable width. Walls express theirs as `thicknessMm` (already specced
// below); routes get `pathWidthMm`.
const PATH_WIDTH_SPEC: AttrSpec = {
  key: "pathWidthMm",
  label: "Path width (mm)",
  type: "int",
  min: 100,
  hint: "Actual width on the floor. Drawn to scale, so a walkway looks like a walkway rather than a line.",
};

/** Lattice spacing for the free-roam zone kinds. The floor is the graph
 *  compiler's node merge radius: below it, neighbouring lattice points would
 *  fuse into a single node and the lattice would collapse. */
const ZONE_PITCH_SPEC: AttrSpec = {
  key: "nodePitchMm",
  label: "Routing grid pitch (mm)",
  type: "int",
  min: 1000,
  hint: "Only used by the grid mesh. How far apart its routing points are — smaller follows the floor more closely but grows the graph fast.",
};

/**
 * How an open area is turned into a routable network.
 *
 * Straight-line is a visibility mesh: nodes only at the corners that a path
 * could actually turn on (the area's own corners, the corners of anything
 * standing in it) plus wherever a lane meets the area, joined by every
 * sightline between them. It gives true Euclidean paths off a handful of
 * nodes. Grid is a lattice of points at a fixed pitch: many more nodes, and
 * paths quantised to 45 degrees, but it copes with an area so cluttered that
 * the sightline count would explode.
 */
const ZONE_MESH_SPEC: AttrSpec = {
  key: "meshMode",
  label: "Routing mesh",
  type: "enum",
  options: [
    { value: "VISIBILITY", label: "Straight-line (recommended)" },
    { value: "GRID", label: "Grid" },
  ],
  hint: "Straight-line gives exact paths off very few nodes. Grid is the fallback for heavily obstructed areas.",
};

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
    PATH_WIDTH_SPEC,
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

  // --- Navigation --------------------------------------------------------
  TRAVEL_LANE: [
    PATH_WIDTH_SPEC,
    {
      key: "direction",
      label: "Direction",
      type: "enum",
      options: [
        { value: "ONE_WAY", label: "One way" },
        { value: "BIDIRECTIONAL", label: "Bidirectional" },
      ],
    },
    { key: "speedLimitMms", label: "Speed limit (mm/s)", type: "int", min: 0 },
  ],
  MAIN_ROAD: [
    PATH_WIDTH_SPEC,
    {
      key: "direction",
      label: "Direction",
      type: "enum",
      options: [
        { value: "ONE_WAY", label: "One way" },
        { value: "BIDIRECTIONAL", label: "Bidirectional" },
      ],
    },
    { key: "speedLimitMms", label: "Speed limit (mm/s)", type: "int", min: 0 },
  ],
  CROSS_AISLE: [PATH_WIDTH_SPEC],
  PEDESTRIAN_WALKWAY: [
    PATH_WIDTH_SPEC,
    {
      key: "isSegregated",
      label: "Physically segregated",
      type: "bool",
      hint: "Barrier or kerb between people and vehicles, rather than paint alone.",
    },
  ],
  CROSSING: [
    {
      key: "hasPriority",
      label: "Pedestrian priority",
      type: "bool",
    },
  ],
  SPEED_ZONE: [
    { key: "speedLimitMms", label: "Speed limit (mm/s)", type: "int", min: 0 },
  ],

  // Free-roam areas. Unlike a lane, these have no centreline: the whole
  // surface is drivable/walkable, so the compiler fills them with a lattice
  // of nodes instead of a single line. `nodePitchMm` is the spacing of that
  // lattice and is the one knob that matters -- node count grows as
  // area / pitch^2, so halving it quadruples the graph.
  DRIVE_ZONE: [
    ZONE_MESH_SPEC,
    ZONE_PITCH_SPEC,
    { key: "speedLimitMms", label: "Speed limit (mm/s)", type: "int", min: 0 },
    {
      key: "allowsPedestrians",
      label: "People may walk here",
      type: "bool",
      hint: "Off means the area is routed for vehicles only — pickers on foot are sent around it.",
    },
  ],
  WORK_ZONE: [
    ZONE_MESH_SPEC,
    ZONE_PITCH_SPEC,
    {
      key: "allowsVehicles",
      label: "Vehicles may enter",
      type: "bool",
      hint: "Off means only pedestrians are routed through — the usual case for a pack or QA area.",
    },
  ],
};

export function attrSpecsFor(kind: string): AttrSpec[] {
  return FEATURE_ATTR_SPECS[kind] ?? [];
}

// ---------------------------------------------------------------------------
// Placement & rendering geometry
//
// The feature_kinds table only carries a default size for RECT kinds; every
// POLYGON and POLYLINE kind stores NULL there, because a room or a walkway has
// no single "correct" size. Click-to-place still needs a concrete footprint,
// and a polyline still needs a real floor width to be drawn to scale, so those
// defaults live here as code.
// ---------------------------------------------------------------------------

/**
 * How wide a POLYLINE feature actually is on the floor. Without this a
 * pedestrian walkway falls back to a hairline and reads as a pencil stroke
 * rather than a route people walk down.
 */
export const DEFAULT_PATH_WIDTH_MM: Record<string, number> = {
  WALL_EXTERIOR: 300,
  WALL_INTERIOR: 200,
  PARTITION: 100,
  CONVEYOR_SEGMENT: 800,
  MAIN_ROAD: 4500,
  TRAVEL_LANE: 3200,
  CROSS_AISLE: 2600,
  PEDESTRIAN_WALKWAY: 1200,
};

const FALLBACK_PATH_WIDTH_MM = 600;

/** Resolves the drawn band width for a polyline: explicit attr, else kind default. */
export function pathWidthMmFor(kind: string, attrs: FeatureAttrs): number {
  // Walls spec this as `thicknessMm`; routes as `pathWidthMm`. Accept either so
  // the renderer does not need to know which family a kind belongs to.
  for (const key of ["pathWidthMm", "thicknessMm"]) {
    const raw = attrs[key];
    const parsed = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_PATH_WIDTH_MM[kind] ?? FALLBACK_PATH_WIDTH_MM;
}

/** Kinds whose stock polygon footprint should not be the generic room size. */
const AREA_PLACEMENT_OVERRIDES: Record<
  string,
  { widthMm: number; lengthMm: number }
> = {
  MEZZANINE_DECK: { widthMm: 12000, lengthMm: 8000 },
  STAGING_AREA: { widthMm: 8000, lengthMm: 6000 },
  CROSS_DOCK_LANE: { widthMm: 12000, lengthMm: 3000 },
  QUARANTINE_AREA: { widthMm: 5000, lengthMm: 4000 },
  RETURNS_AREA: { widthMm: 5000, lengthMm: 4000 },
  DAMAGE_AREA: { widthMm: 4000, lengthMm: 3000 },
  HAZMAT_STORAGE: { widthMm: 5000, lengthMm: 4000 },
  TEMPERATURE_CHAMBER: { widthMm: 8000, lengthMm: 6000 },
  HIGH_VALUE_CAGE: { widthMm: 4000, lengthMm: 3000 },
  MHE_PARKING: { widthMm: 6000, lengthMm: 3000 },
  OFFICE: { widthMm: 6000, lengthMm: 4000 },
  MEETING_ROOM: { widthMm: 5000, lengthMm: 4000 },
  BREAK_ROOM: { widthMm: 7000, lengthMm: 5000 },
  LOCKER_ROOM: { widthMm: 5000, lengthMm: 4000 },
  RESTROOM: { widthMm: 4000, lengthMm: 3000 },
  MAINTENANCE_WORKSHOP: { widthMm: 8000, lengthMm: 6000 },
  NO_ENTRY_ZONE: { widthMm: 4000, lengthMm: 4000 },
  SPEED_ZONE: { widthMm: 8000, lengthMm: 6000 },
  VEHICLE_EXCLUSION: { widthMm: 5000, lengthMm: 4000 },
  PEDESTRIAN_EXCLUSION: { widthMm: 5000, lengthMm: 4000 },
  // Free-roam areas are drawn big by default: they stand for "all of this
  // floor is drivable", which is rarely a 6x4 m patch.
  DRIVE_ZONE: { widthMm: 20000, lengthMm: 12000 },
  WORK_ZONE: { widthMm: 8000, lengthMm: 6000 },
};

const GENERIC_AREA_MM = { widthMm: 6000, lengthMm: 4000 };
const DEFAULT_POLYLINE_RUN_MM = 8000;

/**
 * Footprint to give a feature dropped with a single click. The table's own
 * default wins when it has one; otherwise a per-kind or generic size stands in,
 * so nothing is ever placed at zero size and then invisible.
 */
export function defaultPlacementSizeMm(
  kind: string,
  geometryKind: string,
  defaultWidthMm: number | null,
  defaultLengthMm: number | null,
  attrs: FeatureAttrs = {},
): { widthMm: number; lengthMm: number } {
  if (geometryKind === "POINT") return { widthMm: 0, lengthMm: 0 };

  if (
    defaultWidthMm != null &&
    defaultWidthMm > 0 &&
    defaultLengthMm != null &&
    defaultLengthMm > 0
  ) {
    return { widthMm: defaultWidthMm, lengthMm: defaultLengthMm };
  }

  if (geometryKind === "POLYLINE") {
    // A polyline is placed as a single horizontal run; its "length" dimension
    // is the band width so the bounding box matches what gets drawn.
    return {
      widthMm: DEFAULT_POLYLINE_RUN_MM,
      lengthMm: Math.max(200, Math.round(pathWidthMmFor(kind, attrs))),
    };
  }

  if (geometryKind === "CIRCLE") {
    const size = AREA_PLACEMENT_OVERRIDES[kind]?.widthMm ?? 2000;
    return { widthMm: size, lengthMm: size };
  }

  return AREA_PLACEMENT_OVERRIDES[kind] ?? GENERIC_AREA_MM;
}

/**
 * Kinds that read as an enclosed room rather than an open area. Rooms get a
 * solid name plate on the map -- "Break room" is the only way to tell one
 * lilac rectangle from another.
 */
const ROOM_KINDS = new Set([
  "OFFICE",
  "MEETING_ROOM",
  "RESTROOM",
  "BREAK_ROOM",
  "LOCKER_ROOM",
  "MAINTENANCE_WORKSHOP",
  "ELECTRICAL_ROOM",
  "BATTERY_ROOM",
  "TEMPERATURE_CHAMBER",
  "HIGH_VALUE_CAGE",
  "GATEHOUSE",
  "HAZMAT_STORAGE",
]);

export function isRoomKind(kind: string): boolean {
  return ROOM_KINDS.has(kind);
}

/** Routes that should be drawn as travel surfaces with a centre line. */
const ROUTE_KINDS = new Set([
  "MAIN_ROAD",
  "TRAVEL_LANE",
  "CROSS_AISLE",
  "PEDESTRIAN_WALKWAY",
]);

export function isRouteKind(kind: string): boolean {
  return ROUTE_KINDS.has(kind);
}

// RECT kinds whose "width" -- the DB's widthMm field, drawn as
// g.rect(0, 0, widthMm, lengthMm) so widthMm is the span across the opening
// -- is a real physical spec rather than something to eyeball on the plan: a
// door or gate is bought at a fixed width, a truck bay's lane width is set by
// the trailers using it. Their "length" (depth into the wall, or how far the
// bay runs) stays freely adjustable.
const WIDTH_LOCKED_RECT_KINDS = new Set([
  "DOOR_PERSONNEL",
  "GATE",
  "ROLLER_SHUTTER",
  "DOCK_DOOR",
  "TRUCK_BAY",
  "TRAILER_PARKING",
]);

/**
 * Which of a feature's two dimensions a resize drag must never change, or
 * null if both stay freely adjustable via the usual 4 corner handles.
 *
 * Two independent reasons a dimension gets locked:
 *  - The RECT kinds above have one dimension that is a fixed physical spec
 *    rather than a drawing choice (see WIDTH_LOCKED_RECT_KINDS).
 *  - Every POLYLINE kind (walls, conveyors, travel routes) draws its actual
 *    band width from the `pathWidthMm`/`thicknessMm` attribute, not from
 *    lengthMm -- lengthMm there is only a placement-time helper with no
 *    visual effect (see pathWidthMmFor), so a resize handle that changed it
 *    would silently drift stored data the canvas never shows.
 */
export function lockedResizeAxisFor(
  kind: string,
  geometryKind: string,
): ResizeAxis | null {
  if (geometryKind === "POLYLINE") return "length";
  if (geometryKind === "RECT" && WIDTH_LOCKED_RECT_KINDS.has(kind)) {
    return "width";
  }
  return null;
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
