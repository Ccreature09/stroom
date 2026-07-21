import { Container, Graphics, Rectangle, Text } from "pixi.js";
import { STORAGE_PERMANENCE_STYLES } from "@/lib/warehouse-layout/constants";
import { normalizeStoragePermanence, scaleMillimeters } from "@/lib/warehouse-layout/utils";
import type { StoragePermanence } from "@/lib/warehouse-layout/constants";
import type { WarehouseLayoutLocation } from "@/lib/warehouse-layout/types";

interface RenderLocationNodesOptions {
  container: Container;
  locations: WarehouseLayoutLocation[];
  activeFloorLevel: number;
  selectedLocationId: number | null;
  onSelectLocation: (locationId: number) => void;
}

function destroyChildren(container: Container) {
  for (const child of container.removeChildren()) {
    child.destroy({ children: true });
  }
}

function drawSelectionHandles(width: number, height: number) {
  const handles = new Graphics();
  const handleSize = Math.max(8, Math.min(14, Math.min(width, height) * 0.18));
  const halfSize = handleSize / 2;
  const points = [
    [-width / 2, -height / 2],
    [width / 2, -height / 2],
    [width / 2, height / 2],
    [-width / 2, height / 2],
  ];

  handles.lineStyle(1.5, 0x0f172a, 0.9);
  handles.beginFill(0xfffbeb, 1);

  for (const [x, y] of points) {
    handles.drawRect(x - halfSize, y - halfSize, handleSize, handleSize);
  }

  handles.endFill();
  return handles;
}

function drawLocationNode(location: WarehouseLayoutLocation, isSelected: boolean, onSelectLocation: (locationId: number) => void) {
  const width = Math.max(scaleMillimeters(location.physicalWidthMm), 12);
  const height = Math.max(scaleMillimeters(location.physicalLengthMm), 12);
  const pivotX = scaleMillimeters(location.physicalX) + width / 2;
  const pivotY = scaleMillimeters(location.physicalY) + height / 2;
  const permanence = normalizeStoragePermanence(location.storagePermanence);
  const style = STORAGE_PERMANENCE_STYLES[permanence as StoragePermanence];

  const node = new Container();
  node.label = `location-${location.locationId}`;
  node.position.set(pivotX, pivotY);
  node.rotation = (location.rotationDegrees * Math.PI) / 180;
  node.zIndex = isSelected ? 10 : 1;
  node.eventMode = "static";
  node.cursor = "pointer";
  node.hitArea = new Rectangle(-width / 2, -height / 2, width, height);
  node.on("pointertap", () => onSelectLocation(location.locationId));

  const body = new Graphics();
  body.lineStyle(isSelected ? 3 : 2, style.stroke, isSelected ? 1 : 0.92);
  body.beginFill(style.fill, style.fillAlpha);
  body.drawRect(-width / 2, -height / 2, width, height);
  body.endFill();
  node.addChild(body);

  if (isSelected) {
    node.addChild(drawSelectionHandles(width, height));
  }

  if (width > 36 && height > 18) {
    const label = new Text(location.locationCode, {
      fill: style.label,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 11,
      fontWeight: "700",
    });
    label.anchor.set(0.5);
    label.eventMode = "none";
    node.addChild(label);
  }

  return node;
}

export function renderLocationNodes({
  container,
  locations,
  activeFloorLevel,
  selectedLocationId,
  onSelectLocation,
}: RenderLocationNodesOptions) {
  destroyChildren(container);

  const floorLocations = locations.filter((location) => location.floorLevel === activeFloorLevel);

  for (const location of floorLocations) {
    const isSelected = location.locationId === selectedLocationId;
    container.addChild(drawLocationNode(location, isSelected, onSelectLocation));
  }
}