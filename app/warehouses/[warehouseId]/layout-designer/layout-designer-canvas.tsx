"use client";

import { useEffect, useState, useRef } from "react";
import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Text,
  TextStyle,
  type FederatedPointerEvent,
} from "pixi.js";
import { Viewport } from "pixi-viewport";
import type {
  FeatureDTO,
  FeatureKindDTO,
  HallDTO,
  LabelCategoryKey,
  LocationDTO,
  NavGraphDTO,
  UnderlayDTO,
} from "@/lib/warehouse-map/types";
import {
  bayFootprintKey,
  colorForLocation,
  groupByBayFootprint,
  locationIdsInAisle,
  sortFeaturesForRender,
} from "@/lib/warehouse-map/types";
import {
  centredPlacement,
  computeEnvelope,
  edgeMidpoint,
  footprintVertices,
  hitTestFeature,
  normalizeRotation,
  resizeRotatedBox,
  resizeRotatedBoxAlongAxis,
  rotateAboutOrigin,
  scaleGeometry,
  unionEnvelopes,
  worldCorner,
  type Envelope,
  type FeatureGeometry,
  type GeometryKind,
  type Point,
  type ResizeAxis,
  type ResizeEnd,
} from "@/lib/warehouse-map/geometry";
import {
  isRoomKind,
  isRouteKind,
  lockedResizeAxisFor,
  pathWidthMmFor,
} from "@/lib/warehouse-map/feature-kinds";
import {
  LOCATION_TYPE_DEFAULT_SIZE_MM,
  LOCATION_TYPE_LABELS,
  type LocationType,
} from "@/lib/warehouse-map/naming";
import { connectedComponents } from "@/lib/warehouse-map/graph-compiler";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut } from "lucide-react";

const MIN_LOCATION_MM = 200;
const HANDLE_SCREEN_SIZE = 9;
const LABEL_ZOOM_THRESHOLD = 0.55;
// World-mm radius of the marker drawn for POINT features, and the extra grab
// slack given to thin geometry (walls, conveyors) so they stay clickable.
const POINT_MARKER_MM = 350;
const FEATURE_HIT_TOLERANCE_MM = 250;

export type Tool =
  | "select"
  | "pan"
  | "transform"
  | "draw"
  | "feature"
  | "measure";

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

type Props = {
  hall: HallDTO;
  locations: LocationDTO[];
  features: FeatureDTO[];
  featureKinds: FeatureKindDTO[];
  underlay: UnderlayDTO | null;
  navGraph: NavGraphDTO;
  showNavGraph: boolean;
  /** Polyline of the previewed route, in world mm. */
  routePoints: Point[] | null;
  /** Two clicks in Measure mode report the distance between them, in mm. */
  onMeasured: (distanceMm: number) => void;
  selectedFeatureIds: number[];
  /**
   * The kind chosen from the Add feature menu, with the footprint it will be
   * placed at. Non-null only while the feature tool is armed; drives the ghost
   * preview that follows the cursor.
   */
  armedFeature: {
    kind: string;
    label: string;
    color: string;
    geometryKind: GeometryKind;
    widthMm: number;
    lengthMm: number;
  } | null;
  /** A single click in feature mode drops the armed kind centred on this point. */
  onFeaturePlaced: (worldXMm: number, worldYMm: number) => void;
  onFeatureGeometryChange: (
    featureId: number,
    geometry: FeatureGeometryUpdate,
  ) => void;
  selectedLocationIds: number[];
  /**
   * While true, a plain click (or marquee) adds to the current selection
   * instead of replacing it -- the same union behaviour a shift-click already
   * gets, just without needing to hold the key. Exists for picking several
   * locations that are far apart on a large hall (building a multi-stop
   * route, say): shift-clicking works there too, but keeping a modifier key
   * held down while panning between clicks is easy to fumble.
   */
  multiSelectMode: boolean;
  /** Escape exits multi-select mode while the canvas has focus. */
  onToggleMultiSelect: () => void;
  /** The type chosen from the Add location menu; drives its own ghost preview. */
  armedLocationType: LocationType | null;
  /** A single click in draw mode drops the armed type centred on this point. */
  onLocationPlaced: (worldXMm: number, worldYMm: number) => void;
  activeLevel: number | null;
  availableLevels: number[];
  /** null clears the pin -- clicking the already-active level button passes
   *  null back, so the overlay is a genuine toggle rather than a one-way
   *  switch with no way back to "every level". */
  onLevelChange: (level: number | null) => void;
  tool: Tool;
  /**
   * Lets the canvas itself drive a tool switch -- middle-mouse-button pan and
   * the S/M keyboard shortcuts change modes from inside the canvas rather
   * than through the top bar's buttons.
   */
  onToolChange: (tool: Tool) => void;
  /**
   * The L/F keyboard shortcuts re-arm whatever location type/feature kind was
   * last picked from the Add menus (or the first one, if nothing has been
   * picked yet this session) -- the parent owns that "last picked" memory
   * since it already owns armedFeatureKind/armedLocationType.
   */
  onQuickArmLocation: () => void;
  onQuickArmFeature: () => void;
  /**
   * While true, the next click anywhere on the canvas reports its world
   * position via onPointPicked instead of doing whatever the active tool
   * would normally do -- this is what lets Bulk Generate ask "click where it
   * should start from" rather than making the user type a coordinate. It
   * pre-empts every tool because the request came from outside the canvas
   * entirely (the bulk-generate dialog); whatever the user happened to have
   * selected as their tool beforehand isn't relevant to this one click.
   */
  pickingPoint: boolean;
  onPointPicked: (worldXMm: number, worldYMm: number) => void;
  /** Escape while pickingPoint is true cancels back out to the dialog. */
  onCancelPointPick: () => void;
  locked: boolean;
  /**
   * One callback replaces the old onSelect/onMultiSelect/onSelectFeature trio:
   * every gesture (click, shift-click, marquee) ends up producing one final
   * {locations, features} selection, so there is no reason for the canvas to
   * report it through three different channels that the caller would only
   * have to reconcile again.
   */
  onSelectionChange: (locationIds: number[], featureIds: number[]) => void;
  onGeometryChange: (
    locationId: number,
    geometry: GeometryWithRotation,
  ) => void;
  /**
   * Fired when a mixed group (any combination of locations and features, 2 or
   * more) is dragged together. There is deliberately no group-resize
   * counterpart -- resizing a rigid mix of rectangles, polygons and polylines
   * as one bounding box has no single correct meaning, so Move & Resize only
   * ever offers move and (via the panel's rotate button) rotate for a
   * multi-selection.
   */
  onGroupMove: (
    locationIds: number[],
    featureIds: number[],
    deltaXMm: number,
    deltaYMm: number,
  ) => void;
  showLabels: boolean;
  labelCategoryVisibility: Record<LabelCategoryKey, boolean>;
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
  /** Name plate drawn behind the label so room names stay readable over fill. */
  labelPlate: Graphics;
  label: Text;
  feature: FeatureDTO;
};

/**
 * Walks a polyline and emits dash segments into `g`. Pixi has no dashed-stroke
 * primitive, and the dashed centre line is what makes a travel lane read as a
 * road rather than a solid painted block.
 */
function dashPath(
  g: Graphics,
  points: Point[],
  dashMm: number,
  gapMm: number,
) {
  const period = dashMm + gapMm;
  if (period <= 0) return;
  let carry = 0;

  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const segment = Math.hypot(dx, dy);
    if (segment <= 0) continue;
    const ux = dx / segment;
    const uy = dy / segment;

    // `carry` keeps the dash rhythm continuous across corners instead of
    // restarting the pattern at every vertex.
    let cursor = -carry;
    while (cursor < segment) {
      const start = Math.max(cursor, 0);
      const end = Math.min(cursor + dashMm, segment);
      if (end > start) {
        g.moveTo(from.x + ux * start, from.y + uy * start);
        g.lineTo(from.x + ux * end, from.y + uy * end);
      }
      cursor += period;
    }
    carry = (carry + segment) % period;
  }
}

function parseHexToInt(hex: string | null | undefined, fallback: number) {
  if (!hex) return fallback;
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  return match ? parseInt(match[1], 16) : fallback;
}

const HANDLE_CORNERS = ["nw", "ne", "se", "sw"] as const;
type Corner = (typeof HANDLE_CORNERS)[number];

/**
 * Diagonal resize cursor for a corner, accounting for rotation. A "nw" corner
 * on a box rotated 90° sits where "ne" visually is, so the unrotated cursor
 * would point across the drag rather than along it.
 */
function resizeCursorFor(corner: Corner, rotationDegrees: number) {
  const quarterTurns = Math.round(normalizeRotation(rotationDegrees) / 90) % 2;
  const isPrimaryDiagonal = corner === "nw" || corner === "se";
  const flipped = quarterTurns === 1 ? !isPrimaryDiagonal : isPrimaryDiagonal;
  return flipped ? "nwse-resize" : "nesw-resize";
}

/**
 * Resize cursor for a single-axis (edge midpoint) handle. Unlike a corner --
 * which is diagonal in the local frame at every rotation, so only nwse/nesw
 * ever apply -- an edge handle is axis-aligned locally and can land exactly
 * horizontal or vertical on screen, so this also picks the plain ns/ew
 * cursors when the rotation puts it there.
 */
function axisResizeCursorFor(axis: ResizeAxis, rotationDegrees: number) {
  const AXIS_CURSORS = [
    "ew-resize",
    "nwse-resize",
    "ns-resize",
    "nesw-resize",
  ] as const;
  const local = axis === "length" ? { x: 0, y: 1 } : { x: 1, y: 0 };
  const world = rotateAboutOrigin(local.x, local.y, rotationDegrees);
  const angleDeg = ((Math.atan2(world.y, world.x) * 180) / Math.PI + 360) % 360;
  // The cursor is undirected (dragging either way along the same line looks
  // the same), so fold to a half-turn before snapping to the nearest of the
  // 4 orientations 45 degrees apart.
  const sector = Math.round((angleDeg % 180) / 45) % 4;
  return AXIS_CURSORS[sector];
}

/**
 * Clamps a proposed origin so the geometry's *rendered envelope* stays inside
 * the hall.
 *
 * The envelope rather than (origin, width, length) is what has to fit:
 * rotation is about the origin, so a rotated box occupies a different
 * rectangle than its nominal one, and a polyline's local points can legally
 * run outside its nominal box as well. Clamping the nominal box would let a
 * rotated rack hang through the wall while its numbers still looked in range.
 *
 * A footprint larger than the hall pins to the near edge rather than jumping:
 * when the upper bound falls below the lower one, the outer Math.max wins.
 */
function clampOriginToHall(
  geometry: FeatureGeometry,
  nextX: number,
  nextY: number,
  hallWidth: number,
  hallHeight: number,
): Point {
  // Measured with the origin at (0, 0), the envelope is the set of offsets
  // from the origin to each edge of the footprint -- which is exactly what the
  // hall bounds have to be applied against.
  const local = computeEnvelope({
    ...geometry,
    originXMm: 0,
    originYMm: 0,
  });
  return {
    x: Math.max(-local.minX, Math.min(nextX, hallWidth - local.maxX)),
    y: Math.max(-local.minY, Math.min(nextY, hallHeight - local.maxY)),
  };
}

/**
 * Pins a pointer position to the hall.
 *
 * Every resize gesture holds one corner fixed and follows the pointer with the
 * opposite one, so confining the pointer is enough to confine the result --
 * the anchor corner is already inside the hall by induction.
 */
function clampPointToHall(
  world: Point,
  hallWidth: number,
  hallHeight: number,
): Point {
  return {
    x: Math.max(0, Math.min(world.x, hallWidth)),
    y: Math.max(0, Math.min(world.y, hallHeight)),
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
  features,
  featureKinds,
  underlay,
  navGraph,
  showNavGraph,
  routePoints,
  onMeasured,
  selectedFeatureIds,
  armedFeature,
  onFeaturePlaced,
  onFeatureGeometryChange,
  selectedLocationIds,
  multiSelectMode,
  onToggleMultiSelect,
  armedLocationType,
  onLocationPlaced,
  activeLevel,
  availableLevels,
  onLevelChange,
  tool,
  onToolChange,
  onQuickArmLocation,
  onQuickArmFeature,
  pickingPoint,
  onPointPicked,
  onCancelPointPick,
  locked,
  onSelectionChange,
  onGeometryChange,
  onGroupMove,
  showLabels,
  labelCategoryVisibility,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const locationLayerRef = useRef<Container | null>(null);
  const featureLayerRef = useRef<Container | null>(null);
  const underlayLayerRef = useRef<Container | null>(null);
  const underlaySpriteRef = useRef<Sprite | null>(null);
  const underlayUrlRef = useRef<string | null>(null);
  const measureLayerRef = useRef<Graphics | null>(null);
  const featureGhostRef = useRef<Graphics | null>(null);
  const locationGhostRef = useRef<Graphics | null>(null);
  const navGraphLayerRef = useRef<Graphics | null>(null);
  // Node ids outside the largest connected component -- recomputed only when
  // navGraph itself changes (see the effect below `drawNavGraph`), not on
  // every zoom tick, since drawNavGraph also runs on "zoomed" and redoing a
  // union-find that often would be pure waste.
  const disconnectedNodeIdsRef = useRef<Set<number>>(new Set());
  const routeLayerRef = useRef<Graphics | null>(null);
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
  // Screen-space anchor for an in-progress middle-mouse-button pan; null
  // whenever the middle button isn't currently held down.
  const middlePanRef = useRef<{ x: number; y: number } | null>(null);
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

  /**
   * S/M/L/F switch tools while the canvas container has focus -- attached as
   * a plain React onKeyDown on that div, so it only ever fires "while focused
   * on the canvas" for free, rather than needing a global listener guarded by
   * some separate "is the canvas active" flag.
   */
  function handleCanvasKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (locked || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    switch (e.key.toLowerCase()) {
      case "s":
        onToolChange("select");
        break;
      case "m":
        onToolChange("transform");
        break;
      case "l":
        onQuickArmLocation();
        break;
      case "f":
        onQuickArmFeature();
        break;
      case "escape":
        if (pickingPoint) {
          onCancelPointPick();
        } else if (multiSelectMode) {
          onToggleMultiSelect();
        } else {
          return;
        }
        break;
      default:
        return;
    }
    e.preventDefault();
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
    onToolChange,
    selectedLocationIds,
    multiSelectMode,
    onSelectionChange,
    onGeometryChange,
    onGroupMove,
    hall,
    selectedFeatureIds,
    armedFeature,
    onFeaturePlaced,
    onFeatureGeometryChange,
    armedLocationType,
    onLocationPlaced,
    onMeasured,
    pickingPoint,
    onPointPicked,
    onCancelPointPick,
    showLabels,
    labelCategoryVisibility,
  });
  stateRef.current = {
    tool,
    onToolChange,
    selectedLocationIds,
    multiSelectMode,
    onSelectionChange,
    onGeometryChange,
    onGroupMove,
    hall,
    selectedFeatureIds,
    armedFeature,
    onFeaturePlaced,
    onFeatureGeometryChange,
    armedLocationType,
    onLocationPlaced,
    onMeasured,
    pickingPoint,
    onPointPicked,
    onCancelPointPick,
    showLabels,
    labelCategoryVisibility,
  };

  const locationsRef = useRef(locations);
  locationsRef.current = locations;

  const featuresRef = useRef(features);
  featuresRef.current = features;

  const featureKindsRef = useRef(featureKinds);
  featureKindsRef.current = featureKinds;

  // First click of a measure gesture, in world mm; the second click reports
  // the distance and resets.
  const measureAnchorRef = useRef<Point | null>(null);

  function kindMetaFor(kind: string): FeatureKindDTO | undefined {
    return featureKindsRef.current.find((k) => k.kind === kind);
  }

  function colorForFeature(feature: FeatureDTO): number {
    return parseHexToInt(
      feature.color ?? kindMetaFor(feature.kind)?.defaultColor,
      0x64748b,
    );
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
  // "corner" is the usual free 2-axis resize; "axis" is a single-axis resize
  // for a feature kind whose other dimension is locked (see
  // lockedResizeAxisFor) -- axis/end identify which edge was grabbed, the
  // same way corner does for the free case.
  type FeatureResizeGrab =
    | { mode: "corner"; corner: Corner }
    | { mode: "axis"; axis: ResizeAxis; end: ResizeEnd };
  const featureResizeRef = useRef<
    | null
    | ({
        featureId: number;
        originX: number;
        originY: number;
        originW: number;
        originH: number;
        // Snapshotted at grab time: every move event rescales from *these*,
        // not from the live points, otherwise each event would scale the
        // already scaled result and the shape would run away from the cursor.
        originPoints: Point[] | null;
      } & FeatureResizeGrab)
  >(null);
  // null when the selected feature's handles are the usual 4 corners;
  // otherwise the locked-axis mode currently on screen, so
  // repositionFeatureHandles knows how to interpret its 2 handles without
  // re-deriving lockedResizeAxisFor from a possibly-stale node lookup.
  const featureHandleAxisRef = useRef<ResizeAxis | null>(null);

  const boxSelectRef = useRef<null | {
    startWorldX: number;
    startWorldY: number;
    rect: Graphics;
  }>(null);
  // A mixed group drag: any combination of locations and features moved
  // together as a rigid body. There is no group-resize counterpart -- see the
  // note on Props.onGroupMove for why.
  const groupDragRef = useRef<null | {
    locationIds: number[];
    featureIds: number[];
    startWorldX: number;
    startWorldY: number;
    locOrigins: Map<number, { x: number; y: number }>;
    featOrigins: Map<number, { x: number; y: number }>;
    originBBox: { x: number; y: number; w: number; h: number };
    // Updated every pointermove tick with the same clamped delta already
    // being applied to the canvas -- see the note on commitGroupDrag for why
    // it, not a node lookup, is what commit reads back.
    lastDx: number;
    lastDy: number;
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

  /**
   * Envelope of one location or feature in world mm, used to size the group
   * drag's bounding box. Locations have no `points`, so they are described to
   * computeEnvelope as a plain rotated RECT.
   */
  function envelopeOfLocation(loc: LocationDTO): Envelope {
    return computeEnvelope({
      geometryKind: "RECT",
      originXMm: loc.physicalX,
      originYMm: loc.physicalY,
      widthMm: loc.physicalWidthMm,
      lengthMm: loc.physicalLengthMm,
      rotationDegrees: loc.rotationDegrees,
      points: null,
    });
  }

  /** Begins dragging every listed location and feature together as one rigid group. */
  function startGroupDrag(
    locationIds: number[],
    featureIds: number[],
    world: Point,
  ) {
    const locOrigins = new Map<number, { x: number; y: number }>();
    const featOrigins = new Map<number, { x: number; y: number }>();
    const envelopes: Envelope[] = [];

    // Not nodesRef: that map holds only the one visible representative per
    // aggregated bay group (resolveVisibleLocations picks a single level to
    // actually draw), so a whole-aisle group -- which spans every level, not
    // just the displayed one -- would silently lose every level but that one.
    // locationsRef has every real location regardless of what got a Pixi node,
    // which is what a group move needs to carry each one along.
    const locationById = new Map(
      locationsRef.current.map((l) => [l.locationId, l]),
    );
    for (const id of locationIds) {
      const loc = locationById.get(id);
      if (!loc) continue;
      locOrigins.set(id, { x: loc.physicalX, y: loc.physicalY });
      envelopes.push(envelopeOfLocation(loc));
    }
    for (const id of featureIds) {
      const node = featureNodesRef.current.get(id);
      if (!node) continue;
      featOrigins.set(id, {
        x: node.feature.originXMm,
        y: node.feature.originYMm,
      });
      envelopes.push(computeEnvelope(node.feature));
    }
    if (locOrigins.size + featOrigins.size === 0) return;

    const bbox = unionEnvelopes(envelopes);
    groupDragRef.current = {
      locationIds: Array.from(locOrigins.keys()),
      featureIds: Array.from(featOrigins.keys()),
      startWorldX: world.x,
      startWorldY: world.y,
      locOrigins,
      featOrigins,
      originBBox: {
        x: bbox.minX,
        y: bbox.minY,
        w: bbox.maxX - bbox.minX,
        h: bbox.maxY - bbox.minY,
      },
      lastDx: 0,
      lastDy: 0,
    };
  }

  function commitGroupDrag() {
    const drag = groupDragRef.current;
    if (!drag) return;
    groupDragRef.current = null;
    hideCoordOverlay();

    // Read the delta the pointermove handler already computed and clamped,
    // rather than reconstructing it from some member's moved node position.
    // The old approach picked drag.locationIds[0] and looked it up in
    // nodesRef, which only has an entry for the one visible representative
    // per aggregated bay group -- whenever that first id happened to be a
    // level nodesRef doesn't track (any level but the displayed one in a
    // whole-aisle drag), the lookup missed, found stayed false, and the
    // entire move silently failed to commit for everyone, not just that one
    // level. lastDx/lastDy has no such dependency: it's the same number
    // every member is already being moved by on screen.
    if (drag.lastDx !== 0 || drag.lastDy !== 0) {
      stateRef.current.onGroupMove(
        drag.locationIds,
        drag.featureIds,
        drag.lastDx,
        drag.lastDy,
      );
    }
  }

  // Grouping rule for click/marquee selection: racking locations expand to
  // their full aisle (all bays, all levels) by default -- that's the physical
  // structure, and moving one bay usually means moving the whole rack run.
  // Pinning a level via the L1/L2/... overlay narrows this to just that
  // level's row across the aisle instead: the overlay is asking "let me work
  // with level 2 specifically", and a click while it's active should honour
  // that rather than always dragging every level along with it.
  //
  // Shelving has no aisle to expand into, but resolveVisibleLocations
  // aggregates it by footprint exactly like racking -- one canvas node stands
  // in for every level stacked at that bay (groupByBayFootprint, in
  // types.ts, includes both RACKING and SHELF). Treating shelf as "select
  // just itself" left every level but the displayed one out of the group
  // entirely: dragging the one visible node moved only that level, the
  // other levels never got a delta applied, and they were left stranded at
  // the old position -- re-aggregating there afterward makes them look like
  // a leftover duplicate. Same bug as racking's, just via a type that this
  // function had never been taught to treat as a group at all. The fix
  // mirrors racking's level-pin behaviour, scoped to this one bay's stack
  // (its footprint) rather than a whole aisle, since shelving has no aisle
  // for it to be a fragment of.
  //
  // Floor is deliberately untouched: buildFloorLineLocations always writes
  // level: null, so no floor footprint ever has more than one location on
  // it -- there is nothing for this bug to leave behind, and "select just
  // itself" is already correct for it.
  function resolveGroupIds(locationId: number): number[] {
    const loc = locationsRef.current.find((l) => l.locationId === locationId);
    if (!loc) return [locationId];
    const activeLevel = activeLevelRef.current;

    if (loc.locationType === "RACKING" && loc.aisle != null) {
      if (activeLevel != null) {
        return locationsRef.current
          .filter(
            (l) =>
              l.locationType === "RACKING" &&
              l.aisle === loc.aisle &&
              l.level === activeLevel,
          )
          .map((l) => l.locationId);
      }
      return locationIdsInAisle(locationsRef.current, loc.aisle);
    }

    if (loc.locationType === "SHELF") {
      const key = bayFootprintKey(loc);
      const sameBay = locationsRef.current.filter(
        (l) => l.locationType === "SHELF" && bayFootprintKey(l) === key,
      );
      if (activeLevel != null) {
        return sameBay
          .filter((l) => l.level === activeLevel)
          .map((l) => l.locationId);
      }
      return sameBay.map((l) => l.locationId);
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
    const room = isRoomKind(feature.kind);
    // Rooms are built structures, so they carry a heavier wall-like border than
    // an open painted area such as a staging zone.
    const strokeWidth = isSelected ? 45 : room ? 90 : 20;
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
      : room
        ? 0.3
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
          // Drawn at true floor width rather than as a hairline: a 1200mm
          // walkway is a surface people walk along, not a pencil line, and at
          // warehouse scale the difference decides whether the map is legible.
          const bandWidth = Math.max(
            60,
            pathWidthMmFor(feature.kind, feature.attrs),
          );
          const strokeColor = pending ? PENDING_CREATE_COLOR : color;
          const route = isRouteKind(feature.kind);

          const trace = () => {
            g.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
          };

          // Painted in back-to-front order: each stroke covers the one before,
          // so the selection halo has to go down first to end up as a rim
          // rather than a blanket over the band.
          if (isSelected) {
            trace();
            g.stroke({
              width: bandWidth + Math.max(160, bandWidth * 0.35),
              color: 0x0f172a,
              alpha: 0.9,
              cap: "round",
              join: "round",
            });
          }

          // Routes read as open travel surfaces -- translucent enough to see
          // the floor through. Walls and conveyors are solid built objects.
          trace();
          g.stroke({
            width: bandWidth,
            color: strokeColor,
            alpha: route ? 0.38 : 0.95,
            cap: route ? "butt" : "round",
            join: "round",
          });

          if (route) {
            // Dashed centre line: the single cue that turns a coloured band
            // into something recognisable as a lane you travel along.
            dashPath(g, pts, bandWidth * 0.9, bandWidth * 0.7);
            g.stroke({
              width: Math.max(25, bandWidth * 0.08),
              color: 0xffffff,
              alpha: 0.9,
              cap: "butt",
            });
          } else if (feature.kind === "CONVEYOR_SEGMENT") {
            // Roller ticks across the belt read as a conveyor at a glance.
            dashPath(g, pts, bandWidth * 0.16, bandWidth * 0.45);
            g.stroke({
              width: bandWidth * 0.9,
              color: 0x0f172a,
              alpha: 0.4,
              cap: "butt",
            });
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
        const labelPlate = new Graphics();
        const label = new Text({
          text: "",
          style: new TextStyle({
            fontSize: 200,
            fill: 0x1e293b,
            fontWeight: "600",
          }),
        });
        label.anchor.set(0.5);
        // Plate before label: it is a backdrop, not a decoration on top.
        container.addChild(shape, labelPlate, label);
        layer.addChild(container);

        // Features never intercept pointer events. Pixi hit-tests a Graphics
        // against its fill path, which would make a stroke-only polyline
        // (wall, conveyor) unclickable while simultaneously letting a large
        // filled polygon swallow clicks meant for the racking drawn on top of
        // it. Picking goes through pickFeatureAt() instead, which uses the
        // exact geometry and a zoom-compensated tolerance.
        container.eventMode = "none";

        node = { container, shape, labelPlate, label, feature };
        nodes.set(feature.featureId, node);
      }

      node.feature = feature;
      node.container.position.set(feature.originXMm, feature.originYMm);
      node.container.pivot.set(0, 0);
      node.container.angle = feature.rotationDegrees;
      node.container.zIndex = feature.layerIndex;

      drawFeatureShape(node, selectedFeatureIds.includes(feature.featureId));

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
        // A point's centroid is the marker itself, so its name would print on
        // top of the pin -- drop it clear underneath instead.
        const labelOffsetY =
          feature.geometryKind === "POINT" ? POINT_MARKER_MM * 2.2 : 0;
        node.label.position.set(cx, cy + labelOffsetY);
      }
      node.label.style.fontSize = fittedFontSize(
        Math.max(feature.widthMm, POINT_MARKER_MM * 4),
        Math.max(feature.lengthMm, POINT_MARKER_MM * 4),
      );

      // Plate depends on the text, font size and position just set above, so
      // it is redrawn here rather than on every zoom change.
      drawLabelPlate(node);
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

  /**
   * Name plate behind a feature label. Rooms and areas are filled shapes, so
   * bare dark text on a mid-tone fill is often unreadable -- the plate is what
   * makes "Break room" legible without having to click the room to find out
   * what it is.
   */
  function drawLabelPlate(node: FeatureNode) {
    const g = node.labelPlate.clear();
    if (!node.label.text) return;

    // Point markers carry their label beside the pin, where there is no fill
    // to fight with, so they do not need a plate.
    if (node.feature.geometryKind === "POINT") return;

    const padX = node.label.style.fontSize as number;
    const padY = padX * 0.45;
    const w = node.label.width + padX;
    const h = node.label.height + padY;
    const radius = Math.min(h / 2, padX * 0.5);

    g.roundRect(
      node.label.position.x - w / 2,
      node.label.position.y - h / 2,
      w,
      h,
      radius,
    )
      .fill({ color: 0xffffff, alpha: 0.82 })
      .stroke({ width: Math.max(8, padX * 0.06), color: 0x0f172a, alpha: 0.18 });
  }

  /**
   * Outline of the armed feature at its real size, centred on the cursor.
   * Click-to-place is only trustworthy if you can see what you are about to
   * drop and how big it is before committing.
   */
  function drawFeatureGhost(world: Point | null) {
    const g = featureGhostRef.current;
    if (!g) return;
    g.clear();

    const armed = stateRef.current.armedFeature;
    if (!armed || !world || stateRef.current.tool !== "feature") return;

    const color = parseHexToInt(armed.color, 0x0891b2);
    // stateRef, not the prop: this runs from a pointermove listener registered
    // once at init, so the captured `hall` would go stale the moment someone
    // edits the hall's dimensions.
    const liveHall = stateRef.current.hall;
    const { x, y, width, height } = centredPlacement(
      world.x,
      world.y,
      armed.widthMm,
      armed.lengthMm,
      liveHall.physicalWidthMm,
      liveHall.physicalLengthMm,
    );

    if (armed.geometryKind === "POINT") {
      g.circle(world.x, world.y, POINT_MARKER_MM)
        .fill({ color, alpha: 0.35 })
        .stroke({ width: 60, color, alpha: 0.9 });
      return;
    }

    if (armed.geometryKind === "CIRCLE") {
      const r = Math.min(width, height) / 2;
      g.circle(x + width / 2, y + height / 2, r)
        .fill({ color, alpha: 0.2 })
        .stroke({ width: 60, color, alpha: 0.9 });
      return;
    }

    if (armed.geometryKind === "POLYLINE") {
      const midY = y + height / 2;
      g.moveTo(x, midY).lineTo(x + width, midY);
      g.stroke({
        width: Math.max(60, height),
        color,
        alpha: 0.4,
        cap: "round",
      });
      return;
    }

    g.rect(x, y, width, height)
      .fill({ color, alpha: 0.2 })
      .stroke({ width: 60, color, alpha: 0.9 });
  }

  const LOCATION_GHOST_COLOR = 0x0891b2;

  /**
   * Outline of the armed location type at its stock size, centred on the
   * cursor -- the click-to-place counterpart of drawFeatureGhost above, same
   * reasoning: you should see what you are about to drop before committing.
   */
  function drawLocationGhost(world: Point | null) {
    const g = locationGhostRef.current;
    if (!g) return;
    g.clear();

    const armed = stateRef.current.armedLocationType;
    if (!armed || !world || stateRef.current.tool !== "draw") return;

    const liveHall = stateRef.current.hall;
    const size = LOCATION_TYPE_DEFAULT_SIZE_MM[armed];
    const { x, y, width, height } = centredPlacement(
      world.x,
      world.y,
      size.widthMm,
      size.lengthMm,
      liveHall.physicalWidthMm,
      liveHall.physicalLengthMm,
    );

    g.rect(x, y, width, height)
      .fill({ color: LOCATION_GHOST_COLOR, alpha: 0.2 })
      .stroke({ width: 60, color: LOCATION_GHOST_COLOR, alpha: 0.9 });
  }

  function updateFeatureLabelVisibility() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const scale = viewport.scale.x;
    const { showLabels, labelCategoryVisibility } = stateRef.current;

    for (const node of featureNodesRef.current.values()) {
      // A fixed zoom threshold hid the name of a 7m break room at the very
      // zoom level where the room was still perfectly visible. Decide per
      // feature instead: show the name whenever the label would render large
      // enough on screen to actually be read.
      //
      // Visibility only -- the plate itself is redrawn in syncFeatureNodes,
      // because this runs on every zoom tick and re-emitting a rounded rect
      // per feature per wheel event is exactly the kind of churn that made
      // dragging large aisles expensive.
      const category = kindMetaFor(node.feature.kind)?.category;
      const categoryAllowed =
        showLabels && (category == null || labelCategoryVisibility[category] !== false);
      const onScreenFontPx = (node.label.style.fontSize as number) * scale;
      const areaLike = node.feature.geometryKind !== "POINT";
      const zoomAllowed = areaLike
        ? onScreenFontPx >= 7
        : scale >= LABEL_ZOOM_THRESHOLD;
      node.label.visible = categoryAllowed && zoomAllowed;
      node.labelPlate.visible = node.label.visible;
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

  /**
   * Features whose (rotated) bounding box touches a marquee rectangle, using
   * the same "touches any part of the box" AABB rule the location marquee
   * already uses -- so a marquee that grazes a rotated wall's corner selects
   * it, consistent with what a location marquee does in the same situation.
   */
  function featureIdsInMarquee(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): number[] {
    const hits: number[] = [];
    for (const feature of featuresRef.current) {
      const env = computeEnvelope(feature);
      const intersects =
        env.minX < x1 && env.maxX > x0 && env.minY < y1 && env.maxY > y0;
      if (intersects) hits.push(feature.featureId);
    }
    return hits;
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
   * layer rather than inside the feature's container, because that container
   * is eventMode "none" and would swallow their interactivity -- so each
   * handle's rotated world position is computed explicitly here. They must
   * track the rotation: handles left axis-aligned on a rotated feature sit
   * away from the corners they claim to resize.
   */
  function rebuildFeatureHandles() {
    const handleLayer = handleLayerRef.current;
    const viewport = viewportRef.current;
    if (!handleLayer || !viewport) return;

    for (const h of featureHandlesRef.current) h.destroy();
    featureHandlesRef.current = [];
    featureHandleAxisRef.current = null;

    // Resize only ever applies to exactly one selected object. A mixed or
    // same-type multi-selection gets an outline (drawn by rebuildHandles)
    // but no corner handles -- see the note on Props.onGroupMove.
    if (
      tool !== "transform" ||
      selectedFeatureIds.length !== 1 ||
      selectedLocationIds.length !== 0
    )
      return;
    const node = featureNodesRef.current.get(selectedFeatureIds[0]);
    if (!node) return;
    // A point has no extent to drag; it is repositioned by dragging the
    // marker itself.
    if (node.feature.geometryKind === "POINT") return;

    const worldSize = HANDLE_SCREEN_SIZE / viewport.scale.x;
    const rotation = node.feature.rotationDegrees;
    const { originXMm: x, originYMm: y, widthMm: w, lengthMm: h } = node.feature;

    // Some kinds have one dimension that is a fixed physical spec (a door's
    // opening width) or that never actually renders (a polyline's lengthMm --
    // its band width is drawn from an attribute, not this field). Those get 2
    // edge handles on the adjustable axis only, instead of the usual 4
    // corners that would let a drag change either dimension.
    const lockedAxis = lockedResizeAxisFor(
      node.feature.kind,
      node.feature.geometryKind,
    );
    featureHandleAxisRef.current = lockedAxis;

    if (lockedAxis) {
      const adjustableAxis: ResizeAxis =
        lockedAxis === "width" ? "length" : "width";
      const cursor = axisResizeCursorFor(adjustableAxis, rotation);

      for (const end of ["start", "end"] as const) {
        const { x: cx, y: cy } = edgeMidpoint(x, y, w, h, rotation, adjustableAxis, end);
        const handle = new Graphics()
          .rect(-worldSize, -worldSize, worldSize * 2, worldSize * 2)
          .fill({ color: 0xffffff })
          .stroke({ width: worldSize * 0.3, color: 0x7c3aed });
        handle.position.set(cx, cy);
        handle.angle = rotation;
        handle.eventMode = "static";
        handle.cursor = cursor;

        handle.on("pointerdown", (e: FederatedPointerEvent) => {
          e.stopPropagation();
          featureResizeRef.current = {
            mode: "axis",
            axis: adjustableAxis,
            end,
            featureId: node.feature.featureId,
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
      return;
    }

    for (const corner of HANDLE_CORNERS) {
      // Feature handles live on the (unrotated) handle layer rather than the
      // feature's own container, because that container is eventMode "none" --
      // so their world positions have to be rotated explicitly, or they sit
      // detached from the shape they resize.
      const { x: cx, y: cy } = worldCorner(x, y, w, h, rotation, corner);
      const handle = new Graphics()
        .rect(-worldSize, -worldSize, worldSize * 2, worldSize * 2)
        .fill({ color: 0xffffff })
        .stroke({ width: worldSize * 0.3, color: 0x7c3aed });
      handle.position.set(cx, cy);
      handle.angle = rotation;
      handle.eventMode = "static";
      handle.cursor = resizeCursorFor(corner, rotation);

      handle.on("pointerdown", (e: FederatedPointerEvent) => {
        e.stopPropagation();
        featureResizeRef.current = {
          mode: "corner",
          corner,
          featureId: node.feature.featureId,
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
    rotationDegrees: number,
  ) {
    const lockedAxis = featureHandleAxisRef.current;
    if (lockedAxis) {
      const adjustableAxis: ResizeAxis =
        lockedAxis === "width" ? "length" : "width";
      const order = ["start", "end"] as const;
      featureHandlesRef.current.forEach((handle, index) => {
        const end = order[index];
        if (!end) return;
        const p = edgeMidpoint(x, y, w, h, rotationDegrees, adjustableAxis, end);
        handle.position.set(p.x, p.y);
      });
      return;
    }
    const order: Corner[] = [...HANDLE_CORNERS];
    featureHandlesRef.current.forEach((handle, index) => {
      const corner = order[index];
      if (!corner) return;
      const p = worldCorner(x, y, w, h, rotationDegrees, corner);
      handle.position.set(p.x, p.y);
    });
  }

  function syncLocationNodes(allLocs: LocationDTO[]) {
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

          const existingLocIds = stateRef.current.selectedLocationIds;
          const existingFeatIds = stateRef.current.selectedFeatureIds;
          const isPartOfActiveMultiSelection =
            existingLocIds.length + existingFeatIds.length > 1 &&
            existingLocIds.includes(loc.locationId);

          // Grabbing a member of the CURRENT multi-selection drags everything
          // in it together, mixed locations and features alike. Grabbing
          // anything else starts fresh from that one location's own implicit
          // group (its whole racking aisle, or its shelf/floor group).
          if (isPartOfActiveMultiSelection) {
            startGroupDrag(existingLocIds, existingFeatIds, world);
            return;
          }

          const fullLocationIds = resolveGroupIds(current.loc.locationId);

          if (fullLocationIds.length > 1) {
            stateRef.current.onSelectionChange(fullLocationIds, []);
            startGroupDrag(fullLocationIds, [], world);
          } else {
            stateRef.current.onSelectionChange([loc.locationId], []);
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

      const isSelected = stateRef.current.selectedLocationIds.includes(
        loc.locationId,
      );
      const color = colorForLocation(loc);
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
    let removeMiddleClickGuards: (() => void) | null = null;
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

      // Middle-click starts a manual pan (below) rather than the browser's
      // native autoscroll -- Firefox/Chrome on Windows arm that on the
      // 'mousedown', so it has to be preempted there, not just on the
      // wheel/pointer events that follow.
      const preventMiddleClickDefault = (evt: MouseEvent) => {
        if (evt.button === 1) evt.preventDefault();
      };
      app.canvas.addEventListener("mousedown", preventMiddleClickDefault);
      app.canvas.addEventListener("auxclick", preventMiddleClickDefault);

      // The canvas element itself (a child of containerRef) is what actually
      // receives clicks, and clicking it doesn't hand focus to an ancestor on
      // its own -- without this, the S/M/L/F shortcuts would need an explicit
      // Tab keypress to reach the canvas first.
      const focusContainer = () => containerRef.current?.focus();
      app.canvas.addEventListener("pointerdown", focusContainer);

      removeMiddleClickGuards = () => {
        app.canvas.removeEventListener("mousedown", preventMiddleClickDefault);
        app.canvas.removeEventListener("auxclick", preventMiddleClickDefault);
        app.canvas.removeEventListener("pointerdown", focusContainer);
      };

      const viewport = new Viewport({
        screenWidth: el.clientWidth,
        screenHeight: el.clientHeight,
        worldWidth: hall.physicalWidthMm,
        worldHeight: hall.physicalLengthMm,
        events: app.renderer.events,
        // Passive listeners can't preventDefault, so the page would scroll
        // right along with the canvas zooming under the cursor.
        passiveWheel: false,
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

      // Bottom of the stack: the traced floorplan sits under everything, so
      // the drawing on top of it is always readable.
      const underlayLayer = new Container();
      viewport.addChild(underlayLayer);
      underlayLayerRef.current = underlayLayer;

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

      // Above locations so the network reads as an overlay on the layout
      // rather than something buried under it.
      const navGraphLayer = new Graphics();
      navGraphLayer.eventMode = "none";
      viewport.addChild(navGraphLayer);
      navGraphLayerRef.current = navGraphLayer;

      // Above the graph overlay: a computed route is the thing being read.
      const routeLayer = new Graphics();
      routeLayer.eventMode = "none";
      viewport.addChild(routeLayer);
      routeLayerRef.current = routeLayer;

      const measureLayer = new Graphics();
      viewport.addChild(measureLayer);
      measureLayerRef.current = measureLayer;

      const featureGhost = new Graphics();
      featureGhost.eventMode = "none";
      viewport.addChild(featureGhost);
      featureGhostRef.current = featureGhost;

      const locationGhost = new Graphics();
      locationGhost.eventMode = "none";
      viewport.addChild(locationGhost);
      locationGhostRef.current = locationGhost;

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
        // Middle-click always starts a pan, regardless of the active tool --
        // switching tool state here (rather than relying on pixi-viewport's
        // own drag plugin, which is paused/resumed by the [tool] effect below)
        // means this same gesture doesn't miss its first pointerdown while
        // that effect is still catching up to the tool-state change.
        if (e.button === 1) {
          stateRef.current.onToolChange("pan");
          middlePanRef.current = { x: e.global.x, y: e.global.y };
          return;
        }
        if (e.button !== 0) return;
        const world = viewport.toWorld(e.global);

        // Pre-empts every tool: the request to pick a point came from outside
        // the canvas (Bulk Generate asking where to start), so whatever the
        // user had selected as their tool before that is not relevant to
        // this one click.
        if (stateRef.current.pickingPoint) {
          hideCoordOverlay();
          stateRef.current.onPointPicked(world.x, world.y);
          return;
        }

        // Measure is a two-click gesture rather than a drag: on a large
        // floorplan the two ends of a known dimension are often further
        // apart than one comfortable drag, and each end wants to be placed
        // precisely (with a zoom in between if need be).
        if (stateRef.current.tool === "measure") {
          const anchor = measureAnchorRef.current;
          if (!anchor) {
            measureAnchorRef.current = { x: world.x, y: world.y };
            drawMeasureOverlay(null);
          } else {
            const distance = Math.hypot(world.x - anchor.x, world.y - anchor.y);
            measureAnchorRef.current = null;
            measureLayerRef.current?.clear();
            hideCoordOverlay();
            if (distance > 0) stateRef.current.onMeasured(distance);
          }
          return;
        }

        // Features are placed with a single click at their kind's real-world
        // size, not dragged out. Dragging a box only to then be asked what the
        // box *was* made the size arbitrary and the gesture easy to fumble;
        // the kind is already chosen in the Add feature menu, and it knows how
        // big a dock door or a break room actually is.
        if (stateRef.current.tool === "feature") {
          if (stateRef.current.armedFeature) {
            stateRef.current.onFeaturePlaced(world.x, world.y);
          }
          return;
        }

        // Locations are placed with a single click at their type's stock
        // size, mirroring the feature tool above -- same reasoning, and it
        // replaces the old drag-a-box gesture that made the size arbitrary.
        if (stateRef.current.tool === "draw") {
          if (stateRef.current.armedLocationType) {
            stateRef.current.onLocationPlaced(world.x, world.y);
          }
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
              const existingLocIds = stateRef.current.selectedLocationIds;
              const existingFeatIds = stateRef.current.selectedFeatureIds;
              const isPartOfActiveMultiSelection =
                existingLocIds.length + existingFeatIds.length > 1 &&
                existingFeatIds.includes(featureId);

              if (isPartOfActiveMultiSelection) {
                startGroupDrag(existingLocIds, existingFeatIds, world);
                return;
              }

              stateRef.current.onSelectionChange([], [featureId]);
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
        if (stateRef.current.pickingPoint) {
          const world = viewport.toWorld(e.global);
          showCoordOverlay(
            e.global.x,
            e.global.y,
            `Click to set the start point · (${Math.round(world.x)}, ${Math.round(world.y)})`,
          );
          return;
        }

        if (stateRef.current.tool === "feature") {
          const world = viewport.toWorld(e.global);
          drawFeatureGhost(world);
          const armed = stateRef.current.armedFeature;
          if (armed) {
            showCoordOverlay(
              e.global.x,
              e.global.y,
              armed.geometryKind === "POINT"
                ? `Place ${armed.label}`
                : `${armed.label} · ${armed.widthMm}×${armed.lengthMm}mm`,
            );
          }
          return;
        }

        if (stateRef.current.tool === "measure") {
          const world = viewport.toWorld(e.global);
          if (measureAnchorRef.current) {
            drawMeasureOverlay(world);
            const anchor = measureAnchorRef.current;
            const distance = Math.hypot(
              world.x - anchor.x,
              world.y - anchor.y,
            );
            showCoordOverlay(
              e.global.x,
              e.global.y,
              `${(distance / 1000).toFixed(2)} m (${Math.round(distance)} mm)`,
            );
          }
          return;
        }

        if (stateRef.current.tool === "draw") {
          const world = viewport.toWorld(e.global);
          drawLocationGhost(world);
          const armed = stateRef.current.armedLocationType;
          if (armed) {
            const size = LOCATION_TYPE_DEFAULT_SIZE_MM[armed];
            showCoordOverlay(
              e.global.x,
              e.global.y,
              `${LOCATION_TYPE_LABELS[armed]} · ${size.widthMm}×${size.lengthMm}mm`,
            );
          }
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

      // Applies a newly-hit set of locations/features to the current
      // selection: shift merges (toggling anything already selected back
      // off) or unions in a fresh hit's group; a plain click/marquee replaces
      // the selection outright. `additive` is shift-click OR multi-select
      // mode -- the two are interchangeable from here down.
      function applySelectionHits(
        hitLocationIds: number[],
        hitFeatureIds: number[],
        additive: boolean,
        toggle: boolean,
      ) {
        if (!additive) {
          stateRef.current.onSelectionChange(hitLocationIds, hitFeatureIds);
          return;
        }
        const locSet = new Set(stateRef.current.selectedLocationIds);
        const featSet = new Set(stateRef.current.selectedFeatureIds);
        if (toggle && hitLocationIds.length + hitFeatureIds.length > 0) {
          // A single clicked group toggles as one unit: if every one of its
          // members is already selected, the click removes the whole group;
          // otherwise it adds whatever part is missing. This keeps a repeat
          // click on a partially-selected racking aisle predictable instead
          // of splitting the aisle across two clicks.
          const allPresent =
            hitLocationIds.every((id) => locSet.has(id)) &&
            hitFeatureIds.every((id) => featSet.has(id));
          for (const id of hitLocationIds) {
            if (allPresent) locSet.delete(id);
            else locSet.add(id);
          }
          for (const id of hitFeatureIds) {
            if (allPresent) featSet.delete(id);
            else featSet.add(id);
          }
        } else {
          for (const id of hitLocationIds) locSet.add(id);
          for (const id of hitFeatureIds) featSet.add(id);
        }
        stateRef.current.onSelectionChange(
          Array.from(locSet),
          Array.from(featSet),
        );
      }

      viewport.on("pointerup", (e: FederatedPointerEvent) => {
        if (e.button === 1) {
          middlePanRef.current = null;
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

          // multiSelectMode makes a plain click behave like a shift-click --
          // additive rather than replacing -- without needing the key held.
          const additive = e.shiftKey || stateRef.current.multiSelectMode;

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
            // Locations render above features, so a location under the click
            // is what the user perceives as clicked even if a feature also
            // sits at that point.
            if (hitId != null) {
              const group = resolveSelectionForHits([hitId]);
              applySelectionHits(group, [], additive, true);
              return;
            }
            const featureId = pickFeatureAt({ x: x0, y: y0 });
            if (featureId != null) {
              applySelectionHits([], [featureId], additive, true);
              return;
            }
            // Nothing under the click: a plain click clears the selection;
            // shift-click (or multi-select mode) on empty space leaves an
            // existing selection alone, which is the usual expectation.
            if (!additive) stateRef.current.onSelectionChange([], []);
            return;
          }

          const locationHits: number[] = [];
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
            if (intersects) locationHits.push(id);
          }
          const featureHits = featureIdsInMarquee(x0, y0, x1, y1);

          applySelectionHits(
            resolveSelectionForHits(locationHits),
            featureHits,
            additive,
            false,
          );
          return;
        }

        if (stateRef.current.tool === "select") {
          stateRef.current.onSelectionChange([], []);
        }
      });

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
        dragRef.current = null;
        resizeRef.current = null;
        groupDragRef.current = null;
        featureDragRef.current = null;
        featureResizeRef.current = null;
        middlePanRef.current = null;
        hideCoordOverlay();
      };
      window.addEventListener("pointerup", forceCancelInteractions);
      window.addEventListener("blur", forceCancelInteractions);

      setIsReady(true);

      syncFeatureNodes(featuresRef.current);
      syncLocationNodes(locationsRef.current);
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
      underlayLayerRef.current = null;
      underlaySpriteRef.current = null;
      underlayUrlRef.current = null;
      measureLayerRef.current = null;
      measureAnchorRef.current = null;
      featureGhostRef.current = null;
      locationGhostRef.current = null;
      navGraphLayerRef.current = null;
      routeLayerRef.current = null;
      handleLayerRef.current = null;
      if (forceCancelInteractions) {
        window.removeEventListener("pointerup", forceCancelInteractions);
        window.removeEventListener("blur", forceCancelInteractions);
      }
      if (app && cancelBoxSelectOnLeave) {
        app.canvas.removeEventListener("pointerleave", cancelBoxSelectOnLeave);
      }
      if (removeMiddleClickGuards) removeMiddleClickGuards();
      middlePanRef.current = null;
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

  // Crosshair cursor while a point pick is pending, so the canvas itself
  // signals "click here" independent of whatever tool was active before the
  // pick was requested.
  useEffect(() => {
    const app = appRef.current;
    if (!app) return;
    app.canvas.style.cursor = pickingPoint ? "crosshair" : "";
  }, [pickingPoint]);

  // Leaving feature mode (or disarming the kind) must take the ghost with it,
  // otherwise a stale outline sits on the map with nothing to place.
  useEffect(() => {
    if (!isReady) return;
    if (tool !== "feature" || !armedFeature) {
      featureGhostRef.current?.clear();
      hideCoordOverlay();
    }
  }, [tool, armedFeature, isReady]);

  // Same reasoning as the feature ghost above, for the location-placement ghost.
  useEffect(() => {
    if (!isReady) return;
    if (tool !== "draw" || !armedLocationType) {
      locationGhostRef.current?.clear();
      hideCoordOverlay();
    }
  }, [tool, armedLocationType, isReady]);

  useEffect(() => {
    if (!isReady) return;
    syncLocationNodes(locations);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations, isReady, activeLevel]);

  useEffect(() => {
    if (!isReady) return;
    syncFeatureNodes(features);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, isReady]);

  // The master toggle or a per-category toggle changed -- re-apply visibility
  // without a full node rebuild.
  useEffect(() => {
    if (!isReady) return;
    updateLabelVisibility();
    updateFeatureLabelVisibility();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLabels, labelCategoryVisibility, isReady]);

  // Underlay sprite. The texture is only re-fetched when the URL changes;
  // placement (scale/offset/rotation/opacity) is applied every render, so
  // calibrating or nudging it never round-trips the image again.
  useEffect(() => {
    if (!isReady) return;
    const layer = underlayLayerRef.current;
    if (!layer) return;

    let cancelled = false;

    async function sync() {
      if (!underlay?.signedUrl || !underlay.isVisible) {
        underlaySpriteRef.current?.destroy();
        underlaySpriteRef.current = null;
        underlayUrlRef.current = null;
        return;
      }

      if (underlayUrlRef.current !== underlay.signedUrl) {
        underlaySpriteRef.current?.destroy();
        underlaySpriteRef.current = null;
        try {
          const texture = await Assets.load(underlay.signedUrl);
          if (cancelled) return;
          const sprite = new Sprite(texture);
          sprite.eventMode = "none";
          layer!.addChild(sprite);
          underlaySpriteRef.current = sprite;
          underlayUrlRef.current = underlay.signedUrl;
        } catch (err) {
          // An expired signed URL or a corrupt upload should not take the
          // whole designer down -- the layout is still fully editable.
          console.error("Failed to load underlay image:", err);
          return;
        }
      }

      const sprite = underlaySpriteRef.current;
      if (!sprite) return;
      // scale = mm per image pixel, which is exactly what calibration solves
      // for, so the raster ends up measured in the same millimetres as every
      // location and feature.
      sprite.scale.set(underlay.scaleMmPerPx);
      sprite.position.set(underlay.offsetXMm, underlay.offsetYMm);
      sprite.angle = underlay.rotationDegrees;
      sprite.alpha = underlay.opacity;
    }

    sync();
    return () => {
      cancelled = true;
    };
  }, [underlay, isReady]);

  // Navigation graph overlay. Drawn into a single Graphics rather than one
  // object per node: a compiled hall is hundreds of nodes and edges, and this
  // is a read-only overlay with no per-element interaction to preserve.
  // Flat warning red for anything outside the largest connected piece --
  // deliberately ignoring edge/node kind entirely here, so a disconnected
  // stretch reads as unmistakably broken rather than blending into the
  // normal palette. The whole point is that you shouldn't have to cross-
  // reference the compile warning's feature names against the canvas to
  // find it.
  const DISCONNECTED_COLOR = 0xdc2626;

  /**
   * Same union-find the compiler uses for its "N separate pieces" warning
   * (`connectedComponents`, graph-compiler.ts), run again here so the canvas
   * can show it rather than just report it. Recomputed from the fetched
   * nodes/edges rather than trusting anything persisted, since the whole
   * reason this exists is that the dashed centerline on a lane feature is
   * drawn unconditionally and was never a reliable signal of what's actually
   * reachable. Stores into disconnectedNodeIdsRef rather than returning,
   * so drawNavGraph's per-zoom-tick redraws stay a cheap Set lookup.
   */
  function recomputeDisconnectedNodes() {
    const nodeKeys = navGraph.nodes.map((n) => String(n.nodeId));
    const edgeKeys = navGraph.edges.map((e) => ({
      fromKey: String(e.fromNodeId),
      toKey: String(e.toNodeId),
    }));
    const roots = connectedComponents(nodeKeys, edgeKeys);

    const sizes = new Map<string, number>();
    for (const root of roots.values()) {
      sizes.set(root, (sizes.get(root) ?? 0) + 1);
    }
    let largestRoot: string | null = null;
    let largestSize = 0;
    for (const [root, size] of sizes) {
      if (size > largestSize) {
        largestSize = size;
        largestRoot = root;
      }
    }

    const disconnected = new Set<number>();
    if (largestRoot !== null) {
      for (const node of navGraph.nodes) {
        if (roots.get(String(node.nodeId)) !== largestRoot) {
          disconnected.add(node.nodeId);
        }
      }
    }
    disconnectedNodeIdsRef.current = disconnected;
  }

  function drawNavGraph() {
    const g = navGraphLayerRef.current;
    const viewport = viewportRef.current;
    if (!g || !viewport) return;
    g.clear();
    if (!showNavGraph) return;

    const scale = viewport.scale.x;
    const nodeById = new Map(navGraph.nodes.map((n) => [n.nodeId, n]));
    const isDisconnected = (nodeId: number) =>
      disconnectedNodeIdsRef.current.has(nodeId);

    // Edge colour carries the edge kind, which is the thing a supervisor
    // actually needs to check: is this an inferred aisle, a cross-aisle, a
    // walkway, or a link out to a door?
    const EDGE_STYLE: Record<string, { color: number; width: number }> = {
      AISLE: { color: 0x0d9488, width: 3 },
      CROSS_AISLE: { color: 0x14b8a6, width: 2.5 },
      LANE: { color: 0x0f766e, width: 3 },
      WALKWAY: { color: 0x65a30d, width: 2.5 },
      PORTAL: { color: 0x7c3aed, width: 3 },
      ACCESS: { color: 0x94a3b8, width: 1.5 },
      ZONE: { color: 0x0891b2, width: 1 },
    };

    // A free-roam area compiles to hundreds of lattice edges, so drawing them
    // at lane weight would bury the lanes underneath a solid block of colour.
    // They are drawn hairline and faint: what you need from them at a glance
    // is "this floor is covered and connected", not each individual hop.
    const ZONE_ALPHA = 0.28;

    for (const edge of navGraph.edges) {
      const from = nodeById.get(edge.fromNodeId);
      const to = nodeById.get(edge.toNodeId);
      if (!from || !to) continue;
      const style = EDGE_STYLE[edge.edgeKind] ?? {
        color: 0x64748b,
        width: 2,
      };
      const disconnected = isDisconnected(edge.fromNodeId);
      const isZone = edge.edgeKind === "ZONE";
      g.moveTo(from.xMm, from.yMm)
        .lineTo(to.xMm, to.yMm)
        .stroke({
          width: (disconnected ? style.width + 1 : style.width) / scale,
          color: disconnected ? DISCONNECTED_COLOR : style.color,
          alpha: disconnected
            ? 1
            : isZone
              ? ZONE_ALPHA
              : edge.isGenerated
                ? 0.85
                : 1,
        });
    }

    // Lattice interiors are drawn as edges only. A dot at every one of them
    // would be several hundred filled circles that say nothing the mesh does
    // not already show -- but a node where a lane meets the lattice, or one
    // the compiler could not connect, still has to be visible.
    const zoneOnlyNodes = new Set<number>();
    const nonZoneTouched = new Set<number>();
    for (const edge of navGraph.edges) {
      const target = edge.edgeKind === "ZONE" ? zoneOnlyNodes : nonZoneTouched;
      target.add(edge.fromNodeId);
      target.add(edge.toNodeId);
    }
    for (const id of nonZoneTouched) zoneOnlyNodes.delete(id);

    const NODE_STYLE: Record<string, { color: number; radius: number }> = {
      ACCESS: { color: 0x94a3b8, radius: 2.5 },
      INTERSECTION: { color: 0x0f172a, radius: 4 },
      PORTAL: { color: 0x7c3aed, radius: 5 },
      DOCK: { color: 0x2563eb, radius: 5 },
      WAYPOINT: { color: 0x0d9488, radius: 3 },
    };

    for (const node of navGraph.nodes) {
      const style = NODE_STYLE[node.nodeKind] ?? {
        color: 0x0d9488,
        radius: 3,
      };
      const disconnected = isDisconnected(node.nodeId);
      // Plain lattice interior: the mesh already shows it. Anything stranded
      // still gets its red dot, which is the whole point of the overlay.
      if (
        zoneOnlyNodes.has(node.nodeId) &&
        node.nodeKind === "WAYPOINT" &&
        !disconnected
      ) {
        continue;
      }
      g.circle(node.xMm, node.yMm, style.radius / scale).fill({
        color: disconnected ? DISCONNECTED_COLOR : style.color,
        alpha: 0.95,
      });
      // Hand-placed nodes get a ring so a correction is visibly distinct from
      // something the compiler guessed and may overwrite conceptually.
      if (!node.isGenerated) {
        g.circle(node.xMm, node.yMm, (style.radius + 2.5) / scale).stroke({
          width: 1.5 / scale,
          color: 0xf59e0b,
        });
      }
    }
  }

  useEffect(() => {
    if (!isReady) return;
    recomputeDisconnectedNodes();
    drawNavGraph();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navGraph, showNavGraph, isReady]);

  // Previewed route: a heavy casing line with a bright core, so it stays
  // readable over both the racking fill and the graph overlay underneath.
  function drawRoute() {
    const g = routeLayerRef.current;
    const viewport = viewportRef.current;
    if (!g || !viewport) return;
    g.clear();
    if (!routePoints || routePoints.length < 2) return;

    const scale = viewport.scale.x;
    const trace = () => {
      g.moveTo(routePoints[0].x, routePoints[0].y);
      for (let i = 1; i < routePoints.length; i++) {
        g.lineTo(routePoints[i].x, routePoints[i].y);
      }
    };

    trace();
    g.stroke({ width: 9 / scale, color: 0x0f172a, alpha: 0.35 });
    trace();
    g.stroke({ width: 5 / scale, color: 0xf59e0b, alpha: 1 });

    // Start and end markers -- which way round the route runs matters.
    const first = routePoints[0];
    const last = routePoints[routePoints.length - 1];
    g.circle(first.x, first.y, 7 / scale)
      .fill({ color: 0x16a34a })
      .stroke({ width: 2 / scale, color: 0xffffff });
    g.circle(last.x, last.y, 7 / scale)
      .fill({ color: 0xdc2626 })
      .stroke({ width: 2 / scale, color: 0xffffff });
  }

  useEffect(() => {
    if (!isReady) return;
    drawRoute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routePoints, isReady]);

  // Measure overlay: anchor marker plus the rubber-band line to the cursor.
  function drawMeasureOverlay(cursor: Point | null) {
    const g = measureLayerRef.current;
    const viewport = viewportRef.current;
    if (!g || !viewport) return;
    g.clear();
    const anchor = measureAnchorRef.current;
    if (!anchor) return;

    const markerRadius = 6 / viewport.scale.x;
    const lineWidth = 2 / viewport.scale.x;
    g.circle(anchor.x, anchor.y, markerRadius).fill({ color: 0x7c3aed });
    if (cursor) {
      g.moveTo(anchor.x, anchor.y)
        .lineTo(cursor.x, cursor.y)
        .stroke({ width: lineWidth, color: 0x7c3aed });
      g.circle(cursor.x, cursor.y, markerRadius).stroke({
        width: lineWidth,
        color: 0x7c3aed,
      });
    }
  }

  // Leaving Measure mode abandons any half-finished measurement.
  useEffect(() => {
    if (tool === "measure") return;
    measureAnchorRef.current = null;
    measureLayerRef.current?.clear();
  }, [tool]);

  // Selection styling for features is a redraw of the existing Graphics only,
  // never a node rebuild -- rebuilding on every click would drop the drag
  // gesture that the click just started.
  useEffect(() => {
    if (!isReady) return;
    for (const [id, node] of featureNodesRef.current) {
      drawFeatureShape(node, selectedFeatureIds.includes(id));
    }
    rebuildFeatureHandles();
    rebuildHandles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFeatureIds, selectedLocationIds, tool, isReady]);

  useEffect(() => {
    rebuildHandles();
    for (const [id, node] of nodesRef.current) {
      const isSelected = selectedLocationIds.includes(id);
      const color = colorForLocation(node.loc);
      node.box
        .clear()
        .rect(0, 0, node.loc.physicalWidthMm, node.loc.physicalLengthMm)
        .fill({ color, alpha: node.loc.isBlocked ? 0.25 : 0.55 })
        .stroke(strokeForNode(id, isSelected));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLocationIds, selectedFeatureIds, tool]);

  function updateLabelVisibility() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const { showLabels, labelCategoryVisibility } = stateRef.current;
    const visible =
      showLabels &&
      labelCategoryVisibility.LOCATION !== false &&
      viewport.scale.x >= LABEL_ZOOM_THRESHOLD;
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
    const totalSelected = selectedLocationIds.length + selectedFeatureIds.length;

    if (totalSelected > 1) {
      // A mixed (or same-type) multi-selection gets an outline showing what
      // is selected, and nothing else -- no corner handles. Resizing a rigid
      // mix of rectangles, polygons and polylines as one bounding box has no
      // single correct meaning once features are mixed in, so Move & Resize
      // only offers move (drag any member) and rotate (the panel's button)
      // for a multi-selection; see the note on Props.onGroupMove.
      const envelopes: Envelope[] = [];
      for (const id of selectedLocationIds) {
        const node = nodesRef.current.get(id);
        if (node) envelopes.push(envelopeOfLocation(node.loc));
      }
      for (const id of selectedFeatureIds) {
        const node = featureNodesRef.current.get(id);
        if (node) envelopes.push(computeEnvelope(node.feature));
      }
      if (envelopes.length === 0) return;

      const bbox = unionEnvelopes(envelopes);
      const outline = new Graphics()
        .rect(bbox.minX, bbox.minY, bbox.maxX - bbox.minX, bbox.maxY - bbox.minY)
        .stroke({ width: worldSize * 0.4, color: 0x0891b2 });
      handleLayer.addChild(outline);
      handlesRef.current.push(outline);
      handleOutlineRef.current = outline;
      return;
    }

    if (selectedLocationIds.length !== 1) return;
    const node = nodesRef.current.get(selectedLocationIds[0]);
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
      // These handles are children of the location's own rotated container, so
      // they already follow the box -- only the cursor needs the rotation.
      handle.cursor = resizeCursorFor(corner, node.loc.rotationDegrees);

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
      const middlePan = middlePanRef.current;
      if (middlePan) {
        // Raw screen-pixel delta, exactly what pixi-viewport's own Drag
        // plugin adds to viewport.x/y -- the viewport's position is a screen
        // offset, not a world one, so this is correct at any zoom level.
        const dx = e.global.x - middlePan.x;
        const dy = e.global.y - middlePan.y;
        viewport!.x += dx;
        viewport!.y += dy;
        viewport!.emit("moved", { viewport: viewport!, type: "drag" });
        middlePanRef.current = { x: e.global.x, y: e.global.y };
        return;
      }

      const world = viewport!.toWorld(e.global);
      // Every resize branch below drags one corner to the pointer, so pinning
      // the pointer to the hall is what keeps a resize inside it.
      const pinned = clampPointToHall(
        world,
        hall.physicalWidthMm,
        hall.physicalLengthMm,
      );

      const drag = dragRef.current;
      if (drag) {
        const node = nodesRef.current.get(drag.locationId);
        if (node) {
          const dx = world.x - drag.startWorldX;
          const dy = world.y - drag.startWorldY;
          const clamped = clampOriginToHall(
            {
              geometryKind: "RECT",
              originXMm: node.loc.physicalX,
              originYMm: node.loc.physicalY,
              widthMm: node.loc.physicalWidthMm,
              lengthMm: node.loc.physicalLengthMm,
              rotationDegrees: node.loc.rotationDegrees,
              points: null,
            },
            drag.originX + dx,
            drag.originY + dy,
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
          const clamped = clampOriginToHall(
            node.feature,
            featureDrag.originX + dx,
            featureDrag.originY + dy,
            hall.physicalWidthMm,
            hall.physicalLengthMm,
          );
          const nextX = Math.round(clamped.x);
          const nextY = Math.round(clamped.y);
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
            node.feature.rotationDegrees,
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
          // Resolved in the feature's own rotated frame, so dragging along a
          // rotated feature's visible long edge grows its length rather than
          // its width. Axis-locked kinds (a door, a walkway) go through the
          // single-axis variant instead, which never lets the pointer move
          // the locked dimension no matter where it lands.
          const resized =
            featureResize.mode === "axis"
              ? resizeRotatedBoxAlongAxis(
                  featureResize.originX,
                  featureResize.originY,
                  featureResize.originW,
                  featureResize.originH,
                  node.feature.rotationDegrees,
                  featureResize.axis,
                  featureResize.end,
                  pinned,
                  MIN_LOCATION_MM,
                )
              : resizeRotatedBox(
                  featureResize.originX,
                  featureResize.originY,
                  featureResize.originW,
                  featureResize.originH,
                  node.feature.rotationDegrees,
                  featureResize.corner,
                  pinned,
                  MIN_LOCATION_MM,
                );
          const x = resized.originXMm;
          const y = resized.originYMm;
          const w = resized.widthMm;
          const h = resized.lengthMm;

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
            node.feature.rotationDegrees,
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
          // Same rotated-frame resolution as features: a rotated rack resizes
          // along its own axes, not the screen's.
          const resized = resizeRotatedBox(
            resize.originX,
            resize.originY,
            resize.originW,
            resize.originH,
            node.loc.rotationDegrees,
            resize.corner,
            pinned,
            MIN_LOCATION_MM,
          );
          const x = resized.originXMm;
          const y = resized.originYMm;
          const w = resized.widthMm;
          const h = resized.lengthMm;
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
            .fill({ color: colorForLocation(node.loc), alpha: 0.55 })
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
        // Recorded so commitGroupDrag can read the delta back directly
        // instead of reconstructing it from a moved node's position.
        groupDrag.lastDx = dx;
        groupDrag.lastDy = dy;

        for (const id of groupDrag.locationIds) {
          const node = nodesRef.current.get(id);
          const origin = groupDrag.locOrigins.get(id);
          if (!node || !origin) continue;
          const nextX = origin.x + dx;
          const nextY = origin.y + dy;
          node.loc = { ...node.loc, physicalX: nextX, physicalY: nextY };
          node.container.position.set(nextX, nextY);
        }
        for (const id of groupDrag.featureIds) {
          const node = featureNodesRef.current.get(id);
          const origin = groupDrag.featOrigins.get(id);
          if (!node || !origin) continue;
          const nextX = origin.x + dx;
          const nextY = origin.y + dy;
          node.feature = { ...node.feature, originXMm: nextX, originYMm: nextY };
          node.container.position.set(nextX, nextY);
        }
        // The group bbox outline is a separate Graphics positioned at fixed
        // absolute coordinates (unlike single-location handles, which are
        // children of the dragged container and move for free) -- it needs
        // repositioning every move to track the drag in real time, but
        // (unlike a full rebuildHandles()) this only updates its
        // position/size in place, not its identity or listeners.
        repositionGroupHandles({
          x: groupDrag.originBBox.x + dx,
          y: groupDrag.originBBox.y + dy,
          w: groupDrag.originBBox.w,
          h: groupDrag.originBBox.h,
        });
        const memberCount =
          groupDrag.locationIds.length + groupDrag.featureIds.length;
        showCoordOverlay(
          e.global.x,
          e.global.y,
          `${Math.round(groupDrag.originBBox.w)}mm × ${Math.round(groupDrag.originBBox.h)}mm at (${Math.round(groupDrag.originBBox.x + dx)}, ${Math.round(groupDrag.originBBox.y + dy)}) · ${memberCount} objects`,
        );
        return;
      }
    }

    function handleUp() {
      commitSingleDrag();
      commitSingleResize();
      commitGroupDrag();
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
    // Line widths and node radii are divided by the zoom so the overlay keeps
    // a constant on-screen weight instead of turning into blobs when zoomed in.
    viewport.on("zoomed", drawNavGraph);
    viewport.on("zoomed", drawRoute);

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
        currentViewport.off("zoomed", drawNavGraph);
        currentViewport.off("zoomed", drawRoute);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    locations,
    features,
    selectedLocationIds,
    selectedFeatureIds,
    isReady,
  ]);

  return (
    <div className="relative flex h-full w-full overflow-hidden rounded-xl border bg-background/60">
      {/* CANVAS LAYER -- tabIndex makes it focusable (the pointerdown listener
          set up in the mount effect calls .focus() on it), and onKeyDown is
          what scopes the S/M/L/F shortcuts to "while focused on the canvas"
          rather than needing a global listener. outline-none drops the
          default focus ring; focus-visible restores one for Tab-key focus. */}
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleCanvasKeyDown}
        className="relative z-0 h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50"
      />

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

      {/* UI OVERLAY -- same glassmorphism treatment (translucent background +
          backdrop-blur) across every HUD piece for visual consistency with
          the top bar/sidebar redesign; positions and pointer-events logic
          unchanged. */}
      <div className="pointer-events-none absolute right-3 top-3 z-50 flex flex-col items-end gap-2">
        {/* Dynamic Map Scale */}
        <div className="flex flex-col items-end gap-1 rounded-md border bg-background/90 p-1.5 shadow-sm backdrop-blur-md">
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
        <div className="pointer-events-auto flex flex-col overflow-hidden rounded-lg border bg-background/90 shadow-md backdrop-blur-md">
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
          <div className="pointer-events-auto flex gap-1 rounded-lg border bg-background/90 p-1 shadow-md backdrop-blur-md">
            {availableLevels.map((lvl) => (
              <Button
                key={lvl}
                size="sm"
                variant={lvl === activeLevel ? "default" : "ghost"}
                onClick={() => onLevelChange(lvl === activeLevel ? null : lvl)}
                className="h-8 px-2 text-xs"
                title={
                  lvl === activeLevel
                    ? "Click again to show and select every level"
                    : `Show and select only level ${lvl}`
                }
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
