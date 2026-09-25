import "server-only";

import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  cycleCountTasks,
  employees,
  inventory,
  locations,
  pallets,
  putawayTasks,
  salesOrders,
  shipmentSalesOrders,
  shipments,
  stockMovements,
  taskStatuses,
  tasks,
  taskTypes,
  timeClockEntries,
} from "@/drizzle/schema";
import {
  summariseDurations,
  tasksPerHour,
  type DurationSummary,
} from "./kpi";

/**
 * Every timestamp in this schema is `timestamp without time zone`, so the
 * window boundary has to be `localtimestamp` rather than `now()`. Using
 * `now()` would compare a naive column against a zone-aware value and silently
 * shift the window by the server's UTC offset. Doing the arithmetic in the
 * database also means the boundary comes from one clock -- the app server's
 * idea of "now" never enters into it.
 */
/**
 * Location types that are supposed to hold stock. Dock doors and staging
 * lanes are excluded from occupancy on purpose -- they are meant to be empty,
 * so counting them drags the number down for a reason nobody can act on.
 */
const STORAGE_LOCATION_TYPES = ["RACKING", "SHELF", "FLOOR", "BULK"];

function windowStart(days: number) {
  // An interval literal cannot be a bind parameter, so this is the one place
  // a value reaches SQL as text. Every caller currently passes a whitelisted
  // constant, but this module is exported and the next caller might not, so
  // the coercion happens here rather than on trust.
  const safeDays = Math.trunc(Number(days));
  if (!Number.isFinite(safeDays) || safeDays < 1 || safeDays > 3650) {
    throw new Error(`metrics window out of range: ${days}`);
  }
  return sql`localtimestamp - ${sql.raw(`interval '${safeDays} days'`)}`;
}

/** Minutes between two naive timestamp columns, as a float. */
function minutesBetween(from: AnyPgColumn, to: AnyPgColumn) {
  return sql`extract(epoch from (${to} - ${from})) / 60.0`;
}

export type TaskFlowRow = {
  typeCode: string;
  completed: number;
  open: number;
  medianWorkMinutes: number | null;
  p90WorkMinutes: number | null;
  medianWaitMinutes: number | null;
  impossibleDurations: number;
};

/**
 * Per task type: how much got done, how much is still queued, how long the
 * work itself took, and how long it sat before anyone started it.
 *
 * Work time and wait time are kept apart on purpose. A putaway that takes four
 * minutes but waits six hours for a driver is a labour-planning problem; one
 * that starts immediately and takes six hours is a layout problem. A single
 * "cycle time" number cannot tell you which you have.
 *
 * Aggregation happens in SQL rather than over fetched rows because this table
 * grows without bound -- a year-old warehouse has millions of tasks and there
 * is no reason to move them across the wire to take a median.
 */
export async function loadTaskFlow(
  warehouseId: number,
  days: number,
): Promise<TaskFlowRow[]> {
  const since = windowStart(days);
  const work = minutesBetween(tasks.startedAt, tasks.completedAt);
  const wait = minutesBetween(tasks.createdAt, tasks.startedAt);

  const completedInWindow = sql`${taskStatuses.code} = 'COMPLETED' and ${tasks.completedAt} >= ${since}`;
  const sane = sql`${tasks.startedAt} is not null and ${tasks.completedAt} >= ${tasks.startedAt}`;

  const rows = await db
    .select({
      typeCode: taskTypes.code,
      completed: sql<number>`count(*) filter (where ${completedInWindow})::int`,
      open: sql<number>`count(*) filter (where ${taskStatuses.code} in ('PENDING','IN_PROGRESS'))::int`,
      medianWorkMinutes: sql<
        number | null
      >`percentile_cont(0.5) within group (order by ${work}) filter (where ${completedInWindow} and ${sane})`,
      p90WorkMinutes: sql<
        number | null
      >`percentile_cont(0.9) within group (order by ${work}) filter (where ${completedInWindow} and ${sane})`,
      medianWaitMinutes: sql<
        number | null
      >`percentile_cont(0.5) within group (order by ${wait}) filter (where ${tasks.startedAt} >= ${tasks.createdAt} and ${tasks.startedAt} >= ${since})`,
      impossibleDurations: sql<number>`count(*) filter (where ${completedInWindow} and ${tasks.startedAt} is not null and ${tasks.completedAt} < ${tasks.startedAt})::int`,
    })
    .from(tasks)
    .innerJoin(taskTypes, eq(tasks.taskTypeId, taskTypes.taskTypeId))
    .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
    .where(eq(tasks.warehouseId, warehouseId))
    .groupBy(taskTypes.code)
    .orderBy(taskTypes.code);

  return rows.map((r) => ({
    typeCode: r.typeCode,
    completed: Number(r.completed),
    open: Number(r.open),
    medianWorkMinutes: numOrNull(r.medianWorkMinutes),
    p90WorkMinutes: numOrNull(r.p90WorkMinutes),
    medianWaitMinutes: numOrNull(r.medianWaitMinutes),
    impossibleDurations: Number(r.impossibleDurations),
  }));
}

/** Postgres returns numerics as strings through this driver. */
function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export type DailyCompletion = { day: string; typeCode: string; completed: number };

export async function loadDailyCompletions(
  warehouseId: number,
  days: number,
): Promise<DailyCompletion[]> {
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${tasks.completedAt}), 'YYYY-MM-DD')`,
      typeCode: taskTypes.code,
      completed: sql<number>`count(*)::int`,
    })
    .from(tasks)
    .innerJoin(taskTypes, eq(tasks.taskTypeId, taskTypes.taskTypeId))
    .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
    .where(
      and(
        eq(tasks.warehouseId, warehouseId),
        eq(taskStatuses.code, "COMPLETED"),
        isNotNull(tasks.completedAt),
        gte(tasks.completedAt, windowStart(days)),
      ),
    )
    .groupBy(sql`1`, taskTypes.code)
    .orderBy(sql`1`);

  return rows.map((r) => ({
    day: r.day,
    typeCode: r.typeCode,
    completed: Number(r.completed),
  }));
}

export type LabourRow = {
  employeeId: number;
  name: string;
  completed: number;
  clockedMinutes: number;
  tasksPerHour: number | null;
};

/**
 * Tasks completed against hours actually clocked.
 *
 * Only closed shifts count towards the denominator: an open shift has no
 * length yet, and guessing one by using the current time would make everyone
 * currently on shift look progressively less productive as the day wore on.
 * Someone who completed work but has no closed shift in the window therefore
 * shows a rate of `--`, not a huge number.
 */
export async function loadLabour(
  warehouseId: number,
  days: number,
): Promise<LabourRow[]> {
  const since = windowStart(days);

  const [completions, shiftRows] = await Promise.all([
    db
      .select({
        employeeId: tasks.assignedEmployeeId,
        firstName: employees.firstName,
        lastName: employees.lastName,
        completed: sql<number>`count(*)::int`,
      })
      .from(tasks)
      .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
      .innerJoin(employees, eq(tasks.assignedEmployeeId, employees.employeeId))
      .where(
        and(
          eq(tasks.warehouseId, warehouseId),
          eq(taskStatuses.code, "COMPLETED"),
          isNotNull(tasks.completedAt),
          gte(tasks.completedAt, since),
        ),
      )
      .groupBy(tasks.assignedEmployeeId, employees.firstName, employees.lastName),
    db
      .select({
        employeeId: timeClockEntries.employeeId,
        firstName: employees.firstName,
        lastName: employees.lastName,
        clockedMinutes: sql<number>`coalesce(sum(
          extract(epoch from (${timeClockEntries.clockOutAt} - ${timeClockEntries.clockInAt})) / 60.0
          - coalesce(${timeClockEntries.breakMinutes}, 0)
        ), 0)`,
      })
      .from(timeClockEntries)
      .innerJoin(employees, eq(timeClockEntries.employeeId, employees.employeeId))
      .where(
        and(
          eq(timeClockEntries.warehouseId, warehouseId),
          isNotNull(timeClockEntries.clockOutAt),
          gte(timeClockEntries.clockInAt, since),
        ),
      )
      .groupBy(timeClockEntries.employeeId, employees.firstName, employees.lastName),
  ]);

  const byEmployee = new Map<number, LabourRow>();
  const name = (first: string | null, last: string | null, id: number) =>
    [first, last].filter(Boolean).join(" ") || `#${id}`;

  for (const row of completions) {
    if (row.employeeId === null) continue;
    byEmployee.set(row.employeeId, {
      employeeId: row.employeeId,
      name: name(row.firstName, row.lastName, row.employeeId),
      completed: Number(row.completed),
      clockedMinutes: 0,
      tasksPerHour: null,
    });
  }
  for (const row of shiftRows) {
    if (row.employeeId === null) continue;
    const existing = byEmployee.get(row.employeeId);
    const minutes = Math.max(0, Number(row.clockedMinutes) || 0);
    if (existing) existing.clockedMinutes = minutes;
    else
      byEmployee.set(row.employeeId, {
        employeeId: row.employeeId,
        name: name(row.firstName, row.lastName, row.employeeId),
        completed: 0,
        clockedMinutes: minutes,
        tasksPerHour: null,
      });
  }

  const out = [...byEmployee.values()];
  for (const row of out) {
    row.tasksPerHour = tasksPerHour(row.completed, row.clockedMinutes);
  }
  return out.sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name));
}

/**
 * Dock to stock: from the moment a pallet was booked in at the door to the
 * moment its putaway task closed.
 *
 * `pallets.created_at` is when receiving first produced the LPN, and
 * `putaway_tasks.lpn_id` is the only real join between the two halves of
 * inbound -- there is no receipt id threaded through. That makes this the
 * honest definition available, and it is also the one a floor manager means.
 */
export async function loadDockToStock(
  warehouseId: number,
  days: number,
): Promise<DurationSummary> {
  const rows = await db
    .select({
      minutes: sql<
        string | null
      >`extract(epoch from (${tasks.completedAt} - ${pallets.createdAt})) / 60.0`,
    })
    .from(putawayTasks)
    .innerJoin(tasks, eq(putawayTasks.taskId, tasks.taskId))
    .innerJoin(pallets, eq(putawayTasks.lpnId, pallets.lpnId))
    .where(
      and(
        eq(tasks.warehouseId, warehouseId),
        isNotNull(tasks.completedAt),
        isNotNull(pallets.createdAt),
        gte(tasks.completedAt, windowStart(days)),
      ),
    );

  return summariseDurations(rows.map((r) => Number(r.minutes)));
}

/**
 * Order to dispatch: sales order raised to the trailer leaving.
 *
 * Only orders that actually shipped are in the sample -- an order still
 * sitting in the building has no lead time yet, and counting its age so far
 * would blend "slow" with "unfinished".
 */
export async function loadOrderLeadTime(
  warehouseId: number,
  days: number,
): Promise<DurationSummary> {
  const rows = await db
    .select({
      minutes: sql<
        string | null
      >`extract(epoch from (${shipments.dispatchedAt} - ${salesOrders.createdAt})) / 60.0`,
    })
    .from(salesOrders)
    .innerJoin(shipmentSalesOrders, eq(shipmentSalesOrders.soId, salesOrders.soId))
    .innerJoin(shipments, eq(shipments.shipmentId, shipmentSalesOrders.shipmentId))
    .where(
      and(
        eq(salesOrders.warehouseId, warehouseId),
        isNotNull(shipments.dispatchedAt),
        gte(shipments.dispatchedAt, windowStart(days)),
      ),
    );

  return summariseDurations(rows.map((r) => Number(r.minutes)));
}

export type AccuracyStats = {
  counted: number;
  matched: number;
  unitsOver: number;
  unitsShort: number;
};

/**
 * Inventory accuracy from cycle counts, measured by location-line rather than
 * by unit -- the industry convention, and the one that punishes a wrong bin
 * whether it was out by one carton or a hundred.
 */
export async function loadInventoryAccuracy(
  warehouseId: number,
  days: number,
): Promise<AccuracyStats> {
  const [row] = await db
    .select({
      counted: sql<number>`count(*)::int`,
      matched: sql<number>`count(*) filter (where ${cycleCountTasks.countedQuantity} = ${cycleCountTasks.expectedQuantity})::int`,
      unitsOver: sql<number>`coalesce(sum(greatest(${cycleCountTasks.countedQuantity} - ${cycleCountTasks.expectedQuantity}, 0)), 0)::int`,
      unitsShort: sql<number>`coalesce(sum(greatest(${cycleCountTasks.expectedQuantity} - ${cycleCountTasks.countedQuantity}, 0)), 0)::int`,
    })
    .from(cycleCountTasks)
    .innerJoin(tasks, eq(cycleCountTasks.taskId, tasks.taskId))
    .where(
      and(
        eq(tasks.warehouseId, warehouseId),
        isNotNull(cycleCountTasks.countedQuantity),
        isNotNull(tasks.completedAt),
        gte(tasks.completedAt, windowStart(days)),
      ),
    );

  return {
    counted: Number(row?.counted ?? 0),
    matched: Number(row?.matched ?? 0),
    unitsOver: Number(row?.unitsOver ?? 0),
    unitsShort: Number(row?.unitsShort ?? 0),
  };
}

export type FunnelStage = { status: string; orders: number };

export async function loadOrderFunnel(
  warehouseId: number,
  days: number,
): Promise<FunnelStage[]> {
  const rows = await db
    .select({
      status: salesOrders.status,
      orders: sql<number>`count(*)::int`,
    })
    .from(salesOrders)
    .where(
      and(
        eq(salesOrders.warehouseId, warehouseId),
        gte(salesOrders.createdAt, windowStart(days)),
      ),
    )
    .groupBy(salesOrders.status);

  return rows.map((r) => ({ status: r.status ?? "UNKNOWN", orders: Number(r.orders) }));
}

export type ThroughputStats = { received: number; picked: number; adjusted: number };

/** Units moved in the window, by what moved them. */
export async function loadUnitThroughput(
  warehouseId: number,
  days: number,
): Promise<ThroughputStats> {
  const rows = await db
    .select({
      movementType: stockMovements.movementType,
      units: sql<number>`coalesce(sum(abs(${stockMovements.quantity})), 0)::int`,
    })
    .from(stockMovements)
    .innerJoin(
      locations,
      sql`${locations.locationId} = coalesce(${stockMovements.destinationLocationId}, ${stockMovements.sourceLocationId})`,
    )
    .where(
      and(
        eq(locations.warehouseId, warehouseId),
        gte(stockMovements.createdAt, windowStart(days)),
      ),
    )
    .groupBy(stockMovements.movementType);

  const byType = new Map(rows.map((r) => [r.movementType, Number(r.units)]));
  return {
    received: byType.get("RECEIPT") ?? 0,
    picked: byType.get("PICK") ?? 0,
    adjusted:
      (byType.get("ADJUSTMENT_IN") ?? 0) + (byType.get("ADJUSTMENT_OUT") ?? 0),
  };
}

export type CapacityStats = {
  storageLocations: number;
  occupied: number;
  blocked: number;
  occupancy: number | null;
};

/**
 * A now-fact, not a windowed one: how full the building is today. Dock doors
 * and staging lanes are excluded because they are meant to be empty, and
 * counting them drags occupancy down for a reason nobody can act on.
 */
export async function loadCapacity(warehouseId: number): Promise<CapacityStats> {
  const occupiedLocations = db
    .select({ locationId: inventory.locationId })
    .from(inventory)
    .where(sql`${inventory.quantity} > 0`);

  const [row] = await db
    .select({
      storageLocations: sql<number>`count(*)::int`,
      occupied: sql<number>`count(*) filter (where ${locations.locationId} in ${occupiedLocations})::int`,
      blocked: sql<number>`count(*) filter (where ${locations.isBlocked})::int`,
    })
    .from(locations)
    .where(
      and(
        eq(locations.warehouseId, warehouseId),
        inArray(locations.locationType, STORAGE_LOCATION_TYPES),
      ),
    );

  const storageLocations = Number(row?.storageLocations ?? 0);
  const occupied = Number(row?.occupied ?? 0);
  return {
    storageLocations,
    occupied,
    blocked: Number(row?.blocked ?? 0),
    occupancy: storageLocations > 0 ? occupied / storageLocations : null,
  };
}
