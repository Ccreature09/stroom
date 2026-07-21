export const SCALE_FACTOR = 0.05;
export const GRID_MINOR_MM = 1_000;
export const GRID_MAJOR_MM = 5_000;
export const WORLD_PADDING_MM = 8_000;
export const DEFAULT_WORLD_WIDTH_MM = 80_000;
export const DEFAULT_WORLD_HEIGHT_MM = 60_000;

export type DesignerMode = "SELECT" | "DRAW_BOX" | "GENERATE_GRID";
export type StoragePermanence = "PERMANENT" | "TEMPORARY" | "FLUID_BUFFER";

export const DESIGNER_MODE_LABELS: Record<DesignerMode, string> = {
  SELECT: "Select and inspect",
  DRAW_BOX: "Draw structural box",
  GENERATE_GRID: "Generate storage grid",
};

export const STORAGE_PERMANENCE_STYLES: Record<StoragePermanence, { fill: number; fillAlpha: number; stroke: number; label: number }> = {
  PERMANENT: {
    fill: 0xdbeafe,
    fillAlpha: 0.85,
    stroke: 0x2563eb,
    label: 0x0f172a,
  },
  TEMPORARY: {
    fill: 0xfb923c,
    fillAlpha: 0.28,
    stroke: 0xea580c,
    label: 0x7c2d12,
  },
  FLUID_BUFFER: {
    fill: 0x86efac,
    fillAlpha: 0.34,
    stroke: 0x16a34a,
    label: 0x14532d,
  },
};