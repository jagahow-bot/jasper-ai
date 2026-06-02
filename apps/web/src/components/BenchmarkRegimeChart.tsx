"use client";

import type { BenchmarkSeriesPoint, ObjectiveSwitchLabResult } from "@/lib/types";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const REGIME_COLORS: Record<string, string> = {
  risk_off: "rgba(255, 80, 80, 0.12)",
  neutral: "rgba(255, 176, 0, 0.1)",
  risk_on: "rgba(0, 220, 180, 0.12)",
};

type Props = {
  benchmarkSeries: BenchmarkSeriesPoint[];
  regimeTimeline: ObjectiveSwitchLabResult["regime_timeline"];
  benchmarkTicker: string;
};

function regimeBands(timeline: ObjectiveSwitchLabResult["regime_timeline"]) {
  if (!timeline.length) return [];
  const bands: { start: string; end: string; regime: string }[] = [];
  for (let i = 0; i < timeline.length; i++) {
    const regime = timeline[i].active_regime ?? timeline[i].regime;
    bands.push({
      start: timeline[i].date,
      end: timeline[i + 1]?.date ?? timeline[i].date,
      regime,
    });
  }
  return bands;
}

export function BenchmarkRegimeChart({
  benchmarkSeries,
  regimeTimeline,
  benchmarkTicker,
}: Props) {
  if (!benchmarkSeries.length) {
    return <p className="text-xs text-dim">No benchmark series for chart.</p>;
  }

  const bands = regimeBands(regimeTimeline);
  const chartHeight = 220;

  return (
    <div className="space-y-2">
      <div className="relative" style={{ height: chartHeight }}>
        <div className="pointer-events-none absolute inset-0 flex">
          {bands.map((b) => (
            <div
              key={`${b.start}-${b.regime}`}
              className="h-full flex-1"
              style={{ backgroundColor: REGIME_COLORS[b.regime] ?? "transparent" }}
              title={`${b.start}: ${b.regime}`}
            />
          ))}
        </div>
        <ResponsiveContainer width="100%" height={chartHeight}>
          <LineChart data={benchmarkSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 9, fill: "var(--dim)" }}
              minTickGap={40}
            />
            <YAxis
              tick={{ fontSize: 9, fill: "var(--dim)" }}
              width={44}
              tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
            />
            <Tooltip
              contentStyle={{
                background: "var(--panel)",
                border: "1px solid var(--border)",
                fontSize: 11,
              }}
              formatter={(value: number) => [`${value.toFixed(2)}%`, "Cum. return"]}
              labelFormatter={(label) => String(label)}
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
      </div>
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
      </div>
      {regimeTimeline.length > 0 && (
        <div className="mt-2 flex h-6 items-end gap-px">
          {regimeTimeline.map((row) => (
            <div
              key={row.date}
              className="min-w-[2px] flex-1"
              style={{
                height: "100%",
                backgroundColor:
                  row.switched ? "var(--amber)" : REGIME_COLORS[row.regime]?.replace("0.12", "0.55"),
              }}
              title={`${row.date} ${row.regime}${row.switched ? " (switch)" : ""}`}
            />
          ))}
        </div>
      )}
      <p className="text-[10px] text-dim">
        Top: {benchmarkTicker} cumulative return (%). Background bands = active regime per
        walk-forward step. Bottom strip = regime steps (amber = switch).
      </p>
    </div>
  );
}
