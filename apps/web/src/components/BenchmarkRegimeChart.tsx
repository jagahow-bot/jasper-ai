"use client";

import {
  computeSharedDateDomain,
  formatAxisDate,
  parseDateTs,
  regimeBandRanges,
} from "@/lib/benchmark-chart-scale";
import type { BenchmarkSeriesPoint, ObjectiveSwitchLabResult } from "@/lib/types";
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

const SYNC_ID = "benchmarkRegime";
const CHART_MARGIN = { top: 8, right: 8, left: 0, bottom: 0 };
const Y_AXIS_WIDTH = 44;
const MAIN_CHART_HEIGHT = 220;
const STRIP_CHART_HEIGHT = 24;

const REGIME_COLORS: Record<string, string> = {
  risk_off: "rgba(255, 80, 80, 0.12)",
  neutral: "rgba(255, 176, 0, 0.1)",
  risk_on: "rgba(0, 220, 180, 0.12)",
};

const REGIME_STRIP_COLORS: Record<string, string> = {
  risk_off: "rgba(255, 80, 80, 0.55)",
  neutral: "rgba(255, 176, 0, 0.55)",
  risk_on: "rgba(0, 220, 180, 0.55)",
};

type Props = {
  benchmarkSeries: BenchmarkSeriesPoint[];
  regimeTimeline: ObjectiveSwitchLabResult["regime_timeline"];
  benchmarkTicker: string;
};

function sharedXAxisProps(min: number, max: number) {
  return {
    type: "number" as const,
    domain: [min, max] as [number, number],
    scale: "time" as const,
    tick: { fontSize: 9, fill: "var(--dim)" },
    minTickGap: 40,
    tickFormatter: (ts: number) => formatAxisDate(ts),
  };
}

export function BenchmarkRegimeChart({
  benchmarkSeries,
  regimeTimeline,
  benchmarkTicker,
}: Props) {
  if (!benchmarkSeries.length) {
    return <p className="text-xs text-dim">No benchmark series for chart.</p>;
  }

  const domain = computeSharedDateDomain(benchmarkSeries, regimeTimeline);
  if (!domain) {
    return <p className="text-xs text-dim">No valid dates for chart.</p>;
  }

  const { min: domainMin, max: domainMax } = domain;
  const bands = regimeBandRanges(regimeTimeline, domainMax);
  const chartData = benchmarkSeries.map((p) => ({
    ...p,
    ts: parseDateTs(p.date),
  }));
  const stripAnchor = [
    { ts: domainMin, v: 0 },
    { ts: domainMax, v: 1 },
  ];

  return (
    <div className="space-y-1">
      <ResponsiveContainer width="100%" height={MAIN_CHART_HEIGHT}>
        <LineChart
          syncId={SYNC_ID}
          data={chartData}
          margin={CHART_MARGIN}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="ts" {...sharedXAxisProps(domainMin, domainMax)} />
          <YAxis
            tick={{ fontSize: 9, fill: "var(--dim)" }}
            width={Y_AXIS_WIDTH}
            tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
          />
          {bands.map((b) => (
            <ReferenceArea
              key={`${b.startTs}-${b.regime}`}
              x1={b.startTs}
              x2={b.endTs}
              fill={REGIME_COLORS[b.regime] ?? "transparent"}
              strokeOpacity={0}
              ifOverflow="hidden"
            />
          ))}
          <Tooltip
            contentStyle={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              fontSize: 11,
            }}
            formatter={(value: number) => [`${value.toFixed(2)}%`, "Cum. return"]}
            labelFormatter={(label) => formatAxisDate(Number(label))}
          />
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

      {regimeTimeline.length > 0 && (
        <ResponsiveContainer width="100%" height={STRIP_CHART_HEIGHT}>
          <LineChart syncId={SYNC_ID} data={stripAnchor} margin={CHART_MARGIN}>
            <XAxis dataKey="ts" {...sharedXAxisProps(domainMin, domainMax)} hide />
            <YAxis hide domain={[0, 1]} width={Y_AXIS_WIDTH} />
            {bands.map((b, i) => {
              const row = regimeTimeline[i];
              const fill = row.switched
                ? "var(--amber)"
                : REGIME_STRIP_COLORS[b.regime] ?? "var(--border)";
              return (
                <ReferenceArea
                  key={row.date}
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

      <div className="flex flex-wrap gap-3 text-[10px] text-dim">
        {Object.entries(REGIME_COLORS).map(([regime, color]) => (
          <span key={regime} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2 w-3 rounded-sm border border-[var(--border)]"
              style={{ backgroundColor: color }}
            />
            {regime}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2 w-3 rounded-sm border border-[var(--border)]"
            style={{ backgroundColor: "var(--amber)" }}
          />
          switch
        </span>
      </div>
      <p className="text-[10px] text-dim">
        Top: {benchmarkTicker} cumulative return (%). Background bands = active regime per
        walk-forward step. Bottom strip = regime steps (amber = switch). Both panels share
        the same calendar x-axis.
      </p>
    </div>
  );
}
