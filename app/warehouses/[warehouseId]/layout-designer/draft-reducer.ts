import type {
  FeatureDTO,
  FeaturePatch,
  HallPatch,
  HallState,
  LocationPatch,
} from "@/lib/warehouse-map/types";
import { EMPTY_HALL_STATE } from "@/lib/warehouse-map/types";

export type HallHistory = {
  past: HallState[];
  present: HallState;
  future: HallState[];
};

export type DraftState = Record<number, HallHistory>;

export type DraftAction =
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

export function draftReducer(state: DraftState, action: DraftAction): DraftState {
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
