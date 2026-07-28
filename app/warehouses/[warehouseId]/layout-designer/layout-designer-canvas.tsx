"use client";

import { useEffect, useState, useRef } from "react";
import {
  Application,
  Container,
  Graphics,
  Text,
  TextStyle,
  type FederatedPointerEvent,
} from "pixi.js";
import { Viewport } from "pixi-viewport";
import type {
  FeatureDTO,
  FeatureKindDTO,
  HallDTO,
  LocationDTO,
  ZoneTypeDTO,
} from "./types";
import {
  groupByBayFootprint,
  groupKeyFor,
  locationIdsInAisle,
  locationIdsInGroup,
  resolveZoneColor,
  sortFeaturesForRender,
} from "./types";
import {
  footprintVertices,
  hitTestFeature,
  scaleGeometry,
  type Point,
} from "./geometry";

import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut } from "lucide-react";

const MIN_LOCATION_MM = 200;
const HANDLE_SCREEN_SIZE = 9;
const LABEL_ZOOM_THRESHOLD = 0.55;
// World-mm radius of the marker drawn for POINT features, and the extra grab
// slack given to thin geometry (walls, conveyors) so they stay clickable.
const POINT_MARKER_MM = 350;
const FEATURE_HIT_TOLERANCE_MM = 250;

export type Tool = "select" | "pan" | "transform" | "draw" | "feature";

export type FeatureGeometryUpdate = {
  originXMm: number;
  originYMm: number;
  widthMm: number;
  lengthMm: number;
  rotationDegrees: number;
  points: Point[] | null;
};
export type Geometry = {
  physicalX: number;
  physicalY: number;
  physicalWidthMm: number;
  physicalLengthMm: number;
};
export type GeometryWithRotation = Geometry & { rotationDegrees: number };
export type GeometryUpdate = Geometry & { locationId: number };

type Props = {
  hall: HallDTO;
  locations: LocationDTO[];
  zoneTypes: ZoneTypeDTO[];
  features: FeatureDTO[];
  featureKinds: FeatureKindDTO[];
  selectedFeatureId: number | null;
  onSelectFeature: (featureId: number | null) => void;
  onFeatureDrawn: (geometry: {
    originXMm: number;
    originYMm: number;
    widthMm: number;
    lengthMm: number;
  }) => void;
  onFeatureGeometryChange: (
    featureId: number,
    geometry: FeatureGeometryUpdate,
  ) => void;
  selectedLocationId: number | null;
  selectedLocationIds: number[];
  activeLevel: number | null;
  availableLevels: number[];
  onLevelChange: (level: number) => void;
  tool: Tool;
  locked: boolean;
  onSelect: (locationId: number | null) => void;
  onMultiSelect: (locationIds: number[]) => void;
  onDraftDrawn: (geometry: Geometry) => void;
  onGeometryChange: (
    locationId: number,
    geometry: GeometryWithRotation,
  ) => void;
  onGroupMove: (locationIds: number[], deltaX: number, deltaY: number) => void;
  onGroupResize: (updates: GeometryUpdate[]) => void;
};

type LocationNode = {
  container: Container;
  box: Graphics;
  label: Text;
  badge: Text;
  loc: LocationDTO;
  memberCount: number; // how many levels this node aggregates (bay aggregation)
};

type FeatureNode = {
  container: Container;
  shape: Graphics;
  label: Text;
  feature: FeatureDTO;
};

function parseHexToInt(hex: string | null | undefined, fallback: number) {
  if (!hex) return fallback;
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  return match ? parseInt(match[1], 16) : fallback;
}

const HANDLE_CORNERS = ["nw", "ne", "se", "sw"] as const;
type Corner = (typeof HANDLE_CORNERS)[number];

function clampLocation(
  x: number,
  y: number,
  width: number,
  height: number,
  hallWidth: number,
  hallHeight: number,
) {
  const clampedWidth = Math.min(width, hallWidth);
  const clampedHeight = Math.min(height, hallHeight);
  return {
    x: Math.max(0, Math.min(x, hallWidth - clampedWidth)),
    y: Math.max(0, Math.min(y, hallHeight - clampedHeight)),
    width: clampedWidth,
    height: clampedHeight,
  };
}

/**
 * Bay Aggregation: for racking/shelf locations, multiple DB rows can share
 * the same physical footprint (aisle+bay), one per level. On the top-level
 * canvas we only want to render ONE node per footprint -- preferring the
 * currently active level if it has a member there, otherwise falling back to
 * the lowest level present -- plus every other location (floor storage, or
 * anything without aisle/bay) rendered as-is.
 */
function resolveVisibleLocations(
  allLocations: LocationDTO[],
  activeLevel: number | null,
): { visible: LocationDTO[]; memberCountByLocationId: Map<number, number> } {
  const memberCountByLocationId = new Map<number, number>();
  const bayGroups = groupByBayFootprint(allLocations);
  const aggregatedIds = new Set<number>();
  for (const group of bayGroups.values()) {
    for (const loc of group) aggregatedIds.add(loc.locationId);
  }

  const visible: LocationDTO[] = [];

  for (const group of bayGroups.values()) {
    if (group.length === 0) continue;
    const sorted = [...group].sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
    const preferred =
      (activeLevel != null && sorted.find((l) => l.level === activeLevel)) ||
      sorted[0];
    visible.push(preferred);
    memberCountByLocationId.set(preferred.locationId, sorted.length);
  }

  for (const loc of allLocations) {
    if (!aggregatedIds.has(loc.locationId)) {
      visible.push(loc);
      memberCountByLocationId.set(loc.locationId, 1);
    }
  }

  return { visible, memberCountByLocationId };
}
const PENDING_CREATE_COLOR = 0xf59e0b;

function strokeForNode(locationId: number, isSelected: boolean) {
  if (locationId < 0) {
    return { width: isSelected ? 45 : 24, color: PENDING_CREATE_COLOR };
  }
  return {
    width: isSelected ? 45 : 18,
    color: isSelected ? 0x0f172a : 0x1e293b,
  };
}

function formatFootprint(
  w: number,
  h: number,
  x: number,
  y: number,
  rotation: number,
) {
  return `${Math.round(w)}mm × ${Math.round(h)}mm at (${Math.round(x)}, ${Math.round(y)}) · ${rotation}°`;
}

export default function LayoutDesignerCanvas({
  hall,
  locations,
  zoneTypes,
  features,
  featureKinds,
  selectedFeatureId,
  onSelectFeature,
  onFeatureDrawn,
  onFeatureGeometryChange,
  selectedLocationId,
  selectedLocationIds,
  activeLevel,
  availableLevels,
  onLevelChange,
  tool,
  locked,
  onSelect,
  onMultiSelect,
  onDraftDrawn,
  onGeometryChange,
  onGroupMove,
  onGroupResize,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const locationLayerRef = useRef<Container | null>(null);
  const featureLayerRef = useRef<Container | null>(null);
  const handleLayerRef = useRef<Container | null>(null);
  const featureHandlesRef = useRef<Graphics[]>([]);
  const featureNodesRef = useRef<Map<number, FeatureNode>>(new Map());
  const nodesRef = useRef<Map<number, LocationNode>>(new Map());
  const handlesRef = useRef<Graphics[]>([]);
  const handleCornerGraphicsRef = useRef<Partial<Record<Corner, Graphics>>>({});
  const handleOutlineRef = useRef<Graphics | null>(null);
  const scaleTextRef = useRef<HTMLSpanElement>(null);
  const scaleBarRef = useRef<HTMLDivElement>(null);
  const coordOverlayRef = useRef<HTMLDivElement>(null);
  const minFitScaleRef = useRef<number>(0.05);
  const [isReady, setIsReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  function handleZoomIn() {
    const vp = viewportRef.current;
    if (!vp) return;
    const absoluteMax = Math.max(8, minFitScaleRef.current * 1.5);
    const targetScale = Math.min(vp.scale.x * 1.5, absoluteMax);
    vp.setZoom(targetScale);
    updateScaleBar(vp);
  }

  function handleZoomOut() {
    const vp = viewportRef.current;
    if (!vp) return;
    const targetScale = Math.max(vp.scale.x / 1.5, minFitScaleRef.current);
    vp.setZoom(targetScale);
    updateScaleBar(vp);
  }

  function showCoordOverlay(screenX: number, screenY: number, text: string) {
    const el = coordOverlayRef.current;
    if (!el) return;
    el.textContent = text;
    el.style.left = `${screenX + 14}px`;
    el.style.top = `${screenY + 14}px`;
    el.style.display = "block";
  }

  function hideCoordOverlay() {
    const el = coordOverlayRef.current;
    if (!el) return;
    el.style.display = "none";
  }

  const stateRef = useRef({
    tool,
    selectedLocationId,
    selectedLocationIds,
    onSelect,
    onMultiSelect,
    onDraftDrawn,
    onGeometryChange,
    onGroupMove,
    onGroupResize,
    hall,
    selectedFeatureId,
    onSelectFeature,
    onFeatureDrawn,
    onFeatureGeometryChange,
  });
  stateRef.current = {
    tool,
    selectedLocationId,
    selectedLocationIds,
    onSelect,
    onMultiSelect,
    onDraftDrawn,
    onGeometryChange,
    onGroupMove,
    onGroupResize,
    hall,
    selectedFeatureId,
    onSelectFeature,
    onFeatureDrawn,
    onFeatureGeometryChange,
  };

  const locationsRef = useRef(locations);
  locationsRef.current = locations;

  const zoneTypesRef = useRef(zoneTypes);
  zoneTypesRef.current = zoneTypes;

  const featuresRef = useRef(features);
  featuresRef.current = features;

  const featureKindsRef = useRef(featureKinds);
  featureKindsRef.current = featureKinds;

  function kindMetaFor(kind: string): FeatureKindDTO | undefined {
    return featureKindsRef.current.find((k) => k.kind === kind);
  }

  function colorForFeature(feature: FeatureDTO): number {
    return parseHexToInt(
      feature.color ?? kindMetaFor(feature.kind)?.defaultColor,
      0x64748b,
    );
  }

  function colorForLocation(zoneId: number | null): number {
    if (zoneId == null) return resolveZoneColor(null);
    const zone = zoneTypesRef.current.find((z) => z.zoneId === zoneId);
    return resolveZoneColor(zone ?? { zoneId, color: null });
  }

  const activeLevelRef = useRef(activeLevel);
  activeLevelRef.current = activeLevel;

  const dragRef = useRef<null | {
    locationId: number;
    startWorldX: number;
    startWorldY: number;
    originX: number;
    originY: number;
  }>(null);
  const drawRef = useRef<null | {
    startWorldX: number;
    startWorldY: number;
    rect: Graphics;
  }>(null);
  const resizeRef = useRef<null | {
    locationId: number;
    corner: Corner;
    originX: number;
    originY: number;
    originW: number;
    originH: number;
  }>(null);

  const featureDragRef = useRef<null | {
    featureId: number;
    startWorldX: number;
    startWorldY: number;
    originX: number;
    originY: number;
  }>(null);
  const featureResizeRef = useRef<null | {
    featureId: number;
    corner: Corner;
    originX: number;
    originY: number;
    originW: number;
    originH: number;
    // Snapshotted at grab time: every move event rescales from *these*, not
    // from the live points, otherwise each event would scale the already
    // scaled result and the shape would run away from the cursor.
    originPoints: Point[] | null;
  }>(null);

  const boxSelectRef = useRef<null | {
    startWorldX: number;
    startWorldY: number;
    rect: Graphics;
  }>(null);
  const groupDragRef = useRef<null | {
    memberNodeIds: number[];
    fullLocationIds: number[];
    startWorldX: number;
    startWorldY: number;
    origins: Map<number, { x: number; y: number }>;
    originBBox: { x: number; y: number; w: number; h: number };
  }>(null);
  // Aisle-level group resize: scaling the group's aggregate bounding box
  // proportionally rescales every member location relative to the fixed
  // opposite corner.
  const groupResizeRef = useRef<null | {
    aisle: number;
    corner: Corner;
    memberNodeIds: number[];
    originBBox: { x: number; y: number; w: number; h: number };
    originGeoms: Map<number, { x: number; y: number; w: number; h: number }>;
  }>(null);

  function fittedFontSize(widthMm: number, lengthMm: number) {
    // Adaptive label sizing: scale with the smaller box dimension so text
    // never overflows a narrow bay, but stays readable in larger footprints.
    const raw = Math.min(widthMm, lengthMm) * 0.28;
    return Math.max(90, Math.min(raw, 420));
  }

  // ---------------------------------------------------------------------
  // Shared commit helpers -- these run both when a pointerup lands directly
  // on the node/handle that started the gesture (its own listener) AND, as a
  // fallback, when it lands elsewhere on the stage (app.stage's listener).
  // Both paths null-check the ref so double-firing is a harmless no-op.
  // ---------------------------------------------------------------------

  function commitSingleDrag() {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    hideCoordOverlay();
    const node = nodesRef.current.get(drag.locationId);
    if (node) {
      stateRef.current.onGeometryChange(drag.locationId, {
        physicalX: node.loc.physicalX,
        physicalY: node.loc.physicalY,
        physicalWidthMm: node.loc.physicalWidthMm,
        physicalLengthMm: node.loc.physicalLengthMm,
        rotationDegrees: node.loc.rotationDegrees,
      });
    }
  }

  function commitSingleResize() {
    const resize = resizeRef.current;
    if (!resize) return;
    resizeRef.current = null;
    hideCoordOverlay();
    const node = nodesRef.current.get(resize.locationId);
    if (node) {
      stateRef.current.onGeometryChange(resize.locationId, {
        physicalX: node.loc.physicalX,
        physicalY: node.loc.physicalY,
        physicalWidthMm: node.loc.physicalWidthMm,
        physicalLengthMm: node.loc.physicalLengthMm,
        rotationDegrees: node.loc.rotationDegrees,
      });
    }
  }

  function commitGroupDrag() {
    const drag = groupDragRef.current;
    if (!drag) return;
    groupDragRef.current = null;
    hideCoordOverlay();
    const firstId = drag.memberNodeIds[0];
    if (firstId == null) return;
    const node = nodesRef.current.get(firstId);
    const origin = drag.origins.get(firstId);
    if (!node || !origin) return;
    const dx = node.loc.physicalX - origin.x;
    const dy = node.loc.physicalY - origin.y;
    if (dx !== 0 || dy !== 0) {
      stateRef.current.onGroupMove(drag.fullLocationIds, dx, dy);
    }
  }

  // Grouping rule for click/marquee selection: racking locations expand to
  // their full aisle (all bays/levels); shelf and floor storage locations
  // expand to their zone+type group (the same grouping already used for
  // move/delete elsewhere in the app). Anything else selects just itself.
  function resolveGroupIds(locationId: number): number[] {
    const loc = locationsRef.current.find((l) => l.locationId === locationId);
    if (!loc) return [locationId];
    if (loc.locationType === "RACKING" && loc.aisle != null) {
      return locationIdsInAisle(locationsRef.current, loc.aisle);
    }
    if (loc.locationType === "SHELF" || loc.locationType === "FLOOR") {
      return locationIdsInGroup(locationsRef.current, groupKeyFor(loc));
    }
    return [locationId];
  }

  function resolveSelectionForHits(hitIds: number[]): number[] {
    const result = new Set<number>();
    for (const id of hitIds) {
      for (const gid of resolveGroupIds(id)) result.add(gid);
    }
    return Array.from(result);
  }

  function commitGroupResize() {
    const resize = groupResizeRef.current;
    if (!resize) return;
    groupResizeRef.current = null;
    hideCoordOverlay();

    const geomByBay = new Map<
      string,
      { x: number; y: number; w: number; h: number }
    >();
    for (const id of resize.memberNodeIds) {
      const node = nodesRef.current.get(id);
      if (!node) continue;
      const bayKey = `${node.loc.aisle ?? "x"}:${node.loc.bay ?? "x"}`;
      geomByBay.set(bayKey, {
        x: node.loc.physicalX,
        y: node.loc.physicalY,
        w: node.loc.physicalWidthMm,
        h: node.loc.physicalLengthMm,
      });
    }

    const updates: GeometryUpdate[] = [];
    for (const loc of locationsRef.current) {
      if (loc.locationType !== "RACKING" || loc.aisle !== resize.aisle) continue;
      const bayKey = `${loc.aisle ?? "x"}:${loc.bay ?? "x"}`;
      const geom = geomByBay.get(bayKey);
      if (!geom) continue;
      updates.push({
        locationId: loc.locationId,
        physicalX: geom.x,
        physicalY: geom.y,
        physicalWidthMm: geom.w,
        physicalLengthMm: geom.h,
      });
    }

    if (updates.length > 0) stateRef.current.onGroupResize(updates);
  }

  // ---------------------------------------------------------------------
  // Layout features
  //
  // Drawn on their own layer beneath locations, so a staging polygon or a
  // mezzanine deck never covers the racking standing on it. Each node is a
  // container positioned at the feature origin with the same
  // position/pivot/angle convention locations use, which is what lets
  // geometry.ts's rotate-about-origin math agree with what Pixi renders.
  // ---------------------------------------------------------------------

  function drawFeatureShape(node: FeatureNode, isSelected: boolean) {
    const feature = node.feature;
    const color = colorForFeature(feature);
    const meta = kindMetaFor(feature.kind);
    const strokeWidth = isSelected ? 45 : 20;
    const strokeColor = isSelected ? 0x0f172a : color;
    const pending = feature.featureId < 0;
    const outline = {
      width: strokeWidth,
      color: pending ? PENDING_CREATE_COLOR : strokeColor,
    };
    // Visual-only annotations and non-obstacles read as lighter washes so the
    // eye can separate "this blocks travel" from "this is just labelled area".
    const fillAlpha = feature.isVisualOnly
      ? 0.08
      : feature.isObstacle
        ? 0.45
        : 0.18;

    const g = node.shape.clear();

    switch (feature.geometryKind) {
      case "RECT":
        g.rect(0, 0, feature.widthMm, feature.lengthMm)
          .fill({ color, alpha: fillAlpha })
          .stroke(outline);
        break;
      case "CIRCLE": {
        const r = feature.widthMm / 2;
        g.circle(r, r, r).fill({ color, alpha: fillAlpha }).stroke(outline);
        break;
      }
      case "POLYGON": {
        const pts = feature.points ?? [];
        if (pts.length >= 3) {
          g.poly(pts.map((p) => ({ x: p.x, y: p.y })))
            .fill({ color, alpha: fillAlpha })
            .stroke(outline);
        }
        break;
      }
      case "POLYLINE": {
        const pts = feature.points ?? [];
        if (pts.length >= 2) {
          g.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
          // Walls and conveyors have a real thickness; fall back to a visible
          // hairline so a freshly drawn one is never invisible.
          const thickness = Number(feature.attrs.thicknessMm);
          g.stroke({
            width: Number.isFinite(thickness) && thickness > 0 ? thickness : 200,
            color: pending ? PENDING_CREATE_COLOR : color,
            alpha: 0.95,
          });
          if (isSelected) {
            g.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
            g.stroke({ width: 60, color: 0x0f172a, alpha: 0.9 });
          }
        }
        break;
      }
      case "POINT":
        g.circle(0, 0, POINT_MARKER_MM)
          .fill({ color, alpha: 0.9 })
          .stroke({
            width: isSelected ? 90 : 40,
            color: pending ? PENDING_CREATE_COLOR : 0x0f172a,
          });
        break;
    }

    node.label.text = feature.label ?? meta?.label ?? feature.kind;
  }

  function syncFeatureNodes(allFeatures: FeatureDTO[]) {
    const layer = featureLayerRef.current;
    if (!layer) return;

    const nodes = featureNodesRef.current;
    const seen = new Set<number>();
    const ordered = sortFeaturesForRender(allFeatures);

    for (const feature of ordered) {
      seen.add(feature.featureId);
      let node = nodes.get(feature.featureId);

      if (!node) {
        const container = new Container();
        const shape = new Graphics();
        const label = new Text({
          text: "",
          style: new TextStyle({
            fontSize: 200,
            fill: 0x1e293b,
            fontWeight: "600",
          }),
        });
        label.anchor.set(0.5);
        container.addChild(shape, label);
        layer.addChild(container);

        // Features never intercept pointer events. Pixi hit-tests a Graphics
        // against its fill path, which would make a stroke-only polyline
        // (wall, conveyor) unclickable while simultaneously letting a large
        // filled polygon swallow clicks meant for the racking drawn on top of
        // it. Picking goes through pickFeatureAt() instead, which uses the
        // exact geometry and a zoom-compensated tolerance.
        container.eventMode = "none";

        node = { container, shape, label, feature };
        nodes.set(feature.featureId, node);
      }

      node.feature = feature;
      node.container.position.set(feature.originXMm, feature.originYMm);
      node.container.pivot.set(0, 0);
      node.container.angle = feature.rotationDegrees;
      node.container.zIndex = feature.layerIndex;

      drawFeatureShape(node, feature.featureId === selectedFeatureId);

      // Labels sit at the footprint centroid rather than the origin, which is
      // the only sensible anchor for polygons and polylines.
      const local = footprintVertices({
        geometryKind: feature.geometryKind,
        originXMm: 0,
        originYMm: 0,
        widthMm: feature.widthMm,
        lengthMm: feature.lengthMm,
        rotationDegrees: 0,
        points: feature.points,
      });
      if (local.length > 0) {
        const cx = local.reduce((sum, p) => sum + p.x, 0) / local.length;
        const cy = local.reduce((sum, p) => sum + p.y, 0) / local.length;
        node.label.position.set(cx, cy);
      }
      node.label.style.fontSize = fittedFontSize(
        Math.max(feature.widthMm, POINT_MARKER_MM * 4),
        Math.max(feature.lengthMm, POINT_MARKER_MM * 4),
      );
      node.container.sortableChildren = false;
    }

    for (const [id, node] of nodes) {
      if (!seen.has(id)) {
        node.container.destroy({ children: true });
        nodes.delete(id);
      }
    }

    layer.sortableChildren = true;
    updateFeatureLabelVisibility();
    rebuildFeatureHandles();
  }

  function updateFeatureLabelVisibility() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const visible = viewport.scale.x >= LABEL_ZOOM_THRESHOLD;
    for (const node of featureNodesRef.current.values()) {
      node.label.visible = visible;
    }
  }

  /**
   * Topmost feature under a world point, or null. Iterates in reverse render
   * order so the feature drawn last (highest layer) wins, matching what the
   * user sees. Tolerance is converted from screen pixels to mm at the current
   * zoom so thin geometry keeps a constant-size grab area.
   */
  function pickFeatureAt(world: Point): number | null {
    const viewport = viewportRef.current;
    const scale = viewport?.scale.x ?? 1;
    const toleranceMm = Math.max(
      FEATURE_HIT_TOLERANCE_MM,
      HANDLE_SCREEN_SIZE / scale,
    );

    const ordered = sortFeaturesForRender(featuresRef.current);
    for (let i = ordered.length - 1; i >= 0; i--) {
      const feature = ordered[i];
      const hit = hitTestFeature(
        {
          geometryKind: feature.geometryKind,
          originXMm: feature.originXMm,
          originYMm: feature.originYMm,
          widthMm: feature.widthMm,
          lengthMm: feature.lengthMm,
          rotationDegrees: feature.rotationDegrees,
          points: feature.points,
        },
        world,
        feature.geometryKind === "POINT"
          ? Math.max(POINT_MARKER_MM, toleranceMm)
          : toleranceMm,
      );
      if (hit) return feature.featureId;
    }
    return null;
  }

  function commitFeatureDrag() {
    const drag = featureDragRef.current;
    if (!drag) return;
    featureDragRef.current = null;
    hideCoordOverlay();
    const node = featureNodesRef.current.get(drag.featureId);
    if (!node) return;
    if (
      node.feature.originXMm === drag.originX &&
      node.feature.originYMm === drag.originY
    )
      return;
    stateRef.current.onFeatureGeometryChange(drag.featureId, {
      originXMm: node.feature.originXMm,
      originYMm: node.feature.originYMm,
      widthMm: node.feature.widthMm,
      lengthMm: node.feature.lengthMm,
      rotationDegrees: node.feature.rotationDegrees,
      points: node.feature.points,
    });
  }

  function commitFeatureResize() {
    const resize = featureResizeRef.current;
    if (!resize) return;
    featureResizeRef.current = null;
    hideCoordOverlay();
    const node = featureNodesRef.current.get(resize.featureId);
    if (!node) return;
    stateRef.current.onFeatureGeometryChange(resize.featureId, {
      originXMm: node.feature.originXMm,
      originYMm: node.feature.originYMm,
      widthMm: node.feature.widthMm,
      lengthMm: node.feature.lengthMm,
      rotationDegrees: node.feature.rotationDegrees,
      points: node.feature.points,
    });
  }

  /**
   * Resize handles for the selected feature. They sit on the shared handle
   * layer in world coordinates (not as children of the rotated feature
   * container) so the grab points stay axis-aligned and predictable even for
   * a rotated wall.
   */
  function rebuildFeatureHandles() {
    const handleLayer = handleLayerRef.current;
    const viewport = viewportRef.current;
    if (!handleLayer || !viewport) return;

    for (const h of featureHandlesRef.current) h.destroy();
    featureHandlesRef.current = [];

    if (tool !== "transform" || selectedFeatureId == null) return;
    const node = featureNodesRef.current.get(selectedFeatureId);
    if (!node) return;
    // A point has no extent to drag; it is repositioned by dragging the
    // marker itself.
    if (node.feature.geometryKind === "POINT") return;

    const worldSize = HANDLE_SCREEN_SIZE / viewport.scale.x;
    const { originXMm: x, originYMm: y, widthMm: w, lengthMm: h } = node.feature;
    const corners: Record<Corner, [number, number]> = {
      nw: [x, y],
      ne: [x + w, y],
      se: [x + w, y + h],
      sw: [x, y + h],
    };

    for (const corner of HANDLE_CORNERS) {
      const [cx, cy] = corners[corner];
      const handle = new Graphics()
        .rect(-worldSize, -worldSize, worldSize * 2, worldSize * 2)
        .fill({ color: 0xffffff })
        .stroke({ width: worldSize * 0.3, color: 0x7c3aed });
      handle.position.set(cx, cy);
      handle.eventMode = "static";
      handle.cursor =
        corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize";

      handle.on("pointerdown", (e: FederatedPointerEvent) => {
        e.stopPropagation();
        featureResizeRef.current = {
          featureId: node.feature.featureId,
          corner,
          originX: node.feature.originXMm,
          originY: node.feature.originYMm,
          originW: node.feature.widthMm,
          originH: node.feature.lengthMm,
          originPoints: node.feature.points,
        };
      });

      const up = (e: FederatedPointerEvent) => {
        e.stopPropagation();
        commitFeatureResize();
      };
      handle.on("pointerup", up);
      handle.on("pointerupoutside", up);

      handleLayer.addChild(handle);
      featureHandlesRef.current.push(handle);
    }
  }

  function repositionFeatureHandles(
    x: number,
    y: number,
    w: number,
    h: number,
  ) {
    const order: Corner[] = [...HANDLE_CORNERS];
    const corners: Record<Corner, [number, number]> = {
      nw: [x, y],
      ne: [x + w, y],
      se: [x + w, y + h],
      sw: [x, y + h],
    };
    featureHandlesRef.current.forEach((handle, index) => {
      const corner = order[index];
      if (corner) handle.position.set(...corners[corner]);
    });
  }

  function syncLocationNodes(
    allLocs: LocationDTO[],
    selectedId: number | null,
  ) {
    const layer = locationLayerRef.current;
    if (!layer) return;

    const { visible, memberCountByLocationId } = resolveVisibleLocations(
      allLocs,
      activeLevelRef.current,
    );

    const nodes = nodesRef.current;
    const seen = new Set<number>();

    for (const loc of visible) {
      seen.add(loc.locationId);
      let node = nodes.get(loc.locationId);
      if (!node) {
        const container = new Container();
        const box = new Graphics();
        const label = new Text({
          text: loc.locationCode,
          style: new TextStyle({
            fontSize: 220,
            fill: 0x0f172a,
            fontWeight: "600",
          }),
        });
        label.anchor.set(0.5);

        const badge = new Text({
          text: "",
          style: new TextStyle({
            fontSize: 140,
            fill: 0xffffff,
            fontWeight: "700",
          }),
        });
        badge.anchor.set(1, 0);

        container.addChild(box, label, badge);
        layer.addChild(container);

        container.eventMode = "static";
        container.cursor = "pointer";
        container.on("pointerdown", (e: FederatedPointerEvent) => {
          if (e.button !== 0) return;
          if (stateRef.current.tool !== "transform") return;
          e.stopPropagation();
          const viewport = viewportRef.current;
          if (!viewport) return;
          const world = viewport.toWorld(e.global);
          const current = nodesRef.current.get(loc.locationId);
          if (!current) return;

          const fullLocationIds = resolveGroupIds(current.loc.locationId);

          if (fullLocationIds.length > 1) {
            const groupIdSet = new Set(fullLocationIds);
            const memberNodeIds: number[] = [];
            const origins = new Map<number, { x: number; y: number }>();
            let minX = Infinity,
              minY = Infinity,
              maxX = -Infinity,
              maxY = -Infinity;
            for (const [id, n] of nodesRef.current) {
              if (groupIdSet.has(id)) {
                memberNodeIds.push(id);
                origins.set(id, { x: n.loc.physicalX, y: n.loc.physicalY });
                minX = Math.min(minX, n.loc.physicalX);
                minY = Math.min(minY, n.loc.physicalY);
                maxX = Math.max(maxX, n.loc.physicalX + n.loc.physicalWidthMm);
                maxY = Math.max(maxY, n.loc.physicalY + n.loc.physicalLengthMm);
              }
            }
            stateRef.current.onMultiSelect(fullLocationIds);
            groupDragRef.current = {
              memberNodeIds,
              fullLocationIds,
              startWorldX: world.x,
              startWorldY: world.y,
              origins,
              originBBox: {
                x: minX,
                y: minY,
                w: maxX - minX,
                h: maxY - minY,
              },
            };
          } else {
            stateRef.current.onSelect(loc.locationId);
            dragRef.current = {
              locationId: loc.locationId,
              startWorldX: world.x,
              startWorldY: world.y,
              originX: current.loc.physicalX,
              originY: current.loc.physicalY,
            };
          }
        });

        container.on("pointerup", (e: FederatedPointerEvent) => {
          if (stateRef.current.tool !== "transform") return;
          e.stopPropagation();
          commitSingleDrag();
          commitGroupDrag();
        });

        container.on("pointerupoutside", (e: FederatedPointerEvent) => {
          if (stateRef.current.tool !== "transform") return;
          e.stopPropagation();
          commitSingleDrag();
          commitGroupDrag();
        });
        node = {
          container,
          box,
          label,
          badge,
          loc,
          memberCount: memberCountByLocationId.get(loc.locationId) ?? 1,
        };
        nodes.set(loc.locationId, node);
      }

      node.loc = loc;
      node.memberCount = memberCountByLocationId.get(loc.locationId) ?? 1;

      const isSelected =
        loc.locationId === selectedId ||
        stateRef.current.selectedLocationIds.includes(loc.locationId);
      const color = colorForLocation(loc.zoneId);
      node.box
        .clear()
        .rect(0, 0, loc.physicalWidthMm, loc.physicalLengthMm)
        .fill({ color, alpha: loc.isBlocked ? 0.25 : 0.55 })
        .stroke(strokeForNode(loc.locationId, isSelected));
      node.container.position.set(loc.physicalX, loc.physicalY);
      node.container.pivot.set(0, 0);
      node.container.angle = loc.rotationDegrees;

      node.label.text = loc.locationCode;
      node.label.style.fontSize = fittedFontSize(
        loc.physicalWidthMm,
        loc.physicalLengthMm,
      );
      node.label.position.set(
        loc.physicalWidthMm / 2,
        loc.physicalLengthMm / 2,
      );

      // Bay aggregation badge: show "×N" in the corner when this node
      // represents more than one stacked level.
      if (node.memberCount > 1) {
        node.badge.text = `×${node.memberCount}`;
        node.badge.visible = true;
        node.badge.position.set(loc.physicalWidthMm - 20, 20);
      } else {
        node.badge.visible = false;
      }
    }

    for (const [id, node] of nodes) {
      if (!seen.has(id)) {
        node.container.destroy({ children: true });
        nodes.delete(id);
      }
    }

    updateLabelVisibility();
    rebuildHandles();
  }

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let destroyed = false;
    let forceCancelInteractions: (() => void) | null = null;
    let cancelBoxSelectOnLeave: (() => void) | null = null;
    const app = new Application();

    (async () => {
      try {
        await app.init({
          resizeTo: el,
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
        });
      } catch (err) {
        console.error("Failed to initialize layout designer canvas:", err);
        if (!destroyed)
          setInitError(
            "The layout canvas couldn't start. Try reloading the page.",
          );
        return;
      }
      if (destroyed) {
        app.destroy(true);
        return;
      }
      el.appendChild(app.canvas);
      appRef.current = app;

      const viewport = new Viewport({
        screenWidth: el.clientWidth,
        screenHeight: el.clientHeight,
        worldWidth: hall.physicalWidthMm,
        worldHeight: hall.physicalLengthMm,
        events: app.renderer.events,
      });
      app.stage.addChild(viewport);
      viewportRef.current = viewport;

      const scaleX = el.clientWidth / hall.physicalWidthMm;
      const scaleY = el.clientHeight / hall.physicalLengthMm;
      const minFitScale = Math.min(scaleX, scaleY);
      minFitScaleRef.current = minFitScale;

      viewport.drag().pinch().wheel().decelerate({ friction: 0.9 });
      // Actual enable/disable of the drag plugin is driven entirely by the
      // [tool] effect below (only "pan" keeps it active) -- start paused.
      viewport.plugins.pause("drag");

      const safeMaxScale = Math.max(8, minFitScale * 1.5);
      viewport.clampZoom({ minScale: minFitScale, maxScale: safeMaxScale });
      viewport.clamp({ direction: "all", underflow: "center" });

      const floor = new Graphics()
        .rect(0, 0, hall.physicalWidthMm, hall.physicalLengthMm)
        .fill({ color: 0xffffff })
        .stroke({ width: 60, color: 0x1e293b });
      viewport.addChild(floor);

      const grid = new Graphics();
      viewport.addChild(grid);

      function drawDynamicGrid() {
        grid.clear();
        const scale = viewport.scale.x;

        let stepMm = 10000;
        if (scale > 1.0) {
          stepMm = 100;
        } else if (scale > 0.2) {
          stepMm = 1000;
        }

        const majorEvery = 5;
        const majorStrokeWidth = 3 / scale;
        const minorStrokeWidth = 1 / scale;

        for (let x = 0; x <= hall.physicalWidthMm; x += stepMm) {
          const isMajor = Math.round(x / stepMm) % majorEvery === 0;
          grid
            .moveTo(x, 0)
            .lineTo(x, hall.physicalLengthMm)
            .stroke({
              width: isMajor ? majorStrokeWidth : minorStrokeWidth,
              color: isMajor ? 0xcbd5e1 : 0xe2e8f0,
              alpha: 0.8,
            });
        }

        for (let y = 0; y <= hall.physicalLengthMm; y += stepMm) {
          const isMajor = Math.round(y / stepMm) % majorEvery === 0;
          grid
            .moveTo(0, y)
            .lineTo(hall.physicalWidthMm, y)
            .stroke({
              width: isMajor ? majorStrokeWidth : minorStrokeWidth,
              color: isMajor ? 0xcbd5e1 : 0xe2e8f0,
              alpha: 0.8,
            });
        }
      }

      const updateScale = () => updateScaleBar(viewport);

      viewport.on("zoomed", drawDynamicGrid);
      viewport.on("zoomed", updateScale);
      viewport.on("moved", updateScale);

      // Beneath the location layer: structures, docks and staging polygons
      // are context for the racking, never on top of it.
      const featureLayer = new Container();
      featureLayer.sortableChildren = true;
      viewport.addChild(featureLayer);
      featureLayerRef.current = featureLayer;

      const locationLayer = new Container();
      viewport.addChild(locationLayer);
      locationLayerRef.current = locationLayer;

      const handleLayer = new Container();
      viewport.addChild(handleLayer);
      handleLayerRef.current = handleLayer;

      viewport.fit(true);
      viewport.moveCenter(hall.physicalWidthMm / 2, hall.physicalLengthMm / 2);

      drawDynamicGrid();
      updateScale();

      viewport.eventMode = "static";

      // A pointerdown that lands on the bare viewport (not a location
      // container, which calls e.stopPropagation()) starts either a draw
      // rectangle (in "draw" mode) or a drag-select box (in "select" mode).
      // Marquee applies anywhere within the canvas/viewport bounds, even
      // outside the drawn hall floor rect.
      viewport.on("pointerdown", (e: FederatedPointerEvent) => {
        if (e.button !== 0) return;
        const world = viewport.toWorld(e.global);

        if (
          stateRef.current.tool === "draw" ||
          stateRef.current.tool === "feature"
        ) {
          const rect = new Graphics();
          viewport.addChild(rect);
          drawRef.current = {
            startWorldX: world.x,
            startWorldY: world.y,
            rect,
          };
          return;
        }

        // Reaching here in Transform means no location swallowed the event
        // (location containers stopPropagation on hit), so a feature under
        // the cursor is the next candidate -- grabbing it starts a drag
        // instead of a marquee.
        if (stateRef.current.tool === "transform") {
          const featureId = pickFeatureAt(world);
          if (featureId != null) {
            const node = featureNodesRef.current.get(featureId);
            if (node) {
              stateRef.current.onSelectFeature(featureId);
              featureDragRef.current = {
                featureId,
                startWorldX: world.x,
                startWorldY: world.y,
                originX: node.feature.originXMm,
                originY: node.feature.originYMm,
              };
              return;
            }
          }
        }

        if (
          stateRef.current.tool === "select" ||
          stateRef.current.tool === "transform"
        ) {
          const rect = new Graphics();
          viewport.addChild(rect);
          boxSelectRef.current = {
            startWorldX: world.x,
            startWorldY: world.y,
            rect,
          };
        }
      });

      viewport.on("pointermove", (e: FederatedPointerEvent) => {
        const draw = drawRef.current;
        if (draw) {
          const world = viewport.toWorld(e.global);
          const x = Math.min(draw.startWorldX, world.x);
          const y = Math.min(draw.startWorldY, world.y);
          const w = Math.abs(world.x - draw.startWorldX);
          const h = Math.abs(world.y - draw.startWorldY);
          draw.rect
            .clear()
            .rect(x, y, w, h)
            .fill({ color: 0x0891b2, alpha: 0.2 })
            .stroke({ width: 15, color: 0x0891b2 });
          showCoordOverlay(
            e.global.x,
            e.global.y,
            formatFootprint(w, h, x, y, 0),
          );
          return;
        }

        const box = boxSelectRef.current;
        if (box) {
          const world = viewport.toWorld(e.global);
          const x = Math.min(box.startWorldX, world.x);
          const y = Math.min(box.startWorldY, world.y);
          const w = Math.abs(world.x - box.startWorldX);
          const h = Math.abs(world.y - box.startWorldY);
          box.rect
            .clear()
            .rect(x, y, w, h)
            .fill({ color: 0x2563eb, alpha: 0.15 })
            .stroke({ width: 15, color: 0x2563eb });
        }
      });

      const cancelDraw = () => {
        const draw = drawRef.current;
        drawRef.current = null;
        if (draw) draw.rect.destroy();
        hideCoordOverlay();
      };

      // Leaving the canvas viewport entirely mid-marquee cancels it outright
      // (rather than letting it linger/commit on eventual release).
      cancelBoxSelectOnLeave = () => {
        const box = boxSelectRef.current;
        if (box) {
          box.rect.destroy();
          boxSelectRef.current = null;
        }
      };
      app.canvas.addEventListener("pointerleave", cancelBoxSelectOnLeave);

      viewport.on("pointerup", (e: FederatedPointerEvent) => {
        const draw = drawRef.current;
        if (draw) {
          const world = viewport.toWorld(e.global);
          const x = Math.min(draw.startWorldX, world.x);
          const y = Math.min(draw.startWorldY, world.y);
          const w = Math.abs(world.x - draw.startWorldX);
          const h = Math.abs(world.y - draw.startWorldY);
          const wasFeatureDraw = stateRef.current.tool === "feature";
          draw.rect.destroy();
          drawRef.current = null;
          hideCoordOverlay();
          if (w >= MIN_LOCATION_MM && h >= MIN_LOCATION_MM) {
            const snap = (v: number) => Math.round(v / 100) * 100;
            const clamped = clampLocation(
              snap(x),
              snap(y),
              snap(w),
              snap(h),
              hall.physicalWidthMm,
              hall.physicalLengthMm,
            );

            if (wasFeatureDraw) {
              stateRef.current.onFeatureDrawn({
                originXMm: clamped.x,
                originYMm: clamped.y,
                widthMm: clamped.width,
                lengthMm: clamped.height,
              });
            } else {
              stateRef.current.onDraftDrawn({
                physicalX: clamped.x,
                physicalY: clamped.y,
                physicalWidthMm: clamped.width,
                physicalLengthMm: clamped.height,
              });
            }
          }
          return;
        }

        const box = boxSelectRef.current;
        if (box) {
          const world = viewport.toWorld(e.global);
          const x0 = Math.min(box.startWorldX, world.x);
          const y0 = Math.min(box.startWorldY, world.y);
          const x1 = Math.max(box.startWorldX, world.x);
          const y1 = Math.max(box.startWorldY, world.y);
          box.rect.destroy();
          boxSelectRef.current = null;

          // Near-zero-movement release: a genuine single click. Point-in-box
          // hit test against the click location instead of an area
          // intersection, and instead of unconditionally clearing selection.
          if (x1 - x0 < 5 && y1 - y0 < 5) {
            let hitId: number | null = null;
            for (const [id, node] of nodesRef.current) {
              const {
                physicalX: lx,
                physicalY: ly,
                physicalWidthMm: lw,
                physicalLengthMm: lh,
              } = node.loc;
              if (x0 >= lx && x0 <= lx + lw && y0 >= ly && y0 <= ly + lh) {
                hitId = id;
                break;
              }
            }
            if (hitId == null) {
              // No location under the click -- a feature is the next
              // candidate, and only genuinely empty canvas clears everything.
              const featureId = pickFeatureAt({ x: x0, y: y0 });
              if (featureId != null) {
                stateRef.current.onSelectFeature(featureId);
                return;
              }
              stateRef.current.onSelect(null);
              stateRef.current.onSelectFeature(null);
              return;
            }
            const group = resolveSelectionForHits([hitId]);
            if (group.length > 1) stateRef.current.onMultiSelect(group);
            else stateRef.current.onSelect(hitId);
            return;
          }

          const hits: number[] = [];
          for (const [id, node] of nodesRef.current) {
            const {
              physicalX: lx,
              physicalY: ly,
              physicalWidthMm: lw,
              physicalLengthMm: lh,
            } = node.loc;
            // AABB intersection -- a location is hit if the marquee touches
            // any part of its bounding box, not only when it fully encloses it.
            const intersects =
              lx < x1 && lx + lw > x0 && ly < y1 && ly + lh > y0;
            if (intersects) hits.push(id);
          }

          const group = resolveSelectionForHits(hits);
          if (group.length > 1) stateRef.current.onMultiSelect(group);
          else if (group.length === 1) stateRef.current.onSelect(group[0]);
          else stateRef.current.onSelect(null);
          return;
        }

        if (stateRef.current.tool === "select") {
          stateRef.current.onSelect(null);
        }
      });
      viewport.on("pointerupoutside", cancelDraw);

      // Global safety net: guarantees any in-flight marquee/draw/drag/resize
      // interaction is torn down even if the pointerup lands outside the
      // canvas entirely (side panel, toolbar, zoom controls) or the window
      // loses focus (alt-tab, cursor leaves the browser) -- Pixi's own
      // pointerupoutside only covers "outside the object, still over the
      // canvas", not these cases.
      forceCancelInteractions = () => {
        const box = boxSelectRef.current;
        if (box) {
          box.rect.destroy();
          boxSelectRef.current = null;
        }
        const draw = drawRef.current;
        if (draw) {
          draw.rect.destroy();
          drawRef.current = null;
        }
        dragRef.current = null;
        resizeRef.current = null;
        groupDragRef.current = null;
        groupResizeRef.current = null;
        featureDragRef.current = null;
        featureResizeRef.current = null;
        hideCoordOverlay();
      };
      window.addEventListener("pointerup", forceCancelInteractions);
      window.addEventListener("blur", forceCancelInteractions);

      setIsReady(true);

      syncFeatureNodes(featuresRef.current);
      syncLocationNodes(
        locationsRef.current,
        stateRef.current.selectedLocationId,
      );
    })();

    return () => {
      destroyed = true;
      setIsReady(false);
      setInitError(null);
      nodesRef.current.clear();
      featureNodesRef.current.clear();
      handlesRef.current = [];
      featureHandlesRef.current = [];
      const app = appRef.current;
      const viewport = viewportRef.current;
      appRef.current = null;
      viewportRef.current = null;
      locationLayerRef.current = null;
      featureLayerRef.current = null;
      handleLayerRef.current = null;
      if (forceCancelInteractions) {
        window.removeEventListener("pointerup", forceCancelInteractions);
        window.removeEventListener("blur", forceCancelInteractions);
      }
      if (app && cancelBoxSelectOnLeave) {
        app.canvas.removeEventListener("pointerleave", cancelBoxSelectOnLeave);
      }
      if (viewport) {
        try {
          viewport.destroy();
        } catch {
          // no-op
        }
      }
      if (app) {
        try {
          app.destroy(true, { children: true });
        } catch {
          // no-op
        }
      }
      if (el) el.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hall.hallId, hall.physicalWidthMm, hall.physicalLengthMm]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (tool === "pan") viewport.plugins.resume("drag");
    else viewport.plugins.pause("drag");
  }, [tool]);

  useEffect(() => {
    if (!isReady) return;
    syncLocationNodes(locations, selectedLocationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations, isReady, activeLevel]);

  useEffect(() => {
    if (!isReady) return;
    syncFeatureNodes(features);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, isReady]);

  // Selection styling for features is a redraw of the existing Graphics only,
  // never a node rebuild -- rebuilding on every click would drop the drag
  // gesture that the click just started.
  useEffect(() => {
    if (!isReady) return;
    for (const [id, node] of featureNodesRef.current) {
      drawFeatureShape(node, id === selectedFeatureId);
    }
    rebuildFeatureHandles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFeatureId, tool, isReady]);

  useEffect(() => {
    rebuildHandles();
    for (const [id, node] of nodesRef.current) {
      const isSelected =
        id === selectedLocationId || selectedLocationIds.includes(id);
      const color = colorForLocation(node.loc.zoneId);
      node.box
        .clear()
        .rect(0, 0, node.loc.physicalWidthMm, node.loc.physicalLengthMm)
        .fill({ color, alpha: node.loc.isBlocked ? 0.25 : 0.55 })
        .stroke(strokeForNode(id, isSelected));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLocationId, selectedLocationIds, tool]);

  function updateLabelVisibility() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const visible = viewport.scale.x >= LABEL_ZOOM_THRESHOLD;
    for (const node of nodesRef.current.values()) {
      node.label.visible = visible;
      node.badge.visible = visible && node.memberCount > 1;
    }
  }

  function rebuildHandles() {
    const handleLayer = handleLayerRef.current;
    const viewport = viewportRef.current;
    if (!handleLayer || !viewport) return;

    for (const h of handlesRef.current) h.destroy();
    handlesRef.current = [];
    handleCornerGraphicsRef.current = {};
    handleOutlineRef.current = null;

    // Handles (single or group) only render in the Transform tool -- Select
    // is inspection-only and Pan is pure viewport navigation.
    if (tool !== "transform") return;

    const worldSize = HANDLE_SCREEN_SIZE / viewport.scale.x;

    if (selectedLocationIds.length > 1) {
      // Aisle-level group bounding box + handles.
      const memberNodes = selectedLocationIds
        .map((id) => nodesRef.current.get(id))
        .filter((n): n is LocationNode => Boolean(n));
      if (memberNodes.length === 0) return;

      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const node of memberNodes) {
        minX = Math.min(minX, node.loc.physicalX);
        minY = Math.min(minY, node.loc.physicalY);
        maxX = Math.max(maxX, node.loc.physicalX + node.loc.physicalWidthMm);
        maxY = Math.max(maxY, node.loc.physicalY + node.loc.physicalLengthMm);
      }

      const aisle = memberNodes[0].loc.aisle;
      if (aisle == null) return;

      const outline = new Graphics()
        .rect(minX, minY, maxX - minX, maxY - minY)
        .stroke({ width: worldSize * 0.4, color: 0x0891b2 });
      handleLayer.addChild(outline);
      handlesRef.current.push(outline);
      handleOutlineRef.current = outline;

      const corners: Record<Corner, [number, number]> = {
        nw: [minX, minY],
        ne: [maxX, minY],
        se: [maxX, maxY],
        sw: [minX, maxY],
      };

      for (const corner of HANDLE_CORNERS) {
        const [cx, cy] = corners[corner];
        const handle = new Graphics()
          .rect(-worldSize, -worldSize, worldSize * 2, worldSize * 2)
          .fill({ color: 0xffffff })
          .stroke({ width: worldSize * 0.3, color: 0x0891b2 });
        handle.position.set(cx, cy);
        handle.eventMode = "static";
        handle.cursor =
          corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize";

        handle.on("pointerdown", (e: FederatedPointerEvent) => {
          e.stopPropagation();
          const originGeoms = new Map<
            number,
            { x: number; y: number; w: number; h: number }
          >();
          for (const node of memberNodes) {
            originGeoms.set(node.loc.locationId, {
              x: node.loc.physicalX,
              y: node.loc.physicalY,
              w: node.loc.physicalWidthMm,
              h: node.loc.physicalLengthMm,
            });
          }
          groupResizeRef.current = {
            aisle,
            corner,
            memberNodeIds: memberNodes.map((n) => n.loc.locationId),
            originBBox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
            originGeoms,
          };
        });

        const handleGroupResizeUp = (e: FederatedPointerEvent) => {
          e.stopPropagation();
          commitGroupResize();
        };
        handle.on("pointerup", handleGroupResizeUp);
        handle.on("pointerupoutside", handleGroupResizeUp);

        handleLayer.addChild(handle);
        handlesRef.current.push(handle);
        handleCornerGraphicsRef.current[corner] = handle;
      }
      return;
    }

    const node = selectedLocationId
      ? nodesRef.current.get(selectedLocationId)
      : undefined;
    if (!node) return;

    const { physicalWidthMm: w, physicalLengthMm: h } = node.loc;
    const corners: Record<Corner, [number, number]> = {
      nw: [0, 0],
      ne: [w, 0],
      se: [w, h],
      sw: [0, h],
    };

    for (const corner of HANDLE_CORNERS) {
      const [cx, cy] = corners[corner];
      const handle = new Graphics()
        .rect(-worldSize, -worldSize, worldSize * 2, worldSize * 2)
        .fill({ color: 0xffffff })
        .stroke({ width: worldSize * 0.3, color: 0x0f172a });
      handle.position.set(cx, cy);
      handle.eventMode = "static";
      handle.cursor =
        corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize";

      handle.on("pointerdown", (e: FederatedPointerEvent) => {
        e.stopPropagation();
        resizeRef.current = {
          locationId: node.loc.locationId,
          corner,
          originX: node.loc.physicalX,
          originY: node.loc.physicalY,
          originW: node.loc.physicalWidthMm,
          originH: node.loc.physicalLengthMm,
        };
      });

      const handleResizeUp = (e: FederatedPointerEvent) => {
        e.stopPropagation();
        commitSingleResize();
      };

      handle.on("pointerup", handleResizeUp);
      handle.on("pointerupoutside", handleResizeUp);

      node.container.addChild(handle);
      handlesRef.current.push(handle);
      handleCornerGraphicsRef.current[corner] = handle;
    }
  }

  // Lightweight reposition path for the single-location resize gesture --
  // updates the 4 existing corner handles in place (they're children of the
  // resized node's own container, so only their local corner offset needs
  // to change) without touching Graphics identity or listeners.
  function repositionSingleHandles(w: number, h: number) {
    const corners: Record<Corner, [number, number]> = {
      nw: [0, 0],
      ne: [w, 0],
      se: [w, h],
      sw: [0, h],
    };
    for (const corner of HANDLE_CORNERS) {
      const g = handleCornerGraphicsRef.current[corner];
      if (g) g.position.set(...corners[corner]);
    }
  }

  // Lightweight reposition path for group drag/resize -- updates the
  // existing outline + 4 corner handles to a new bounding box in place.
  function repositionGroupHandles(bbox: {
    x: number;
    y: number;
    w: number;
    h: number;
  }) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const worldSize = HANDLE_SCREEN_SIZE / viewport.scale.x;
    const minX = bbox.x;
    const minY = bbox.y;
    const maxX = bbox.x + bbox.w;
    const maxY = bbox.y + bbox.h;

    const outline = handleOutlineRef.current;
    if (outline) {
      outline
        .clear()
        .rect(minX, minY, maxX - minX, maxY - minY)
        .stroke({ width: worldSize * 0.4, color: 0x0891b2 });
    }

    const corners: Record<Corner, [number, number]> = {
      nw: [minX, minY],
      ne: [maxX, minY],
      se: [maxX, maxY],
      sw: [minX, maxY],
    };
    for (const corner of HANDLE_CORNERS) {
      const g = handleCornerGraphicsRef.current[corner];
      if (g) g.position.set(...corners[corner]);
    }
  }

  const updateScaleBar = (vp: Viewport) => {
    if (!scaleTextRef.current || !scaleBarRef.current) return;
    const scale = vp.scale.x;

    const targetPx = 80;
    const mmAtTarget = targetPx / scale;

    const niceValuesMm = [
      10, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000,
    ];

    let bestMm = niceValuesMm[0];
    let minDiff = Math.abs(mmAtTarget - bestMm);
    for (const val of niceValuesMm) {
      const diff = Math.abs(mmAtTarget - val);
      if (diff < minDiff) {
        minDiff = diff;
        bestMm = val;
      }
    }

    const actualPx = bestMm * scale;
    scaleBarRef.current.style.width = `${actualPx}px`;

    if (bestMm >= 1000) {
      scaleTextRef.current.innerText = `${bestMm / 1000}m`;
    } else if (bestMm >= 10) {
      scaleTextRef.current.innerText = `${bestMm / 10}cm`;
    } else {
      scaleTextRef.current.innerText = `${bestMm}mm`;
    }
  };

  useEffect(() => {
    const app = appRef.current;
    const viewport = viewportRef.current;
    if (!app || !viewport) return;

    function handleMove(e: FederatedPointerEvent) {
      const world = viewport!.toWorld(e.global);

      const drag = dragRef.current;
      if (drag) {
        const node = nodesRef.current.get(drag.locationId);
        if (node) {
          const dx = world.x - drag.startWorldX;
          const dy = world.y - drag.startWorldY;
          const nextX = Math.max(0, drag.originX + dx);
          const nextY = Math.max(0, drag.originY + dy);
          const clamped = clampLocation(
            nextX,
            nextY,
            node.loc.physicalWidthMm,
            node.loc.physicalLengthMm,
            hall.physicalWidthMm,
            hall.physicalLengthMm,
          );

          node.loc = {
            ...node.loc,
            physicalX: clamped.x,
            physicalY: clamped.y,
          };
          node.container.position.set(clamped.x, clamped.y);
          showCoordOverlay(
            e.global.x,
            e.global.y,
            formatFootprint(
              node.loc.physicalWidthMm,
              node.loc.physicalLengthMm,
              clamped.x,
              clamped.y,
              node.loc.rotationDegrees,
            ),
          );
        }
        return;
      }

      const featureDrag = featureDragRef.current;
      if (featureDrag) {
        const node = featureNodesRef.current.get(featureDrag.featureId);
        if (node) {
          const dx = world.x - featureDrag.startWorldX;
          const dy = world.y - featureDrag.startWorldY;
          const nextX = Math.round(featureDrag.originX + dx);
          const nextY = Math.round(featureDrag.originY + dy);
          node.feature = {
            ...node.feature,
            originXMm: nextX,
            originYMm: nextY,
          };
          node.container.position.set(nextX, nextY);
          repositionFeatureHandles(
            nextX,
            nextY,
            node.feature.widthMm,
            node.feature.lengthMm,
          );
          showCoordOverlay(
            e.global.x,
            e.global.y,
            formatFootprint(
              node.feature.widthMm,
              node.feature.lengthMm,
              nextX,
              nextY,
              node.feature.rotationDegrees,
            ),
          );
        }
        return;
      }

      const featureResize = featureResizeRef.current;
      if (featureResize) {
        const node = featureNodesRef.current.get(featureResize.featureId);
        if (node) {
          let {
            originX: x,
            originY: y,
            originW: w,
            originH: h,
          } = featureResize;
          const farX = featureResize.originX + featureResize.originW;
          const farY = featureResize.originY + featureResize.originH;
          if (featureResize.corner === "nw") {
            w = Math.max(MIN_LOCATION_MM, farX - world.x);
            h = Math.max(MIN_LOCATION_MM, farY - world.y);
            x = farX - w;
            y = farY - h;
          } else if (featureResize.corner === "ne") {
            w = Math.max(MIN_LOCATION_MM, world.x - featureResize.originX);
            h = Math.max(MIN_LOCATION_MM, farY - world.y);
            y = farY - h;
          } else if (featureResize.corner === "se") {
            w = Math.max(MIN_LOCATION_MM, world.x - featureResize.originX);
            h = Math.max(MIN_LOCATION_MM, world.y - featureResize.originY);
          } else if (featureResize.corner === "sw") {
            w = Math.max(MIN_LOCATION_MM, farX - world.x);
            h = Math.max(MIN_LOCATION_MM, world.y - featureResize.originY);
            x = farX - w;
          }

          // Polygon/polyline vertices scale with the box; rect-like geometry
          // just takes the new extent. scaleGeometry keeps both consistent.
          const scaled = scaleGeometry(
            {
              geometryKind: node.feature.geometryKind,
              originXMm: node.feature.originXMm,
              originYMm: node.feature.originYMm,
              widthMm: featureResize.originW,
              lengthMm: featureResize.originH,
              rotationDegrees: node.feature.rotationDegrees,
              points: featureResize.originPoints,
            },
            w,
            h,
          );

          node.feature = {
            ...node.feature,
            originXMm: Math.round(x),
            originYMm: Math.round(y),
            widthMm: scaled.widthMm,
            lengthMm: scaled.lengthMm,
            points: scaled.points,
          };
          node.container.position.set(node.feature.originXMm, node.feature.originYMm);
          drawFeatureShape(node, true);
          repositionFeatureHandles(
            node.feature.originXMm,
            node.feature.originYMm,
            scaled.widthMm,
            scaled.lengthMm,
          );
          showCoordOverlay(
            e.global.x,
            e.global.y,
            formatFootprint(
              scaled.widthMm,
              scaled.lengthMm,
              node.feature.originXMm,
              node.feature.originYMm,
              node.feature.rotationDegrees,
            ),
          );
        }
        return;
      }

      const resize = resizeRef.current;
      if (resize) {
        const node = nodesRef.current.get(resize.locationId);
        if (node) {
          let { originX: x, originY: y, originW: w, originH: h } = resize;
          const farX = resize.originX + resize.originW;
          const farY = resize.originY + resize.originH;
          if (resize.corner === "nw") {
            w = Math.max(MIN_LOCATION_MM, farX - world.x);
            h = Math.max(MIN_LOCATION_MM, farY - world.y);
            x = farX - w;
            y = farY - h;
          } else if (resize.corner === "ne") {
            w = Math.max(MIN_LOCATION_MM, world.x - resize.originX);
            h = Math.max(MIN_LOCATION_MM, farY - world.y);
            y = farY - h;
          } else if (resize.corner === "se") {
            w = Math.max(MIN_LOCATION_MM, world.x - resize.originX);
            h = Math.max(MIN_LOCATION_MM, world.y - resize.originY);
          } else if (resize.corner === "sw") {
            w = Math.max(MIN_LOCATION_MM, farX - world.x);
            h = Math.max(MIN_LOCATION_MM, world.y - resize.originY);
            x = farX - w;
          }
          node.loc = {
            ...node.loc,
            physicalX: x,
            physicalY: y,
            physicalWidthMm: w,
            physicalLengthMm: h,
          };
          node.container.position.set(x, y);
          node.box
            .clear()
            .rect(0, 0, w, h)
            .fill({ color: colorForLocation(node.loc.zoneId), alpha: 0.55 })
            .stroke(strokeForNode(resize.locationId, true));
          node.label.style.fontSize = fittedFontSize(w, h);
          node.label.position.set(w / 2, h / 2);
          repositionSingleHandles(w, h);
          showCoordOverlay(
            e.global.x,
            e.global.y,
            formatFootprint(w, h, x, y, node.loc.rotationDegrees),
          );
        }
        return;
      }

      const groupDrag = groupDragRef.current;
      if (groupDrag) {
        const rawDx = world.x - groupDrag.startWorldX;
        const rawDy = world.y - groupDrag.startWorldY;
        // Clamp using the group's aggregate bounding box so every member's
        // relative offset is preserved exactly (a single uniform delta).
        const dx = Math.max(
          -groupDrag.originBBox.x,
          Math.min(
            rawDx,
            hall.physicalWidthMm -
              (groupDrag.originBBox.x + groupDrag.originBBox.w),
          ),
        );
        const dy = Math.max(
          -groupDrag.originBBox.y,
          Math.min(
            rawDy,
            hall.physicalLengthMm -
              (groupDrag.originBBox.y + groupDrag.originBBox.h),
          ),
        );

        for (const id of groupDrag.memberNodeIds) {
          const node = nodesRef.current.get(id);
          const origin = groupDrag.origins.get(id);
          if (!node || !origin) continue;
          const nextX = origin.x + dx;
          const nextY = origin.y + dy;
          node.loc = { ...node.loc, physicalX: nextX, physicalY: nextY };
          node.container.position.set(nextX, nextY);
        }
        // The group bbox outline/handles are separate Graphics positioned at
        // fixed absolute coordinates (unlike single-location handles, which
        // are children of the dragged container and move for free) -- they
        // need repositioning every move to track the drag in real time, but
        // (unlike a full rebuildHandles()) this only updates their
        // position/size in place, not their identity or listeners.
        repositionGroupHandles({
          x: groupDrag.originBBox.x + dx,
          y: groupDrag.originBBox.y + dy,
          w: groupDrag.originBBox.w,
          h: groupDrag.originBBox.h,
        });
        showCoordOverlay(
          e.global.x,
          e.global.y,
          `${Math.round(groupDrag.originBBox.w)}mm × ${Math.round(groupDrag.originBBox.h)}mm at (${Math.round(groupDrag.originBBox.x + dx)}, ${Math.round(groupDrag.originBBox.y + dy)}) · ${groupDrag.memberNodeIds.length} locations`,
        );
        return;
      }

      const groupResize = groupResizeRef.current;
      if (groupResize) {
        const { originBBox } = groupResize;
        let { x, y, w, h } = originBBox;
        const farX = originBBox.x + originBBox.w;
        const farY = originBBox.y + originBBox.h;
        if (groupResize.corner === "nw") {
          w = Math.max(MIN_LOCATION_MM, farX - world.x);
          h = Math.max(MIN_LOCATION_MM, farY - world.y);
          x = farX - w;
          y = farY - h;
        } else if (groupResize.corner === "ne") {
          w = Math.max(MIN_LOCATION_MM, world.x - originBBox.x);
          h = Math.max(MIN_LOCATION_MM, farY - world.y);
          y = farY - h;
        } else if (groupResize.corner === "se") {
          w = Math.max(MIN_LOCATION_MM, world.x - originBBox.x);
          h = Math.max(MIN_LOCATION_MM, world.y - originBBox.y);
        } else if (groupResize.corner === "sw") {
          w = Math.max(MIN_LOCATION_MM, farX - world.x);
          h = Math.max(MIN_LOCATION_MM, world.y - originBBox.y);
          x = farX - w;
        }

        const sx = w / originBBox.w;
        const sy = h / originBBox.h;
        // Fixed anchor corner (opposite the one being dragged) -- matches
        // the single-location resize anchor logic above.
        const anchorX =
          groupResize.corner === "ne" || groupResize.corner === "se"
            ? originBBox.x
            : farX;
        const anchorY =
          groupResize.corner === "sw" || groupResize.corner === "se"
            ? originBBox.y
            : farY;

        for (const [id, geom] of groupResize.originGeoms) {
          const node = nodesRef.current.get(id);
          if (!node) continue;
          const nextX = anchorX + (geom.x - anchorX) * sx;
          const nextY = anchorY + (geom.y - anchorY) * sy;
          const nextW = geom.w * sx;
          const nextH = geom.h * sy;
          node.loc = {
            ...node.loc,
            physicalX: nextX,
            physicalY: nextY,
            physicalWidthMm: nextW,
            physicalLengthMm: nextH,
          };
          node.container.position.set(nextX, nextY);
          node.box
            .clear()
            .rect(0, 0, nextW, nextH)
            .fill({ color: colorForLocation(node.loc.zoneId), alpha: 0.55 })
            .stroke(strokeForNode(id, true));
          node.label.style.fontSize = fittedFontSize(nextW, nextH);
          node.label.position.set(nextW / 2, nextH / 2);
        }
        repositionGroupHandles({ x, y, w, h });
        showCoordOverlay(
          e.global.x,
          e.global.y,
          `${Math.round(w)}mm × ${Math.round(h)}mm at (${Math.round(x)}, ${Math.round(y)}) · ${groupResize.memberNodeIds.length} locations`,
        );
      }
    }

    function handleUp() {
      commitSingleDrag();
      commitSingleResize();
      commitGroupDrag();
      commitGroupResize();
      commitFeatureDrag();
      commitFeatureResize();
    }

    app.stage.eventMode = "static";
    app.stage.hitArea = app.screen;
    app.stage.on("pointermove", handleMove);
    app.stage.on("pointerup", handleUp);
    app.stage.on("pointerupoutside", handleUp);
    viewport.on("zoomed", updateLabelVisibility);
    viewport.on("zoomed", updateFeatureLabelVisibility);
    viewport.on("zoomed", rebuildHandles);
    viewport.on("zoomed", rebuildFeatureHandles);

    return () => {
      const currentApp = appRef.current;
      const currentViewport = viewportRef.current;

      if (currentApp && currentApp.stage) {
        currentApp.stage.off("pointermove", handleMove);
        currentApp.stage.off("pointerup", handleUp);
        currentApp.stage.off("pointerupoutside", handleUp);
      }
      if (currentViewport) {
        currentViewport.off("zoomed", updateLabelVisibility);
        currentViewport.off("zoomed", updateFeatureLabelVisibility);
        currentViewport.off("zoomed", rebuildHandles);
        currentViewport.off("zoomed", rebuildFeatureHandles);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    locations,
    features,
    selectedLocationId,
    selectedLocationIds,
    selectedFeatureId,
    isReady,
  ]);

  return (
    <div className="relative flex h-full w-full overflow-hidden rounded-xl border bg-background/60">
      {/* CANVAS LAYER */}
      <div ref={containerRef} className="relative z-0 h-full w-full" />

      {initError && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/90 p-4 text-center text-sm font-medium text-destructive">
          {initError}
        </div>
      )}

      {/* Blocks all pointer interaction with the canvas while Save Map is in
          flight -- without this, a drag/resize/draw during the save window
          could dispatch a draft change that Save Map's unconditional
          RESET_ALL would then silently discard once the save completes. */}
      {locked && (
        <div className="pointer-events-auto absolute inset-0 z-[60] flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-xs font-medium shadow-md">
            <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
            Saving map…
          </div>
        </div>
      )}

      {/* Live coordinate overlay -- shown while drawing/dragging/resizing */}
      <div
        ref={coordOverlayRef}
        className="pointer-events-none absolute z-50 hidden rounded-md bg-slate-900/90 px-2 py-1 text-[11px] font-medium text-white shadow-sm"
        style={{ display: "none" }}
      />

      {/* UI OVERLAY */}
      <div className="pointer-events-none absolute right-4 top-4 z-50 flex flex-col items-end gap-3">
        {/* Dynamic Map Scale */}
        <div className="flex flex-col items-end gap-1 rounded-md bg-background/90 p-1.5 shadow-sm backdrop-blur-md border">
          <span
            ref={scaleTextRef}
            className="text-[10px] font-bold leading-none text-foreground"
          >
            {/* Populated by Pixi zoomed event */}
          </span>
          <div
            ref={scaleBarRef}
            className="h-1.5 border-x-2 border-b-2 border-foreground"
            style={{ width: "80px" }}
          />
        </div>

        {/* Zoom Controls */}
        <div className="pointer-events-auto flex flex-col rounded-lg border bg-background shadow-md overflow-hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleZoomIn}
            className="h-8 w-8 rounded-none border-b"
            title="Zoom In"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleZoomOut}
            className="h-8 w-8 rounded-none"
            title="Zoom Out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
        </div>

        {/* Level selector -- consolidated into the same HUD dock as the
            scale indicator and zoom controls above, instead of a separately
            positioned overlay. */}
        {availableLevels.length > 0 && (
          <div className="pointer-events-auto flex gap-1 rounded-lg border bg-background p-1 shadow-md">
            {availableLevels.map((lvl) => (
              <Button
                key={lvl}
                size="sm"
                variant={lvl === activeLevel ? "default" : "ghost"}
                onClick={() => onLevelChange(lvl)}
                className="h-8 px-2 text-xs"
              >
                L{lvl}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
