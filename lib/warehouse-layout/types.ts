import type { StoragePermanence } from "@/lib/warehouse-layout/constants";

export interface WarehouseLayoutWarehouseSummary {
  warehouseId: number;
  name: string | null;
  city: string | null;
  country: string | null;
  timezone: string | null;
  isActive: boolean | null;
}

export interface WarehouseLayoutLocation {
  locationId: number;
  warehouseId: number | null;
  zoneId: number | null;
  locationCode: string;
  aisle: number | null;
  bay: number | null;
  level: number | null;
  position: number | null;
  heightMm: number | null;
  maxWeightKg: number | null;
  isBlocked: boolean | null;
  updatedAt: string | null;
  physicalX: number;
  physicalY: number;
  physicalWidthMm: number;
  physicalLengthMm: number;
  rotationDegrees: number;
  floorLevel: number;
  storagePermanence: StoragePermanence | string | null;
  requiresBarcodeScan: boolean;
  zoneName: string | null;
}

export interface WarehouseLayoutInspectorDraft {
  locationCode: string;
  requiresBarcodeScan: boolean;
  maxWeightKg: string;
  heightMm: string;
}

export interface WarehouseWorldBounds {
  worldWidth: number;
  worldHeight: number;
  maxPhysicalX: number;
  maxPhysicalY: number;
}