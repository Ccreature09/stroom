"use client";

import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useTransition,
} from "react";
import HallToolbar from "./hall-toolbar";
import LayoutDesignerCanvas, {
  type GeometryUpdate,
  type Tool,
} from "./layout-designer-canvas";
import {
  CreateLocationPanel,
  EditLocationPanel,
  EmptyLocationPanel,
  MultiSelectPanel,
} from "./location-panel";
import { CreateFeaturePanel, EditFeaturePanel } from "./feature-panel";
import type {
  DraftGeometry,
  FeatureDTO,
  FeatureKindDTO,
  FeaturePatch,
  HallDTO,
  HallPatch,
  HallState,
  LocationDTO,
  LocationPatch,
  ZonePatch,
  ZoneTypeDTO,
} from "./types";
import {
  EMPTY_HALL_STATE,
  applyHallStateToFeatures,
  applyHallStateToLocations,
  applyHallStateToZones,
  hallStateChangeCount,
} from "./types";
import { defaultPointsForDrawnRect } from "./geometry";
import { commitHallStates } from "./actions";

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
  | {
      type: "PATCH_LOCATIONS_BULK";
      hallId: number;
      updates: Array<{ locationId: number; patch: LocationPatch }>;
    }
  | { type: "DELETE_LOCATION"; hallId: number; locationId: number }
  | { type: "CREATE_ZONE"; hallId: number; tempId: number; data: ZonePatch }
  | { type: "PATCH_ZONE"; hallId: number; zoneId: number; patch: ZonePatch }
  | { type: "DELETE_ZONE"; hallId: number; zoneId: number }
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
  | { type: "UNDO"; hallId: number }
  | { type: "REDO"; hallId: number }
  | { type: "RESET_ALL" }
  | { type: "HYDRATE"; state: DraftState };

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

    case "PATCH_LOCATIONS_BULK":
      return pushHistory(state, action.hallId, (present) => {
        let next = present;
        for (const { locationId, patch } of action.updates) {
          next = patchLocationInState(next, locationId, patch);
        }
        return next;
      });

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

    case "CREATE_ZONE":
      return pushHistory(state, action.hallId, (present) => ({
        ...present,
        newZones: [...present.newZones, { ...action.data, tempId: action.tempId }],
      }));

    case "PATCH_ZONE":
      return pushHistory(state, action.hallId, (present) => {
        if (action.zoneId < 0) {
          return {
            ...present,
            newZones: present.newZones.map((nz) =>
              nz.tempId === action.zoneId ? { ...nz, ...action.patch } : nz,
            ),
          };
        }
        return {
          ...present,
          zonePatches: {
            ...present.zonePatches,
            [action.zoneId]: {
              ...present.zonePatches[action.zoneId],
              ...action.patch,
            },
          },
        };
      });

    case "DELETE_ZONE":
      return pushHistory(state, action.hallId, (present) => {
        if (action.zoneId < 0) {
          return {
            ...present,
            newZones: present.newZones.filter(
              (nz) => nz.tempId !== action.zoneId,
            ),
          };
        }
        return {
          ...present,
          zonePatches: withoutKey(present.zonePatches, action.zoneId),
          deletedZoneIds: [...present.deletedZoneIds, action.zoneId],
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
      return pushHistory(state, action.hallId, (present) => {
        if (action.featureId < 0) {
          return {
            ...present,
            newFeatures: present.newFeatures.map((nf) =>
              nf.tempId === action.featureId ? { ...nf, ...action.patch } : nf,
            ),
          };
        }
        return {
          ...present,
          featurePatches: {
            ...present.featurePatches,
            [action.featureId]: {
              ...present.featurePatches[action.featureId],
              ...action.patch,
            },
          },
        };
      });

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

    default:
      return state;
  }
}

// Recovering an in-progress draft after a refresh/crash, and warning before
// a navigation that would otherwise silently discard one -- the draft store
// is the only place unsaved layout edits exist until "Save Map" runs.
// Bumped to 2 when layout features joined HallState: a v1 draft has no
// featurePatches/newFeatures/deletedFeatureIds keys, and the version check
// below discards it rather than hydrating a shape the reducer would crash on.
const DRAFT_STORAGE_VERSION = 2;

function draftStorageKey(warehouseId: number) {
  return `stroom:layout-draft:${warehouseId}`;
}

export default function LayoutDesigner({
  warehouseId,
  halls,
  selectedHallId,
  locations,
  zoneTypes,
  features,
  featureKinds,
}: {
  warehouseId: number;
  halls: HallDTO[];
  selectedHallId: number;
  locations: LocationDTO[];
  zoneTypes: ZoneTypeDTO[];
  features: FeatureDTO[];
  featureKinds: FeatureKindDTO[];
}) {
  const [tool, setTool] = useState<Tool>("select");
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(
    null,
  );
  const [selectedLocationIds, setSelectedLocationIds] = useState<number[]>([]);
  const [selectedFeatureId, setSelectedFeatureId] = useState<number | null>(
    null,
  );
  const [featureDraft, setFeatureDraft] = useState<{
    originXMm: number;
    originYMm: number;
    widthMm: number;
    lengthMm: number;
  } | null>(null);
  const [draft, setDraft] = useState<DraftGeometry | null>(null);
  const [isSavingMap, startSaveMapTransition] = useTransition();

  const [draftState, dispatch] = useReducer(draftReducer, {} as DraftState);
  const tempIdRef = useRef(0);
  function nextTempId() {
    tempIdRef.current -= 1;
    return tempIdRef.current;
  }

  // Recover any draft left over from a previous session (refresh, crash,
  // closed tab) before anything else touches the store.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftStorageKey(warehouseId));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === DRAFT_STORAGE_VERSION && parsed.state) {
          dispatch({ type: "HYDRATE", state: parsed.state as DraftState });
        } else {
          localStorage.removeItem(draftStorageKey(warehouseId));
        }
      }
    } catch {
      // Corrupt or unavailable storage -- proceed with an empty draft.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const hall = useMemo(
    () => halls.find((h) => h.hallId === selectedHallId) ?? halls[0],
    [halls, selectedHallId],
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
  const effectiveZoneTypes = useMemo(
    () => applyHallStateToZones(zoneTypes, hallState),
    [zoneTypes, hallState],
  );
  const effectiveFeatures = useMemo(
    () => applyHallStateToFeatures(features, hallState),
    [features, hallState],
  );
  const selectedFeature = useMemo(
    () =>
      effectiveFeatures.find((f) => f.featureId === selectedFeatureId) ?? null,
    [effectiveFeatures, selectedFeatureId],
  );

  const selectedLocation = useMemo(
    () =>
      effectiveLocations.find((l) => l.locationId === selectedLocationId) ??
      null,
    [effectiveLocations, selectedLocationId],
  );
  const selectedLocationsForMulti = useMemo(
    () =>
      selectedLocationIds
        .map((id) => effectiveLocations.find((l) => l.locationId === id))
        .filter((l): l is LocationDTO => Boolean(l)),
    [effectiveLocations, selectedLocationIds],
  );

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
  const [activeLevel, setActiveLevel] = useState<number | null>(
    availableLevels[0] ?? null,
  );

  function handleToolChange(next: Tool) {
    setTool(next);
    setSelectedLocationId(null);
    setSelectedLocationIds([]);
    setSelectedFeatureId(null);
    setDraft(null);
    setFeatureDraft(null);
  }

  function handleDraftDrawn(geometry: DraftGeometry) {
    setDraft(geometry);
  }

  // Locations and features are separate selections, and the right-hand panel
  // shows one at a time -- selecting either clears the other so the panel is
  // never ambiguous about what an edit applies to.
  function handleSelect(locationId: number | null) {
    setSelectedLocationIds([]);
    setSelectedLocationId(locationId);
    if (locationId !== null) setSelectedFeatureId(null);
  }

  function handleMultiSelect(locationIds: number[]) {
    setSelectedLocationId(null);
    setSelectedLocationIds(locationIds);
    if (locationIds.length > 0) setSelectedFeatureId(null);
  }

  function handleSelectFeature(featureId: number | null) {
    setSelectedFeatureId(featureId);
    if (featureId !== null) {
      setSelectedLocationId(null);
      setSelectedLocationIds([]);
    }
  }

  function handleClearSelection() {
    setSelectedLocationId(null);
    setSelectedLocationIds([]);
    setSelectedFeatureId(null);
  }

  function handleFeatureDrawn(geometry: {
    originXMm: number;
    originYMm: number;
    widthMm: number;
    lengthMm: number;
  }) {
    setFeatureDraft(geometry);
  }

  // The picked kind supplies geometry kind, height and obstacle defaults, so
  // the drawn rectangle becomes a polyline for a wall or a point for a fire
  // exit without the user choosing a geometry at all.
  function handleCreateFeature(kind: FeatureKindDTO) {
    if (!featureDraft) return;
    const tempId = nextTempId();
    const geometryKind = kind.defaultGeometryKind;

    const widthMm =
      geometryKind === "POINT" ? 0 : (kind.defaultWidthMm ?? featureDraft.widthMm);
    const lengthMm =
      geometryKind === "POINT"
        ? 0
        : (kind.defaultLengthMm ?? featureDraft.lengthMm);

    dispatch({
      type: "CREATE_FEATURE",
      hallId: hall.hallId,
      tempId,
      kind: kind.kind,
      geometryKind,
      data: {
        originXMm: featureDraft.originXMm,
        originYMm: featureDraft.originYMm,
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

    setFeatureDraft(null);
    handleSelectFeature(tempId);
  }

  function handlePatchFeature(featureId: number, patch: FeaturePatch) {
    dispatch({ type: "PATCH_FEATURE", hallId: hall.hallId, featureId, patch });
  }

  function handleDeleteFeature(featureId: number) {
    dispatch({ type: "DELETE_FEATURE", hallId: hall.hallId, featureId });
    if (selectedFeatureId === featureId) setSelectedFeatureId(null);
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

  function handleCreateLocation(data: LocationPatch) {
    const tempId = nextTempId();
    dispatch({ type: "CREATE_LOCATION", hallId: hall.hallId, tempId, data });
    setDraft(null);
    setSelectedLocationIds([]);
    setSelectedLocationId(tempId);
  }

  function handlePatchLocation(locationId: number, patch: LocationPatch) {
    dispatch({ type: "PATCH_LOCATION", hallId: hall.hallId, locationId, patch });
  }

  function handlePatchLocationsBulk(
    updates: Array<{ locationId: number; patch: LocationPatch }>,
  ) {
    dispatch({ type: "PATCH_LOCATIONS_BULK", hallId: hall.hallId, updates });
  }

  function handleDeleteLocation(locationId: number) {
    dispatch({ type: "DELETE_LOCATION", hallId: hall.hallId, locationId });
    if (selectedLocationId === locationId) setSelectedLocationId(null);
    setSelectedLocationIds((ids) => ids.filter((id) => id !== locationId));
  }

  function handleCreateZone(data: ZonePatch) {
    const tempId = nextTempId();
    dispatch({ type: "CREATE_ZONE", hallId: hall.hallId, tempId, data });
  }

  function handlePatchZone(zoneId: number, patch: ZonePatch) {
    dispatch({ type: "PATCH_ZONE", hallId: hall.hallId, zoneId, patch });
  }

  function handleDeleteZone(zoneId: number) {
    dispatch({ type: "DELETE_ZONE", hallId: hall.hallId, zoneId });
  }

  function handleSaveMap() {
    const statesToSave: Record<number, HallState> = {};
    for (const [hallIdStr, history] of Object.entries(draftState)) {
      if (hallStateChangeCount(history.present) > 0) {
        statesToSave[Number(hallIdStr)] = history.present;
      }
    }
    startSaveMapTransition(async () => {
      const result = await commitHallStates(warehouseId, statesToSave);
      if (!result?.error) {
        dispatch({ type: "RESET_ALL" });
      }
    });
  }

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-row overflow-hidden rounded-xl border bg-background/40">
      {/* 1. Left Sidebar: Toolbar */}
      <HallToolbar
        warehouseId={warehouseId}
        halls={halls}
        selectedHallId={hall.hallId}
        zoneTypes={effectiveZoneTypes}
        tool={tool}
        onToolChange={handleToolChange}
        hallDraft={hallDraft}
        onHallFieldChange={handleHallFieldChange}
        canUndoHall={canUndoHall}
        canRedoHall={canRedoHall}
        onUndoHall={handleUndoHall}
        onRedoHall={handleRedoHall}
        onSaveMap={handleSaveMap}
        isSavingMap={isSavingMap}
        pendingCount={pendingCount}
        onCreateZone={handleCreateZone}
        onPatchZone={handlePatchZone}
        onDeleteZone={handleDeleteZone}
        locked={isSavingMap}
      />

      {/* 2. Middle Column: Canvas Container */}
      <div className="relative flex min-w-0 flex-1 items-center justify-center p-6 bg-muted/30">
        <div className="h-[600px] w-full max-w-5xl overflow-hidden rounded-xl shadow-sm">
          <LayoutDesignerCanvas
            hall={hall}
            locations={effectiveLocations}
            zoneTypes={effectiveZoneTypes}
            features={effectiveFeatures}
            featureKinds={featureKinds}
            selectedFeatureId={selectedFeatureId}
            onSelectFeature={handleSelectFeature}
            onFeatureDrawn={handleFeatureDrawn}
            onFeatureGeometryChange={handlePatchFeature}
            selectedLocationId={selectedLocationId}
            selectedLocationIds={selectedLocationIds}
            activeLevel={activeLevel}
            availableLevels={availableLevels}
            onLevelChange={setActiveLevel}
            tool={tool}
            locked={isSavingMap}
            onSelect={handleSelect}
            onMultiSelect={handleMultiSelect}
            onDraftDrawn={handleDraftDrawn}
            onGeometryChange={(locationId, geometry) => {
              handlePatchLocation(locationId, geometry);
            }}
            onGroupMove={(locationIds, deltaX, deltaY) => {
              const updates = locationIds.flatMap((id) => {
                const loc = effectiveLocations.find(
                  (l) => l.locationId === id,
                );
                if (!loc) return [];
                return [
                  {
                    locationId: id,
                    patch: {
                      physicalX: loc.physicalX + deltaX,
                      physicalY: loc.physicalY + deltaY,
                    },
                  },
                ];
              });
              handlePatchLocationsBulk(updates);
            }}
            onGroupResize={(updates: GeometryUpdate[]) => {
              handlePatchLocationsBulk(
                updates.map((u) => ({
                  locationId: u.locationId,
                  patch: {
                    physicalX: u.physicalX,
                    physicalY: u.physicalY,
                    physicalWidthMm: u.physicalWidthMm,
                    physicalLengthMm: u.physicalLengthMm,
                  },
                })),
              );
            }}
          />
        </div>
      </div>

      {/* 3. Right Sidebar: property panel -- feature drafts and feature
          selection take precedence, since both are only reachable from an
          explicit feature gesture. */}
      {featureDraft ? (
        <CreateFeaturePanel
          featureKinds={featureKinds}
          onCreate={handleCreateFeature}
          onClose={() => setFeatureDraft(null)}
          locked={isSavingMap}
        />
      ) : selectedFeature ? (
        <EditFeaturePanel
          feature={selectedFeature}
          featureKinds={featureKinds}
          zoneTypes={effectiveZoneTypes}
          onPatch={(patch) =>
            handlePatchFeature(selectedFeature.featureId, patch)
          }
          onDelete={() => handleDeleteFeature(selectedFeature.featureId)}
          onClose={() => setSelectedFeatureId(null)}
          locked={isSavingMap}
        />
      ) : draft ? (
        <CreateLocationPanel
          draft={draft}
          zoneTypes={effectiveZoneTypes}
          onCreate={handleCreateLocation}
          onClose={() => setDraft(null)}
          locked={isSavingMap}
        />
      ) : selectedLocationsForMulti.length > 1 ? (
        <MultiSelectPanel
          locations={selectedLocationsForMulti}
          zoneTypes={effectiveZoneTypes}
          onPatch={handlePatchLocation}
          onDelete={handleDeleteLocation}
          onClose={handleClearSelection}
          locked={isSavingMap}
        />
      ) : selectedLocation ? (
        <EditLocationPanel
          location={selectedLocation}
          zoneTypes={effectiveZoneTypes}
          onPatch={(patch) => handlePatchLocation(selectedLocation.locationId, patch)}
          onDelete={() => handleDeleteLocation(selectedLocation.locationId)}
          onClose={() => setSelectedLocationId(null)}
          locked={isSavingMap}
        />
      ) : (
        <EmptyLocationPanel />
      )}
    </div>
  );
}
