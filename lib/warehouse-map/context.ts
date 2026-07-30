import "server-only";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { db } from "@/lib/db";
import { employees, halls, positionTypes, warehouses, zoneTypes } from "@/drizzle/schema";
import { createClient } from "@/lib/server";

export const UNDERLAY_BUCKET = "layout-underlays";

/**
 * Service-role Supabase client, for storage only.
 *
 * The underlay bucket is private and carries no RLS policies, so the
 * user-scoped client cannot touch it at all -- which is the point: there is no
 * path from a browser to a floorplan except through a server action that has
 * already run requireLayoutContext() and derived the object path from the
 * authenticated organization. Authorization happens in our code; RLS is not
 * being relied on and not being quietly bypassed either.
 */
export function createStorageClient() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not set -- underlay storage is unavailable.",
    );
  }
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    secret,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** How long a minted underlay URL stays valid. Long enough for a design
 *  session, short enough that a leaked URL expires on its own. */
export const UNDERLAY_SIGNED_URL_TTL_SECONDS = 60 * 60 * 4;

// Shared server-side context for every layout mutation. Deliberately not a
// "use server" module -- those may only export async server actions, and this
// exports helpers that actions call rather than actions themselves.

export type LayoutContext = {
  organizationId: number;
  employeeId: number;
};

/**
 * Every layout mutation is scoped to the caller's organization and requires
 * the "can modify locations" permission. Redirects on auth failure, throws on
 * permission failure so it surfaces as an error to the calling form.
 */
export async function requireLayoutContext(
  warehouseId: number,
): Promise<LayoutContext> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/sign-in");

  const [employee] = await db
    .select({
      employeeId: employees.employeeId,
      organizationId: employees.organizationId,
      canModifyLocations: positionTypes.canModifyLocations,
    })
    .from(employees)
    .innerJoin(positionTypes, eq(employees.positionId, positionTypes.positionId))
    .where(and(eq(employees.authUserId, userId), eq(employees.isActive, true)))
    .limit(1);

  if (!employee) redirect("/sign-in");
  if (employee.canModifyLocations !== true) {
    throw new Error(
      "You do not have permission to modify the warehouse layout.",
    );
  }

  const [warehouse] = await db
    .select({ warehouseId: warehouses.warehouseId })
    .from(warehouses)
    .where(
      and(
        eq(warehouses.warehouseId, warehouseId),
        eq(warehouses.organizationId, employee.organizationId),
      ),
    )
    .limit(1);

  if (!warehouse) redirect("/warehouses");

  return {
    organizationId: employee.organizationId,
    employeeId: employee.employeeId,
  };
}

export function revalidateLayout(warehouseId: number) {
  revalidatePath(`/warehouses/${warehouseId}/layout-designer`);
}

export function revalidateLiveMap(warehouseId: number) {
  revalidatePath(`/warehouses/${warehouseId}/live-map`);
}

export type LiveMapContext = LayoutContext & {
  /** Raising or clearing a blockage is directing floor work. */
  canReportBlockages: boolean;
};

/**
 * Access check for the live map.
 *
 * Deliberately NOT requireLayoutContext: watching the floor is a different
 * job from editing the layout, and a shift supervisor who should see where
 * everyone is has no business being able to move racking. Viewing needs
 * `can_view_metrics`; reporting a blockage needs `can_assign_tasks`, because
 * it redirects people.
 *
 * This gate is also the privacy boundary (docs §5.8). Individual worker
 * location is regulated in the EU, so it must sit behind an explicit
 * permission rather than being visible to anyone with a login.
 */
export async function requireLiveMapContext(
  warehouseId: number,
): Promise<LiveMapContext> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/sign-in");

  const [employee] = await db
    .select({
      employeeId: employees.employeeId,
      organizationId: employees.organizationId,
      canViewMetrics: positionTypes.canViewMetrics,
      canAssignTasks: positionTypes.canAssignTasks,
    })
    .from(employees)
    .innerJoin(positionTypes, eq(employees.positionId, positionTypes.positionId))
    .where(and(eq(employees.authUserId, userId), eq(employees.isActive, true)))
    .limit(1);

  if (!employee) redirect("/sign-in");
  if (employee.canViewMetrics !== true) {
    redirect(`/warehouses/${warehouseId}`);
  }

  const [warehouse] = await db
    .select({ warehouseId: warehouses.warehouseId })
    .from(warehouses)
    .where(
      and(
        eq(warehouses.warehouseId, warehouseId),
        eq(warehouses.organizationId, employee.organizationId),
      ),
    )
    .limit(1);

  if (!warehouse) redirect("/warehouses");

  return {
    organizationId: employee.organizationId,
    employeeId: employee.employeeId,
    canReportBlockages: employee.canAssignTasks === true,
  };
}

export async function hallBelongsToWarehouse(
  hallId: number,
  warehouseId: number,
) {
  const [row] = await db
    .select({ hallId: halls.hallId })
    .from(halls)
    .where(and(eq(halls.hallId, hallId), eq(halls.warehouseId, warehouseId)))
    .limit(1);
  return Boolean(row);
}

export async function zoneBelongsToWarehouse(
  zoneId: number,
  warehouseId: number,
) {
  const [row] = await db
    .select({ zoneId: zoneTypes.zoneId })
    .from(zoneTypes)
    .where(
      and(eq(zoneTypes.zoneId, zoneId), eq(zoneTypes.warehouseId, warehouseId)),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Thrown when a publish is built on a layout version that is no longer
 * current. Carried out of the transaction as a tagged error so the caller can
 * turn it into a reviewable message instead of a generic failure.
 */
export class LayoutVersionConflictError extends Error {
  readonly currentVersion: number;
  readonly publishedByName: string | null;
  readonly publishedAt: string | null;

  constructor(details: {
    currentVersion: number;
    publishedByName: string | null;
    publishedAt: string | null;
  }) {
    super("The layout has been published by someone else since you loaded it.");
    this.name = "LayoutVersionConflictError";
    this.currentVersion = details.currentVersion;
    this.publishedByName = details.publishedByName;
    this.publishedAt = details.publishedAt;
  }
}
