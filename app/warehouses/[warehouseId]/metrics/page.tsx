import Link from "next/link";
import { ArrowLeft, TrendingUp } from "lucide-react";
import { requireMetricsAccess } from "@/lib/warehouse-access";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import {
  accuracyRate,
  densifyDays,
  formatMinutes,
  formatPercent,
  formatRate,
  MIN_MINUTES_FOR_RATE,
} from "@/lib/metrics/kpi";
import {
  loadCapacity,
  loadDailyCompletions,
  loadDockToStock,
  loadInventoryAccuracy,
  loadLabour,
  loadOrderFunnel,
  loadOrderLeadTime,
  loadTaskFlow,
  loadUnitThroughput,
} from "@/lib/metrics/metrics-server";
import {
  ChartLegend,
  FunnelBars,
  Gauge,
  MiniBar,
  StackedBars,
  type StackedDay,
} from "./charts";

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

function parseRange(value: string | undefined): Range {
  const parsed = Number(value);
  return (RANGES as readonly number[]).includes(parsed) ? (parsed as Range) : 30;
}

/** Outbound stages in flow order, so the funnel reads top to bottom. */
const FUNNEL_ORDER: { status: string; label: string; tone: string }[] = [
  { status: "DRAFT", label: "Draft", tone: "bg-slate-400" },
  { status: "RELEASED", label: "Released", tone: "bg-sky-500" },
  { status: "PICKING", label: "Picking", tone: "bg-blue-500" },
  { status: "PICKED", label: "Picked", tone: "bg-indigo-500" },
  { status: "PACKING", label: "Packing", tone: "bg-violet-500" },
  { status: "PACKED", label: "Packed", tone: "bg-purple-500" },
  { status: "SHIPPED", label: "Shipped", tone: "bg-emerald-600" },
  { status: "CANCELLED", label: "Cancelled", tone: "bg-red-400" },
];

export default async function MetricsPage({
  params,
  searchParams,
}: {
  params: Promise<{ warehouseId: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { warehouseId } = await params;
  const { range: rangeParam } = await searchParams;
  const { warehouse, warehouseId: parsedWarehouseId } =
    await requireMetricsAccess(warehouseId);

  const days = parseRange(rangeParam);

  const [
    taskFlow,
    daily,
    labour,
    dockToStock,
    leadTime,
    accuracy,
    funnel,
    units,
    capacity,
  ] = await Promise.all([
    loadTaskFlow(parsedWarehouseId, days),
    loadDailyCompletions(parsedWarehouseId, days),
    loadLabour(parsedWarehouseId, days),
    loadDockToStock(parsedWarehouseId, days),
    loadOrderLeadTime(parsedWarehouseId, days),
    loadInventoryAccuracy(parsedWarehouseId, days),
    loadOrderFunnel(parsedWarehouseId, days),
    loadUnitThroughput(parsedWarehouseId, days),
    loadCapacity(parsedWarehouseId),
  ]);

  const totalCompleted = taskFlow.reduce((sum, r) => sum + r.completed, 0);
  const totalOpen = taskFlow.reduce((sum, r) => sum + r.open, 0);
  const impossible = taskFlow.reduce((sum, r) => sum + r.impossibleDurations, 0);

  // The chart's day keys come from the same date_trunc the query used, so the
  // series is densified against the newest day the data actually reports
  // rather than against the app server's calendar.
  const seriesNames = [...new Set(daily.map((d) => d.typeCode))].sort();
  const latestDay =
    daily.length > 0
      ? daily.reduce((max, d) => (d.day > max ? d.day : max), daily[0].day)
      : new Date().toISOString().slice(0, 10);
  const byDay = new Map<string, Record<string, number>>();
  for (const row of daily) {
    const entry = byDay.get(row.day) ?? {};
    entry[row.typeCode] = row.completed;
    byDay.set(row.day, entry);
  }
  const dailyTotals = [...byDay.entries()].map(([day, segments]) => ({
    day,
    value: Object.values(segments).reduce((sum, n) => sum + n, 0),
  }));
  const dense: StackedDay[] = densifyDays(dailyTotals, latestDay, days).map(
    (bucket) => ({ day: bucket.day, segments: byDay.get(bucket.day) ?? {} }),
  );

  const accuracyPct = accuracyRate(accuracy.matched, accuracy.counted);
  const maxLabourTasks = Math.max(1, ...labour.map((l) => l.completed));
  const funnelStages = FUNNEL_ORDER.filter((stage) =>
    funnel.some((f) => f.status === stage.status),
  ).map((stage) => ({
    label: stage.label,
    tone: stage.tone,
    count: funnel.find((f) => f.status === stage.status)?.orders ?? 0,
  }));

  return (
    <main className="flex-1 space-y-6 bg-slate-50 p-5 sm:p-8">
      <div>
        <DynamicBreadcrumb />
      </div>
      <Link
        href={`/warehouses/${parsedWarehouseId}`}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {warehouse.name}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Performance
          </h1>
          <p className="text-sm text-slate-500">
            What the building actually did over the last {days} days.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={`/warehouses/${parsedWarehouseId}/metrics?range=${r}`}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                r === days
                  ? "bg-teal-700 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {r}d
            </Link>
          ))}
        </div>
      </div>

      {totalCompleted === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Nothing was completed in this window, so the timing figures below have
          no observations behind them. Try a longer range.
        </div>
      ) : null}

      {impossible > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          <span className="font-semibold text-slate-900">
            {impossible} task{impossible === 1 ? "" : "s"}
          </span>{" "}
          finished before they started and were left out of the timings. That is
          a data problem, not a fast shift — usually an imported or hand-edited
          record.
        </div>
      ) : null}

      {/* Headline numbers */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Tasks completed"
          value={String(totalCompleted)}
          hint={`${totalOpen} still open`}
        />
        <StatCard
          label="Dock to stock"
          value={formatMinutes(dockToStock.medianMinutes)}
          hint={
            dockToStock.count > 0
              ? `median of ${dockToStock.count} pallet${dockToStock.count === 1 ? "" : "s"}`
              : "no pallets put away yet"
          }
        />
        <StatCard
          label="Order to dispatch"
          value={formatMinutes(leadTime.medianMinutes)}
          hint={
            leadTime.count > 0
              ? `median of ${leadTime.count} order${leadTime.count === 1 ? "" : "s"}`
              : "no orders dispatched yet"
          }
        />
        <StatCard
          label="Count accuracy"
          value={formatPercent(accuracyPct, 0)}
          hint={
            accuracy.counted > 0
              ? `${accuracy.matched}/${accuracy.counted} bins matched`
              : "nothing counted yet"
          }
        />
      </section>

      {/* Daily completions */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
            Tasks completed per day
          </h2>
          <ChartLegend series={seriesNames} />
        </div>
        {seriesNames.length > 0 ? (
          <StackedBars data={dense} series={seriesNames} />
        ) : (
          <p className="py-8 text-center text-sm text-slate-400">
            Nothing completed in this window.
          </p>
        )}
      </section>

      {/* Work vs wait, per task type */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
            Where the time goes
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Waiting is time a task sat in the queue before anyone started it.
            Working is how long it took once someone did. They are different
            problems.
          </p>
        </div>
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-700">
            <tr>
              <th className="px-5 py-3">Task type</th>
              <th className="px-5 py-3 text-right">Done</th>
              <th className="px-5 py-3 text-right">Open</th>
              <th className="px-5 py-3 text-right">Median wait</th>
              <th className="px-5 py-3 text-right">Median work</th>
              <th className="px-5 py-3 text-right">Slowest 10%</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {taskFlow.map((row) => (
              <tr key={row.typeCode} className="hover:bg-slate-50">
                <td className="px-5 py-3 text-xs font-semibold text-slate-900">
                  {row.typeCode.replace(/_/g, " ")}
                </td>
                <td className="px-5 py-3 text-right font-mono text-xs">
                  {row.completed}
                </td>
                <td className="px-5 py-3 text-right font-mono text-xs">
                  {row.open > 0 ? (
                    <span className="font-bold text-amber-700">{row.open}</span>
                  ) : (
                    <span className="text-slate-300">0</span>
                  )}
                </td>
                <td className="px-5 py-3 text-right font-mono text-xs">
                  {formatMinutes(row.medianWaitMinutes)}
                </td>
                <td className="px-5 py-3 text-right font-mono text-xs font-bold text-slate-900">
                  {formatMinutes(row.medianWorkMinutes)}
                </td>
                <td className="px-5 py-3 text-right font-mono text-xs text-slate-500">
                  {formatMinutes(row.p90WorkMinutes)}
                </td>
              </tr>
            ))}
            {taskFlow.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                  No tasks have ever been raised in this warehouse.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Order funnel */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-1 text-sm font-bold uppercase tracking-wider text-slate-700">
            Order funnel
          </h2>
          <p className="mb-4 text-xs text-slate-500">
            Orders raised in this window, by where they are now.
          </p>
          {funnelStages.length > 0 ? (
            <FunnelBars stages={funnelStages} />
          ) : (
            <p className="py-8 text-center text-sm text-slate-400">
              No orders raised in this window.
            </p>
          )}
        </section>

        {/* Capacity + volume */}
        <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <h2 className="mb-1 text-sm font-bold uppercase tracking-wider text-slate-700">
              Space
            </h2>
            <p className="mb-4 text-xs text-slate-500">
              Storage locations only — dock doors and staging are meant to be
              empty.
            </p>
            <Gauge
              ratio={capacity.occupancy}
              label={formatPercent(capacity.occupancy, 1)}
              sublabel={`${capacity.occupied} of ${capacity.storageLocations} locations hold stock${
                capacity.blocked > 0 ? ` · ${capacity.blocked} blocked` : ""
              }`}
            />
          </div>
          <div className="grid grid-cols-3 gap-3 border-t border-slate-100 pt-4">
            <UnitStat label="Received" value={units.received} />
            <UnitStat label="Picked" value={units.picked} />
            <UnitStat label="Adjusted" value={units.adjusted} />
          </div>
        </section>
      </div>

      {/* Labour */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
            People
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Completed work against closed shifts. An open shift has no length
            yet, so it is not in the denominator — and a rate needs at least{" "}
            {MIN_MINUTES_FOR_RATE} clocked minutes to mean anything.
          </p>
        </div>
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-700">
            <tr>
              <th className="px-5 py-3">Employee</th>
              <th className="px-5 py-3">Tasks completed</th>
              <th className="px-5 py-3 text-right">Clocked</th>
              <th className="px-5 py-3 text-right">Tasks / hour</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {labour.map((row) => (
              <tr key={row.employeeId} className="hover:bg-slate-50">
                <td className="px-5 py-3 text-xs font-semibold text-slate-900">
                  {row.name}
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <span className="w-6 shrink-0 font-mono text-xs font-bold text-slate-900">
                      {row.completed}
                    </span>
                    <div className="max-w-40 flex-1">
                      <MiniBar value={row.completed} max={maxLabourTasks} />
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3 text-right font-mono text-xs">
                  {formatMinutes(
                    row.clockedMinutes > 0 ? row.clockedMinutes : null,
                  )}
                </td>
                <td className="px-5 py-3 text-right font-mono text-xs font-bold text-slate-900">
                  {row.tasksPerHour === null ? (
                    <span
                      className="font-normal text-slate-400"
                      title={`Needs at least ${MIN_MINUTES_FOR_RATE} clocked minutes`}
                    >
                      --
                    </span>
                  ) : (
                    formatRate(row.tasksPerHour, 2)
                  )}
                </td>
              </tr>
            ))}
            {labour.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-slate-500">
                  <div className="flex flex-col items-center gap-2">
                    <TrendingUp className="h-6 w-6 text-slate-300" />
                    Nobody completed work or clocked a shift in this window.
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <p className="pb-2 text-[11px] text-slate-400">
        Medians, not averages — one task left open over a weekend would drag an
        average into nonsense. A figure shown as{" "}
        <span className="font-mono">--</span> has no observations behind it, and
        is never the same thing as zero.
      </p>
    </main>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
        {value}
      </div>
      <div className="mt-1 text-xs text-slate-500">{hint}</div>
    </div>
  );
}

function UnitStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="font-mono text-lg font-bold text-slate-900">
        {value.toLocaleString()}
      </div>
      <div className="text-[10px] text-slate-400">units</div>
    </div>
  );
}
