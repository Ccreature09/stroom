import {
  DEFAULT_WORLD_HEIGHT_MM,
  DEFAULT_WORLD_WIDTH_MM,
  SCALE_FACTOR,
  WORLD_PADDING_MM,
  type StoragePermanence,
} from "@/lib/warehouse-layout/constants";
import type { WarehouseLayoutLocation, WarehouseWorldBounds } from "@/lib/warehouse-layout/types";

export function scaleMillimeters(value: number) {
  return value * SCALE_FACTOR;
}

export function normalizeStoragePermanence(value: string | null | undefined): StoragePermanence {
  if (value === "TEMPORARY" || value === "FLUID_BUFFER") {
    return value;
  }

  return "PERMANENT";
}

export function formatFloorLevelLabel(floorLevel: number) {
  if (floorLevel === 1) return "Ground floor";
  if (floorLevel === 2) return "Mezzanine";
  return `Floor ${floorLevel}`;
}

export function getLocationAreaSquareMeters(location: Pick<WarehouseLayoutLocation, "physicalWidthMm" | "physicalLengthMm">) {
  return (location.physicalWidthMm * location.physicalLengthMm) / 1_000_000;
}

export function getWorldBounds(locations: WarehouseLayoutLocation[]): WarehouseWorldBounds {
  const maxPhysicalX = Math.max(
    DEFAULT_WORLD_WIDTH_MM,
    ...locations.map((location) => location.physicalX + Math.max(location.physicalWidthMm, WORLD_PADDING_MM)),
  );
  const maxPhysicalY = Math.max(
    DEFAULT_WORLD_HEIGHT_MM,
    ...locations.map((location) => location.physicalY + Math.max(location.physicalLengthMm, WORLD_PADDING_MM)),
  );

  return {
    worldWidth: scaleMillimeters(maxPhysicalX + WORLD_PADDING_MM),
    worldHeight: scaleMillimeters(maxPhysicalY + WORLD_PADDING_MM),
    maxPhysicalX,
    maxPhysicalY,
  };
}