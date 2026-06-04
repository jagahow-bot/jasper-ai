"use client";

import { useMemo } from "react";
import {
  activeObjectiveAtTs,
  activeRegimeAtTs,
  computeSharedDateDomain,
  chartLegendFontSize,
  chartTickFontSize,
  chartTooltipFontSize,
  formatChartTooltipLabel,
  JASPER_PERFORMANCE_CHART_SYNC,
  LAB_CHART_MARGIN,
  LAB_Y_AXIS_WIDTH,
  labXAxisProps,
  OBJECTIVE_BAND_COLORS,
  OBJECTIVE_DISPLAY_LABELS,
  objectiveBandRanges,
  parseDateTs,
  REGIME_BAND_COLORS,
  REGIME_DISPLAY_LABELS,
  REGIME_STRIP_COLORS,
  regimeBandRanges,
} from "@/lib/benchmark-chart-scale";
import type { DynamicObjectiveTimelinePoint } from "@/lib/types";
import { ChartTooltip, type RechartsTooltipContentProps } from "@/components/ChartTooltip";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const EQUITY_HEIGHT = 220;
const REGIME_STRIP_HEIGHT = 22;
const OBJECTIVE_STRIP_HEIGHT = 22;
const WEIGHT_HEIGHT = 260;

type EquityPoint = { date: string; value: number };

type Props = {
  equityCurve: EquityPoint[];
  benchmarkCurve?: EquityPoint[] | null;
  benchmarkLabel: string;
  weightHistory: ({ date: string } & Record<string, number | string>)[];
  weightTickers: string[];
  colors: string[];
  /** Walk-forward regime / objective steps (dynamic Jasper). */
  regimeTimeline?: DynamicObjectiveTimelinePoint[];
};

function PortfolioEquityTooltip({
  active,
  payload,
  label,
  timeline,
}: RechartsTooltipContentProps & {
  timeline: DynamicObjectiveTimelinePoint[];
}) {
  if (!active || !payload?.length) return null;
  const ts = Number(label);
  const dateLabel = formatChartTooltipLabel(label);
  const regime =
    timeline.length && Number.isFinite(ts)
      ? activeRegimeAtTs(ts, timeline)
      : null;
  const objective =
    timeline.length && Number.isFinite(ts)
      ? activeObjectiveAtTs(ts, timeline)
      : null;

  const tipPx = chartTooltipFontSize();

  return (
    <div
      className="border-2 border-[var(--neon)] bg-[#050508] px-3 py-2 min-w-[160px]"
      style={{ fontSize: tipPx }}
    >
      <div
        className="mb-1 font-pixel text-[var(--amber)]"
        style={{ fontSize: Math.max(11, tipPx - 1) }}
      >
        {dateLabel}
      </div>
      {regime && (
        <p className="text-dim">
          Regime: {REGIME_DISPLAY_LABELS[regime] ?? regime}
        </p>
      )}
      {objective && (
        <p className="text-dim">
          Active objective: {OBJECTIVE_DISPLAY_LABELS[objective] ?? objective}
        </p>
      )}
      <ul className="mt-1 space-y-0.5">
        {payload.map((row, i) => (
          <li key={`${row.dataKey ?? i}`} className="flex justify-between gap-3">
            <span className="text-dim" style={{ color: row.color }}>
              {row.name ?? row.dataKey}
            </span>
            <span className="text-neon font-semibold">
              {typeof row.value === "number" ? `${row.value.toFixed(2)}%` : "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LinkedEquityWeightChart({
  equityCurve,
  benchmarkCurve,
  benchmarkLabel,
  weightHistory,
  weightTickers,
  colors,
  regimeTimeline = [],
}: Props) {
  const timeline = regimeTimeline;

  const equityChartData = useMemo(() => {
    const benchByDate = new Map(
      (benchmarkCurve ?? []).map((r) => [r.date, Number(r.value)]),
    );
    return equityCurve.map((row) => {
      const portNorm = Number(row.value);
      const benchNorm = benchByDate.get(row.date);
      return {
        date: row.date,
        ts: parseDateTs(row.date),
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
        ts: parseDateTs(String(row.date)),
        OTHER: Number(
          (row as Record<string, unknown>).OTHER ?? Math.max(0, 1 - sumShown),
        ),
      };
    };
    return weightHistory.map((row) => enrich(row));
  }, [weightHistory, weightTickers]);

  const sharedDomain = useMemo(() => {
    const benchForDomain = equityChartData.map((r) => ({
      date: r.date,
      cumulative_return_pct: r.portfolio,
      price_index: 0,
    }));
    return computeSharedDateDomain(benchForDomain, timeline);
  }, [equityChartData, timeline]);

  const objectiveBands = useMemo(() => {
    if (!timeline.length || !sharedDomain) return [];
    return objectiveBandRanges(timeline, sharedDomain.max);
  }, [timeline, sharedDomain]);

  const regimeBands = useMemo(() => {
    if (!timeline.length || !sharedDomain) return [];
    return regimeBandRanges(timeline, sharedDomain.max, "active_regime");
  }, [timeline, sharedDomain]);

  const xAxisProps = useMemo(() => {
    if (!sharedDomain) return null;
    return labXAxisProps(sharedDomain.min, sharedDomain.max);
  }, [sharedDomain]);

  const stripAnchor = useMemo(() => {
    if (!sharedDomain) return [];
    return [
      { ts: sharedDomain.min, v: 0 },
      { ts: sharedDomain.max, v: 1 },
    ];
  }, [sharedDomain]);

  const tickFont = chartTickFontSize();
  const legendFont = chartLegendFontSize();
  const showOtherBand = useMemo(() => {
    if (!weightChartData.length) return false;
    const maxOther = Math.max(
      ...weightChartData.map((row) => Number(row.OTHER ?? 0)),
    );
    return maxOther > 0.005;
  }, [weightChartData]);

  const hasEquity = equityChartData.length > 0;
  const hasWeights = weightChartData.length > 0 && weightTickers.length > 0;
  const hasBenchmark = equityChartData.some(
    (r) => r.benchmark != null && Number.isFinite(r.benchmark),
  );
  const hasTimeline = timeline.length > 0;
  const regimesInRun = [
    ...new Set(timeline.map((r) => r.regime).filter(Boolean)),
  ];
  const objectivesInRun = [
    ...new Set(timeline.map((r) => r.objective).filter(Boolean)),
  ];

  if (!hasEquity && !hasWeights) {
    return (
      <p className="text-xs text-dim">No equity or weight history for this model.</p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-dim">
        Linked cursor: performance, regime/objective bands, and stacked weights share one date axis.
      </p>

      {hasEquity && (
        <div className="border-2 border-[var(--border)] bg-[#050508] p-2">
          <p className="mb-1 px-1 text-[10px] uppercase tracking-wide text-dim">
            Cumulative return % · Portfolio vs {benchmarkLabel}
          </p>
          <ResponsiveContainer width="100%" height={EQUITY_HEIGHT}>
            <LineChart
              {...JASPER_PERFORMANCE_CHART_SYNC}
              data={equityChartData}
              margin={LAB_CHART_MARGIN}
            >
              <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
              {xAxisProps ? (
                <XAxis {...xAxisProps} />
              ) : (
                <XAxis
                  dataKey="date"
                  stroke="#94a3b8"
                  fontSize={tickFont}
                  minTickGap={28}
                  tickFormatter={(v) => String(v).slice(2)}
                />
              )}
              <YAxis
                domain={["auto", "auto"]}
                stroke="#94a3b8"
                fontSize={tickFont}
                width={LAB_Y_AXIS_WIDTH}
                tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
              />
              {regimeBands.map((b) => (
                <ReferenceArea
                  key={`reg-${b.startTs}-${b.regime}`}
                  x1={b.startTs}
                  x2={b.endTs}
                  fill={REGIME_BAND_COLORS[b.regime] ?? "transparent"}
                  strokeOpacity={0}
                  ifOverflow="hidden"
                />
              ))}
              {objectiveBands.map((b) => (
                <ReferenceArea
                  key={`obj-${b.startTs}-${b.objective}`}
                  x1={b.startTs}
                  x2={b.endTs}
                  fill={OBJECTIVE_BAND_COLORS[b.objective] ?? "transparent"}
                  strokeOpacity={0}
                  ifOverflow="hidden"
                />
              ))}
              <Tooltip
                content={
                  hasTimeline ? (
                    <PortfolioEquityTooltip timeline={timeline} />
                  ) : (
                    <ChartTooltip valueDecimals={2} valueIsPct={false} />
                  )
                }
                labelFormatter={formatChartTooltipLabel}
              />
              <Legend wrapperStyle={{ fontSize: legendFont }} />
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

          {hasTimeline && xAxisProps && stripAnchor.length > 0 && (
            <>
              <ResponsiveContainer width="100%" height={REGIME_STRIP_HEIGHT}>
                <LineChart
                  {...JASPER_PERFORMANCE_CHART_SYNC}
                  data={stripAnchor}
                  margin={LAB_CHART_MARGIN}
                >
                  <XAxis {...xAxisProps} hide />
                  <YAxis hide domain={[0, 1]} width={LAB_Y_AXIS_WIDTH} />
                  {regimeBands.map((b, i) => {
                    const row = timeline[i];
                    const fill = row?.switched
                      ? "var(--amber)"
                      : REGIME_STRIP_COLORS[b.regime] ?? "var(--border)";
                    return (
                      <ReferenceArea
                        key={`reg-strip-${row?.date ?? i}`}
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
              <ResponsiveContainer width="100%" height={OBJECTIVE_STRIP_HEIGHT}>
                <LineChart
                  {...JASPER_PERFORMANCE_CHART_SYNC}
                  data={stripAnchor}
                  margin={LAB_CHART_MARGIN}
                >
                  <XAxis {...xAxisProps} hide />
                  <YAxis hide domain={[0, 1]} width={LAB_Y_AXIS_WIDTH} />
                  {objectiveBands.map((b, i) => {
                    const row = timeline[i];
                    const fill = row?.switched
                      ? "var(--amber)"
                      : OBJECTIVE_BAND_COLORS[b.objective] ?? "var(--border)";
                    return (
                      <ReferenceArea
                        key={`obj-strip-${row?.date ?? i}`}
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
              <div className="mt-1 flex flex-wrap gap-3 px-1 text-[10px] text-dim">
                {regimesInRun.map((regime) => (
                  <span key={regime} className="inline-flex items-center gap-1">
                    <span
                      className="inline-block h-2 w-3 rounded-sm border border-[var(--border)]"
                      style={{
                        backgroundColor:
                          REGIME_STRIP_COLORS[regime] ?? "var(--border)",
                      }}
                    />
                    {REGIME_DISPLAY_LABELS[regime] ?? regime}
                  </span>
                ))}
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
                <span className="text-[var(--amber)]">Amber = switch</span>
              </div>
            </>
          )}
        </div>
      )}

      {hasWeights && (
        <div className="border-2 border-[var(--border)] bg-[#050508] p-2">
          <p className="mb-1 px-1 text-[10px] uppercase tracking-wide text-dim">
            Holding weights (stacked)
            <span className="ml-2 normal-case tracking-normal text-[var(--border)]">
              · Other capped at 10% (dynamic sleeves)
            </span>
            <span className="ml-2 normal-case tracking-normal text-[var(--border)]">
              · Hover chart for holdings
            </span>
          </p>
          <ResponsiveContainer width="100%" height={WEIGHT_HEIGHT}>
            <AreaChart
              {...JASPER_PERFORMANCE_CHART_SYNC}
              data={weightChartData}
              margin={LAB_CHART_MARGIN}
            >
              <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
              {xAxisProps ? (
                <XAxis {...xAxisProps} />
              ) : (
                <XAxis
                  dataKey="date"
                  stroke="#94a3b8"
                  fontSize={tickFont}
                  minTickGap={28}
                  tickFormatter={(v) => String(v).slice(2)}
                />
              )}
              <YAxis
                domain={[0, 1]}
                stroke="#94a3b8"
                fontSize={tickFont}
                width={LAB_Y_AXIS_WIDTH}
                tickFormatter={(v) => `${(Number(v) * 100).toFixed(0)}%`}
              />
              <Tooltip
                allowEscapeViewBox={{ x: true, y: true }}
                wrapperStyle={{ zIndex: 10050, pointerEvents: "none" }}
                content={
                  <ChartTooltip
                    valueIsPct
                    valueDecimals={2}
                    sortByValue
                  />
                }
                labelFormatter={formatChartTooltipLabel}
              />
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
              {showOtherBand && (
                <Area
                  key="OTHER"
                  type="monotone"
                  dataKey="OTHER"
                  name="Other"
                  stackId="weights"
                  stroke="#64748b"
                  fill="#64748b"
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
