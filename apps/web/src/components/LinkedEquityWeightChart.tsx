"use client";

import { useMemo } from "react";
import {
  aggregateWeightHistoryByAssetClass,
  ASSET_CLASS_CHART_COLORS,
  buildTickerAssetClassMap,
} from "@/lib/asset-class-weight-history";
import { assetClassLabel, objectiveBandLabel, regimeLabel, useI18n } from "@/lib/i18n";
import { getUniverseItems } from "@/lib/universe";
import {
  activeObjectiveAtTs,
  activeRegimeAtTs,
  alignWeightHistoryToEquityStart,
  extendWeightHistoryToEquityEnd,
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
  objectiveBandRanges,
  parseDateTs,
  REGIME_BAND_COLORS,
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
  const { t } = useI18n();
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
          {t("linkedChart.tooltipRegime")}: {regimeLabel(t, regime)}
        </p>
      )}
      {objective && (
        <p className="text-dim">
          {t("linkedChart.tooltipActiveObjective")}: {objectiveBandLabel(t, objective)}
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
  const { t } = useI18n();
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
    const equityStart = equityCurve[0]?.date ? String(equityCurve[0].date) : "";
    const equityEnd = equityCurve[equityCurve.length - 1]?.date
      ? String(equityCurve[equityCurve.length - 1].date)
      : "";
    const aligned = extendWeightHistoryToEquityEnd(
      alignWeightHistoryToEquityStart(weightHistory, equityStart),
      equityEnd,
    );
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
    return aligned.map((row) => enrich(row));
  }, [weightHistory, weightTickers, equityCurve]);

  const sharedDomain = useMemo(() => {
    const benchForDomain = equityChartData.map((r) => ({
      date: r.date,
      cumulative_return_pct: r.portfolio,
      price_index: 0,
    }));
    const equityDomain = computeSharedDateDomain(benchForDomain, []);
    if (!timeline.length) return equityDomain;
    const withTimeline = computeSharedDateDomain(benchForDomain, timeline);
    if (!equityDomain) return withTimeline;
    // Walk-forward steps can start before the first equity point; don't stretch the axis left.
    return {
      min: equityDomain.min,
      max: withTimeline?.max ?? equityDomain.max,
    };
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

  const tickerAssetClassMap = useMemo(
    () => buildTickerAssetClassMap(getUniverseItems()),
    [],
  );

  const { data: classWeightChartData, classKeys: assetClassKeys } = useMemo(
    () =>
      aggregateWeightHistoryByAssetClass(
        weightChartData,
        weightTickers,
        tickerAssetClassMap,
      ),
    [weightChartData, weightTickers, tickerAssetClassMap],
  );

  const hasEquity = equityChartData.length > 0;
  const hasWeights = weightChartData.length > 0 && weightTickers.length > 0;
  const hasClassWeights = classWeightChartData.length > 0 && assetClassKeys.length > 0;
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
      <p className="text-xs text-dim">{t("linkedChart.noHistory")}</p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-dim">
        {t("linkedChart.linkedCursorHint")}
      </p>

      {hasEquity && (
        <div className="border-2 border-[var(--border)] bg-[#050508] p-2">
          <p className="mb-1 px-1 text-[10px] uppercase tracking-wide text-dim">
            {t("linkedChart.cumulativeTitle", { benchmark: benchmarkLabel })}
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
                name={t("linkedChart.portfolio")}
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
                    {regimeLabel(t, regime)}
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
                    {objectiveBandLabel(t, obj)}
                  </span>
                ))}
                <span className="text-[var(--amber)]">{t("linkedChart.amberSwitch")}</span>
              </div>
            </>
          )}
        </div>
      )}

      {hasWeights && (
        <div className="border-2 border-[var(--border)] bg-[#050508] p-2">
          <p className="mb-1 px-1 text-[10px] uppercase tracking-wide text-dim">
            {t("linkedChart.holdingsTitle")}
            <span className="ml-2 normal-case tracking-normal text-[var(--border)]">
              · {t("linkedChart.otherCapHint")}
            </span>
            <span className="ml-2 normal-case tracking-normal text-[var(--border)]">
              · {t("linkedChart.rebalanceSnapshotHint")}
            </span>
            <span className="ml-2 normal-case tracking-normal text-[var(--border)]">
              · {t("linkedChart.hoverHint")}
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
                  type="stepAfter"
                  dataKey={t}
                  stackId="weights"
                  stroke={colors[i % colors.length]}
                  fill={colors[i % colors.length]}
                />
              ))}
              {showOtherBand && (
                <Area
                  key="OTHER"
                  type="stepAfter"
                  dataKey="OTHER"
                  name={t("linkedChart.other")}
                  stackId="weights"
                  stroke="#64748b"
                  fill="#64748b"
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {hasClassWeights && (
        <div className="border-2 border-[var(--border)] bg-[#050508] p-2">
          <p className="mb-1 px-1 text-[10px] uppercase tracking-wide text-dim">
            {t("linkedChart.assetClassTitle")}
            <span className="ml-2 normal-case tracking-normal text-[var(--border)]">
              · {t("linkedChart.rebalanceSnapshotHint")}
            </span>
            <span className="ml-2 normal-case tracking-normal text-[var(--border)]">
              · {t("linkedChart.hoverHint")}
            </span>
          </p>
          <ResponsiveContainer width="100%" height={WEIGHT_HEIGHT}>
            <AreaChart
              {...JASPER_PERFORMANCE_CHART_SYNC}
              data={classWeightChartData}
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
              <Legend
                wrapperStyle={{ fontSize: legendFont }}
                formatter={(value) => assetClassLabel(t, String(value))}
              />
              {assetClassKeys.map((cls) => (
                <Area
                  key={cls}
                  type="stepAfter"
                  dataKey={cls}
                  name={assetClassLabel(t, cls)}
                  stackId="assetClasses"
                  stroke={ASSET_CLASS_CHART_COLORS[cls]}
                  fill={ASSET_CLASS_CHART_COLORS[cls]}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
