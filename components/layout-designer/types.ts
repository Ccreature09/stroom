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
  position: number | null;
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