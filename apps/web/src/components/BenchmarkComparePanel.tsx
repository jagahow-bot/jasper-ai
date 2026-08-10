"use client";

import { useEffect, useMemo, useState } from "react";
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

import { ChartTooltip } from "@/components/ChartTooltip";
import { fetchCandidateCharts } from "@/lib/api";
import {
  chartLegendFontSize,
  chartTickFontSize,
  JASPER_PERFORMANCE_CHART_SYNC,
  LAB_CHART_MARGIN,
  LAB_Y_AXIS_WIDTH,
} from "@/lib/benchmark-chart-scale";
import {
  candidateHasFullCharts,
  mergeCandidateCharts,
} from "@/lib/candidate-charts-lazy";
import { objectiveLabel, useI18n } from "@/lib/i18n";
import { resolveRunObjective } from "@/lib/resolve-run-objective";
import {
  buildBenchmarkCompareChartData,
  buildMetricCompareRows,
  rebasedEquityToCumulativePct,
  type RmCandidatePick,
} from "@/lib/rm-report-utils";
import type {
  BacktestRequest,
  BacktestResult,
  CandidateChartsPayload,
} from "@/lib/types";

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

  const selectedModelCode = candidatePick?.customizedModelCode ?? null;
  const selectedCandidate = useMemo(() => {
    if (!selectedModelCode) return null;
    return (
      adjustedResult.candidates.find(
        (c) =>
          (c.model_code ?? "").toUpperCase() === selectedModelCode.toUpperCase(),
      ) ?? null
    );
  }, [adjustedResult.candidates, selectedModelCode]);

  const needsLazyCharts = Boolean(
    selectedModelCode &&
      selectedCandidate &&
      !candidateHasFullCharts(selectedCandidate),
  );

  const [lazyChartsByCode, setLazyChartsByCode] = useState<
    Record<string, CandidateChartsPayload>
  >({});
  const [chartsLoadingCode, setChartsLoadingCode] = useState<string | null>(
    null,
  );
  const [chartsLoadError, setChartsLoadError] = useState<string | null>(null);

  useEffect(() => {
    setLazyChartsByCode({});
    setChartsLoadingCode(null);
    setChartsLoadError(null);
  }, [adjustedResult.job_id]);

  useEffect(() => {
    if (!selectedModelCode || !needsLazyCharts) return;
    if (lazyChartsByCode[selectedModelCode]?.equity_curve?.length) return;

    let cancelled = false;
    setChartsLoadingCode(selectedModelCode);
    setChartsLoadError(null);
    void (async () => {
      try {
        const payload = await fetchCandidateCharts(
          adjustedResult.job_id,
          selectedModelCode,
          { rank: selectedCandidate?.rank },
        );
        if (!cancelled) {
          setLazyChartsByCode((prev) => ({
            ...prev,
            [selectedModelCode]: payload,
          }));
        }
      } catch (err) {
        if (!cancelled) {
          setChartsLoadError(
            err instanceof Error ? err.message : t("results.failedLoadTrajectory"),
          );
        }
      } finally {
        if (!cancelled) setChartsLoadingCode(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    selectedModelCode,
    selectedCandidate?.rank,
    needsLazyCharts,
    lazyChartsByCode,
    adjustedResult.job_id,
    t,
  ]);

  const enrichedAdjustedResult = useMemo(() => {
    if (!selectedModelCode || !selectedCandidate) return adjustedResult;
    const lazy = lazyChartsByCode[selectedModelCode];
    if (!lazy?.equity_curve?.length && candidateHasFullCharts(selectedCandidate)) {
      return adjustedResult;
    }
    if (!lazy?.equity_curve?.length) return adjustedResult;

    const merged = mergeCandidateCharts(selectedCandidate, lazy);
    return {
      ...adjustedResult,
      candidates: adjustedResult.candidates.map((c) =>
        (c.model_code ?? "").toUpperCase() === selectedModelCode.toUpperCase()
          ? merged
          : c,
      ),
    };
  }, [
    adjustedResult,
    selectedModelCode,
    selectedCandidate,
    lazyChartsByCode,
  ]);

  const rows = useMemo(
    () =>
      buildMetricCompareRows(baseResult, enrichedAdjustedResult, {
        cagr: t("compare.metric.cagr"),
        sharpe: t("compare.metric.sharpe"),
        mdd: t("compare.metric.mdd"),
        vol: t("compare.metric.vol"),
      }, candidatePick),
    [baseResult, enrichedAdjustedResult, candidatePick, t],
  );

  const chartData = useMemo(
    () =>
      buildBenchmarkCompareChartData(
        baseResult,
        enrichedAdjustedResult,
        candidatePick,
      ),
    [baseResult, enrichedAdjustedResult, candidatePick],
  );

  // Rebased index (100→…) → cumulative return % from common start (matches LinkedEquityWeightChart).
  const pctChartData = useMemo(() => {
    if (!chartData?.length) return null;
    return rebasedEquityToCumulativePct(chartData);
  }, [chartData]);

  const chartsLoading = Boolean(
    needsLazyCharts &&
      chartsLoadingCode === selectedModelCode &&
      !pctChartData?.length,
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

      {chartsLoading ? (
        <p className="ui-hint flex items-center gap-2 px-1">
          <span
            className="inline-block h-3 w-3 animate-spin rounded-full border border-[var(--amber)] border-t-transparent"
            aria-hidden
          />
          {t("results.loadingTrajectory", {
            model: selectedModelCode ?? "",
          })}
        </p>
      ) : null}
      {chartsLoadError && !pctChartData?.length ? (
        <p className="ui-hint px-1 text-red-400">{chartsLoadError}</p>
      ) : null}

      {pctChartData && pctChartData.length > 0 && (
        <div className="saas-inset p-2">
          <p className="mb-2 px-1 ui-section-title">
            {t("compare.chart.title")}
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart
              {...JASPER_PERFORMANCE_CHART_SYNC}
              data={pctChartData}
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
                tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    valueDecimals={2}
                    valueIsPct={false}
                    valueSuffix="%"
                    sortByValue
                  />
                }
              />
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
              // Prefer utils trafficLight so MDD severity delta (|c|−|a|) colors correctly.
              const deltaClass =
                row.trafficLight === "better"
                  ? "text-emerald-600"
                  : row.trafficLight === "neutral"
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
