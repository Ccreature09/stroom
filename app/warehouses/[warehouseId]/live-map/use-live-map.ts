"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/client";
import {
  ASSET_EXPIRY_MS,
  advanceStream,
  coalescePositions,
  type LiveAsset,
  type MapEvent,
  type StreamState,
} from "@/lib/warehouse-map/live-map";

/**
 * Subscribes a hall to its live channels.
 *
 * Transport choices (docs §4.2):
 *
 *   - Positions ride a **presence** channel. Presence is last-write-wins per
 *     key, expires on disconnect, and never touches disk -- which is exactly
 *     right for "where is everyone right now". Writing 200 workers at 1 Hz
 *     into a table would be 17M rows a day of data whose value expires in
 *     seconds.
 *
 *   - Everything else (blockages, route assignments, alerts) rides a
 *     **broadcast** channel as sequenced events, so a gap is detectable.
 *
 *   - Layout republishes arrive as postgres_changes on `layout_versions`,
 *     which is small and rare, and tells every open map to refetch.
 *
 * Ordering always uses the server-assigned `seq`. Device clocks in a
 * warehouse are routinely minutes out and cannot be trusted to sort anything.
 */
export type LiveConnectionState =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "error";

export type UseLiveMapResult = {
  assets: Map<string, LiveAsset>;
  connection: LiveConnectionState;
  /** Bumps when the server says the layout changed and we should refetch. */
  layoutChangedAt: number | null;
  /** Bumps when a sequence gap forces a full resync. */
  resyncRequestedAt: number | null;
  lastEventAt: number | null;
};

export function assetKey(kind: string, refId: number) {
  return `${kind}:${refId}`;
}

function seedAssets(assets: LiveAsset[]): Map<string, LiveAsset> {
  const seeded = new Map<string, LiveAsset>();
  for (const asset of assets) {
    seeded.set(assetKey(asset.assetKind, asset.assetRefId), asset);
  }
  return seeded;
}

export function useLiveMap({
  warehouseId,
  hallId,
  enabled,
  initialAssets,
}: {
  warehouseId: number;
  hallId: number;
  enabled: boolean;
  initialAssets: LiveAsset[];
}): UseLiveMapResult {
  const [assets, setAssets] = useState<Map<string, LiveAsset>>(() =>
    seedAssets(initialAssets),
  );
  // Null until the channel reports. Derived below rather than stored as
  // "idle", so toggling the layer off never needs a setState in an effect.
  const [channelState, setChannelState] = useState<LiveConnectionState | null>(
    null,
  );
  const [layoutChangedAt, setLayoutChangedAt] = useState<number | null>(null);
  const [resyncRequestedAt, setResyncRequestedAt] = useState<number | null>(null);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  const streamRef = useRef<StreamState>({ lastSeq: 0, needsResync: false });
  // Incoming positions are buffered and flushed on a timer rather than
  // applied per message: a burst of 200 updates should cause one React render,
  // not 200.
  const pendingRef = useRef<LiveAsset[]>([]);

  // Reseed when the server snapshot changes. Adjusted during render rather
  // than in an effect -- the pattern React recommends for resetting state
  // from a prop, and the one the rest of this designer already uses.
  const [prevInitial, setPrevInitial] = useState(initialAssets);
  if (initialAssets !== prevInitial) {
    setPrevInitial(initialAssets);
    setAssets(seedAssets(initialAssets));
  }

  const flush = useCallback(() => {
    if (pendingRef.current.length === 0) return;
    const batch = coalescePositions(pendingRef.current);
    pendingRef.current = [];
    setAssets((previous) => {
      const next = new Map(previous);
      const cutoff = Date.now() - ASSET_EXPIRY_MS;
      for (const asset of batch) {
        next.set(assetKey(asset.assetKind, asset.assetRefId), asset);
      }
      // Drop anyone who has gone quiet for good, so the map does not
      // accumulate ghosts across a long shift.
      for (const [key, asset] of next) {
        if (asset.fixedAt < cutoff) next.delete(key);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let flushTimer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    try {
      channel = supabase.channel(`wh:${warehouseId}:hall:${hallId}`, {
        config: { presence: { key: `viewer-${Date.now()}` } },
      });

      // Presence: the authoritative view of who is where right now.
      channel.on("presence", { event: "sync" }, () => {
        if (!channel || cancelled) return;
        const state = channel.presenceState<{ asset?: LiveAsset }>();
        const seen: LiveAsset[] = [];
        for (const entries of Object.values(state)) {
          for (const entry of entries) {
            if (entry.asset) seen.push(entry.asset);
          }
        }
        if (seen.length > 0) {
          pendingRef.current.push(...seen);
        }
      });

      channel.on("broadcast", { event: "map" }, ({ payload }) => {
        if (cancelled) return;
        const event = payload as MapEvent;
        const next = advanceStream(streamRef.current, event);
        // A gap means we cannot trust our view. Refetch the snapshot rather
        // than trying to reconcile -- a subtly wrong live map is worse than
        // one that blinks.
        if (next.needsResync && !streamRef.current.needsResync) {
          setResyncRequestedAt(Date.now());
        }
        streamRef.current = next;
        setLastEventAt(Date.now());

        if (event.kind === "POSITION" && event.payload) {
          pendingRef.current.push(event.payload as LiveAsset);
        }
        if (event.kind === "LAYOUT" || event.kind === "BLOCKAGE") {
          setLayoutChangedAt(Date.now());
        }
      });

      channel.subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") setChannelState("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setChannelState("reconnecting");
        } else if (status === "CLOSED") setChannelState("idle");
      });

      // 150ms ~ 6-7 renders/sec. Fast enough to feel live, slow enough that a
      // busy warehouse does not re-render the tree on every frame.
      flushTimer = setInterval(flush, 150);
    } catch (err) {
      // Only reachable if the client or channel constructor throws, which
      // means misconfiguration rather than a network problem. Deferred a tick
      // so the failure does not cascade a render from inside the effect body.
      console.error("Live map channel failed:", err);
      queueMicrotask(() => setChannelState("error"));
    }

    return () => {
      cancelled = true;
      if (flushTimer) clearInterval(flushTimer);
      if (channel) supabase.removeChannel(channel);
      setChannelState(null);
    };
  }, [warehouseId, hallId, enabled, flush]);

  const connection: LiveConnectionState = !enabled
    ? "idle"
    : (channelState ?? "connecting");

  return {
    assets,
    connection,
    layoutChangedAt,
    resyncRequestedAt,
    lastEventAt,
  };
}
