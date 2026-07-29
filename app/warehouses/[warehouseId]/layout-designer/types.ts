import type { GeometryKind, Point } from "./geometry";
import { computeEnvelope } from "./geometry";
import type { FeatureAttrs, FeatureCategory } from "./feature-kinds";
import type { LocationType } from "./naming";

export type ZoneTypeDTO = {
  zoneId: number;
  name: string;
  isPickable: boolean | null;
  isTemperatureControlled: boolean | null;
  requiresHazmatClearance: boolean | null;
  requiresBarcodeScan: boolean;
  storagePermanence: string;
  color: string | null;
};

export type LocationDTO = {
  locationId: number;
  locationCode: string;
  zoneId: number | null;
  aisle: number | null;
  bay: number | null;
  level: number | null;
  row: number | null;
  locationType: LocationType;
  heightMm: number | null;
  maxWeightKg: number | null;
  isBlocked: boolean | null;
  physicalX: number;
  physicalY: number;
  physicalWidthMm: number;
  physicalLengthMm: number;
  rotationDegrees: number;
  floorLevel: number;
};

export type HallDTO = {
  hallId: number;
  name: string;
  physicalWidthMm: number;
  physicalLengthMm: number;
  clearHeightMm: number | null;
  isActive: boolean | null;
};

// Editable subset of a hall's metadata -- shape of an in-flight draft edit
// before it's committed to the database via "Save Map".
export type HallPatch = Partial<{
  physicalWidthMm: number;
  physicalLengthMm: number;
  clearHeightMm: number | null;
  isActive: boolean;
}>;

// Editable subset of a location's fields -- same "not committed until Save
// Map" draft shape as HallPatch, covering both detail fields and geometry
// (canvas drag/resize commits land here too).
export type LocationPatch = Partial<{
  locationCode: string;
  zoneId: number | null;
  aisle: number | null;
  bay: number | null;
  level: number | null;
  row: number | null;
  locationType: LocationType;
  heightMm: number | null;
  maxWeightKg: number | null;
  isBlocked: boolean;
  physicalX: number;
  physicalY: number;
  physicalWidthMm: number;
  physicalLengthMm: number;
  rotationDegrees: number;
  floorLevel: number;
}>;

// ---------------------------------------------------------------------------
// Layout lifecycle
// ---------------------------------------------------------------------------

export type LayoutVersionDTO = {
  versionNumber: number;
  graphEpoch: number;
  changeCount: number;
  notes: string | null;
  publishedByName: string | null;
  publishedAt: string | null;
};

// A draft recovered from the server. `isStale` means it was authored against
// an older published version -- the edits may no longer make sense against the
// layout as it now stands, so the user is told rather than silently merged.
export type RecoveredDraft = {
  hallId: number;
  state: HallState;
  baseVersionNumber: number;
  changeCount: number;
  updatedAt: string | null;
  isStale: boolean;
};

export type UnderlayDTO = {
  underlayId: number;
  hallId: number;
  floorLevel: number;
  signedUrl: string | null;
  originalFilename: string | null;
  imageWidthPx: number | null;
  imageHeightPx: number | null;
  scaleMmPerPx: number;
  offsetXMm: number;
  offsetYMm: number;
  rotationDegrees: number;
  opacity: number;
  isVisible: boolean;
  calibMeasuredMm: number | null;
  calibKnownMm: number | null;
};

// ---------------------------------------------------------------------------
// Navigation graph (read model for the designer overlay)
// ---------------------------------------------------------------------------

export type NavNodeDTO = {
  nodeId: number;
  xMm: number;
  yMm: number;
  floorLevel: number;
  nodeKind: string;
  isGenerated: boolean;
};

export type NavEdgeDTO = {
  edgeId: number;
  fromNodeId: number;
  toNodeId: number;
  edgeKind: string;
  traversal: string;
  lengthMm: number;
  widthMm: number | null;
  isGenerated: boolean;
};

export type RoutingVehicleDTO = {
  mheTypeId: number;
  name: string;
  classBit: number | null;
  isPedestrian: boolean;
};

export type NavGraphDTO = {
  nodes: NavNodeDTO[];
  edges: NavEdgeDTO[];
  accessPointCount: number;
  layoutVersion: number | null;
};

// ---------------------------------------------------------------------------
// Layout features -- everything on the floor that is not a storage bin.
// ---------------------------------------------------------------------------

// Row from the `feature_kinds` lookup: how the designer draws and defaults a
// kind. The kind's *attribute schema* lives in feature-kinds.ts instead,
// because that is code rather than data.
export type FeatureKindDTO = {
  kind: string;
  category: FeatureCategory;
  label: string;
  defaultGeometryKind: GeometryKind;
  defaultWidthMm: number | null;
  defaultLengthMm: number | null;
  defaultHeightMm: number | null;
  isObstacleDefault: boolean;
  defaultColor: string;
  sortOrder: number;
};

export type FeatureDTO = {
  featureId: number;
  floorLevel: number;
  kind: string;
  geometryKind: GeometryKind;
  originXMm: number;
  originYMm: number;
  widthMm: number;
  lengthMm: number;
  rotationDegrees: number;
  points: Point[] | null;
  elevationMm: number;
  heightMm: number | null;
  layerIndex: number;
  isObstacle: boolean;
  isVisualOnly: boolean;
  zoneId: number | null;
  label: string | null;
  color: string | null;
  attrs: FeatureAttrs;
};

// `kind` and `geometryKind` are deliberately absent: kind determines the
// attribute schema, so changing it on an existing feature would leave attrs
// belonging to a different shape behind. Changing kind is a delete + create.
export type FeaturePatch = Partial<{
  floorLevel: number;
  originXMm: number;
  originYMm: number;
  widthMm: number;
  lengthMm: number;
  rotationDegrees: number;
  points: Point[] | null;
  elevationMm: number;
  heightMm: number | null;
  layerIndex: number;
  isObstacle: boolean;
  isVisualOnly: boolean;
  zoneId: number | null;
  label: string | null;
  color: string | null;
  attrs: FeatureAttrs;
}>;

export type NewFeatureDraft = FeaturePatch & {
  tempId: number;
  kind: string;
  geometryKind: GeometryKind;
};

export type ZonePatch = Partial<{
  name: string;
  isPickable: boolean;
  isTemperatureControlled: boolean;
  requiresHazmatClearance: boolean;
  requiresBarcodeScan: boolean;
  storagePermanence: string;
  color: string | null;
}>;

// A brand-new location/zone that only exists in the draft store. tempId is
// always negative so it can share the same numeric id space as real rows
// (LocationDTO.locationId / ZoneTypeDTO.zoneId) without colliding, letting
// the canvas/panels treat pending-create rows exactly like saved ones.
export type NewLocationDraft = LocationPatch & { tempId: number };
export type NewZoneDraft = ZonePatch & { tempId: number };

// Everything staged-but-unsaved for one hall. One of these is snapshotted
// per undo/redo step (see the history stack in layout-designer.tsx).
export type HallState = {
  hallPatch: HallPatch;
  locationPatches: Record<number, LocationPatch>;
  deletedLocationIds: number[];
  newLocations: NewLocationDraft[];
  zonePatches: Record<number, ZonePatch>;
  deletedZoneIds: number[];
  newZones: NewZoneDraft[];
  featurePatches: Record<number, FeaturePatch>;
  deletedFeatureIds: number[];
  newFeatures: NewFeatureDraft[];
};

// Bumped whenever the HallState shape changes. Both persistence layers check
// it -- localStorage in layout-designer.tsx and layout_drafts.state_version on
// the server -- and discard anything older rather than rehydrating a shape the
// reducer no longer understands.
export const DRAFT_STATE_VERSION = 2;

export const EMPTY_HALL_STATE: HallState = {
  hallPatch: {},
  locationPatches: {},
  deletedLocationIds: [],
  newLocations: [],
  zonePatches: {},
  deletedZoneIds: [],
  newZones: [],
  featurePatches: {},
  deletedFeatureIds: [],
  newFeatures: [],
};

function newLocationDraftToDTO(draft: NewLocationDraft): LocationDTO {
  return {
    locationId: draft.tempId,
    locationCode: draft.locationCode ?? `DRAFT-${Math.abs(draft.tempId)}`,
    zoneId: draft.zoneId ?? null,
    aisle: draft.aisle ?? null,
    bay: draft.bay ?? null,
    level: draft.level ?? null,
    row: draft.row ?? null,
    locationType: draft.locationType ?? "NONE",
    heightMm: draft.heightMm ?? null,
    maxWeightKg: draft.maxWeightKg ?? null,
    isBlocked: draft.isBlocked ?? false,
    physicalX: draft.physicalX ?? 0,
    physicalY: draft.physicalY ?? 0,
    physicalWidthMm: draft.physicalWidthMm ?? 1000,
    physicalLengthMm: draft.physicalLengthMm ?? 1000,
    rotationDegrees: draft.rotationDegrees ?? 0,
    floorLevel: draft.floorLevel ?? 1,
  };
}

function newZoneDraftToDTO(draft: NewZoneDraft): ZoneTypeDTO {
  return {
    zoneId: draft.tempId,
    name: draft.name ?? `Draft zone ${Math.abs(draft.tempId)}`,
    isPickable: draft.isPickable ?? true,
    isTemperatureControlled: draft.isTemperatureControlled ?? false,
    requiresHazmatClearance: draft.requiresHazmatClearance ?? false,
    requiresBarcodeScan: draft.requiresBarcodeScan ?? true,
    storagePermanence: draft.storagePermanence ?? "PERMANENT",
    color: draft.color ?? null,
  };
}

// Single source of truth for "what the user currently sees" -- base server
// data with the active hall's staged draft applied on top. Used by the
// canvas, toolbar, and side panels alike so they never disagree.
export function applyHallStateToLocations(
  base: LocationDTO[],
  state: HallState | undefined,
): LocationDTO[] {
  if (!state) return base;
  const deleted = new Set(state.deletedLocationIds);
  const patched = base
    .filter((loc) => !deleted.has(loc.locationId))
    .map((loc) => {
      const patch = state.locationPatches[loc.locationId];
      return patch ? { ...loc, ...patch } : loc;
    });
  const created = state.newLocations.map(newLocationDraftToDTO);
  return [...patched, ...created];
}

export function applyHallStateToZones(
  base: ZoneTypeDTO[],
  state: HallState | undefined,
): ZoneTypeDTO[] {
  if (!state) return base;
  const deleted = new Set(state.deletedZoneIds);
  const patched = base
    .filter((z) => !deleted.has(z.zoneId))
    .map((z) => {
      const patch = state.zonePatches[z.zoneId];
      return patch ? { ...z, ...patch } : z;
    });
  const created = state.newZones.map(newZoneDraftToDTO);
  return [...patched, ...created];
}

function newFeatureDraftToDTO(draft: NewFeatureDraft): FeatureDTO {
  const widthMm = draft.widthMm ?? 1000;
  const lengthMm = draft.lengthMm ?? 1000;
  return {
    featureId: draft.tempId,
    floorLevel: draft.floorLevel ?? 1,
    kind: draft.kind,
    geometryKind: draft.geometryKind,
    originXMm: draft.originXMm ?? 0,
    originYMm: draft.originYMm ?? 0,
    widthMm,
    lengthMm,
    rotationDegrees: draft.rotationDegrees ?? 0,
    points: draft.points ?? null,
    elevationMm: draft.elevationMm ?? 0,
    heightMm: draft.heightMm ?? null,
    layerIndex: draft.layerIndex ?? 0,
    isObstacle: draft.isObstacle ?? true,
    isVisualOnly: draft.isVisualOnly ?? false,
    zoneId: draft.zoneId ?? null,
    label: draft.label ?? null,
    color: draft.color ?? null,
    attrs: draft.attrs ?? {},
  };
}

export function applyHallStateToFeatures(
  base: FeatureDTO[],
  state: HallState | undefined,
): FeatureDTO[] {
  if (!state) return base;
  const deleted = new Set(state.deletedFeatureIds);
  const patched = base
    .filter((f) => !deleted.has(f.featureId))
    .map((f) => {
      const patch = state.featurePatches[f.featureId];
      return patch ? { ...f, ...patch } : f;
    });
  const created = state.newFeatures.map(newFeatureDraftToDTO);
  return [...patched, ...created];
}

/**
 * Features are drawn under locations and in ascending layer order, so a
 * mezzanine deck or staging polygon never hides the racking sitting on it.
 */
export function sortFeaturesForRender(features: FeatureDTO[]): FeatureDTO[] {
  return [...features].sort(
    (a, b) => a.layerIndex - b.layerIndex || a.featureId - b.featureId,
  );
}

/** Envelope of a feature as currently drafted -- recomputed, never trusted. */
export function envelopeForFeature(feature: FeatureDTO) {
  return computeEnvelope({
    geometryKind: feature.geometryKind,
    originXMm: feature.originXMm,
    originYMm: feature.originYMm,
    widthMm: feature.widthMm,
    lengthMm: feature.lengthMm,
    rotationDegrees: feature.rotationDegrees,
    points: feature.points,
  });
}

export function hallStateChangeCount(state: HallState): number {
  return (
    (Object.keys(state.hallPatch).length > 0 ? 1 : 0) +
    Object.keys(state.locationPatches).length +
    state.deletedLocationIds.length +
    state.newLocations.length +
    Object.keys(state.zonePatches).length +
    state.deletedZoneIds.length +
    state.newZones.length +
    Object.keys(state.featurePatches).length +
    state.deletedFeatureIds.length +
    state.newFeatures.length
  );
}

// Geometry of a location the user just drew on the canvas but hasn't saved yet.
export type DraftGeometry = {
  physicalX: number;
  physicalY: number;
  physicalWidthMm: number;
  physicalLengthMm: number;
};

// Stable color per zone so the same zone always renders the same color across
// re-renders/re-fetches, without persisting a color column in the database.
const ZONE_PALETTE = [
  0x2563eb, // blue
  0x16a34a, // green
  0xd97706, // amber
  0xdb2777, // pink
  0x7c3aed, // violet
  0x0891b2, // cyan
  0xca8a04, // yellow-ish
  0xdc2626, // red
  0x059669, // emerald
  0x4f46e5, // indigo
];

export function colorForZone(zoneId: number | null): number {
  if (zoneId === null) return 0x94a3b8; // slate-400 for "no zone"
  // Pending-create zones/locations use negative temp ids (see NewZoneDraft),
  // and JS's `%` preserves the dividend's sign -- Math.abs keeps the index
  // valid instead of indexing the palette array with a negative number
  // (which silently returns undefined and crashes downstream .toString()).
  return ZONE_PALETTE[Math.abs(zoneId) % ZONE_PALETTE.length];
}

function parseHexColor(hex: string): number | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return null;
  return parseInt(match[1], 16);
}

// A zone's displayed color: its own explicitly picked color if set, else the
// same stable palette color derived from its id as before.
export function resolveZoneColor(
  zone: Pick<ZoneTypeDTO, "zoneId" | "color"> | null | undefined,
): number {
  if (!zone) return colorForZone(null);
  if (zone.color) {
    const parsed = parseHexColor(zone.color);
    if (parsed !== null) return parsed;
  }
  return colorForZone(zone.zoneId);
}

export function cssColorForZone(
  zone: Pick<ZoneTypeDTO, "zoneId" | "color"> | null,
): string {
  return `#${resolveZoneColor(zone).toString(16).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/**
 * Locations sharing a group key move and delete together as a single unit.
 * A group is Zone + Location Type (e.g. "Zone A + Racking"), computed
 * on the fly rather than persisted as its own column.
 */
export function groupKeyFor(
  loc: Pick<LocationDTO, "zoneId" | "locationType">,
): string {
  return `${loc.zoneId ?? "none"}:${loc.locationType}`;
}

export function locationIdsInGroup(
  locations: LocationDTO[],
  groupKey: string,
): number[] {
  return locations
    .filter((loc) => groupKeyFor(loc) === groupKey)
    .map((loc) => loc.locationId);
}

/**
 * Aisle-level group: every racking location sharing the same aisle number
 * (across all bays and stacked levels) moves and resizes together as a
 * single unit. Unlike groupKeyFor (zone+type), this is racking-specific and
 * keyed purely on the aisle number.
 */
export function locationIdsInAisle(
  locations: LocationDTO[],
  aisle: number,
): number[] {
  return locations
    .filter((loc) => loc.locationType === "RACKING" && loc.aisle === aisle)
    .map((loc) => loc.locationId);
}

/**
 * Bay aggregation: for racking/shelf locations, many rows in the DB (one per
 * level) share the same physical footprint (aisle+bay). The canvas should
 * only render one representative node per (aisle, bay) at a time, switchable
 * via the level overlay. This groups locations by that footprint key.
 */
export function bayFootprintKey(
  loc: Pick<LocationDTO, "aisle" | "bay">,
): string {
  return `${loc.aisle ?? "x"}:${loc.bay ?? "x"}`;
}

export function groupByBayFootprint(
  locations: LocationDTO[],
): Map<string, LocationDTO[]> {
  const groups = new Map<string, LocationDTO[]>();
  for (const loc of locations) {
    if (loc.locationType !== "RACKING" && loc.locationType !== "SHELF")
      continue;
    const key = bayFootprintKey(loc);
    const existing = groups.get(key) ?? [];
    existing.push(loc);
    groups.set(key, existing);
  }
  return groups;
}
