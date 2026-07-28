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
import type {
  DraftGeometry,
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
  applyHallStateToLocations,
  applyHallStateToZones,
  hallStateChangeCount,
} from "./types";
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
const DRAFT_STORAGE_VERSION = 1;

function draftStorageKey(warehouseId: number) {
  return `stroom:layout-draft:${warehouseId}`;
}

export default function LayoutDesigner({
  warehouseId,
  halls,
  selectedHallId,
  locations,
  zoneTypes,
}: {
  warehouseId: number;
  halls: HallDTO[];
  selectedHallId: number;
  locations: LocationDTO[];
  zoneTypes: ZoneTypeDTO[];
}) {
  const [tool, setTool] = useState<Tool>("select");
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(
    null,
  );
  const [selectedLocationIds, setSelectedLocationIds] = useState<number[]>([]);
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
      if ((loc.isRacking || loc.isShelf) && loc.level != null)
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
    setDraft(null);
  }

  function handleDraftDrawn(geometry: DraftGeometry) {
    setDraft(geometry);
  }

  function handleSelect(locationId: number | null) {
    setSelectedLocationIds([]);
    setSelectedLocationId(locationId);
  }

  function handleMultiSelect(locationIds: number[]) {
    setSelectedLocationId(null);
    setSelectedLocationIds(locationIds);
  }

  function handleClearSelection() {
    setSelectedLocationId(null);
    setSelectedLocationIds([]);
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

      {/* 3. Right Sidebar: Location Panel */}
      {draft ? (
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
