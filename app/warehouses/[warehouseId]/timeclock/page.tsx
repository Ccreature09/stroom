import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { employees, timeClockEntries } from "@/drizzle/schema";
import { requireWarehouseAccess } from "@/lib/warehouse-access";
import {
  elapsedMinutes,
  formatDuration,
  isOpenShift,
  totalWorkedMinutes,
  workedMinutes,
} from "@/lib/timeclock/shift";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { ArrowLeft, Clock } from "lucide-react";
import { EditEntryButton } from "./timesheet-controls";

const WINDOW_DAYS = 7;

export default async function TimeclockPage({
  params,
}: {
  params: Promise<{ warehouseId: string }>;
}) {
  const { warehouseId } = await params;
  const { employee, warehouseId: parsedWarehouseId } =
    await requireWarehouseAccess(warehouseId);

  // Timesheets are workforce data -- who was in the building and for how
  // long -- so viewing anyone but yourself sits behind the metrics gate,
  // the same boundary the live map uses for individual worker location.
  if (employee.canViewMetrics !== true) {
    redirect(`/warehouses/${parsedWarehouseId}/floor`);
  }

  // Window measured by the database clock rather than this process's, so a
  // few seconds of skew between app server and database can't move the
  // boundary. `localtimestamp` (not `now()`) because clock_in_at is a naive
  // timestamp -- comparing it against a timestamptz would silently apply an
  // offset to everyone's hours.
  const since = sql`(localtimestamp - ${sql.raw(`interval '${WINDOW_DAYS} days'`)})`;

  const editor = alias(employees, "editor");

  const rows = await db
    .select({
      timeClockId: timeClockEntries.timeClockId,
      employeeId: timeClockEntries.employeeId,
      firstName: employees.firstName,
      lastName: employees.lastName,
      clockInAt: timeClockEntries.clockInAt,
      clockOutAt: timeClockEntries.clockOutAt,
      breakMinutes: timeClockEntries.breakMinutes,
      source: timeClockEntries.source,
      editedByFirstName: editor.firstName,
      editedByLastName: editor.lastName,
    })
    .from(timeClockEntries)
    .leftJoin(employees, eq(timeClockEntries.employeeId, employees.employeeId))
    .leftJoin(editor, eq(timeClockEntries.editedByEmployeeId, editor.employeeId))
    .where(
      and(
        eq(timeClockEntries.warehouseId, parsedWarehouseId),
        gte(timeClockEntries.clockInAt, since),
      ),
    )
    .orderBy(desc(timeClockEntries.clockInAt))
    .limit(500);

  const onShift = rows.filter(isOpenShift);

  // Hours per person over the window. Open shifts contribute nothing to the
  // total (see workedMinutes) -- a running shift is not yet worked time.
  const byEmployee = new Map<
    number,
    { name: string; entries: typeof rows; minutes: number }
  >();
  for (const row of rows) {
    if (row.employeeId === null) continue;
    const name =
      [row.firstName, row.lastName].filter(Boolean).join(" ") || `#${row.employeeId}`;
    const bucket = byEmployee.get(row.employeeId) ?? { name, entries: [], minutes: 0 };
    bucket.entries.push(row);
    byEmployee.set(row.employeeId, bucket);
  }
  for (const bucket of byEmployee.values()) {
    bucket.minutes = totalWorkedMinutes(bucket.entries);
  }
  const summary = [...byEmployee.values()].sort((a, b) => b.minutes - a.minutes);

  const canEdit = employee.canManageUsers === true;
  const [totals] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(timeClockEntries)
    .where(eq(timeClockEntries.warehouseId, parsedWarehouseId));

  return (
    <main className="flex-1 space-y-6 bg-slate-50 p-5 sm:p-8">
      <div>
        <DynamicBreadcrumb />
      </div>
      <Link
        href={`/warehouses/${parsedWarehouseId}`}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Warehouse
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Time Clock</h1>
        <p className="text-sm text-slate-500">
          Who is on shift now, and hours worked over the last {WINDOW_DAYS} days.
          {totals?.n ? ` ${totals.n} entries on record.` : ""}
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
          On shift now ({onShift.length})
        </h2>
        {onShift.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400">
            Nobody is clocked in.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {onShift.map((row) => (
              <div
                key={row.timeClockId}
                className="flex items-center gap-3 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3"
              >
                <Clock className="h-5 w-5 shrink-0 text-teal-700" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-slate-900">
                    {[row.firstName, row.lastName].filter(Boolean).join(" ") ||
                      `#${row.employeeId}`}
                  </div>
                  <div className="text-xs text-teal-800">
                    {formatDuration(elapsedMinutes(row))} · since{" "}
                    {row.clockInAt.slice(11, 16)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
          Hours by person
        </h2>
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-6 py-3">Employee</th>
                <th className="px-6 py-3 text-right">Shifts</th>
                <th className="px-6 py-3 text-right">Worked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {summary.map((s) => (
                <tr key={s.name} className="hover:bg-slate-50">
                  <td className="px-6 py-3 font-medium text-slate-900">{s.name}</td>
                  <td className="px-6 py-3 text-right font-mono text-xs text-slate-600">
                    {s.entries.length}
                  </td>
                  <td className="px-6 py-3 text-right font-mono text-sm font-semibold text-slate-900">
                    {formatDuration(s.minutes)}
                  </td>
                </tr>
              ))}
              {summary.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-8 text-center text-slate-500">
                    No shifts recorded in the last {WINDOW_DAYS} days.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
          Entries
        </h2>
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-6 py-3">Employee</th>
                <th className="px-6 py-3">In</th>
                <th className="px-6 py-3">Out</th>
                <th className="px-6 py-3 text-right">Break</th>
                <th className="px-6 py-3 text-right">Worked</th>
                <th className="px-6 py-3">Source</th>
                {canEdit ? <th className="px-6 py-3 text-right">Actions</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.map((row) => {
                const editedBy = [row.editedByFirstName, row.editedByLastName]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <tr key={row.timeClockId} className="hover:bg-slate-50">
                    <td className="px-6 py-3 font-medium text-slate-900">
                      {[row.firstName, row.lastName].filter(Boolean).join(" ") ||
                        `#${row.employeeId}`}
                    </td>
                    <td className="px-6 py-3 font-mono text-xs text-slate-600">
                      {row.clockInAt.replace("T", " ").slice(0, 16)}
                    </td>
                    <td className="px-6 py-3 font-mono text-xs text-slate-600">
                      {row.clockOutAt ? (
                        row.clockOutAt.replace("T", " ").slice(0, 16)
                      ) : (
                        <span className="font-semibold text-teal-700">On shift</span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-right font-mono text-xs text-slate-500">
                      {row.breakMinutes ?? 0}m
                    </td>
                    <td className="px-6 py-3 text-right font-mono text-sm font-semibold text-slate-900">
                      {formatDuration(workedMinutes(row))}
                    </td>
                    <td className="px-6 py-3">
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                        {row.source ?? "—"}
                      </span>
                      {editedBy ? (
                        <div className="mt-0.5 text-[10px] text-amber-700">
                          edited by {editedBy}
                        </div>
                      ) : null}
                    </td>
                    {canEdit ? (
                      <td className="px-6 py-3 text-right">
                        <EditEntryButton
                          warehouseId={parsedWarehouseId}
                          entry={{
                            timeClockId: row.timeClockId,
                            clockInAt: row.clockInAt,
                            clockOutAt: row.clockOutAt,
                            breakMinutes: row.breakMinutes ?? 0,
                          }}
                        />
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={canEdit ? 7 : 6}
                    className="px-6 py-8 text-center text-slate-500"
                  >
                    No entries in the last {WINDOW_DAYS} days.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
