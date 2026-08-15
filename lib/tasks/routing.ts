import "server-only";

import { and, eq, exists, inArray, notExists, or, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  departments,
  employeeDepartments,
  taskEligibleDepartments,
  taskRoutingRules,
  taskTypes,
  tasks,
} from "@/drizzle/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = typeof db | Tx;

/**
 * Task routing by department.
 *
 * A task carries zero or more eligible departments. Zero means "anyone with
 * the right permission" -- the absence of a restriction is not the same as a
 * restriction to nothing, and treating an untagged task as invisible would
 * silently strand every task created before this existed.
 */

/** The departments an employee belongs to. */
export async function loadEmployeeDepartmentIds(
  employeeId: number,
): Promise<number[]> {
  const rows = await db
    .select({ departmentId: employeeDepartments.departmentId })
    .from(employeeDepartments)
    .where(eq(employeeDepartments.employeeId, employeeId));
  return rows.map((r) => r.departmentId);
}

/**
 * Whether this employee should see a given task on their own task list.
 *
 * Three ways in, in priority order:
 *
 *  1. **It is assigned to them.** A supervisor handing you a job overrides
 *     any routing rule -- otherwise assigning across departments would
 *     silently produce a task nobody can see, which is far worse than a
 *     task in the wrong queue.
 *  2. **It is unrestricted.** No eligibility rows means open to anyone with
 *     the permission, which is how every task behaved before routing.
 *  3. **It is routed to a department they are in.**
 *
 * Returned as a composable predicate rather than applied here, because each
 * floor query already has its own type/status/warehouse conditions and this
 * has to `and` into them.
 */
export function taskRoutingFilter(
  employeeId: number,
  departmentIds: number[],
): SQL | undefined {
  const assignedToMe = eq(tasks.assignedEmployeeId, employeeId);

  const unrestricted = notExists(
    db
      .select({ taskId: taskEligibleDepartments.taskId })
      .from(taskEligibleDepartments)
      .where(eq(taskEligibleDepartments.taskId, tasks.taskId)),
  );

  if (departmentIds.length === 0) {
    // Someone in no department sees their own work and anything unrouted.
    return or(assignedToMe, unrestricted);
  }

  const routedToMyDepartment = exists(
    db
      .select({ taskId: taskEligibleDepartments.taskId })
      .from(taskEligibleDepartments)
      .where(
        and(
          eq(taskEligibleDepartments.taskId, tasks.taskId),
          inArray(taskEligibleDepartments.departmentId, departmentIds),
        ),
      ),
  );

  return or(assignedToMe, unrestricted, routedToMyDepartment);
}

/**
 * Replaces a task's eligible departments.
 *
 * Delete-then-insert rather than a diff: the set is tiny, the table is a
 * pure join with a composite primary key and nothing else worth preserving,
 * and "these are the departments now" is much easier to reason about than a
 * partial update.
 */
export async function setTaskDepartments(
  tx: DbOrTx,
  taskId: string,
  departmentIds: number[],
): Promise<void> {
  await tx
    .delete(taskEligibleDepartments)
    .where(eq(taskEligibleDepartments.taskId, taskId));

  const unique = [...new Set(departmentIds)].filter(
    (id) => Number.isInteger(id) && id > 0,
  );
  if (unique.length === 0) return;

  await tx
    .insert(taskEligibleDepartments)
    .values(unique.map((departmentId) => ({ taskId, departmentId })));
}

/**
 * Confirms every id is a real, active department of this warehouse before it
 * is written onto a task -- department ids arrive from the client, and
 * routing a task to another warehouse's department would make it invisible
 * to everyone here.
 */
export async function validateDepartmentIds(
  warehouseId: number,
  departmentIds: number[],
): Promise<{ ok: true; ids: number[] } | { ok: false; error: string }> {
  const unique = [...new Set(departmentIds)].filter(
    (id) => Number.isInteger(id) && id > 0,
  );
  if (unique.length === 0) return { ok: true, ids: [] };

  const rows = await db
    .select({ departmentId: departments.departmentId })
    .from(departments)
    .where(
      and(
        inArray(departments.departmentId, unique),
        eq(departments.warehouseId, warehouseId),
        eq(departments.isActive, true),
      ),
    );
  if (rows.length !== unique.length) {
    return { ok: false, error: "One or more departments are not valid for this warehouse." };
  }
  return { ok: true, ids: unique };
}

export type TaskDepartment = { departmentId: number; departmentName: string };

/**
 * Eligible departments for a batch of tasks, for display in manager queues.
 * Batched deliberately: a queue renders hundreds of rows and one query per
 * row is the classic way to make a list page slow.
 */
export async function loadTaskDepartments(
  taskIds: string[],
): Promise<Map<string, TaskDepartment[]>> {
  const result = new Map<string, TaskDepartment[]>();
  if (taskIds.length === 0) return result;

  const rows = await db
    .select({
      taskId: taskEligibleDepartments.taskId,
      departmentId: departments.departmentId,
      departmentName: departments.departmentName,
    })
    .from(taskEligibleDepartments)
    .innerJoin(
      departments,
      eq(taskEligibleDepartments.departmentId, departments.departmentId),
    )
    .where(inArray(taskEligibleDepartments.taskId, taskIds))
    .orderBy(departments.departmentName);

  for (const row of rows) {
    const list = result.get(row.taskId) ?? [];
    list.push({ departmentId: row.departmentId, departmentName: row.departmentName });
    result.set(row.taskId, list);
  }
  return result;
}

/** Active departments of a warehouse, for the routing pickers. */
export async function listWarehouseDepartments(
  warehouseId: number,
): Promise<TaskDepartment[]> {
  const rows = await db
    .select({
      departmentId: departments.departmentId,
      departmentName: departments.departmentName,
    })
    .from(departments)
    .where(
      and(eq(departments.warehouseId, warehouseId), eq(departments.isActive, true)),
    )
    .orderBy(departments.departmentName);
  return rows;
}

/**
 * The standing rule for where this kind of work goes in this warehouse.
 *
 * Returns an empty list when no rule is configured, which correctly means
 * "unrestricted" -- the same thing an untagged task has always meant.
 */
export async function loadRoutingRuleDepartments(
  tx: DbOrTx,
  warehouseId: number,
  typeCode: string,
): Promise<number[]> {
  const rows = await tx
    .select({ departmentId: taskRoutingRules.departmentId })
    .from(taskRoutingRules)
    .innerJoin(taskTypes, eq(taskRoutingRules.taskTypeId, taskTypes.taskTypeId))
    .where(
      and(
        eq(taskRoutingRules.warehouseId, warehouseId),
        eq(taskTypes.code, typeCode),
        eq(taskRoutingRules.isActive, true),
      ),
    );
  return rows.map((r) => r.departmentId);
}

/**
 * What a newly created task should be routed to.
 *
 * An explicit choice always wins; the rule is the default for when none was
 * made. That ordering is the whole point -- a policy that could not be
 * overridden on the day would be worse than no policy, because the one time
 * you need to send a job to a different team is exactly when the standing
 * rule is wrong.
 *
 * Note the deliberate consequence: there is no way to say "explicitly
 * unrestricted" on a task type that has a rule, because an empty selection
 * is indistinguishable from an absent one in an HTML form. Clearing the
 * routing after creation (the queue editor) is the escape hatch.
 */
export async function resolveTaskDepartments(
  tx: DbOrTx,
  warehouseId: number,
  typeCode: string,
  explicitIds: number[] | undefined,
): Promise<number[]> {
  if (explicitIds && explicitIds.length > 0) return explicitIds;
  return loadRoutingRuleDepartments(tx, warehouseId, typeCode);
}

/** Parses the comma-separated `departmentIds` field the dialogs submit. */
export function parseDepartmentIds(value: FormDataEntryValue | null): number[] {
  if (value === null) return [];
  return String(value)
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}
