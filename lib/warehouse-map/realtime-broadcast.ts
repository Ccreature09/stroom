import "server-only";

import type { MapEventKind } from "./live-map";

// Per-process, monotonically increasing per warehouse. Two server instances
// racing would each hand out their own 1, 2, 3..., which a client sees as a
// gap and resolves with a full resync -- not free, but not wrong, and the
// same accepted trade-off `routing-actions.ts`'s per-process graph cache
// already makes elsewhere in this module. A real fix is a Postgres sequence;
// not worth a migration for events this infrequent (stock edits, not 5 Hz
// telemetry).
const seqByWarehouse = new Map<number, number>();

function nextSeq(warehouseId: number): number {
  const next = (seqByWarehouse.get(warehouseId) ?? 0) + 1;
  seqByWarehouse.set(warehouseId, next);
  return next;
}

/**
 * Publishes a MapEvent to every client subscribed to `wh:{warehouseId}:hall:{hallId}`.
 *
 * Sent over Supabase's stateless broadcast REST endpoint rather than opening a
 * websocket -- a server action's process is far too short-lived to hold a
 * channel connection open long enough to guarantee delivery over it.
 *
 * Best-effort and silent on failure: a dropped broadcast only delays a client
 * refresh (the recipient's own gap detection forces a resync on the next
 * event it *does* see), it never loses the underlying mutation, which has
 * already been committed by the time this is called. Callers must not let a
 * broadcast failure fail the mutation it followed.
 */
export async function broadcastMapEvent(
  warehouseId: number,
  hallId: number,
  kind: MapEventKind,
  payload: unknown,
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return;

  const event = {
    seq: nextSeq(warehouseId),
    ts: Date.now(),
    warehouseId,
    kind,
    payload,
  };

  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: secret,
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic: `wh:${warehouseId}:hall:${hallId}`,
            event: "map",
            payload: event,
            private: false,
          },
        ],
      }),
    });
  } catch (err) {
    console.error("Map event broadcast failed:", err);
  }
}
