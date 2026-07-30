"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  layoutVersions,
  locationAccessPoints,
  locations,
  mheTypes,
  navEdges,
  navNodes,
  routePlans,
} from "@/drizzle/schema";
import { requireLayoutContext, revalidateLayout } from "@/lib/warehouse-map/context";
import {
  buildRoutingGraph,
  findRoute,
  routeThrough,
  sequencePickPath,
  type CompiledRoutingGraph,
  type Traveller,
} from "@/lib/warehouse-map/routing";
import type { Point } from "@/lib/warehouse-map/geometry";

export type RoutePreview = {
  error?: string;
  found?: boolean;
  points?: Point[];
  edgeIds?: number[];
  distanceMm?: number;
  travelMs?: number;
  /** Sum of the handling time at each stop -- lifting, scanning, placing. */
  handlingMs?: number;
  totalMs?: number;
  /** Location codes in the order the router chose to visit them. */
  orderedStops?: { locationId: number; locationCode: string }[];
  sequencingTruncated?: boolean;
  routePlanId?: number;
};

/**
 * In-process cache of the compiled routing graph.
 *
 * Keyed by (hall, layout version, graph epoch) because that triple is exactly
 * what invalidates a graph: republishing moves the version, a blockage moves
 * the epoch. Building it is ~1ms for a hall this size, but a pick-path
 * sequence runs one Dijkstra per stop and would otherwise rebuild it each time.
 */
type CacheEntry = { key: string; graph: CompiledRoutingGraph };
const graphCache = new Map<number, CacheEntry>();

async function loadRoutingGraph(
  hallId: number,
  layoutVersion: number,
  graphEpoch: number,
): Promise<CompiledRoutingGraph> {
  const key = `${layoutVersion}:${graphEpoch}`;
  const cached = graphCache.get(hallId);
  if (cached && cached.key === key) return cached.graph;

  const [nodeRows, edgeRows] = await Promise.all([
    db
      .select({
        nodeId: navNodes.nodeId,
        xMm: navNodes.xMm,
        yMm: navNodes.yMm,
        floorLevel: navNodes.floorLevel,
      })
      .from(navNodes)
      .where(eq(navNodes.hallId, hallId)),
    db
      .select({
        edgeId: navEdges.edgeId,
        fromNodeId: navEdges.fromNodeId,
        toNodeId: navEdges.toNodeId,
        traversal: navEdges.traversal,
        lengthMm: navEdges.lengthMm,
        maxSpeedMms: navEdges.maxSpeedMms,
        minClearanceMm: navEdges.minClearanceMm,
        maxWeightKg: navEdges.maxWeightKg,
        maxVehicleWidthMm: navEdges.maxVehicleWidthMm,
        allowedVehicleMask: navEdges.allowedVehicleMask,
        impedance: navEdges.impedance,
        fixedDelayMs: navEdges.fixedDelayMs,
      })
      .from(navEdges)
      .where(eq(navEdges.hallId, hallId)),
  ]);

  const graph = buildRoutingGraph(
    nodeRows,
    edgeRows.map((edge) => ({
      ...edge,
      traversal: edge.traversal as
        | "BIDIRECTIONAL"
        | "FORWARD_ONLY"
        | "REVERSE_ONLY",
      allowedVehicleMask: Number(edge.allowedVehicleMask),
      impedance: Number(edge.impedance),
    })),
  );

  graphCache.set(hallId, { key, graph });
  return graph;
}

/**
 * Routes from one location to one or more others, ordering the stops if there
 * is more than one.
 *
 * `persist` writes a route_plan; the designer leaves it off, because a preview
 * that nobody acts on is not worth a row.
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

  const stopIds = toLocationIds.filter((id) => id !== fromLocationId);
  if (stopIds.length === 0) {
    return { error: "Pick at least one destination that isn't the origin." };
  }

  const [versionRow] = await db
    .select({
      versionNumber: layoutVersions.versionNumber,
      graphEpoch: layoutVersions.graphEpoch,
    })
    .from(layoutVersions)
    .where(eq(layoutVersions.warehouseId, warehouseId))
    .orderBy(desc(layoutVersions.versionNumber))
    .limit(1);
  const layoutVersion = versionRow?.versionNumber ?? 0;
  const graphEpoch = versionRow?.graphEpoch ?? 0;

  const accessRows = await db
    .select({
      locationId: locationAccessPoints.locationId,
      nodeId: locationAccessPoints.nodeId,
      handlingTimeMs: locationAccessPoints.handlingTimeMs,
      allowedVehicleMask: locationAccessPoints.allowedVehicleMask,
      locationCode: locations.locationCode,
    })
    .from(locationAccessPoints)
    .innerJoin(locations, eq(locations.locationId, locationAccessPoints.locationId))
    .where(
      and(
        eq(locationAccessPoints.warehouseId, warehouseId),
        inArray(locationAccessPoints.locationId, [fromLocationId, ...stopIds]),
      ),
    );

  if (accessRows.length === 0) {
    return {
      error:
        "These locations have no access point yet. Compile the navigation graph first.",
    };
  }

  // A location can legitimately have several access points (double-deep,
  // back-to-back); the primary one is enough for a preview.
  const accessByLocation = new Map<number, (typeof accessRows)[number]>();
  for (const row of accessRows) {
    if (!accessByLocation.has(row.locationId)) {
      accessByLocation.set(row.locationId, row);
    }
  }

  const origin = accessByLocation.get(fromLocationId);
  if (!origin) {
    return { error: "The starting location has no access point." };
  }

  let traveller: Traveller = { classBit: 0 };
  if (options.mheTypeId) {
    const [mhe] = await db
      .select({
        classBit: mheTypes.classBit,
        heightMm: mheTypes.heightMm,
        widthMm: mheTypes.widthMm,
        turningRadiusMm: mheTypes.turningRadiusMm,
        maxSpeedLadenMms: mheTypes.maxSpeedLadenMms,
      })
      .from(mheTypes)
      .where(eq(mheTypes.mheTypeId, options.mheTypeId))
      .limit(1);
    if (mhe?.classBit != null) {
      traveller = {
        classBit: mhe.classBit,
        heightMm: mhe.heightMm,
        widthMm: mhe.widthMm,
        turningRadiusMm: mhe.turningRadiusMm,
        maxSpeedMms: mhe.maxSpeedLadenMms,
      };
    }
  }

  const graph = await loadRoutingGraph(hallId, layoutVersion, graphEpoch);
  if (graph.nodeCount === 0) {
    return { error: "This hall has no compiled navigation graph yet." };
  }

  const stops = stopIds
    .map((id) => accessByLocation.get(id))
    .filter((row): row is (typeof accessRows)[number] => Boolean(row));
  if (stops.length === 0) {
    return { error: "None of the destinations have an access point." };
  }

  let orderedNodeIds: number[];
  let truncated = false;

  if (stops.length === 1) {
    orderedNodeIds = [stops[0].nodeId];
  } else {
    const sequenced = sequencePickPath(
      graph,
      origin.nodeId,
      stops.map((s) => s.nodeId),
      traveller,
    );
    orderedNodeIds = sequenced.order;
    truncated = sequenced.truncated;
  }

  const route =
    orderedNodeIds.length === 1
      ? findRoute(graph, origin.nodeId, orderedNodeIds[0], traveller)
      : routeThrough(graph, origin.nodeId, orderedNodeIds, traveller);

  if (!route.found) {
    return {
      found: false,
      error:
        "No route exists between those locations for this equipment. Check the graph for disconnected areas.",
    };
  }

  // Map the visiting order back to locations for display. Several bays can
  // share one access node, so consume matches rather than reusing them.
  const remaining = [...stops];
  const orderedStops: { locationId: number; locationCode: string }[] = [];
  for (const nodeId of orderedNodeIds) {
    const index = remaining.findIndex((s) => s.nodeId === nodeId);
    if (index >= 0) {
      const [taken] = remaining.splice(index, 1);
      orderedStops.push({
        locationId: taken.locationId,
        locationCode: taken.locationCode,
      });
    }
  }

  const handlingMs = stops.reduce((sum, s) => sum + s.handlingTimeMs, 0);

  let routePlanId: number | undefined;
  if (options.persist) {
    const [row] = await db
      .insert(routePlans)
      .values({
        organizationId,
        warehouseId,
        hallId,
        taskId: options.taskId ?? null,
        mheTypeId: options.mheTypeId ?? null,
        fromNodeId: origin.nodeId,
        toNodeId: orderedNodeIds[orderedNodeIds.length - 1],
        edgeIds: route.edgeIds,
        stops: orderedStops,
        estDurationMs: route.durationMs + handlingMs,
        estDistanceMm: route.distanceMm,
        layoutVersion,
        graphEpoch,
      })
      .returning({ routePlanId: routePlans.routePlanId });
    routePlanId = row.routePlanId;
    revalidateLayout(warehouseId);
  }

  return {
    found: true,
    points: route.points,
    edgeIds: route.edgeIds,
    distanceMm: route.distanceMm,
    travelMs: route.durationMs,
    handlingMs,
    totalMs: route.durationMs + handlingMs,
    orderedStops,
    sequencingTruncated: truncated,
    routePlanId,
  };
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
