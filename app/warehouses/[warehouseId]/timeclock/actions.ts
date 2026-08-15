"use server";

import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { timeClockEntries } from "@/drizzle/schema";
import { requireWarehouseActionAccess } from "@/lib/warehouse-access";
import { shiftsOverlap, validateShift } from "@/lib/timeclock/shift";

/** How the entry was recorded -- self-service in the app vs. a supervisor
 *  correcting the record afterwards. Mirrors the honesty of the live map's
 *  position `source`: the two are not the same evidence. */
const SOURCE_WEB = "WEB";
const SOURCE_MANUAL = "MANUAL";

function parsePositiveInt(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const parsed = Number(String(value).trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseNonNegativeInt(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseTimestamp(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  // <input type="datetime-local"> gives "YYYY-MM-DDTHH:mm"; the column is a
  // naive timestamp, so it is stored as given rather than shifted through a
  // timezone that would silently move everyone's hours.
  return Number.isFinite(Date.parse(raw)) ? raw.replace("T", " ") : null;
}

function revalidateTimeclock(warehouseId: number) {
  revalidatePath(`/warehouses/${warehouseId}/timeclock`);
  revalidatePath(`/warehouses/${warehouseId}/floor`);
}

/** The caller's currently-open shift in this warehouse, if any. */
async function findOpenShift(employeeId: number, warehouseId: number) {
  const [row] = await db
    .select({
      timeClockId: timeClockEntries.timeClockId,
      clockInAt: timeClockEntries.clockInAt,
      breakMinutes: timeClockEntries.breakMinutes,
    })
    .from(timeClockEntries)
    .where(
      and(
        eq(timeClockEntries.employeeId, employeeId),
        eq(timeClockEntries.warehouseId, warehouseId),
        isNull(timeClockEntries.clockOutAt),
      ),
    )
    .orderBy(desc(timeClockEntries.clockInAt))
    .limit(1);
  return row ?? null;
}

/**
 * Starts a shift for the caller.
 *
 * Self-service only, and deliberately needs no special permission -- every
 * employee clocks in, and gating that behind a capability would mean the
 * people who most need it could not use it. Clocking *someone else* in is a
 * different act entirely and lives in `adjustEntry` behind `canManageUsers`.
 */
export async function clockIn(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"));
  if (!access.ok) return { error: access.error };
  const { employee, warehouseId } = access.context;

  const existing = await findOpenShift(employee.employeeId, warehouseId);
  if (existing) {
    return { error: "You are already clocked in. Clock out before starting a new shift." };
  }

  await db.insert(timeClockEntries).values({
    employeeId: employee.employeeId,
    warehouseId,
    clockInAt: new Date().toISOString().slice(0, 19).replace("T", " "),
    breakMinutes: 0,
    source: SOURCE_WEB,
  });

  revalidateTimeclock(warehouseId);
  return { success: true };
}

/** Ends the caller's open shift, recording any break taken. */
export async function clockOut(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"));
  if (!access.ok) return { error: access.error };
  const { employee, warehouseId } = access.context;

  const breakMinutes = parseNonNegativeInt(formData.get("breakMinutes"));
  if (breakMinutes === null) {
    return { error: "Break minutes must be zero or a positive whole number." };
  }

  const open = await findOpenShift(employee.employeeId, warehouseId);
  if (!open) return { error: "You are not clocked in." };

  const clockOutAt = new Date().toISOString().slice(0, 19).replace("T", " ");
  const check = validateShift(open.clockInAt, clockOutAt, breakMinutes);
  if (!check.ok) return { error: check.error };

  await db
    .update(timeClockEntries)
    .set({ clockOutAt, breakMinutes })
    .where(eq(timeClockEntries.timeClockId, open.timeClockId));

  revalidateTimeclock(warehouseId);
  return { success: true };
}

/**
 * Supervisor correction of a timesheet entry.
 *
 * Stamps `edited_by_employee_id` so a corrected entry is never mistaken for
 * what the worker actually recorded -- that column exists precisely because
 * "someone changed my hours" needs to be answerable. The source flips to
 * MANUAL for the same reason.
 *
 * Rejects an edit that would overlap another of that employee's shifts:
 * two open shifts, or two overlapping closed ones, mean somebody is being
 * paid twice for the same hour.
 */
export async function adjustEntry(formData: FormData) {
  const access = await requireWarehouseActionAccess(formData.get("warehouseId"), {
    requireManageUsers: true,
  });
  if (!access.ok) return { error: access.error };
  const { employee, warehouseId } = access.context;

  const timeClockId = parsePositiveInt(formData.get("timeClockId"));
  const clockInAt = parseTimestamp(formData.get("clockInAt"));
  const clockOutAtRaw = String(formData.get("clockOutAt") ?? "").trim();
  const clockOutAt = clockOutAtRaw ? parseTimestamp(formData.get("clockOutAt")) : null;
  const breakMinutes = parseNonNegativeInt(formData.get("breakMinutes"));

  if (!timeClockId) return { error: "Invalid entry." };
  if (!clockInAt) return { error: "Enter a valid clock-in time." };
  if (clockOutAtRaw && !clockOutAt) return { error: "Enter a valid clock-out time." };
  if (breakMinutes === null) {
    return { error: "Break minutes must be zero or a positive whole number." };
  }

  const check = validateShift(clockInAt, clockOutAt, breakMinutes);
  if (!check.ok) return { error: check.error };

  const [entry] = await db
    .select({
      timeClockId: timeClockEntries.timeClockId,
      employeeId: timeClockEntries.employeeId,
    })
    .from(timeClockEntries)
    .where(
      and(
        eq(timeClockEntries.timeClockId, timeClockId),
        eq(timeClockEntries.warehouseId, warehouseId),
      ),
    )
    .limit(1);
  if (!entry || entry.employeeId === null) {
    return { error: "Entry not found in this warehouse." };
  }

  const siblings = await db
    .select({
      clockInAt: timeClockEntries.clockInAt,
      clockOutAt: timeClockEntries.clockOutAt,
    })
    .from(timeClockEntries)
    .where(
      and(
        eq(timeClockEntries.employeeId, entry.employeeId),
        eq(timeClockEntries.warehouseId, warehouseId),
        ne(timeClockEntries.timeClockId, timeClockId),
      ),
    );

  const clash = siblings.find((s) => shiftsOverlap({ clockInAt, clockOutAt }, s));
  if (clash) {
    return {
      error: `That overlaps another shift starting ${clash.clockInAt.slice(0, 16).replace("T", " ")}.`,
    };
  }

  await db
    .update(timeClockEntries)
    .set({
      clockInAt,
      clockOutAt,
      breakMinutes,
      source: SOURCE_MANUAL,
      editedByEmployeeId: employee.employeeId,
    })
    .where(eq(timeClockEntries.timeClockId, timeClockId));

  revalidateTimeclock(warehouseId);
  return { success: true };
}
