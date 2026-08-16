import { formatDayLabel } from "@/lib/metrics/kpi";

/**
 * Hand-rolled SVG charts.
 *
 * The project has no charting dependency and these do not justify adding one:
 * everything here is a rectangle or a line, it renders on the server with no
 * client JavaScript at all, and it inherits the page's Tailwind palette
 * instead of fighting a library's theme. Anything that needs a tooltip or a
 * brush should reconsider being a chart.
 */

const SERIES_COLORS = [
  "#0f766e", // teal-700
  "#0284c7", // sky-600
  "#7c3aed", // violet-600
  "#ea580c", // orange-600
  "#65a30d", // lime-600
  "#db2777", // pink-600
  "#0891b2", // cyan-600
  "#a16207", // yellow-700
];

export function seriesColor(index: number) {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

export type StackedDay = {
  day: string;
  /** Segment values keyed by series name, in the order given by `series`. */
  segments: Record<string, number>;
};

/**
 * Stacked daily bars. Empty days are drawn as an empty slot rather than
 * skipped -- a week with three quiet days should look like a week with three
 * quiet days, not like a busy three-day week.
 */
export function StackedBars({
  data,
  series,
  height = 160,
}: {
  data: StackedDay[];
  series: string[];
  height?: number;
}) {
  const totals = data.map((d) =>
    series.reduce((sum, key) => sum + (d.segments[key] ?? 0), 0),
  );
  const max = Math.max(1, ...totals);
  const barCount = Math.max(1, data.length);
  const slot = 100 / barCount;
  const barWidth = slot * 0.62;
  const gap = (slot - barWidth) / 2;
  const labelEvery = Math.ceil(barCount / 12);

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label="Tasks completed per day"
      >
        {[0.25, 0.5, 0.75, 1].map((frac) => (
          <line
            key={frac}
            x1={0}
            x2={100}
            y1={height - frac * height}
            y2={height - frac * height}
            stroke="#e2e8f0"
            strokeWidth={0.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {data.map((d, i) => {
          let cursor = height;
          return (
            <g key={d.day}>
              {series.map((key, s) => {
                const value = d.segments[key] ?? 0;
                if (value <= 0) return null;
                const barHeight = (value / max) * (height - 4);
                cursor -= barHeight;
                return (
                  <rect
                    key={key}
                    x={i * slot + gap}
                    y={cursor}
                    width={barWidth}
                    height={barHeight}
                    fill={seriesColor(s)}
                  >
                    <title>{`${d.day} · ${key}: ${value}`}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex w-full">
        {data.map((d, i) => (
          <div
            key={d.day}
            className="min-w-0 flex-1 text-center text-[9px] text-slate-400"
          >
            {i % labelEvery === 0 ? formatDayLabel(d.day) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChartLegend({ series }: { series: string[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {series.map((key, i) => (
        <span key={key} className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: seriesColor(i) }}
          />
          <span className="text-[11px] font-medium text-slate-600">
            {key.replace(/_/g, " ")}
          </span>
        </span>
      ))}
    </div>
  );
}

/**
 * A horizontal magnitude bar for table cells -- comparing rows at a glance
 * without giving each one its own axis.
 */
export function MiniBar({
  value,
  max,
  color = "#0f766e",
}: {
  value: number;
  max: number;
  color?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-full rounded-full"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

/**
 * The outbound funnel. Stages are given in flow order and drawn at their own
 * scale, so a stage holding one order is still visible next to one holding a
 * hundred -- the point is where orders are sitting, not a bar-length contest.
 */
export function FunnelBars({
  stages,
}: {
  stages: { label: string; count: number; tone: string }[];
}) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <div className="space-y-2.5">
      {stages.map((stage) => (
        <div key={stage.label} className="flex items-center gap-3">
          <span className="w-24 shrink-0 text-right text-[11px] font-medium text-slate-600">
            {stage.label}
          </span>
          <div className="h-5 flex-1 overflow-hidden rounded-md bg-slate-100">
            <div
              className={`h-full rounded-md ${stage.tone}`}
              style={{ width: `${Math.max(2, (stage.count / max) * 100)}%` }}
            />
          </div>
          <span className="w-8 shrink-0 font-mono text-xs font-bold text-slate-900">
            {stage.count}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A single donut-style occupancy dial. */
export function Gauge({
  ratio,
  label,
  sublabel,
}: {
  ratio: number | null;
  label: string;
  sublabel: string;
}) {
  const pct = ratio === null ? 0 : Math.min(1, Math.max(0, ratio));
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const tone = pct > 0.9 ? "#dc2626" : pct > 0.75 ? "#ea580c" : "#0f766e";

  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0 -rotate-90">
        <circle
          cx={50}
          cy={50}
          r={radius}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={10}
        />
        {ratio !== null ? (
          <circle
            cx={50}
            cy={50}
            r={radius}
            fill="none"
            stroke={tone}
            strokeWidth={10}
            strokeLinecap="round"
            strokeDasharray={`${pct * circumference} ${circumference}`}
          />
        ) : null}
      </svg>
      <div className="min-w-0">
        <div className="text-2xl font-bold text-slate-900">{label}</div>
        <div className="text-xs text-slate-500">{sublabel}</div>
      </div>
    </div>
  );
}
