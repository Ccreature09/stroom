"use server";

import { requireLiveMapContext } from "@/lib/warehouse-map/context";
import {
  computeRoutePreview,
  type RoutePreview,
} from "@/lib/warehouse-map/routing-server";
import { getCongestionMultipliers } from "./traffic-actions";

export type { RoutePreview };

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
