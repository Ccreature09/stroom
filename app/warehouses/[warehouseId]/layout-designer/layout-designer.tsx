"use client";

import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, History, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import HallToolbar from "./hall-toolbar";
import LayoutTopBar from "./layout-top-bar";
import LayoutDesignerCanvas, { type Tool } from "./layout-designer-canvas";
import { EditLocationPanel, EmptyLocationPanel } from "./location-panel";
import { EditFeaturePanel } from "./feature-panel";
import { MultiObjectPanel } from "./multi-object-panel";
import type {
  FeatureDTO,
  FeatureKindDTO,
  FeaturePatch,
  HallDTO,
  HallPatch,
  HallState,
  LabelCategoryKey,
  LayoutVersionDTO,
  LocationDTO,
  LocationPatch,
  NavGraphDTO,
  RoutingVehicleDTO,
  RecoveredDraft,
  UnderlayDTO,
} from "@/lib/warehouse-map/types";
import {
  DRAFT_STATE_VERSION,
  EMPTY_HALL_STATE,
  applyHallStateToFeatures,
  applyHallStateToLocations,
  hallStateChangeCount,
} from "@/lib/warehouse-map/types";
import {
  centredPlacement,
  clampBBoxOffset,
  computeEnvelope,
  defaultPointsForDrawnRect,
  rigidRotateAround,
  unionEnvelopes,
  type Envelope,
  type Point,
} from "@/lib/warehouse-map/geometry";
import type { BulkGeneratorKind } from "./bulk-generator-dialog";
import {
  CATEGORY_ORDER,
  defaultPlacementSizeMm,
} from "@/lib/warehouse-map/feature-kinds";
import {
  LOCATION_TYPE_DEFAULT_SIZE_MM,
  LOCATION_TYPES,
  type LocationType,
} from "@/lib/warehouse-map/naming";
import { commitHallStates, type PublishConflict } from "./actions";
import type { RoutePreview } from "@/lib/warehouse-map/routing-server";
import { saveHallDraft } from "./lifecycle-actions";

type HallHistory = {
  past: HallState[];
  present: HallState;
  future: HallState[];
};

type DraftState = Record<number, HallHistory>;

type DraftAction =
  | { type: "EDIT_HALL_FIELD"; hallId: number; field: keyof HallPatch; value: HallPatch[keyof HallPatch] }
  | { type: "CREATE_LOCATION"; hallId: number; tempId: number; data: LocationPatch }
  | { type: "PATCH_LOCATION"; hallId: number; locationId: number; patch: LocationPatch }
  | { type: "DELETE_LOCATION"; hallId: number; locationId: number }
  | {
      type: "CREATE_FEATURE";
      hallId: number;
      tempId: number;
      kind: string;
      geometryKind: FeatureDTO["geometryKind"];
      data: FeaturePatch;
    }
  | {
      type: "PATCH_FEATURE";
      hallId: number;
      featureId: number;
      patch: FeaturePatch;
    }
  | { type: "DELETE_FEATURE"; hallId: number; featureId: number }
  | {
      // One history entry covering a mixed group of locations and features
      // moved or rotated together, so undoing a single drag/rotate gesture
      // takes exactly one undo rather than one per member.
      type: "PATCH_GROUP";
      hallId: number;
      locationUpdates: Array<{ locationId: number; patch: LocationPatch }>;
      featureUpdates: Array<{ featureId: number; patch: FeaturePatch }>;
    }
  | { type: "UNDO"; hallId: number }
  | { type: "REDO"; hallId: number }
  | { type: "RESET_ALL" }
  | { type: "HYDRATE"; state: DraftState }
  | { type: "FORGET_HALL"; hallId: number };

function withoutKey<V>(record: Record<number, V>, key: number): Record<number, V> {
  const next = { ...record };
  delete next[key];
  return next;
}

function pushHistory(
  state: DraftState,
  hallId: number,
  mutate: (present: HallState) => HallState,
): DraftState {
  const existing = state[hallId] ?? {
    past: [],
    present: EMPTY_HALL_STATE,
    future: [],
  };
  return {
    ...state,
    [hallId]: {
      past: [...existing.past, existing.present],
      present: mutate(existing.present),
      future: [],
    },
  };
}

function patchLocationInState(
  present: HallState,
  locationId: number,
  patch: LocationPatch,
): HallState {
  if (locationId < 0) {
    return {
      ...present,
      newLocations: present.newLocations.map((nl) =>
        nl.tempId === locationId ? { ...nl, ...patch } : nl,
      ),
    };
  }
  return {
    ...present,
    locationPatches: {
      ...present.locationPatches,
      [locationId]: { ...present.locationPatches[locationId], ...patch },
    },
  };
}

function patchFeatureInState(
  present: HallState,
  featureId: number,
  patch: FeaturePatch,
): HallState {
  if (featureId < 0) {
    return {
      ...present,
      newFeatures: present.newFeatures.map((nf) =>
        nf.tempId === featureId ? { ...nf, ...patch } : nf,
      ),
    };
  }
  return {
    ...present,
    featurePatches: {
      ...present.featurePatches,
      [featureId]: { ...present.featurePatches[featureId], ...patch },
    },
  };
}

function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case "EDIT_HALL_FIELD":
      return pushHistory(state, action.hallId, (present) => ({
        ...present,
        hallPatch: { ...present.hallPatch, [action.field]: action.value },
      }));

    case "CREATE_LOCATION":
      return pushHistory(state, action.hallId, (present) => ({
        ...present,
        newLocations: [
          ...present.newLocations,
          { ...action.data, tempId: action.tempId },
        ],
      }));

    case "PATCH_LOCATION":
      return pushHistory(state, action.hallId, (present) =>
        patchLocationInState(present, action.locationId, action.patch),
      );

    case "DELETE_LOCATION":
      return pushHistory(state, action.hallId, (present) => {
        if (action.locationId < 0) {
          return {
            ...present,
            newLocations: present.newLocations.filter(
              (nl) => nl.tempId !== action.locationId,
            ),
          };
        }
        return {
          ...present,
          locationPatches: withoutKey(present.locationPatches, action.locationId),
          deletedLocationIds: [
            ...present.deletedLocationIds,
            action.locationId,
          ],
        };
      });

    case "CREATE_FEATURE":
      return pushHistory(state, action.hallId, (present) => ({
        ...present,
        newFeatures: [
          ...present.newFeatures,
          {
            ...action.data,
            tempId: action.tempId,
            kind: action.kind,
            geometryKind: action.geometryKind,
          },
        ],
      }));

    case "PATCH_FEATURE":
      return pushHistory(state, action.hallId, (present) =>
        patchFeatureInState(present, action.featureId, action.patch),
      );

    case "DELETE_FEATURE":
      return pushHistory(state, action.hallId, (present) => {
        if (action.featureId < 0) {
          return {
            ...present,
            newFeatures: present.newFeatures.filter(
              (nf) => nf.tempId !== action.featureId,
            ),
          };
        }
        return {
          ...present,
          featurePatches: withoutKey(present.featurePatches, action.featureId),
          deletedFeatureIds: [...present.deletedFeatureIds, action.featureId],
        };
      });

    case "PATCH_GROUP":
      return pushHistory(state, action.hallId, (present) => {
        let next = present;
        for (const { locationId, patch } of action.locationUpdates) {
          next = patchLocationInState(next, locationId, patch);
        }
        for (const { featureId, patch } of action.featureUpdates) {
          next = patchFeatureInState(next, featureId, patch);
        }
        return next;
      });

    case "UNDO": {
      const existing = state[action.hallId];
      if (!existing || existing.past.length === 0) return state;
      const previous = existing.past[existing.past.length - 1];
      return {
        ...state,
        [action.hallId]: {
          past: existing.past.slice(0, -1),
          present: previous,
          future: [existing.present, ...existing.future],
        },
      };
    }

    case "REDO": {
      const existing = state[action.hallId];
      if (!existing || existing.future.length === 0) return state;
      const [next, ...rest] = existing.future;
      return {
        ...state,
        [action.hallId]: {
          past: [...existing.past, existing.present],
          present: next,
          future: rest,
        },
      };
    }

    case "RESET_ALL":
      return {};

    case "HYDRATE":
      return action.state;

    // Discards a deleted hall's draft history so a later Save Map doesn't
    // try to commit changes against a hall that no longer exists.
    case "FORGET_HALL":
      return withoutKey(state, action.hallId);

    default:
      return state;
  }
}

// Recovering an in-progress draft after a refresh/crash, and warning before
// a navigation that would otherwise silently discard one -- the draft store
// is the only place unsaved layout edits exist until "Save Map" runs.
// localStorage is now only the offline fallback -- layout_drafts on the server
// is authoritative and wins whenever both exist. This still matters for edits
// made while the network is down, which the server autosave cannot capture.
// Shares DRAFT_STATE_VERSION so both persistence layers invalidate together.
const DRAFT_STORAGE_VERSION = DRAFT_STATE_VERSION;

// How long the designer sits idle before autosaving to the server. Long
// enough that a drag gesture is one save rather than thirty, short enough that
// a closed tab loses seconds of work rather than minutes.
const DRAFT_AUTOSAVE_DEBOUNCE_MS = 1500;

function draftStorageKey(warehouseId: number) {
  return `stroom:layout-draft:${warehouseId}`;
}

export default function LayoutDesigner({
  warehouseId,
  halls,
  selectedHallId,
  locations,
  features,
  featureKinds,
  currentVersionNumber,
  versionHistory,
  recoveredDrafts,
  underlays,
  navGraph,
  routingVehicles,
}: {
  warehouseId: number;
  halls: HallDTO[];
  selectedHallId: number;
  locations: LocationDTO[];
  features: FeatureDTO[];
  featureKinds: FeatureKindDTO[];
  currentVersionNumber: number;
  versionHistory: LayoutVersionDTO[];
  recoveredDrafts: RecoveredDraft[];
  underlays: UnderlayDTO[];
  navGraph: NavGraphDTO;
  routingVehicles: RoutingVehicleDTO[];
}) {
  const router = useRouter();
  // Pure presentational UI state for the collapsible left panel -- not part
  // of the draft engine, nothing here is persisted or undoable.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [tool, setTool] = useState<Tool>("select");
  // The full selection is always these two arrays, even when exactly one
  // thing is selected -- see handleSelectionChange for why a single unified
  // shape replaced separate single/multi state.
  const [selectedLocationIds, setSelectedLocationIds] = useState<number[]>([]);
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<number[]>([]);
  // While on, a plain canvas click adds to the selection instead of
  // replacing it -- see the doc comment on the canvas's `multiSelectMode`
  // prop. Toggled from Route Preview, since picking several stops that are
  // spread across a large hall is the reason this exists.
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  // Bulk Generate's "pick start point on canvas" flow. The dialog itself is
  // owned here too (not inside HallToolbar, where it used to live) because
  // picking has to close it to let clicks reach the canvas, then reopen it --
  // both ends of that round trip need to be driven from whatever owns
  // showBulkGenerate. bulkGenStartPoints is keyed per generator type so
  // picking a spot for racking doesn't clobber one already picked for
  // shelving, and it persists across the dialog closing and reopening since
  // it lives up here, not inside the (re-mounted-on-open) dialog content.
  const [showBulkGenerate, setShowBulkGenerate] = useState(false);
  const [bulkGenPickTarget, setBulkGenPickTarget] =
    useState<BulkGeneratorKind | null>(null);
  const [bulkGenStartPoints, setBulkGenStartPoints] = useState<
    Record<BulkGeneratorKind, Point | null>
  >({ racking: null, floor_line: null, shelving: null });
  // The kind/type chosen from the Add feature/location menu, waiting for a
  // click to place it. Arming one always disarms the other -- see
  // handlePickFeatureKind/handlePickLocationType.
  const [armedFeatureKind, setArmedFeatureKind] =
    useState<FeatureKindDTO | null>(null);
  const [armedLocationType, setArmedLocationType] =
    useState<LocationType | null>(null);
  // Remembers whatever was last armed even after the user leaves feature/draw
  // mode (armedFeatureKind/armedLocationType above are cleared on every tool
  // switch) -- the canvas's L/F keyboard shortcuts re-arm this without
  // needing the Add menu, and fall back to the first kind/type if nothing
  // has been picked yet this session.
  const lastFeatureKindRef = useRef<FeatureKindDTO | null>(null);
  const lastLocationTypeRef = useRef<LocationType | null>(null);
  const [isSavingMap, startSaveMapTransition] = useTransition();
  const [publishConflict, setPublishConflict] =
    useState<PublishConflict | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  // Result of the last two-click measurement, waiting for the user to say
  // what that distance really is.
  const [measuredMm, setMeasuredMm] = useState<number | null>(null);
  // Default on once a graph exists: the whole point of stage 3 is that you can
  // see what the compiler inferred and judge whether it matches the building.
  const [showNavGraph, setShowNavGraph] = useState(true);
  const [routePreview, setRoutePreview] = useState<RoutePreview | null>(null);

  // Label visibility: one master toggle, plus one sub-toggle per category
  // (locations, and every feature category). Pure display state -- not part
  // of the draft engine, not persisted, not undoable, exactly like
  // showNavGraph above.
  const [showLabels, setShowLabels] = useState(true);
  const [labelCategoryVisibility, setLabelCategoryVisibility] = useState<
    Record<LabelCategoryKey, boolean>
  >(() => {
    const initial: Partial<Record<LabelCategoryKey, boolean>> = {
      LOCATION: true,
    };
    for (const category of CATEGORY_ORDER) initial[category] = true;
    return initial as Record<LabelCategoryKey, boolean>;
  });

  const [draftState, dispatch] = useReducer(draftReducer, {} as DraftState);
  const tempIdRef = useRef(0);
  function nextTempId() {
    tempIdRef.current -= 1;
    return tempIdRef.current;
  }

  /**
   * Placeholder location codes are `NEW-<TYPE>-<suffix>-<id>`, and this
   * suffix is what keeps them unique *across* sessions, not just within one.
   * tempIdRef always restarts at 0 on a fresh mount (see lowestTempIdIn
   * below for the one case it doesn't), so without something session-scoped
   * in the code, two separate sessions that each place, say, five FLOOR
   * locations before renaming any of them would both mint `NEW-FLOOR-5` --
   * and if the first session's got saved and never renamed, the second
   * session's Save Map fails on the warehouse/location_code unique
   * constraint with nothing on screen to explain why, since as far as that
   * user can see every location *they* placed this session has a distinct
   * code. Four base36 characters is 1.6M combinations, plenty to make two
   * sessions colliding on both this and the same type+count vanishingly
   * unlikely, and it's still short enough to read at a glance in the panel
   * the user renames it in immediately after placing it.
   */
  // useState's lazy initializer, not useRef, is the one hook React
  // guarantees runs exactly once regardless of StrictMode/Compiler
  // re-invocation rules -- useRef's initial-value argument is still
  // evaluated on every render (only the resulting ref object is stable), so
  // Math.random() belongs here, not there.
  const [sessionCodeSuffix] = useState(() =>
    Math.random().toString(36).slice(2, 6),
  );

  /**
   * A restored draft (localStorage or server-recovered layout_drafts) can
   * carry negative temp ids from a *previous* mount -- tempIdRef itself
   * always restarts at 0 on a fresh mount, since it's a plain ref with no
   * persistence of its own. Without this, the counter could hand out a temp
   * id that collides with one already sitting in the just-hydrated draft:
   * two newLocations entries sharing one id overwrite each other in the
   * canvas's per-id node map (the older one appears to vanish) and then
   * both generate the same `NEW-<TYPE>-<suffix>-<id>` code, which fails the
   * warehouse/location_code unique constraint at Save Map -- the session
   * suffix above doesn't help here since it's one fixed value for the whole
   * restored session. Seeding the counter from the lowest id already present
   * closes that gap.
   */
  function lowestTempIdIn(state: DraftState): number {
    let lowest = 0;
    for (const history of Object.values(state)) {
      for (const nl of history.present.newLocations) {
        if (nl.tempId < lowest) lowest = nl.tempId;
      }
      for (const nf of history.present.newFeatures) {
        if (nf.tempId < lowest) lowest = nf.tempId;
      }
    }
    return lowest;
  }

  // Recover any draft left over from a previous session (refresh, crash,
  // closed tab, different machine) before anything else touches the store.
  //
  // The server's layout_drafts rows win over localStorage: they follow the
  // user between browsers and they carry the layout version the edits were
  // authored against, which localStorage cannot know. localStorage is only
  // consulted for halls the server has no draft for, which is what covers
  // edits made while offline.
  useEffect(() => {
    let next: DraftState = {};

    try {
      const raw = localStorage.getItem(draftStorageKey(warehouseId));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === DRAFT_STORAGE_VERSION && parsed.state) {
          next = parsed.state as DraftState;
        } else {
          localStorage.removeItem(draftStorageKey(warehouseId));
        }
      }
    } catch {
      // Corrupt or unavailable storage -- fall through to the server drafts.
    }

    for (const draft of recoveredDrafts) {
      next[draft.hallId] = { past: [], present: draft.state, future: [] };
    }

    if (Object.keys(next).length > 0) {
      tempIdRef.current = Math.min(tempIdRef.current, lowestTempIdIn(next));
      dispatch({ type: "HYDRATE", state: next });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const staleDrafts = useMemo(
    () => recoveredDrafts.filter((d) => d.isStale),
    [recoveredDrafts],
  );
  const [staleNoticeDismissed, setStaleNoticeDismissed] = useState(false);

  // Skips its very first run (mount) -- that run reflects the pre-hydration
  // render, which lands in the same commit as the hydrate effect above but
  // before its dispatch takes effect, so writing at that point would wipe
  // out whatever's about to be loaded before it ever renders.
  const isFirstPersistRef = useRef(true);
  useEffect(() => {
    if (isFirstPersistRef.current) {
      isFirstPersistRef.current = false;
      return;
    }
    try {
      if (Object.keys(draftState).length === 0) {
        localStorage.removeItem(draftStorageKey(warehouseId));
      } else {
        localStorage.setItem(
          draftStorageKey(warehouseId),
          JSON.stringify({ version: DRAFT_STORAGE_VERSION, state: draftState }),
        );
      }
    } catch {
      // Storage unavailable/quota exceeded -- draft still works in-memory.
    }
  }, [draftState, warehouseId]);

  // Debounced server autosave. Only halls whose draft actually changed since
  // the last flush are sent, so switching halls or nudging one box never
  // rewrites every draft row.
  const [draftSaveState, setDraftSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const lastSavedRef = useRef<Record<number, HallState>>({});
  const autosaveSkipRef = useRef(true);

  useEffect(() => {
    // The first run is the pre-hydration render; saving then would push an
    // empty draft over whatever is about to be recovered.
    if (autosaveSkipRef.current) {
      autosaveSkipRef.current = false;
      return;
    }
    if (isSavingMap) return;

    const timer = setTimeout(async () => {
      const pending: Array<[number, HallState]> = [];
      for (const [hallIdStr, history] of Object.entries(draftState)) {
        const hallId = Number(hallIdStr);
        if (lastSavedRef.current[hallId] !== history.present) {
          pending.push([hallId, history.present]);
        }
      }
      if (pending.length === 0) return;

      setDraftSaveState("saving");
      try {
        for (const [hallId, state] of pending) {
          const result = await saveHallDraft(
            warehouseId,
            hallId,
            state,
            currentVersionNumber,
          );
          if (result?.error) throw new Error(result.error);
          lastSavedRef.current[hallId] = state;
        }
        setDraftSaveState("saved");
      } catch {
        // localStorage still holds the draft, so this is recoverable -- the
        // indicator tells the user the server copy is behind.
        setDraftSaveState("error");
      }
    }, DRAFT_AUTOSAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [draftState, warehouseId, currentVersionNumber, isSavingMap]);

  const hall = useMemo(
    () => halls.find((h) => h.hallId === selectedHallId) ?? halls[0],
    [halls, selectedHallId],
  );

  const hallUnderlay = useMemo(
    () => underlays.find((u) => u.hallId === selectedHallId) ?? null,
    [underlays, selectedHallId],
  );

  const hallHistory = draftState[hall.hallId];
  const hallState = hallHistory?.present ?? EMPTY_HALL_STATE;
  const hallDraft: HallPatch = hallState.hallPatch;
  const canUndoHall = (hallHistory?.past.length ?? 0) > 0;
  const canRedoHall = (hallHistory?.future.length ?? 0) > 0;

  const pendingCount = useMemo(() => {
    let sum = 0;
    for (const history of Object.values(draftState)) {
      sum += hallStateChangeCount(history.present);
    }
    return sum;
  }, [draftState]);

  // Warn before a refresh/close/navigation that would discard unsaved
  // layout edits -- localStorage above covers a refresh, but this covers a
  // fully closed tab/browser where nothing gets a chance to persist first.
  useEffect(() => {
    if (pendingCount === 0) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [pendingCount]);

  const effectiveLocations = useMemo(
    () => applyHallStateToLocations(locations, hallState),
    [locations, hallState],
  );
  const effectiveFeatures = useMemo(
    () => applyHallStateToFeatures(features, hallState),
    [features, hallState],
  );

  const selectedLocationObjects = useMemo(
    () =>
      selectedLocationIds
        .map((id) => effectiveLocations.find((l) => l.locationId === id))
        .filter((l): l is LocationDTO => Boolean(l)),
    [effectiveLocations, selectedLocationIds],
  );
  const selectedFeatureObjects = useMemo(
    () =>
      selectedFeatureIds
        .map((id) => effectiveFeatures.find((f) => f.featureId === id))
        .filter((f): f is FeatureDTO => Boolean(f)),
    [effectiveFeatures, selectedFeatureIds],
  );
  const totalSelectedCount =
    selectedLocationObjects.length + selectedFeatureObjects.length;
  // Exactly one thing selected gets the full single-item edit panel; these
  // are undefined for every other case (0 selected, or 2+).
  const selectedLocation =
    totalSelectedCount === 1 ? (selectedLocationObjects[0] ?? null) : null;
  const selectedFeature =
    totalSelectedCount === 1 ? (selectedFeatureObjects[0] ?? null) : null;

  // Level overlay: which height level is active for rackings/shelves. Only
  // shown when the hall actually has multi-level racking/shelf locations.
  const availableLevels = useMemo(() => {
    const levels = new Set<number>();
    for (const loc of effectiveLocations) {
      if (
        (loc.locationType === "RACKING" || loc.locationType === "SHELF") &&
        loc.level != null
      )
        levels.add(loc.level);
    }
    return Array.from(levels).sort((a, b) => a - b);
  }, [effectiveLocations]);
  // null (no level pinned) is the genuine default, not availableLevels[0] --
  // resolveVisibleLocations already falls back to the lowest level on its own
  // when activeLevel is null, so a non-null default bought nothing visually
  // and instead left the L1 button silently "pressed" from first load. That
  // used to be harmless (display-only); once selection/move started reading
  // activeLevel too (see resolveGroupIds in the canvas), a hidden default
  // level meant every racking move looked like "no filter applied" to the
  // user while actually being scoped to level 1 -- moving only the bottom
  // level of an aisle and leaving the rest behind.
  const [activeLevel, setActiveLevel] = useState<number | null>(null);

  function handleToolChange(next: Tool) {
    // Panning is a camera move, not an object interaction -- entering or
    // leaving "pan" (including the automatic switch a middle-mouse-button
    // drag makes, see the canvas's pointerdown handler) must not disturb
    // whatever is selected. Without this, panning across the hall to reach a
    // far-off location for a multi-stop route silently dropped everything
    // picked so far, which defeated the entire point of selecting distant
    // locations for one.
    const isPanTransition = next === "pan" || tool === "pan";
    setTool(next);
    if (!isPanTransition) {
      setSelectedLocationIds([]);
      setSelectedFeatureIds([]);
    }
    // Switching to any other tool disarms whatever was armed; "feature" and
    // "draw" mode only exist while a kind/type is actually armed.
    if (next !== "feature") setArmedFeatureKind(null);
    if (next !== "draw") setArmedLocationType(null);
  }

  /**
   * Toggles click-to-add selection. Turning it on also forces the Select
   * tool (the additive-click gesture only fires there and in Move & Resize)
   * without going through handleToolChange, since that would wipe out
   * exactly the selection the user is about to build on.
   */
  function handleToggleMultiSelect() {
    setMultiSelectMode((prev) => {
      const next = !prev;
      if (next) {
        setTool("select");
        setArmedFeatureKind(null);
        setArmedLocationType(null);
      }
      return next;
    });
  }

  /**
   * Closes Bulk Generate so the canvas can take the next click, rather than
   * making the user type a start coordinate. The dialog's own form state
   * survives this: it's closed, not unmounted from where its fields actually
   * live (bulkGenStartPoints is up here; everything else stays inside the
   * still-mounted BulkGenerateDialog wrapper), so nothing the user already
   * configured on another tab is lost while they point at the canvas.
   */
  function handleRequestBulkGenPick(kind: BulkGeneratorKind) {
    setBulkGenPickTarget(kind);
    setShowBulkGenerate(false);
  }

  function handleBulkGenPointPicked(worldXMm: number, worldYMm: number) {
    const kind = bulkGenPickTarget;
    if (!kind) return;
    // The viewport shows a margin of grid outside the hall's own rectangle
    // (so its edge isn't flush with the canvas edge), which a click can
    // legitimately land in -- clamped here rather than left to the server
    // action's plain non-negative check, which would just reject it with
    // "Start X/Y must be whole numbers" and no obvious reason why.
    const x = Math.round(
      Math.max(0, Math.min(worldXMm, hall.physicalWidthMm)),
    );
    const y = Math.round(
      Math.max(0, Math.min(worldYMm, hall.physicalLengthMm)),
    );
    setBulkGenStartPoints((prev) => ({ ...prev, [kind]: { x, y } }));
    setBulkGenPickTarget(null);
    setShowBulkGenerate(true);
  }

  function handleCancelBulkGenPick() {
    setBulkGenPickTarget(null);
    setShowBulkGenerate(true);
  }

  // Choosing a kind from the Add feature menu arms it and enters feature mode.
  // The selection is cleared so the right-hand panel is not showing something
  // else while the next click is going to create a brand new object, and any
  // armed location type is cleared since only one thing can be armed at once.
  function handlePickFeatureKind(kind: FeatureKindDTO) {
    lastFeatureKindRef.current = kind;
    setArmedFeatureKind(kind);
    setArmedLocationType(null);
    setTool("feature");
    setSelectedLocationIds([]);
    setSelectedFeatureIds([]);
  }

  // Mirrors handlePickFeatureKind above for the Add location menu.
  function handlePickLocationType(type: LocationType) {
    lastLocationTypeRef.current = type;
    setArmedLocationType(type);
    setArmedFeatureKind(null);
    setTool("draw");
    setSelectedLocationIds([]);
    setSelectedFeatureIds([]);
  }

  // The canvas's F keyboard shortcut: re-arms the last feature kind picked
  // from the Add feature menu, or the first available kind if none has been
  // picked yet this session.
  function handleQuickArmFeature() {
    const kind = lastFeatureKindRef.current ?? featureKinds[0];
    if (kind) handlePickFeatureKind(kind);
  }

  // Mirrors handleQuickArmFeature above for the canvas's L shortcut.
  function handleQuickArmLocation() {
    const type = lastLocationTypeRef.current ?? LOCATION_TYPES[0];
    if (type) handlePickLocationType(type);
  }

  /**
   * One callback for every selection gesture the canvas can produce (click,
   * shift-click, marquee) -- it always reports the final {locations,
   * features} selection rather than an incremental change, so there is
   * exactly one place selection state is written from user interaction.
   */
  function handleSelectionChange(locationIds: number[], featureIds: number[]) {
    setSelectedLocationIds(locationIds);
    setSelectedFeatureIds(featureIds);
    setRoutePreview(null);
  }

  function handleClearSelection() {
    setSelectedLocationIds([]);
    setSelectedFeatureIds([]);
  }

  // Placement footprint for the armed kind. The feature_kinds table only sizes
  // RECT kinds, so rooms and walkways fall back to the code-side defaults.
  const armedFeaturePlacement = useMemo(() => {
    if (!armedFeatureKind) return null;
    const size = defaultPlacementSizeMm(
      armedFeatureKind.kind,
      armedFeatureKind.defaultGeometryKind,
      armedFeatureKind.defaultWidthMm,
      armedFeatureKind.defaultLengthMm,
    );
    return {
      kind: armedFeatureKind.kind,
      label: armedFeatureKind.label,
      color: armedFeatureKind.defaultColor,
      geometryKind: armedFeatureKind.defaultGeometryKind,
      widthMm: size.widthMm,
      lengthMm: size.lengthMm,
    };
  }, [armedFeatureKind]);

  /**
   * Drops the armed kind centred on the clicked point, then hands the user
   * straight to Move & Resize with it selected -- placing something you cannot
   * immediately nudge or size is a dead end, and the size is a stock default
   * that usually wants adjusting.
   */
  function handleFeaturePlaced(worldXMm: number, worldYMm: number) {
    const kind = armedFeatureKind;
    if (!kind) return;

    const tempId = nextTempId();
    const geometryKind = kind.defaultGeometryKind;
    const size = defaultPlacementSizeMm(
      kind.kind,
      geometryKind,
      kind.defaultWidthMm,
      kind.defaultLengthMm,
    );

    const placed = centredPlacement(
      worldXMm,
      worldYMm,
      size.widthMm,
      size.lengthMm,
      hall.physicalWidthMm,
      hall.physicalLengthMm,
    );

    let originXMm = placed.x;
    let originYMm = placed.y;
    let widthMm = placed.width;
    let lengthMm = placed.height;

    if (geometryKind === "POINT") {
      // A point has no extent, so it belongs exactly where the user clicked.
      originXMm = Math.round(
        Math.max(0, Math.min(worldXMm, hall.physicalWidthMm)),
      );
      originYMm = Math.round(
        Math.max(0, Math.min(worldYMm, hall.physicalLengthMm)),
      );
      widthMm = 0;
      lengthMm = 0;
    } else if (geometryKind === "CIRCLE") {
      // widthMm is the diameter for a circle, so keep it square.
      const diameter = Math.min(widthMm, lengthMm);
      widthMm = diameter;
      lengthMm = diameter;
    }

    dispatch({
      type: "CREATE_FEATURE",
      hallId: hall.hallId,
      tempId,
      kind: kind.kind,
      geometryKind,
      data: {
        originXMm,
        originYMm,
        widthMm,
        lengthMm,
        rotationDegrees: 0,
        points: defaultPointsForDrawnRect(geometryKind, widthMm, lengthMm),
        elevationMm: 0,
        heightMm: kind.defaultHeightMm,
        isObstacle: kind.isObstacleDefault,
        isVisualOnly: false,
        layerIndex: 0,
        floorLevel: 1,
        attrs: {},
      },
    });

    setArmedFeatureKind(null);
    setTool("transform");
    handleSelectionChange([], [tempId]);
  }

  /**
   * Drops the armed location type centred on the clicked point, mirroring
   * handleFeaturePlaced above. locationCode is required and unique per
   * warehouse, so a placeholder is generated from the session suffix and the
   * temp id -- see sessionCodeSuffix above for why the suffix matters --
   * and the user renames it in the edit panel they land on immediately
   * afterward.
   */
  function handleLocationPlaced(worldXMm: number, worldYMm: number) {
    const type = armedLocationType;
    if (!type) return;

    const tempId = nextTempId();
    const size = LOCATION_TYPE_DEFAULT_SIZE_MM[type];
    const placed = centredPlacement(
      worldXMm,
      worldYMm,
      size.widthMm,
      size.lengthMm,
      hall.physicalWidthMm,
      hall.physicalLengthMm,
    );

    dispatch({
      type: "CREATE_LOCATION",
      hallId: hall.hallId,
      tempId,
      data: {
        locationCode: `NEW-${type}-${sessionCodeSuffix}-${Math.abs(tempId)}`,
        aisle: null,
        bay: null,
        level: null,
        row: null,
        locationType: type,
        heightMm: null,
        maxWeightKg: null,
        isTemporary: false,
        floorLevel: 1,
        physicalX: placed.x,
        physicalY: placed.y,
        physicalWidthMm: placed.width,
        physicalLengthMm: placed.height,
        rotationDegrees: 0,
      },
    });

    setArmedLocationType(null);
    setTool("transform");
    handleSelectionChange([tempId], []);
  }

  /**
   * Every geometry-affecting patch -- the rotate button, a numeric field in
   * the side panel, or a drag/resize commit off the canvas -- funnels through
   * here, so this is the one place that has to keep a feature inside the
   * hall. The canvas already pins drags/resizes interactively, but the panel
   * writes origin/size/rotation directly with no such check (typing a
   * rotation or dragging a rect wide open otherwise leaves it hanging off an
   * edge). Recomputing the envelope and nudging the origin back in, exactly
   * like handleRotateSelection does for a multi-selection, covers every path
   * uniformly and a no-op patch (attrs, label, color, ...) leaves the
   * envelope unchanged, so the offset comes back zero.
   */
  function clampFeaturePatch(
    feature: FeatureDTO,
    patch: FeaturePatch,
  ): FeaturePatch {
    const next = { ...feature, ...patch };
    const offset = clampBBoxOffset(
      computeEnvelope(next),
      hall.physicalWidthMm,
      hall.physicalLengthMm,
    );
    if (offset.x === 0 && offset.y === 0) return patch;
    return {
      ...patch,
      originXMm: Math.round(next.originXMm + offset.x),
      originYMm: Math.round(next.originYMm + offset.y),
    };
  }

  function handlePatchFeature(featureId: number, patch: FeaturePatch) {
    const current = effectiveFeatures.find((f) => f.featureId === featureId);
    dispatch({
      type: "PATCH_FEATURE",
      hallId: hall.hallId,
      featureId,
      patch: current ? clampFeaturePatch(current, patch) : patch,
    });
  }

  function handleDeleteFeature(featureId: number) {
    dispatch({ type: "DELETE_FEATURE", hallId: hall.hallId, featureId });
    setSelectedFeatureIds((ids) => ids.filter((id) => id !== featureId));
  }

  function handleHallFieldChange(field: keyof HallPatch, value: unknown) {
    dispatch({
      type: "EDIT_HALL_FIELD",
      hallId: hall.hallId,
      field,
      value: value as HallPatch[keyof HallPatch],
    });
  }

  function handleUndoHall() {
    dispatch({ type: "UNDO", hallId: hall.hallId });
  }

  function handleRedoHall() {
    dispatch({ type: "REDO", hallId: hall.hallId });
  }

  function handleHallDeleted(hallId: number) {
    dispatch({ type: "FORGET_HALL", hallId });
    router.push(`/warehouses/${warehouseId}/layout-designer`);
  }

  /** Location counterpart of clampFeaturePatch above -- same reasoning. */
  function clampLocationPatch(
    loc: LocationDTO,
    patch: LocationPatch,
  ): LocationPatch {
    const next = { ...loc, ...patch };
    const offset = clampBBoxOffset(
      computeEnvelope({
        geometryKind: "RECT",
        originXMm: next.physicalX,
        originYMm: next.physicalY,
        widthMm: next.physicalWidthMm,
        lengthMm: next.physicalLengthMm,
        rotationDegrees: next.rotationDegrees,
        points: null,
      }),
      hall.physicalWidthMm,
      hall.physicalLengthMm,
    );
    if (offset.x === 0 && offset.y === 0) return patch;
    return {
      ...patch,
      physicalX: Math.round(next.physicalX + offset.x),
      physicalY: Math.round(next.physicalY + offset.y),
    };
  }

  function handlePatchLocation(locationId: number, patch: LocationPatch) {
    const current = effectiveLocations.find(
      (l) => l.locationId === locationId,
    );
    dispatch({
      type: "PATCH_LOCATION",
      hallId: hall.hallId,
      locationId,
      patch: current ? clampLocationPatch(current, patch) : patch,
    });
  }

  function handleDeleteLocation(locationId: number) {
    dispatch({ type: "DELETE_LOCATION", hallId: hall.hallId, locationId });
    setSelectedLocationIds((ids) => ids.filter((id) => id !== locationId));
  }

  /**
   * Rotates the whole current multi-selection as one rigid body about its
   * combined bounding-box centre -- the Move & Resize tool's only rotate
   * affordance for 2+ selected objects (there is no drag-resize equivalent;
   * see the note on canvas Props.onGroupMove for why). Every member keeps its
   * position relative to the others and gains the same rotation delta, then
   * the whole rotated group is nudged back inside the hall if it now hangs
   * over an edge.
   */
  function handleRotateSelection(deltaDegrees: number) {
    if (totalSelectedCount < 2) return;

    const locationEnvelope = (loc: LocationDTO, x: number, y: number, rot: number) =>
      computeEnvelope({
        geometryKind: "RECT",
        originXMm: x,
        originYMm: y,
        widthMm: loc.physicalWidthMm,
        lengthMm: loc.physicalLengthMm,
        rotationDegrees: rot,
        points: null,
      });

    const currentEnvelopes: Envelope[] = [
      ...selectedLocationObjects.map((loc) =>
        locationEnvelope(loc, loc.physicalX, loc.physicalY, loc.rotationDegrees),
      ),
      ...selectedFeatureObjects.map((f) => computeEnvelope(f)),
    ];
    const currentBBox = unionEnvelopes(currentEnvelopes);
    const pivotX = (currentBBox.minX + currentBBox.maxX) / 2;
    const pivotY = (currentBBox.minY + currentBBox.maxY) / 2;

    const rotatedLocations = selectedLocationObjects.map((loc) => ({
      loc,
      next: rigidRotateAround(
        loc.physicalX,
        loc.physicalY,
        loc.rotationDegrees,
        pivotX,
        pivotY,
        deltaDegrees,
      ),
    }));
    const rotatedFeatures = selectedFeatureObjects.map((feature) => ({
      feature,
      next: rigidRotateAround(
        feature.originXMm,
        feature.originYMm,
        feature.rotationDegrees,
        pivotX,
        pivotY,
        deltaDegrees,
      ),
    }));

    const rotatedEnvelopes: Envelope[] = [
      ...rotatedLocations.map(({ loc, next }) =>
        locationEnvelope(loc, next.originXMm, next.originYMm, next.rotationDegrees),
      ),
      ...rotatedFeatures.map(({ feature, next }) =>
        computeEnvelope({
          ...feature,
          originXMm: next.originXMm,
          originYMm: next.originYMm,
          rotationDegrees: next.rotationDegrees,
        }),
      ),
    ];
    const offset = clampBBoxOffset(
      unionEnvelopes(rotatedEnvelopes),
      hall.physicalWidthMm,
      hall.physicalLengthMm,
    );

    dispatch({
      type: "PATCH_GROUP",
      hallId: hall.hallId,
      locationUpdates: rotatedLocations.map(({ loc, next }) => ({
        locationId: loc.locationId,
        patch: {
          physicalX: Math.round(next.originXMm + offset.x),
          physicalY: Math.round(next.originYMm + offset.y),
          rotationDegrees: next.rotationDegrees,
        },
      })),
      featureUpdates: rotatedFeatures.map(({ feature, next }) => ({
        featureId: feature.featureId,
        patch: {
          originXMm: Math.round(next.originXMm + offset.x),
          originYMm: Math.round(next.originYMm + offset.y),
          rotationDegrees: next.rotationDegrees,
        },
      })),
    });
  }

  function handleSaveMap() {
    const statesToSave: Record<number, HallState> = {};
    for (const [hallIdStr, history] of Object.entries(draftState)) {
      if (hallStateChangeCount(history.present) > 0) {
        statesToSave[Number(hallIdStr)] = history.present;
      }
    }
    startSaveMapTransition(async () => {
      setPublishConflict(null);
      setPublishError(null);
      const result = await commitHallStates(
        warehouseId,
        statesToSave,
        currentVersionNumber,
      );
      if (result?.conflict) {
        // The draft is deliberately kept. Someone else published underneath
        // this session, so discarding the user's work to resolve it would be
        // the worst possible outcome -- they reload, review, and republish.
        setPublishConflict(result.conflict);
        return;
      }
      if (result?.error) {
        setPublishError(result.error);
        return;
      }
      lastSavedRef.current = {};
      setDraftSaveState("idle");
      dispatch({ type: "RESET_ALL" });
    });
  }

  const showStaleNotice = staleDrafts.length > 0 && !staleNoticeDismissed;

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background/40">
      {publishConflict && (
        <div className="flex items-start gap-3 border-b border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              Someone else published while you were editing.
            </p>
            <p className="mt-0.5 leading-relaxed">
              The layout moved from version {currentVersionNumber} to{" "}
              {publishConflict.currentVersion}
              {publishConflict.publishedByName
                ? ` (published by ${publishConflict.publishedByName})`
                : ""}
              . Your {pendingCount} unsaved change
              {pendingCount === 1 ? "" : "s"} have been kept — reload to see
              their version, then re-apply and publish again.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => router.refresh()}
            className="h-7 shrink-0 border-amber-400 bg-white text-xs"
          >
            Reload layout
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setPublishConflict(null)}
            className="h-7 shrink-0 px-2 text-xs"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {publishError && (
        <div className="flex items-start gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="min-w-0 flex-1 font-medium">{publishError}</p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setPublishError(null)}
            className="h-7 shrink-0 px-2 text-xs"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {showStaleNotice && (
        <div className="flex items-start gap-3 border-b border-sky-300 bg-sky-50 px-4 py-3 text-xs text-sky-900">
          <History className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="min-w-0 flex-1 leading-relaxed">
            <span className="font-semibold">Recovered draft is older.</span>{" "}
            {staleDrafts.length === 1 ? "A draft was" : "Drafts were"} written
            against layout version {staleDrafts[0].baseVersionNumber}, but the
            published layout is now version {currentVersionNumber}. Review the
            changes before publishing — they may reference locations that have
            since moved.
          </p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setStaleNoticeDismissed(true)}
            className="h-7 shrink-0 px-2 text-xs"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <LayoutTopBar
        warehouseId={warehouseId}
        halls={halls}
        selectedHallId={hall.hallId}
        onHallDeleted={handleHallDeleted}
        tool={tool}
        onToolChange={handleToolChange}
        featureKinds={featureKinds}
        armedFeatureKind={armedFeatureKind}
        onPickFeatureKind={handlePickFeatureKind}
        armedLocationType={armedLocationType}
        onPickLocationType={handlePickLocationType}
        locked={isSavingMap}
        onSaveMap={handleSaveMap}
        isSavingMap={isSavingMap}
        pendingCount={pendingCount}
        currentVersionNumber={currentVersionNumber}
        versionHistory={versionHistory}
        draftSaveState={draftSaveState}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
      />

      <div className="relative flex min-h-0 flex-1 flex-row overflow-hidden">
      {/* 1. Left Sidebar: Toolbar */}
      <HallToolbar
        warehouseId={warehouseId}
        halls={halls}
        selectedHallId={hall.hallId}
        tool={tool}
        onToolChange={handleToolChange}
        hallDraft={hallDraft}
        onHallFieldChange={handleHallFieldChange}
        canUndoHall={canUndoHall}
        canRedoHall={canRedoHall}
        onUndoHall={handleUndoHall}
        onRedoHall={handleRedoHall}
        locked={isSavingMap}
        underlay={hallUnderlay}
        measuredMm={measuredMm}
        onClearMeasurement={() => setMeasuredMm(null)}
        navGraph={navGraph}
        showNavGraph={showNavGraph}
        onToggleNavGraph={setShowNavGraph}
        routingVehicles={routingVehicles}
        selectedLocations={selectedLocationObjects}
        selectedFeatureCount={selectedFeatureObjects.length}
        routePreview={routePreview}
        onRoutePreview={setRoutePreview}
        onClearRoute={() => setRoutePreview(null)}
        multiSelectMode={multiSelectMode}
        onToggleMultiSelect={handleToggleMultiSelect}
        onClearSelection={handleClearSelection}
        showBulkGenerate={showBulkGenerate}
        onShowBulkGenerateChange={setShowBulkGenerate}
        bulkGenStartPoints={bulkGenStartPoints}
        onRequestBulkGenPick={handleRequestBulkGenPick}
        collapsed={sidebarCollapsed}
        showLabels={showLabels}
        onToggleShowLabels={setShowLabels}
        labelCategoryVisibility={labelCategoryVisibility}
        onToggleLabelCategory={(key, next) =>
          setLabelCategoryVisibility((prev) => ({ ...prev, [key]: next }))
        }
      />

      {/* 2. Middle Column: Canvas Container */}
      <div className="relative flex min-w-0 flex-1 p-3 bg-muted/30">
        <div className="h-full w-full overflow-hidden rounded-xl shadow-sm">
          <LayoutDesignerCanvas
            hall={hall}
            locations={effectiveLocations}
            features={effectiveFeatures}
            featureKinds={featureKinds}
            underlay={hallUnderlay}
            navGraph={navGraph}
            showNavGraph={showNavGraph}
            routePoints={routePreview?.points ?? null}
            onMeasured={setMeasuredMm}
            selectedFeatureIds={selectedFeatureIds}
            armedFeature={armedFeaturePlacement}
            onFeaturePlaced={handleFeaturePlaced}
            onFeatureGeometryChange={handlePatchFeature}
            selectedLocationIds={selectedLocationIds}
            multiSelectMode={multiSelectMode}
            onToggleMultiSelect={handleToggleMultiSelect}
            armedLocationType={armedLocationType}
            onLocationPlaced={handleLocationPlaced}
            activeLevel={activeLevel}
            availableLevels={availableLevels}
            onLevelChange={setActiveLevel}
            tool={tool}
            onToolChange={handleToolChange}
            onQuickArmLocation={handleQuickArmLocation}
            onQuickArmFeature={handleQuickArmFeature}
            pickingPoint={bulkGenPickTarget !== null}
            onPointPicked={handleBulkGenPointPicked}
            onCancelPointPick={handleCancelBulkGenPick}
            locked={isSavingMap}
            onSelectionChange={handleSelectionChange}
            onGeometryChange={(locationId, geometry) => {
              handlePatchLocation(locationId, geometry);
            }}
            onGroupMove={(locationIds, featureIds, deltaXMm, deltaYMm) => {
              const locationUpdates = locationIds.flatMap((id) => {
                const loc = effectiveLocations.find(
                  (l) => l.locationId === id,
                );
                if (!loc) return [];
                return [
                  {
                    locationId: id,
                    patch: {
                      physicalX: loc.physicalX + deltaXMm,
                      physicalY: loc.physicalY + deltaYMm,
                    },
                  },
                ];
              });
              const featureUpdates = featureIds.flatMap((id) => {
                const feature = effectiveFeatures.find(
                  (f) => f.featureId === id,
                );
                if (!feature) return [];
                return [
                  {
                    featureId: id,
                    patch: {
                      originXMm: feature.originXMm + deltaXMm,
                      originYMm: feature.originYMm + deltaYMm,
                    },
                  },
                ];
              });
              dispatch({
                type: "PATCH_GROUP",
                hallId: hall.hallId,
                locationUpdates,
                featureUpdates,
              });
            }}
            showLabels={showLabels}
            labelCategoryVisibility={labelCategoryVisibility}
          />
        </div>
      </div>

      {/* 3. Right Sidebar: property panel -- a mixed multi-selection (2+
          objects, locations and/or features) takes precedence over the
          single-item panels, since "exactly one thing selected" is a
          separate, more specific case. */}
      {totalSelectedCount > 1 ? (
        <MultiObjectPanel
          locations={selectedLocationObjects}
          features={selectedFeatureObjects}
          featureKinds={featureKinds}
          onPatchLocation={handlePatchLocation}
          onDeleteLocation={handleDeleteLocation}
          onPatchFeature={handlePatchFeature}
          onDeleteFeature={handleDeleteFeature}
          onRotateSelection={handleRotateSelection}
          onClose={handleClearSelection}
          locked={isSavingMap}
        />
      ) : selectedFeature ? (
        <EditFeaturePanel
          feature={selectedFeature}
          featureKinds={featureKinds}
          onPatch={(patch) =>
            handlePatchFeature(selectedFeature.featureId, patch)
          }
          onDelete={() => handleDeleteFeature(selectedFeature.featureId)}
          onClose={handleClearSelection}
          locked={isSavingMap}
        />
      ) : selectedLocation ? (
        <EditLocationPanel
          location={selectedLocation}
          onPatch={(patch) => handlePatchLocation(selectedLocation.locationId, patch)}
          onDelete={() => handleDeleteLocation(selectedLocation.locationId)}
          onClose={handleClearSelection}
          locked={isSavingMap}
        />
      ) : (
        <EmptyLocationPanel />
      )}
      </div>
    </div>
  );
}
