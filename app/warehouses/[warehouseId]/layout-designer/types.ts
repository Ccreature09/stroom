export type ZoneTypeDTO = {
  zoneId: number;
  name: string;
  isPickable: boolean | null;
  isTemperatureControlled: boolean | null;
  requiresHazmatClearance: boolean | null;
  requiresBarcodeScan: boolean;
  storagePermanence: string;
};

export type LocationDTO = {
  locationId: number;
  locationCode: string;
  zoneId: number | null;
  aisle: number | null;
  bay: number | null;
  level: number | null;
  row: number | null;
  isRacking: boolean;
  isShelf: boolean;
  isFloorStorage: boolean;
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
};

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
  return ZONE_PALETTE[zoneId % ZONE_PALETTE.length];
}

export function cssColorForZone(zoneId: number | null): string {
  return `#${colorForZone(zoneId).toString(16).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export type LocationTypeKey = "racking" | "shelf" | "floor" | "none";

export function locationTypeKeyFor(
  loc: Pick<LocationDTO, "isRacking" | "isShelf" | "isFloorStorage">,
): LocationTypeKey {
  if (loc.isRacking) return "racking";
  if (loc.isShelf) return "shelf";
  if (loc.isFloorStorage) return "floor";
  return "none";
}

/**
 * Locations sharing a group key move and delete together as a single unit.
 * A group is Zone + Location Type (e.g. "Zone A + Racking"), computed
 * on the fly rather than persisted as its own column.
 */
export function groupKeyFor(
  loc: Pick<LocationDTO, "zoneId" | "isRacking" | "isShelf" | "isFloorStorage">,
): string {
  return `${loc.zoneId ?? "none"}:${locationTypeKeyFor(loc)}`;
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
    if (!loc.isRacking && !loc.isShelf) continue;
    const key = bayFootprintKey(loc);
    const existing = groups.get(key) ?? [];
    existing.push(loc);
    groups.set(key, existing);
  }
  return groups;
}
