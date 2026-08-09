import { useEffect, useRef, useState, type Dispatch, type MutableRefObject } from "react";
import type { HallState, RecoveredDraft } from "@/lib/warehouse-map/types";
import { DRAFT_STATE_VERSION } from "@/lib/warehouse-map/types";
import { saveHallDraft } from "./actions/lifecycle-actions";
import type { DraftAction, DraftState } from "./draft-reducer";

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

/**
 * A restored draft (localStorage or server-recovered layout_drafts) can
 * carry negative temp ids from a *previous* mount -- tempIdRef itself always
 * restarts at 0 on a fresh mount, since it's a plain ref with no persistence
 * of its own. Without this, the counter could hand out a temp id that
 * collides with one already sitting in the just-hydrated draft: two
 * newLocations entries sharing one id overwrite each other in the canvas's
 * per-id node map (the older one appears to vanish) and then both generate
 * the same `NEW-<TYPE>-<suffix>-<id>` code, which fails the
 * warehouse/location_code unique constraint at Save Map. Seeding the counter
 * from the lowest id already present closes that gap.
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

/**
 * Draft recovery (server + localStorage), localStorage persistence, and the
 * debounced server autosave -- everything the layout designer needs to keep
 * unsaved edits alive across a refresh, a crash, or a closed tab without the
 * user ever running "Save Map".
 */
export function useDraftPersistence(
  warehouseId: number,
  recoveredDrafts: RecoveredDraft[],
  currentVersionNumber: number,
  isSavingMap: boolean,
  draftState: DraftState,
  dispatch: Dispatch<DraftAction>,
  tempIdRef: MutableRefObject<number>,
) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftState, warehouseId, currentVersionNumber, isSavingMap]);

  return { draftSaveState, setDraftSaveState, lastSavedRef };
}
