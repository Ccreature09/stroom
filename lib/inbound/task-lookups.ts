import "server-only";

import { db } from "@/lib/db";
import { taskStatuses, taskTypes } from "@/drizzle/schema";

/**
 * `task_statuses` and `task_types` are global lookup tables (no
 * organization/warehouse scoping, a bare unique `code`) that the schema has
 * carried since the original baseline but nothing has ever written to --
 * every task-subtype table (`booking_tasks`, `unloading_tasks`,
 * `putaway_tasks`, ...) has existed with no UI in front of it. Seeding them
 * with a migration would be the more usual move in this codebase (see
 * `feature_kinds`), but a migration is schema *and* deploy risk for two rows
 * of static data; upserting them here, idempotently, on first use costs
 * nothing extra after the first call and needs no deploy step of its own.
 */

export const TASK_STATUS_CODES = [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;
export type TaskStatusCode = (typeof TASK_STATUS_CODES)[number];

const TASK_STATUS_SEED: Record<TaskStatusCode, string> = {
  PENDING: "Not yet started",
  IN_PROGRESS: "Being worked",
  COMPLETED: "Finished",
  CANCELLED: "Voided before completion",
};

// Every task-subtype table this schema already defines gets a code, even
// though only booking/unloading/putaway have a module built on them yet --
// seeding the rest now means the next module doesn't have to touch this file.
export const TASK_TYPE_CODES = [
  "BOOKING",
  "UNLOADING",
  "PUTAWAY",
  "PICKING",
  "LOADING",
  "REPLENISHMENT",
  "CYCLE_COUNT",
  "VAS",
] as const;
export type TaskTypeCode = (typeof TASK_TYPE_CODES)[number];

const TASK_TYPE_SEED: Record<TaskTypeCode, string> = {
  BOOKING: "Dock appointment booking",
  UNLOADING: "Unload an inbound trailer",
  PUTAWAY: "Move received stock to its storage location",
  PICKING: "Pick stock for an outbound order",
  LOADING: "Load an outbound trailer",
  REPLENISHMENT: "Move stock to a pick face",
  CYCLE_COUNT: "Count stock at a location",
  VAS: "Value-added services on a picked order (packing, labelling, kitting)",
};

export type TaskLookups = {
  statusIdByCode: Record<TaskStatusCode, number>;
  typeIdByCode: Record<TaskTypeCode, number>;
};

let cached: TaskLookups | null = null;

/**
 * Ensures the fixed set of statuses/types exist, then returns their ids.
 * Cached per process after the first call -- these never change at runtime,
 * so there is nothing to invalidate.
 */
export async function getTaskLookups(): Promise<TaskLookups> {
  if (cached) return cached;

  await db
    .insert(taskStatuses)
    .values(
      TASK_STATUS_CODES.map((code) => ({
        code,
        description: TASK_STATUS_SEED[code],
      })),
    )
    .onConflictDoNothing({ target: taskStatuses.code });

  await db
    .insert(taskTypes)
    .values(
      TASK_TYPE_CODES.map((code) => ({
        code,
        description: TASK_TYPE_SEED[code],
      })),
    )
    .onConflictDoNothing({ target: taskTypes.code });

  const [statusRows, typeRows] = await Promise.all([
    db.select({ id: taskStatuses.statusId, code: taskStatuses.code }).from(
      taskStatuses,
    ),
    db.select({ id: taskTypes.taskTypeId, code: taskTypes.code }).from(
      taskTypes,
    ),
  ]);

  const statusIdByCode = Object.fromEntries(
    statusRows.map((r) => [r.code, r.id]),
  ) as Record<TaskStatusCode, number>;
  const typeIdByCode = Object.fromEntries(
    typeRows.map((r) => [r.code, r.id]),
  ) as Record<TaskTypeCode, number>;

  cached = { statusIdByCode, typeIdByCode };
  return cached;
}
