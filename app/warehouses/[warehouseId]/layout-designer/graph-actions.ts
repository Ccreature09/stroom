"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  halls,
  layoutFeatures,
  layoutVersions,
  locationAccessPoints,
  locations,
  mheTypes,
  navEdges,
  navNodes,
} from "@/drizzle/schema";
import {
  hallBelongsToWarehouse,
  requireLayoutContext,
  revalidateLayout,
} from "@/lib/warehouse-map/context";
import { sanitizePoints, type GeometryKind } from "@/lib/warehouse-map/geometry";
import type { FeatureAttrs } from "@/lib/warehouse-map/feature-kinds";
import { parseLocationType } from "@/lib/warehouse-map/naming";
import { compileNavigationGraph, type CompileWarning } from "@/lib/warehouse-map/graph-compiler";
import type { FeatureDTO, LocationDTO } from "@/lib/warehouse-map/types";

export type CompileGraphResult = {
  error?: string;
  success?: true;
  stats?: {
    nodes: number;
    edges: number;
    accessPoints: number;
    rackRuns: number;
    inferredCorridors: number;
    authoredLanes: number;
    connectors: number;
    componentCount: number;
    reachableLocationCount: number;
    unreachableLocationCount: number;
  };
  warnings?: CompileWarning[];
  layoutVersion?: number;
};

/**
 * Recompiles a hall's navigation graph from its current geometry and replaces
 * the stored one.
 *
 * Only generated rows are replaced. Hand-placed nodes and edges
 * (is_generated = false) survive, because a supervisor correcting the
 * compiler's guess should not have that correction thrown away the next time
 * anyone presses the button.
 */
export async function compileHallGraph(
  warehouseId: number,
  hallId: number,
  floorLevel = 1,
): Promise<CompileGraphResult> {
  let organizationId: number;
  try {
    ({ organizationId } = await requireLayoutContext(warehouseId));
  } catch (err) {
    return { error: (err as Error).message };
  }

  if (!(await hallBelongsToWarehouse(hallId, warehouseId))) {
    return { error: "That hall does not belong to this warehouse." };
  }

  const [hall] = await db
    .select({
      hallId: halls.hallId,
      physicalWidthMm: halls.physicalWidthMm,
      physicalLengthMm: halls.physicalLengthMm,
      clearHeightMm: halls.clearHeightMm,
    })
    .from(halls)
    .where(eq(halls.hallId, hallId))
    .limit(1);
  if (!hall) return { error: "That hall no longer exists." };

  const [locationRows, featureRows, vehicleRows, versionRow] =
    await Promise.all([
      db
        .select({
          locationId: locations.locationId,
          locationCode: locations.locationCode,
          zoneId: locations.zoneId,
          aisle: locations.aisle,
          bay: locations.bay,
          level: locations.level,
          row: locations.row,
          locationType: locations.locationType,
          heightMm: locations.heightMm,
          maxWeightKg: locations.maxWeightKg,
          isBlocked: locations.isBlocked,
          physicalX: locations.physicalX,
          physicalY: locations.physicalY,
          physicalWidthMm: locations.physicalWidthMm,
          physicalLengthMm: locations.physicalLengthMm,
          rotationDegrees: locations.rotationDegrees,
          floorLevel: locations.floorLevel,
        })
        .from(locations)
        .where(
          and(
            eq(locations.warehouseId, warehouseId),
            eq(locations.hallId, hallId),
          ),
        ),
      db
        .select({
          featureId: layoutFeatures.featureId,
          floorLevel: layoutFeatures.floorLevel,
          kind: layoutFeatures.kind,
          geometryKind: layoutFeatures.geometryKind,
          originXMm: layoutFeatures.originXMm,
          originYMm: layoutFeatures.originYMm,
          widthMm: layoutFeatures.widthMm,
          lengthMm: layoutFeatures.lengthMm,
          rotationDegrees: layoutFeatures.rotationDegrees,
          points: layoutFeatures.points,
          elevationMm: layoutFeatures.elevationMm,
          heightMm: layoutFeatures.heightMm,
          layerIndex: layoutFeatures.layerIndex,
          isObstacle: layoutFeatures.isObstacle,
          isVisualOnly: layoutFeatures.isVisualOnly,
          zoneId: layoutFeatures.zoneId,
          label: layoutFeatures.label,
          color: layoutFeatures.color,
          attrs: layoutFeatures.attrs,
        })
        .from(layoutFeatures)
        .where(
          and(
            eq(layoutFeatures.warehouseId, warehouseId),
            eq(layoutFeatures.hallId, hallId),
            eq(layoutFeatures.isActive, true),
          ),
        ),
      db
        .select({
          mheTypeId: mheTypes.mheTypeId,
          name: mheTypes.name,
          classBit: mheTypes.classBit,
          isPedestrian: mheTypes.isPedestrian,
          minAisleWidthMm: mheTypes.minAisleWidthMm,
          maxSpeedLadenMms: mheTypes.maxSpeedLadenMms,
          heightMm: mheTypes.heightMm,
        })
        .from(mheTypes),
      db
        .select({ versionNumber: layoutVersions.versionNumber })
        .from(layoutVersions)
        .where(eq(layoutVersions.warehouseId, warehouseId))
        .orderBy(desc(layoutVersions.versionNumber))
        .limit(1),
    ]);

  const layoutVersion = versionRow[0]?.versionNumber ?? 0;

  const compilerLocations: LocationDTO[] = locationRows.map((row) => ({
    ...row,
    locationType: parseLocationType(row.locationType),
  }));

  const compilerFeatures: FeatureDTO[] = featureRows.map((row) => ({
    ...row,
    geometryKind: row.geometryKind as GeometryKind,
    points: sanitizePoints(row.points),
    attrs: (row.attrs ?? {}) as FeatureAttrs,
  }));

  const vehicles = vehicleRows
    .filter((v) => v.classBit !== null)
    .map((v) => ({
      mheTypeId: v.mheTypeId,
      name: v.name,
      classBit: v.classBit as number,
      isPedestrian: v.isPedestrian,
      minAisleWidthMm: v.minAisleWidthMm,
      maxSpeedLadenMms: v.maxSpeedLadenMms,
      heightMm: v.heightMm,
    }));

  if (vehicles.length === 0) {
    return {
      error:
        "No equipment types have a vehicle class assigned, so no lane would be usable by anything. Assign class bits in MHE types first.",
    };
  }

  const result = compileNavigationGraph({
    hall,
    locations: compilerLocations,
    features: compilerFeatures,
    vehicles,
    floorLevel,
  });

  try {
    await db.transaction(async (tx) => {
      // Clear the previously generated graph for this floor. Edges go first
      // (they reference nodes), and hand-placed rows are left untouched.
      const generatedNodes = await tx
        .select({ nodeId: navNodes.nodeId })
        .from(navNodes)
        .where(
          and(
            eq(navNodes.hallId, hallId),
            eq(navNodes.floorLevel, floorLevel),
            eq(navNodes.isGenerated, true),
          ),
        );
      const generatedNodeIds = generatedNodes.map((n) => n.nodeId);

      await tx
        .delete(navEdges)
        .where(
          and(eq(navEdges.hallId, hallId), eq(navEdges.isGenerated, true)),
        );
      if (generatedNodeIds.length > 0) {
        // Access points cascade from nav_nodes, but deleting them explicitly
        // keeps the intent obvious rather than relying on the FK.
        await tx
          .delete(locationAccessPoints)
          .where(inArray(locationAccessPoints.nodeId, generatedNodeIds));
        await tx
          .delete(navNodes)
          .where(inArray(navNodes.nodeId, generatedNodeIds));
      }

      if (result.nodes.length === 0) return;

      const insertedNodes = await tx
        .insert(navNodes)
        .values(
          result.nodes.map((node) => ({
            organizationId,
            warehouseId,
            hallId,
            floorLevel: node.floorLevel,
            xMm: node.xMm,
            yMm: node.yMm,
            nodeKind: node.nodeKind,
            portalGroupId: node.portalGroupId,
            sourceFeatureId: node.sourceFeatureId,
            isGenerated: true,
            layoutVersion,
          })),
        )
        .returning({ nodeId: navNodes.nodeId });

      // The compiler's node order is the insert order, so index alignment is
      // what maps its string keys onto real ids.
      const nodeIdByKey = new Map<string, number>();
      result.nodes.forEach((node, index) => {
        nodeIdByKey.set(node.key, insertedNodes[index].nodeId);
      });

      if (result.edges.length > 0) {
        await tx.insert(navEdges).values(
          result.edges.map((edge) => ({
            organizationId,
            warehouseId,
            hallId,
            fromNodeId: nodeIdByKey.get(edge.fromKey)!,
            toNodeId: nodeIdByKey.get(edge.toKey)!,
            traversal: edge.traversal,
            edgeKind: edge.edgeKind,
            lengthMm: edge.lengthMm,
            widthMm: edge.widthMm,
            maxSpeedMms: edge.maxSpeedMms,
            minClearanceMm: edge.minClearanceMm,
            allowedVehicleMask: edge.allowedVehicleMask,
            sourceFeatureId: edge.sourceFeatureId,
            isGenerated: true,
            layoutVersion,
          })),
        );
      }

      if (result.accessPoints.length > 0) {
        await tx.insert(locationAccessPoints).values(
          result.accessPoints.map((ap) => ({
            organizationId,
            warehouseId,
            locationId: ap.locationId,
            nodeId: nodeIdByKey.get(ap.nodeKey)!,
            approachHeadingDeg: ap.approachHeadingDeg,
            face: ap.face,
            offsetMm: ap.offsetMm,
            handlingTimeMs: ap.handlingTimeMs,
            allowedVehicleMask: ap.allowedVehicleMask,
            isPrimary: ap.isPrimary,
            layoutVersion,
          })),
        );
      }
    });
  } catch (err) {
    return {
      error: (err as Error).message || "Failed to store the compiled graph.",
    };
  }

  revalidateLayout(warehouseId);

  return {
    success: true,
    layoutVersion,
    warnings: result.warnings,
    stats: {
      nodes: result.nodes.length,
      edges: result.edges.length,
      accessPoints: result.accessPoints.length,
      ...result.stats,
    },
  };
}

/** Removes the compiled graph for a hall floor, generated rows only. */
export async function clearHallGraph(
  warehouseId: number,
  hallId: number,
  floorLevel = 1,
): Promise<{ error?: string; success?: true }> {
  try {
    await requireLayoutContext(warehouseId);
  } catch (err) {
    return { error: (err as Error).message };
  }

  await db.transaction(async (tx) => {
    const generated = await tx
      .select({ nodeId: navNodes.nodeId })
      .from(navNodes)
      .where(
        and(
          eq(navNodes.hallId, hallId),
          eq(navNodes.floorLevel, floorLevel),
          eq(navNodes.isGenerated, true),
        ),
      );
    await tx
      .delete(navEdges)
      .where(and(eq(navEdges.hallId, hallId), eq(navEdges.isGenerated, true)));
    const ids = generated.map((n) => n.nodeId);
    if (ids.length > 0) {
      await tx
        .delete(locationAccessPoints)
        .where(inArray(locationAccessPoints.nodeId, ids));
      await tx.delete(navNodes).where(inArray(navNodes.nodeId, ids));
    }
  });

  revalidateLayout(warehouseId);
  return { success: true };
}
