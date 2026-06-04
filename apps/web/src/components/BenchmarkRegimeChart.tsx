"use client";

import {
  activeRegimeAtTs,
  formatAxisDate,
  LAB_CHART_MARGIN,
  LAB_CHART_SYNC_ID,
  LAB_Y_AXIS_WIDTH,
  labXAxisProps,
  parseDateTs,
  regimeBandRanges,
  computeSharedDateDomain,
} from "@/lib/benchmark-chart-scale";
import type { BenchmarkSeriesPoint, ObjectiveSwitchLabResult } from "@/lib/types";
import type { RechartsTooltipContentProps } from "@/components/ChartTooltip";
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
const STRIP_CHART_HEIGHT = 24;
const RAW_STRIP_CHART_HEIGHT = 10;

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

const CHART_SYNC = { syncId: LAB_CHART_SYNC_ID, syncMethod: "value" as const };

type Props = {
  benchmarkSeries: BenchmarkSeriesPoint[];
  regimeTimeline: ObjectiveSwitchLabResult["regime_timeline"];
  benchmarkTicker: string;
};

function BenchmarkRegimeTooltip({
  active,
  payload,
  label,
  regimeTimeline,
}: RechartsTooltipContentProps & {
  regimeTimeline: ObjectiveSwitchLabResult["regime_timeline"];
}) {
  if (!active || !payload?.length) return null;
  const ts = Number(label);
  if (!Number.isFinite(ts)) return null;
  const value = payload[0]?.value;
  const regime = activeRegimeAtTs(ts, regimeTimeline);

  return (
    <div
      className="rounded border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-[11px]"
      style={{ fontSize: 11 }}
    >
      <p className="text-[var(--foreground)]">Date: {formatAxisDate(ts)}</p>
      <p className="text-dim">
        Cumulative return:{" "}
        {typeof value === "number" ? `${value.toFixed(2)}%` : "—"}
      </p>
      {regime && <p className="text-dim">Active regime: {regime}</p>}
      {(() => {
        let raw: string | null = null;
        for (const row of regimeTimeline) {
          const rowTs = parseDateTs(row.date);
          if (Number.isNaN(rowTs) || rowTs > ts) break;
          if (row.raw_regime) raw = row.raw_regime;
        }
        return raw ? <p className="text-dim">Raw regime: {raw}</p> : null;
      })()}
    </div>
  );
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
  const bands = regimeBandRanges(regimeTimeline, domainMax, "active_regime");
  const hasRaw = regimeTimeline.some((r) => r.raw_regime);
  const rawBands = hasRaw
    ? regimeBandRanges(regimeTimeline, domainMax, "raw_regime")
    : [];
  const chartData = benchmarkSeries.map((p) => ({
    ...p,
    ts: parseDateTs(p.date),
  }));
  const stripAnchor = [
    { ts: domainMin, v: 0 },
    { ts: domainMax, v: 1 },
  ];
  const xAxis = labXAxisProps(domainMin, domainMax);

  return (
    <div className="space-y-1">
      <ResponsiveContainer width="100%" height={MAIN_CHART_HEIGHT}>
        <LineChart
          {...CHART_SYNC}
          data={chartData}
          margin={LAB_CHART_MARGIN}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis {...xAxis} />
          <YAxis
            tick={{ fontSize: 9, fill: "var(--dim)" }}
            width={LAB_Y_AXIS_WIDTH}
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
            content={
              <BenchmarkRegimeTooltip regimeTimeline={regimeTimeline} />
            }
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
          <LineChart
            {...CHART_SYNC}
            data={stripAnchor}
            margin={LAB_CHART_MARGIN}
          >
            <XAxis {...xAxis} hide />
            <YAxis hide domain={[0, 1]} width={LAB_Y_AXIS_WIDTH} />
            {bands.map((b, i) => {
              const row = regimeTimeline[i];
              const fill = row.switched
                ? "var(--amber)"
                : REGIME_STRIP_COLORS[b.regime] ?? "var(--border)";
              return (
                <ReferenceArea
                  key={`active-${row.date}`}
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

      {rawBands.length > 0 && (
        <ResponsiveContainer width="100%" height={RAW_STRIP_CHART_HEIGHT}>
          <LineChart
            {...CHART_SYNC}
            data={stripAnchor}
            margin={LAB_CHART_MARGIN}
          >
            <XAxis {...xAxis} hide />
            <YAxis hide domain={[0, 1]} width={LAB_Y_AXIS_WIDTH} />
            {rawBands.map((b, i) => {
              const row = regimeTimeline[i];
              const fill = REGIME_STRIP_COLORS[b.regime] ?? "var(--border)";
              return (
                <ReferenceArea
                  key={`raw-${row.date}`}
                  x1={b.startTs}
                  x2={b.endTs}
                  y1={0}
                  y2={1}
                  fill={fill}
                  fillOpacity={0.45}
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
        Top: {benchmarkTicker} cumulative return (%). Background bands = active regime
        (hysteresis). Middle strip = active steps (amber = switch). Thin bottom strip = raw
        arbitration when available. Hover syncs with the regime scores chart below when shown.
      </p>
    </div>
  );
}
