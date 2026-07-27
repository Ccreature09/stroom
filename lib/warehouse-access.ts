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
  options: { requireModifyInventory?: boolean } = {},
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

  return { ok: true, context: { employee, warehouseId } };
}
