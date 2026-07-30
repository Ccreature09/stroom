"use server";

import { db } from "@/lib/db";
import { mheTypes } from "@/drizzle/schema";
import { requireLayoutContext, revalidateLayout } from "@/lib/warehouse-map/context";
import {
  computeRoutePreview,
  type RoutePreview,
} from "@/lib/warehouse-map/routing-server";

export type { RoutePreview };

/**
 * Design-time route preview. Delegates the actual computation to the shared
 * `computeRoutePreview` (also used by the live map's congestion-aware
 * preview) but never passes `congestionMultipliers` -- a design-time route
 * reflects what the layout implies, nothing about current traffic. That
 * omission is what keeps this module free of any dependency on live tables.
 */
export async function previewRoute(
  warehouseId: number,
  hallId: number,
  fromLocationId: number,
  toLocationIds: number[],
  options: { mheTypeId?: number | null; persist?: boolean; taskId?: string } = {},
): Promise<RoutePreview> {
  let organizationId: number;
  try {
    ({ organizationId } = await requireLayoutContext(warehouseId));
  } catch (err) {
    return { error: (err as Error).message };
  }

  const result = await computeRoutePreview(
    organizationId,
    warehouseId,
    hallId,
    fromLocationId,
    toLocationIds,
    options,
  );

  if (result.routePlanId !== undefined) revalidateLayout(warehouseId);
  return result;
}

/** Equipment profiles offered as the traveller for a route preview. */
export async function listRoutingVehicles(warehouseId: number) {
  try {
    await requireLayoutContext(warehouseId);
  } catch {
    return [];
  }
  const rows = await db
    .select({
      mheTypeId: mheTypes.mheTypeId,
      name: mheTypes.name,
      classBit: mheTypes.classBit,
      isPedestrian: mheTypes.isPedestrian,
    })
    .from(mheTypes);
  return rows.filter((row) => row.classBit !== null);
}
