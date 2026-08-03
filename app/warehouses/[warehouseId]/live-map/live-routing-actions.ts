"use server";

import { requireLiveMapContext } from "@/lib/warehouse-map/context";
import {
  computeRoutePreview,
  type RoutePreview,
} from "@/lib/warehouse-map/routing-server";
import { getCongestionMultipliers } from "./traffic-actions";

// NOTE: do not re-export the RoutePreview type from this file, even as a
// type-only export -- a "use server" file may only export async functions,
// and the Next.js server-actions compiler does not reliably erase a
// re-exported type here, producing a runtime `ReferenceError: RoutePreview
// is not defined` when the actions-loader chunk evaluates. Import the type
// from "@/lib/warehouse-map/routing-server" directly instead.

/**
 * Congestion-aware route preview for the live map.
 *
 * The only difference from the designer's `previewRoute` is that this one
 * fetches current per-edge congestion multipliers first and passes them
 * through -- the shared `computeRoutePreview` does everything else
 * identically. Persistence is intentionally not exposed here: writing a
 * `route_plans` row ties into task assignment, which nothing in this
 * codebase does yet, so this stays a read-only preview until that exists.
 */
export async function previewLiveRoute(
  warehouseId: number,
  hallId: number,
  fromLocationId: number,
  toLocationIds: number[],
  options: { mheTypeId?: number | null } = {},
): Promise<RoutePreview> {
  const { organizationId } = await requireLiveMapContext(warehouseId);
  const congestionMultipliers = await getCongestionMultipliers(
    warehouseId,
    hallId,
  );

  return computeRoutePreview(
    organizationId,
    warehouseId,
    hallId,
    fromLocationId,
    toLocationIds,
    { mheTypeId: options.mheTypeId, congestionMultipliers },
  );
}
