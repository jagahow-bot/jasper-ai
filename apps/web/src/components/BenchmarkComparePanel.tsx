"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  chartLegendFontSize,
  chartTickFontSize,
  JASPER_PERFORMANCE_CHART_SYNC,
  LAB_CHART_MARGIN,
  LAB_Y_AXIS_WIDTH,
} from "@/lib/benchmark-chart-scale";
import { objectiveLabel, useI18n } from "@/lib/i18n";
import { resolveRunObjective } from "@/lib/resolve-run-objective";
import {
  buildBenchmarkCompareChartData,
  buildMetricCompareRows,
  type RmCandidatePick,
} from "@/lib/rm-report-utils";
import type { BacktestRequest, BacktestResult } from "@/lib/types";

type Props = {
  anchorLabel: string;
  customizedLabel: string;
  baseResult: BacktestResult;
  adjustedResult: BacktestResult;
  request?: Pick<BacktestRequest, "objective"> | null;
  candidatePick?: RmCandidatePick;
};

export function BenchmarkComparePanel({
  anchorLabel,
  customizedLabel,
  baseResult,
  adjustedResult,
  request,
  candidatePick,
}: Props) {
  const { t } = useI18n();
  const objectiveKey = resolveRunObjective(request, adjustedResult.narrative_facts);
  const runObjective = objectiveLabel(t, objectiveKey);
  const tickFont = chartTickFontSize();
  const legendFont = chartLegendFontSize();

  const rows = useMemo(
    () =>
      buildMetricCompareRows(baseResult, adjustedResult, {
        cagr: t("compare.metric.cagr"),
        sharpe: t("compare.metric.sharpe"),
        mdd: t("compare.metric.mdd"),
        vol: t("compare.metric.vol"),
      }, candidatePick),
    [baseResult, adjustedResult, candidatePick, t],
  );

  const chartData = useMemo(
    () => buildBenchmarkCompareChartData(baseResult, adjustedResult, candidatePick),
    [baseResult, adjustedResult, candidatePick],
  );

  if (!rows.length) return null;

  return (
    <div className="pixel-panel space-y-4">
      <div>
        <h2 className="ui-panel-title">{t("compare.title")}</h2>
        {runObjective ? (
          <p
            className="mt-2 font-bold text-indigo-950"
            aria-label={`${t("results.runObjectiveLabel")}: ${runObjective}`}
          >
            {runObjective}
          </p>
        ) : null}
        <p className="mt-2 ui-hint">{t("compare.subtitle")}</p>
      </div>

      {chartData && chartData.length > 0 && (
        <div className="saas-inset p-2">
          <p className="mb-2 px-1 ui-section-title">
            {t("compare.chart.title")}
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart
              {...JASPER_PERFORMANCE_CHART_SYNC}
              data={chartData}
              margin={LAB_CHART_MARGIN}
            >
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                stroke="#94a3b8"
                fontSize={tickFont}
                minTickGap={28}
                tickFormatter={(v) => String(v).slice(2)}
              />
              <YAxis
                domain={["auto", "auto"]}
                stroke="#94a3b8"
                fontSize={tickFont}
                width={LAB_Y_AXIS_WIDTH}
                tickFormatter={(v) => `${Number(v).toFixed(0)}`}
              />
              <Tooltip labelFormatter={(v) => String(v)} />
              <Legend wrapperStyle={{ fontSize: legendFont }} />
              <Line
                type="monotone"
                dataKey="anchor"
                name={anchorLabel || t("compare.chart.anchor")}
                stroke="#d97706"
                dot={false}
                strokeWidth={2}
              />
              <Line
                type="monotone"
                dataKey="customized"
                name={customizedLabel || t("compare.chart.customized")}
                stroke="#2563eb"
                dot={false}
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-dim">
              <th className="py-2 pr-3 font-normal">{t("compare.col.metric")}</th>
              <th className="py-2 pr-3 font-normal">{anchorLabel}</th>
              <th className="py-2 pr-3 font-normal">{customizedLabel}</th>
              <th className="py-2 font-normal">{t("compare.col.delta")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const improved =
                row.key === "mdd" || row.key === "vol"
                  ? row.customizedValue < row.anchorValue
                  : row.customizedValue > row.anchorValue;
              const delta = row.customizedValue - row.anchorValue;
              const deltaClass = improved
                ? "text-emerald-600"
                : delta === 0
                  ? "text-dim"
                  : "text-red-600";

              return (
                <tr key={row.key} className="border-b border-[var(--border)]/50">
                  <td className="py-2 pr-3 text-dim">{row.label}</td>
                  <td className="py-2 pr-3 font-medium tabular-nums">
                    {row.anchorDisplay}
                  </td>
                  <td className="py-2 pr-3 font-medium tabular-nums text-[var(--primary)]">
                    {row.customizedDisplay}
                  </td>
                  <td className={`py-2 font-medium tabular-nums ${deltaClass}`}>
                    {row.deltaDisplay}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
