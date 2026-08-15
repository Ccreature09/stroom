import "server-only";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { employees, positionTypes, warehouses } from "@/drizzle/schema";
import { createClient } from "@/lib/server";

// Shared auth + scope guard for warehouse-scoped modules. Every page under
// /warehouses/[warehouseId]/... needs the same three checks: a signed-in user,
// an active employee record, and a warehouse that actually belongs to that
// employee's organization. Without the last one, any employee could read
// another organization's data just by editing the URL.

const employeeSelection = {
  employeeId: employees.employeeId,
  organizationId: employees.organizationId,
  firstName: employees.firstName,
  lastName: employees.lastName,
  canViewMetrics: positionTypes.canViewMetrics,
  canModifyInventory: positionTypes.canModifyInventory,
  canModifyConfigs: positionTypes.canModifyConfigs,
  canModifyLayout: positionTypes.canModifyLayout,
  canManageUsers: positionTypes.canManageUsers,
  canForceRecount: positionTypes.canForceRecount,
  // Inbound task-engine permissions -- each maps to one task type's
  // execution rights; canAssignTasks separately covers handing a task to
  // someone else, the same capability the live map's blockage/position
  // reporting already gates "acting for another person" behind.
  canBook: positionTypes.canBook,
  canUnload: positionTypes.canUnload,
  canAssignTasks: positionTypes.canAssignTasks,
  // Outbound counterparts of the same idea: one flag per task type's
  // execution rights, plus the two that authorise a commercial decision
  // rather than a physical one (releasing an order to the floor, and
  // voiding a shipment that may already be on a truck).
  canPick: positionTypes.canPick,
  canPack: positionTypes.canPack,
  canLoad: positionTypes.canLoad,
  canReleaseOrders: positionTypes.canReleaseOrders,
  canVoidShipments: positionTypes.canVoidShipments,
  // Internal operations: moving stock around inside the building rather than
  // in or out of it. `canForceRecount` is above -- it authorises overriding a
  // count, which is a different (and stronger) right than performing one.
  canReplenish: positionTypes.canReplenish,
} as const;

async function loadEmployee() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;

  const [employee] = await db
    .select(employeeSelection)
    .from(employees)
    .innerJoin(positionTypes, eq(employees.positionId, positionTypes.positionId))
    .where(and(eq(employees.authUserId, userId), eq(employees.isActive, true)))
    .limit(1);

  return employee ?? null;
}

function parseWarehouseId(warehouseIdParam: string) {
  const parsed = Number(warehouseIdParam);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * For pages (Server Components). Redirects rather than throwing, so an
 * unauthorized visit lands somewhere sensible instead of on an error screen.
 */
export async function requireWarehouseAccess(warehouseIdParam: string) {
  const warehouseId = parseWarehouseId(warehouseIdParam);
  if (warehouseId === null) redirect("/warehouses");

  const employee = await loadEmployee();
  if (!employee) redirect("/sign-in");

  const [warehouse] = await db
    .select({
      warehouseId: warehouses.warehouseId,
      name: warehouses.name,
      city: warehouses.city,
      country: warehouses.country,
      timezone: warehouses.timezone,
      isActive: warehouses.isActive,
    })
    .from(warehouses)
    .where(
      and(
        eq(warehouses.organizationId, employee.organizationId),
        eq(warehouses.warehouseId, warehouseId),
      ),
    )
    .limit(1);

  if (!warehouse) redirect("/warehouses");

  return { employee, warehouse, warehouseId };
}

/**
 * For the inbound *management* pages (purchase orders, dock bookings,
 * unloading, putaway task queues) -- the admin/supervisor view over the
 * whole operation, as opposed to `/floor`, which is what a worker actually
 * executing one task uses.
 *
 * Gated on `canAssignTasks` rather than any single task-type permission:
 * it's the capability that already means "directs floor work" everywhere
 * else in this codebase (assigning a task to someone else, cancelling a
 * task, reporting someone else's live-map position). A Receiving Clerk with
 * `canBook`/`canUnload` can execute tasks but has no business seeing every
 * other supplier's pricing or reassigning a colleague's work -- that's a
 * different job. Redirects to `/floor` rather than erroring, since landing
 * on the worker view is the actually-useful outcome of a floor worker
 * following an old bookmark or a manager's shared link.
 */
export async function requireInboundManagerAccess(warehouseIdParam: string) {
  const access = await requireWarehouseAccess(warehouseIdParam);
  if (access.employee.canAssignTasks !== true) {
    redirect(`/warehouses/${access.warehouseId}/floor`);
  }
  return access;
}

/**
 * Outbound counterpart of `requireInboundManagerAccess` -- the management
 * view over sales orders, picking queues and shipments (customer names,
 * order values, reassigning other people's picks), as opposed to `/floor`,
 * where a picker executes one task. Same `canAssignTasks` gate and the same
 * redirect-to-floor behaviour, for the same reasons.
 */
export async function requireOutboundManagerAccess(warehouseIdParam: string) {
  const access = await requireWarehouseAccess(warehouseIdParam);
  if (access.employee.canAssignTasks !== true) {
    redirect(`/warehouses/${access.warehouseId}/floor`);
  }
  return access;
}

/**
 * Internal operations management -- replenishment planning and cycle-count
 * programmes, which decide what work the floor is given rather than doing
 * it. Same `canAssignTasks` gate and redirect as the inbound/outbound
 * manager views, for the same reasons.
 */
export async function requireInternalManagerAccess(warehouseIdParam: string) {
  const access = await requireWarehouseAccess(warehouseIdParam);
  if (access.employee.canAssignTasks !== true) {
    redirect(`/warehouses/${access.warehouseId}/floor`);
  }
  return access;
}

export type InventoryActionContext = {
  employee: NonNullable<Awaited<ReturnType<typeof loadEmployee>>>;
  warehouseId: number;
};

/**
 * For server actions. Returns a discriminated result instead of redirecting so
 * callers can surface the message in the dialog that triggered the action.
 * `requireModifyInventory` additionally enforces the canModifyInventory
 * permission -- read paths don't need it, write paths always do.
 */
export async function requireWarehouseActionAccess(
  warehouseIdInput: FormDataEntryValue | null,
  options: {
    requireModifyInventory?: boolean;
    requireBook?: boolean;
    requireUnload?: boolean;
    requireAssignTasks?: boolean;
    requirePick?: boolean;
    requireLoad?: boolean;
    requireReleaseOrders?: boolean;
    requireVoidShipments?: boolean;
    requireReplenish?: boolean;
    requireForceRecount?: boolean;
    requireManageUsers?: boolean;
  } = {},
): Promise<
  { ok: true; context: InventoryActionContext } | { ok: false; error: string }
> {
  const warehouseId = parseWarehouseId(String(warehouseIdInput ?? ""));
  if (warehouseId === null) {
    return { ok: false, error: "Invalid warehouse." };
  }

  const employee = await loadEmployee();
  if (!employee) {
    return { ok: false, error: "Unauthorized" };
  }

  const [warehouse] = await db
    .select({ warehouseId: warehouses.warehouseId })
    .from(warehouses)
    .where(
      and(
        eq(warehouses.organizationId, employee.organizationId),
        eq(warehouses.warehouseId, warehouseId),
      ),
    )
    .limit(1);

  if (!warehouse) {
    return { ok: false, error: "Warehouse not found for your organization." };
  }

  if (options.requireModifyInventory && employee.canModifyInventory !== true) {
    return {
      ok: false,
      error: "You do not have permission to modify inventory.",
    };
  }
  if (options.requireBook && employee.canBook !== true) {
    return {
      ok: false,
      error: "You do not have permission to book dock appointments.",
    };
  }
  if (options.requireUnload && employee.canUnload !== true) {
    return {
      ok: false,
      error: "You do not have permission to unload deliveries.",
    };
  }
  if (options.requireAssignTasks && employee.canAssignTasks !== true) {
    return {
      ok: false,
      error: "You do not have permission to assign or cancel tasks.",
    };
  }
  if (options.requirePick && employee.canPick !== true) {
    return { ok: false, error: "You do not have permission to pick orders." };
  }
  if (options.requireLoad && employee.canLoad !== true) {
    return { ok: false, error: "You do not have permission to load trailers." };
  }
  if (options.requireReleaseOrders && employee.canReleaseOrders !== true) {
    return {
      ok: false,
      error: "You do not have permission to release orders to the floor.",
    };
  }
  if (options.requireVoidShipments && employee.canVoidShipments !== true) {
    return { ok: false, error: "You do not have permission to void shipments." };
  }
  if (options.requireReplenish && employee.canReplenish !== true) {
    return { ok: false, error: "You do not have permission to replenish pick faces." };
  }
  if (options.requireForceRecount && employee.canForceRecount !== true) {
    return {
      ok: false,
      error: "You do not have permission to override a stock count.",
    };
  }
  if (options.requireManageUsers && employee.canManageUsers !== true) {
    return {
      ok: false,
      error: "You do not have permission to edit other people's records.",
    };
  }

  return { ok: true, context: { employee, warehouseId } };
}
