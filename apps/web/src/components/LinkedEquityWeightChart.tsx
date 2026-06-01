"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltip } from "@/components/ChartTooltip";

const SYNC_ID = "equity-weight-linked";

type EquityPoint = { date: string; value: number };

type Props = {
  equityCurve: EquityPoint[];
  benchmarkCurve?: EquityPoint[] | null;
  benchmarkLabel: string;
  weightHistory: ({ date: string } & Record<string, number | string>)[];
  weightTickers: string[];
  colors: string[];
};

export function LinkedEquityWeightChart({
  equityCurve,
  benchmarkCurve,
  benchmarkLabel,
  weightHistory,
  weightTickers,
  colors,
}: Props) {
  const equityChartData = useMemo(() => {
    const benchByDate = new Map(
      (benchmarkCurve ?? []).map((r) => [r.date, Number(r.value)]),
    );
    return equityCurve.map((row) => {
      const portNorm = Number(row.value);
      const benchNorm = benchByDate.get(row.date);
      return {
        date: row.date,
        portfolio: portNorm - 100,
        benchmark:
          benchNorm != null && Number.isFinite(benchNorm) ? benchNorm - 100 : null,
      };
    });
  }, [equityCurve, benchmarkCurve]);

  const weightChartData = useMemo(() => {
    if (!weightHistory.length) return [];
    const enrich = (row: { date: string } & Record<string, number | string>) => {
      const sumShown = weightTickers.reduce(
        (acc, t) => acc + Number((row as Record<string, unknown>)[t] ?? 0),
        0,
      );
      return {
        ...row,
        OTHER: Number(
          (row as Record<string, unknown>).OTHER ?? Math.max(0, 1 - sumShown),
        ),
      };
    };
    if (!equityCurve.length) {
      return weightHistory.map((row) => enrich(row));
    }
    const byDate = new Map(
      weightHistory.map((row) => [String(row.date), row]),
    );
    const aligned: ReturnType<typeof enrich>[] = [];
    for (const eq of equityCurve) {
      const row = byDate.get(eq.date);
      if (row) aligned.push(enrich(row));
    }
    if (aligned.length > 0) return aligned;
    return weightHistory.map((row) => enrich(row));
  }, [weightHistory, weightTickers, equityCurve]);

  const hasEquity = equityChartData.length > 0;
  const hasWeights = weightChartData.length > 0 && weightTickers.length > 0;
  const hasBenchmark = equityChartData.some(
    (r) => r.benchmark != null && Number.isFinite(r.benchmark),
  );

  if (!hasEquity && !hasWeights) {
    return <p className="text-xs text-dim">No equity or weight history for this model.</p>;
  }

  const tickFmt = (v: unknown) => String(v).slice(2);

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-dim">
        Hover either chart — cursor syncs by date so you can read portfolio return and
        holdings at the same rebalance.
      </p>
      <div className="grid gap-4 xl:grid-cols-1">
        {hasEquity && (
          <div className="border-2 border-[var(--border)] bg-[#050508] p-2">
            <p className="mb-1 px-1 text-[10px] uppercase tracking-wide text-dim">
              Cumulative return % · portfolio vs {benchmarkLabel}
            </p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={equityChartData} syncId={SYNC_ID}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  stroke="#94a3b8"
                  fontSize={10}
                  minTickGap={28}
                  tickFormatter={tickFmt}
                />
                <YAxis
                  domain={["auto", "auto"]}
                  stroke="#94a3b8"
                  fontSize={11}
                  tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
                />
                <Tooltip
                  content={<ChartTooltip valueDecimals={2} valueIsPct={false} />}
                  labelFormatter={(label) => `date ${String(label)}`}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="portfolio"
                  name="Portfolio"
                  stroke="#39ff14"
                  dot={false}
                  strokeWidth={2}
                  connectNulls
                />
                {hasBenchmark && (
                  <Line
                    type="monotone"
                    dataKey="benchmark"
                    name={benchmarkLabel}
                    stroke="#ffb000"
                    dot={false}
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    connectNulls
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {hasWeights && (
          <div className="border-2 border-[var(--border)] bg-[#050508] p-2">
            <p className="mb-1 px-1 text-[10px] uppercase tracking-wide text-dim">
              Weight history (stacked)
            </p>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={weightChartData} syncId={SYNC_ID}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  stroke="#94a3b8"
                  fontSize={10}
                  minTickGap={28}
                  tickFormatter={tickFmt}
                />
                <YAxis
                  domain={[0, 1]}
                  stroke="#94a3b8"
                  fontSize={10}
                  tickFormatter={(v) => `${(Number(v) * 100).toFixed(0)}%`}
                />
                <Tooltip
                  content={<ChartTooltip valueIsPct valueDecimals={2} />}
                  labelFormatter={(label) => `date ${String(label)}`}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {weightTickers.map((t, i) => (
                  <Area
                    key={t}
                    type="monotone"
                    dataKey={t}
                    stackId="weights"
                    stroke={colors[i % colors.length]}
                    fill={colors[i % colors.length]}
                  />
                ))}
                <Area
                  key="OTHER"
                  type="monotone"
                  dataKey="OTHER"
                  stackId="weights"
                  stroke="#64748b"
                  fill="#64748b"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
