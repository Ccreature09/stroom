import type { GeometryKind, Point } from "./geometry";
import { computeEnvelope } from "./geometry";
import type { FeatureAttrs, FeatureCategory } from "./feature-kinds";
import type { LocationType } from "./naming";

// A label-visibility toggle group: locations plus every feature category.
// "LOCATION" is not itself a FeatureCategory, since locations aren't features.
export type LabelCategoryKey = "LOCATION" | FeatureCategory;

export type LocationDTO = {
  locationId: number;
  locationCode: string;
  aisle: number | null;
  bay: number | null;
  level: number | null;
  row: number | null;
  locationType: LocationType;
  heightMm: number | null;
  maxWeightKg: number | null;
  isBlocked: boolean | null;
  // A staging/buffer slot -- pallets waiting to move or load -- as opposed
  // to permanent storage. Replaces the old zone-based storage_permanence.
  isTemporary: boolean;
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
  name: string;
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
  aisle: number | null;
  bay: number | null;
  level: number | null;
  row: number | null;
  locationType: LocationType;
  heightMm: number | null;
  maxWeightKg: number | null;
  isBlocked: boolean;
  isTemporary: boolean;
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

export type BlockageDTO = {
  blockageId: number;
  edgeIds: number[];
  originXMm: number | null;
  originYMm: number | null;
  radiusMm: number | null;
  reason: string;
  notes: string | null;
  startedAt: string | null;
  expiresAt: string | null;
};

export type LiveAssetDTO = {
  assetKind: "EMPLOYEE" | "MHE";
  assetRefId: number;
  label: string;
  xMm: number;
  yMm: number;
  floorLevel: number;
  headingDeg: number | null;
  source: string;
  confidence: number;
  status: string;
  routePlanId: number | null;
  observedAt: string | null;
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
  label: string | null;
  color: string | null;
  attrs: FeatureAttrs;
}>;

export type NewFeatureDraft = FeaturePatch & {
  tempId: number;
  kind: string;
  geometryKind: GeometryKind;
};

// A brand-new location that only exists in the draft store. tempId is always
// negative so it can share the same numeric id space as real rows
// (LocationDTO.locationId) without colliding, letting the canvas/panels treat
// pending-create rows exactly like saved ones.
export type NewLocationDraft = LocationPatch & { tempId: number };

// Everything staged-but-unsaved for one hall. One of these is snapshotted
// per undo/redo step (see the history stack in layout-designer.tsx).
export type HallState = {
  hallPatch: HallPatch;
  locationPatches: Record<number, LocationPatch>;
  deletedLocationIds: number[];
  newLocations: NewLocationDraft[];
  featurePatches: Record<number, FeaturePatch>;
  deletedFeatureIds: number[];
  newFeatures: NewFeatureDraft[];
};

// Bumped whenever the HallState shape changes. Both persistence layers check
// it -- localStorage in layout-designer.tsx and layout_drafts.state_version on
// the server -- and discard anything older rather than rehydrating a shape the
// reducer no longer understands. Bumped to 3 when zones were removed (drafts
// with the old zonePatches/deletedZoneIds/newZones/zoneId shape must not be
// rehydrated against a reducer that no longer knows what to do with them).
export const DRAFT_STATE_VERSION = 3;

export const EMPTY_HALL_STATE: HallState = {
  hallPatch: {},
  locationPatches: {},
  deletedLocationIds: [],
  newLocations: [],
  featurePatches: {},
  deletedFeatureIds: [],
  newFeatures: [],
};

function newLocationDraftToDTO(draft: NewLocationDraft): LocationDTO {
  return {
    locationId: draft.tempId,
    locationCode: draft.locationCode ?? `DRAFT-${Math.abs(draft.tempId)}`,
    aisle: draft.aisle ?? null,
    bay: draft.bay ?? null,
    level: draft.level ?? null,
    row: draft.row ?? null,
    locationType: draft.locationType ?? "NONE",
    heightMm: draft.heightMm ?? null,
    maxWeightKg: draft.maxWeightKg ?? null,
    isBlocked: draft.isBlocked ?? false,
    isTemporary: draft.isTemporary ?? false,
    physicalX: draft.physicalX ?? 0,
    physicalY: draft.physicalY ?? 0,
    physicalWidthMm: draft.physicalWidthMm ?? 1000,
    physicalLengthMm: draft.physicalLengthMm ?? 1000,
    rotationDegrees: draft.rotationDegrees ?? 0,
    floorLevel: draft.floorLevel ?? 1,
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

// Fixed palette by location type, replacing the old per-zone palette --
// every location already knows its own type, whereas zone was a separate
// lookup nothing actually read. isTemporary always wins over type (see
// colorForLocation) so a staging slot reads as staging regardless of what
// type it's tagged as.
const LOCATION_TYPE_COLORS: Record<LocationType, number> = {
  RACKING: 0x2563eb, // blue
  SHELF: 0x7c3aed, // violet
  FLOOR: 0x16a34a, // green
  NONE: 0x94a3b8, // slate
};

export const TEMPORARY_LOCATION_COLOR = 0xf59e0b; // amber

export function colorForLocation(
  loc: Pick<LocationDTO, "locationType" | "isTemporary">,
): number {
  if (loc.isTemporary) return TEMPORARY_LOCATION_COLOR;
  return LOCATION_TYPE_COLORS[loc.locationType];
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/**
 * Aisle-level group: every racking location sharing the same aisle number
 * (across all bays and stacked levels) moves and resizes together as a
 * single unit. Racking is the only location type with an implicit batch
 * grouping -- it used to extend to shelf/floor storage keyed by zone
 * assignment, but zones never had real per-location assignments (every row
 * was unzoned) and isTemporary is too coarse a stand-in: every temporary
 * FLOOR location would collapse into one group regardless of where or when
 * it was created. Shelf/floor locations now always select/move individually.
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
 * level) share the same physical footprint. The canvas should only render one
 * representative node per footprint at a time, switchable via the level
 * overlay. This groups locations by that footprint key.
 *
 * The key is the rotated physical envelope, not the (aisle, bay) label pair --
 * matching `collectBayFootprints` in graph-compiler.ts, which faces this exact
 * same "what counts as one bay" question server-side and already answers it
 * this way. Labels are not a safe substitute: `aisle`/`bay` are numbers a
 * generator assigns, and the bulk generator restarts them from `aisleStart`/
 * `bayStart` (default 1) on every run. A second bulk-generate over a different
 * part of the same hall -- an ordinary way to build up a large layout in
 * pieces -- reuses the same small numbers for a physically unrelated block of
 * racking. Keying on the label alone folded every such collision into one
 * group and silently dropped every member but one from `visible`: not merely
 * unaggregated, but never drawn anywhere, while sitting in the database
 * exactly as inserted. Shelving made this closer to certain than rare, since
 * its generator always writes `aisle: null`, collapsing the old key to just
 * the bay number for every shelf unit in the hall.
 */
export function bayFootprintKey(
  loc: Pick<
    LocationDTO,
    "physicalX" | "physicalY" | "physicalWidthMm" | "physicalLengthMm" | "rotationDegrees"
  >,
): string {
  const envelope = computeEnvelope({
    geometryKind: "RECT",
    originXMm: loc.physicalX,
    originYMm: loc.physicalY,
    widthMm: loc.physicalWidthMm,
    lengthMm: loc.physicalLengthMm,
    rotationDegrees: loc.rotationDegrees,
    points: null,
  });
  return `${envelope.minX}:${envelope.minY}:${envelope.maxX}:${envelope.maxY}`;
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
