"use client";

import {
  activeObjectiveAtTs,
  activeRegimeAtTs,
  computeSharedDateDomain,
  DYNAMIC_OBJECTIVE_CHART_SYNC_ID,
  formatAxisDate,
  LAB_CHART_MARGIN,
  LAB_Y_AXIS_WIDTH,
  labXAxisProps,
  OBJECTIVE_BAND_COLORS,
  OBJECTIVE_DISPLAY_LABELS,
  OBJECTIVE_STRIP_COLORS,
  objectiveBandRanges,
  parseDateTs,
  regimeBandRanges,
} from "@/lib/benchmark-chart-scale";
import type {
  BenchmarkSeriesPoint,
  DynamicObjectiveTimelinePoint,
} from "@/lib/types";
import type { TooltipProps } from "recharts";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const MAIN_CHART_HEIGHT = 220;
const OBJECTIVE_STRIP_HEIGHT = 24;
const REGIME_STRIP_HEIGHT = 20;

const REGIME_COLORS: Record<string, string> = {
  risk_off: "rgba(255, 80, 80, 0.45)",
  neutral: "rgba(255, 176, 0, 0.45)",
  risk_on: "rgba(0, 220, 180, 0.45)",
};

const CHART_SYNC = {
  syncId: DYNAMIC_OBJECTIVE_CHART_SYNC_ID,
  syncMethod: "value" as const,
};

type Props = {
  benchmarkSeries: BenchmarkSeriesPoint[];
  timeline: DynamicObjectiveTimelinePoint[];
  benchmarkTicker: string;
};

function DynamicObjectiveTooltip({
  active,
  payload,
  label,
  timeline,
}: TooltipProps<number, string> & { timeline: DynamicObjectiveTimelinePoint[] }) {
  if (!active || !payload?.length) return null;
  const ts = Number(label);
  if (!Number.isFinite(ts)) return null;
  const value = payload[0]?.value;
  const objective = activeObjectiveAtTs(ts, timeline);
  const regime = activeRegimeAtTs(
    ts,
    timeline as { date: string; regime: string; objective: string }[],
  );

  return (
    <div
      className="rounded border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-[11px]"
      style={{ fontSize: 11 }}
    >
      <p className="text-[var(--foreground)]">Date: {formatAxisDate(ts)}</p>
      {objective && (
        <p className="text-dim">
          Active objective:{" "}
          {OBJECTIVE_DISPLAY_LABELS[objective] ?? objective}
        </p>
      )}
      {regime && <p className="text-dim">Regime: {regime}</p>}
      <p className="text-dim">
        Cumulative return:{" "}
        {typeof value === "number" ? `${value.toFixed(2)}%` : "—"}
      </p>
    </div>
  );
}

export function DynamicObjectiveTimelineChart({
  benchmarkSeries,
  timeline,
  benchmarkTicker,
}: Props) {
  if (!benchmarkSeries.length) {
    return <p className="text-xs text-dim">No benchmark series for chart.</p>;
  }

  const regimeTimeline = timeline as Parameters<typeof computeSharedDateDomain>[1];
  const domain = computeSharedDateDomain(benchmarkSeries, regimeTimeline);
  if (!domain) {
    return <p className="text-xs text-dim">No valid dates for chart.</p>;
  }

  const { min: domainMin, max: domainMax } = domain;
  const objectiveBands = objectiveBandRanges(timeline, domainMax);
  const regimeBands = regimeBandRanges(regimeTimeline, domainMax, "active_regime");
  const chartData = benchmarkSeries.map((p) => ({
    ...p,
    ts: parseDateTs(p.date),
  }));
  const stripAnchor = [
    { ts: domainMin, v: 0 },
    { ts: domainMax, v: 1 },
  ];
  const xAxis = labXAxisProps(domainMin, domainMax);
  const objectivesInRun = [
    ...new Set(timeline.map((r) => r.objective).filter(Boolean)),
  ];

  return (
    <div className="space-y-1">
      <ResponsiveContainer width="100%" height={MAIN_CHART_HEIGHT}>
        <LineChart {...CHART_SYNC} data={chartData} margin={LAB_CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis {...xAxis} />
          <YAxis
            tick={{ fontSize: 9, fill: "var(--dim)" }}
            width={LAB_Y_AXIS_WIDTH}
            tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
          />
          {objectiveBands.map((b) => (
            <ReferenceArea
              key={`${b.startTs}-${b.objective}`}
              x1={b.startTs}
              x2={b.endTs}
              fill={OBJECTIVE_BAND_COLORS[b.objective] ?? "transparent"}
              strokeOpacity={0}
              ifOverflow="hidden"
            />
          ))}
          <Tooltip content={<DynamicObjectiveTooltip timeline={timeline} />} />
          <Line
            type="monotone"
            dataKey="cumulative_return_pct"
            stroke="var(--cyan)"
            dot={false}
            strokeWidth={1.5}
            name={`${benchmarkTicker} cum. %`}
          />
        </LineChart>
      </ResponsiveContainer>

      {timeline.length > 0 && (
        <ResponsiveContainer width="100%" height={OBJECTIVE_STRIP_HEIGHT}>
          <LineChart {...CHART_SYNC} data={stripAnchor} margin={LAB_CHART_MARGIN}>
            <XAxis {...xAxis} hide />
            <YAxis hide domain={[0, 1]} width={LAB_Y_AXIS_WIDTH} />
            {objectiveBands.map((b, i) => {
              const row = timeline[i];
              const fill = row.switched
                ? "var(--amber)"
                : OBJECTIVE_STRIP_COLORS[b.objective] ?? "var(--border)";
              return (
                <ReferenceArea
                  key={`obj-${row.date}`}
                  x1={b.startTs}
                  x2={b.endTs}
                  y1={0}
                  y2={1}
                  fill={fill}
                  strokeOpacity={0}
                  ifOverflow="hidden"
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      )}

      {regimeBands.length > 0 && (
        <ResponsiveContainer width="100%" height={REGIME_STRIP_HEIGHT}>
          <LineChart {...CHART_SYNC} data={stripAnchor} margin={LAB_CHART_MARGIN}>
            <XAxis {...xAxis} hide />
            <YAxis hide domain={[0, 1]} width={LAB_Y_AXIS_WIDTH} />
            {regimeBands.map((b, i) => {
              const row = timeline[i];
              const fill = REGIME_COLORS[b.regime] ?? "var(--border)";
              return (
                <ReferenceArea
                  key={`reg-${row.date}`}
                  x1={b.startTs}
                  x2={b.endTs}
                  y1={0}
                  y2={1}
                  fill={fill}
                  fillOpacity={0.55}
                  strokeOpacity={0}
                  ifOverflow="hidden"
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      )}

      <div className="flex flex-wrap gap-3 text-[10px] text-dim">
        {objectivesInRun.map((obj) => (
          <span key={obj} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2 w-3 rounded-sm border border-[var(--border)]"
              style={{
                backgroundColor:
                  OBJECTIVE_BAND_COLORS[obj] ?? "var(--border)",
              }}
            />
            {OBJECTIVE_DISPLAY_LABELS[obj] ?? obj}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2 w-3 rounded-sm border border-[var(--border)]"
            style={{ backgroundColor: "var(--amber)" }}
          />
          objective switch
        </span>
        {regimeBands.length > 0 && (
          <>
            <span className="text-dim">· regime strip:</span>
            {Object.entries(REGIME_COLORS).map(([regime, color]) => (
              <span key={regime} className="inline-flex items-center gap-1">
                <span
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{ backgroundColor: color }}
                />
                {regime}
              </span>
            ))}
          </>
        )}
      </div>
      <p className="text-[10px] text-dim">
        Top: {benchmarkTicker} cumulative return (%). Background = effective objective per
        walk-forward step. Middle strip = objective (amber = switch). Bottom strip = market
        regime when shown. Linked hover across panels.
      </p>
    </div>
  );
}
