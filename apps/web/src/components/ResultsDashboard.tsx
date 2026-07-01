"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Label,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { ChartTooltip } from "@/components/ChartTooltip";
import { InstitutionalReport } from "@/components/InstitutionalReport";
import { LinkedEquityWeightChart } from "@/components/LinkedEquityWeightChart";
import { QuickRefinements } from "@/components/QuickRefinements";
import {
  ASSET_CLASS_LABELS,
  SUB_ASSET_CLASS_LABELS,
  SUB_ASSET_PARAM_KEYS,
  type SubAssetClassKey,
} from "@/lib/constants";
import {
  REGIME_QUOTA_KEYS,
  type RegimeQuotaKey,
  normalizeRegimeClassQuotas,
  quotaKeysForClasses,
} from "@/lib/asset-class-policy";
import {
  alignDualAxisZeroDomains,
  capDomainMax,
  compareModelCode,
  extentWithZero,
  tightMaxFromValues,
} from "@/lib/align-y-axis-zero";
import {
  filterFrontierSamplesForDisplay,
  frontierTooltipLabel,
} from "@/lib/efficient-frontier-chart";
import {
  buildPerformanceCompareRows,
  candidateModelKey,
  candidateRowKey,
  performanceCompareRowsByChartKey,
  performanceCompareTickLabel,
  resolveChampionCandidateIndex,
  resolveChampionModelKey,
  resolveDefaultSelectedRowKey,
  resolveHorizonMetrics,
  resolveOutOfSampleMetrics,
} from "@/lib/performance-compare-chart";
import {
  buildCompareEffectKey,
  computeAllCandidatesBelowBenchmark,
} from "@/lib/compare-summary";
import { fetchCandidateCharts } from "@/lib/api";
import {
  candidateHasDeepAnalytics,
  candidateHasFullCharts,
  lazyPayloadComplete,
  mergeCandidateCharts,
} from "@/lib/candidate-charts-lazy";
import type {
  BacktestRequest,
  BacktestResult,
  BenchmarkSeriesPoint,
  CandidateChartsPayload,
  DynamicObjectiveTimelinePoint,
} from "@/lib/types";
import {
  alignWeightHistoryToEquityStart,
  chartLegendFontSize,
  chartTickFontSize,
  chartTooltipFontSize,
} from "@/lib/benchmark-chart-scale";
import { getUniverseItems } from "@/lib/universe";
import { regimeLabel, useI18n } from "@/lib/i18n";

const CHAMPION_STROKE = "#ffb000";
const BENCHMARK_FILL = "#ffb000";
const METRIC_FILLS = {
  cagr: "#34d399",
  mdd: "#f87171",
  sharpe: "#60a5fa",
  sortino: "#a78bfa",
} as const;

/**
 * Guarantee the negative half of the performance-compare axes stays visible
 * (≥12% of the span) whenever any Sharpe / CAGR / Sortino / drawdown value is
 * negative, so below-zero bars are never squashed against the axis edge.
 */
const PERFORMANCE_MIN_NEGATIVE_RATIO = 0.12;

type LeaderboardSort = "in_sample" | "out_of_sample" | "full_sample";

function leaderboardSortValue(
  row: {
    in_sample_objective?: number;
    out_of_sample_objective?: number;
    full_sample_objective?: number;
  },
  sort: LeaderboardSort,
): number {
  const v =
    sort === "out_of_sample"
      ? row.out_of_sample_objective
      : sort === "full_sample"
        ? row.full_sample_objective
        : row.in_sample_objective;
  return Number(v ?? -1e9);
}

const COLORS = [
  "#39ff14",
  "#00f5ff",
  "#ff2bd6",
  "#ffb000",
  "#a78bfa",
  "#f87171",
  "#22d3ee",
  "#5a7a5a",
  "#4ade80",
  "#fb923c",
];

const SELECTED_STROKE = "#f97316";

/**
 * Prefer ticker when catalog name is CJK (legacy universe labels), except when
 * the UI is in a CJK language where the localized name is the better label.
 */
function holdingDisplayName(
  ticker: string,
  catalogName?: string,
  lang?: string,
): string {
  if (!catalogName || catalogName === ticker) return ticker;
  const preferLocalized = lang === "zh" || lang === "ko";
  if (!preferLocalized && /[\u4e00-\u9fff\u3040-\u30ff]/.test(catalogName)) {
    return ticker;
  }
  return catalogName;
}

type Props = {
  result: BacktestResult;
  narrative: string;
  /** Optional Pro round context prepended above the job-level AI narrative. */
  narrativePrefix?: string;
  request: BacktestRequest;
  onRerun: () => void;
  onExport: () => void;
  onQuickTweak: (next: BacktestRequest, label: string) => void;
  onQuickTweakAndRun: (next: BacktestRequest, label: string) => void;
};

export function ResultsDashboard({
  result,
  narrative,
  narrativePrefix,
  request,
  onRerun,
  onExport,
  onQuickTweak,
  onQuickTweakAndRun,
}: Props) {
  const { t, lang } = useI18n();
  const chartTick = chartTickFontSize();
  const chartLegend = chartLegendFontSize();
  const chartTip = chartTooltipFontSize();
  const [selectedRowKey, setSelectedRowKey] = useState<string>("");
  const [compareSummary, setCompareSummary] = useState("");
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareRetryNote, setCompareRetryNote] = useState<string | null>(null);
  const [leaderboardSort, setLeaderboardSort] =
    useState<LeaderboardSort>("in_sample");
  const [lazyChartsByCode, setLazyChartsByCode] = useState<
    Record<string, CandidateChartsPayload>
  >({});
  const [chartsLoadingCode, setChartsLoadingCode] = useState<string | null>(
    null,
  );
  const [chartsLoadError, setChartsLoadError] = useState<string | null>(null);

  const resultSelectionEpoch = useMemo(
    () =>
      `${result.job_id}\0${result.candidates
        .map((c, i) => candidateRowKey(c, i))
        .join("\0")}`,
    [result.job_id, result.candidates],
  );

  const championNarrativeFacts = result.narrative_facts;

  useEffect(() => {
    setCompareSummary("");
    setCompareRetryNote(null);
    setLazyChartsByCode({});
    setChartsLoadingCode(null);
    setChartsLoadError(null);
  }, [resultSelectionEpoch, result.narrative_facts]);

  useEffect(() => {
    setSelectedRowKey(
      resolveDefaultSelectedRowKey(
        result.candidates,
        championNarrativeFacts,
      ),
    );
  }, [resultSelectionEpoch, result.candidates, championNarrativeFacts]);

  const defaultSelectedRowKey = useMemo(
    () =>
      resolveDefaultSelectedRowKey(
        result.candidates,
        championNarrativeFacts,
      ),
    [result.candidates, championNarrativeFacts],
  );

  const selected = useMemo(() => {
    const fallbackIdx = resolveChampionCandidateIndex(
      result.candidates,
      championNarrativeFacts,
    );
    const fallback =
      fallbackIdx >= 0 ? result.candidates[fallbackIdx] : result.candidates[0];
    if (!fallback) return undefined;
    const rowKey = selectedRowKey || defaultSelectedRowKey;
    if (!rowKey) return fallback;
    const idx = result.candidates.findIndex(
      (c, i) => candidateRowKey(c, i) === rowKey,
    );
    return idx >= 0 ? result.candidates[idx] : fallback;
  }, [
    result.candidates,
    championNarrativeFacts,
    selectedRowKey,
    defaultSelectedRowKey,
  ]);
  const selectedChartKey = useMemo(() => {
    if (!selected) return "";
    const idx = result.candidates.indexOf(selected);
    return candidateRowKey(selected, idx >= 0 ? idx : 0);
  }, [selected, result.candidates]);

  const championModelKey = useMemo(
    () => resolveChampionModelKey(result.candidates, championNarrativeFacts),
    [result.candidates, championNarrativeFacts],
  );

  const championCandidate = useMemo(() => {
    const idx = resolveChampionCandidateIndex(
      result.candidates,
      championNarrativeFacts,
    );
    return idx >= 0 ? result.candidates[idx] : result.candidates[0];
  }, [result.candidates, championNarrativeFacts]);

  const isDynamicObjective =
    request.objective === "dynamic" ||
    result.narrative_facts.objective === "dynamic" ||
    result.narrative_facts.dynamic_objective_enabled === true;

  const championRationale = useMemo(() => {
    const pr = result.narrative_facts.pro_refinement as
      | {
          per_round?: {
            ai_champion_model_code?: string | null;
            ai_champion_rationale?: string | null;
          }[];
        }
      | null
      | undefined;
    const rounds = pr?.per_round ?? [];
    for (let i = rounds.length - 1; i >= 0; i--) {
      const row = rounds[i];
      const text = (row?.ai_champion_rationale ?? "").trim();
      if (row?.ai_champion_model_code && text) {
        return { code: String(row.ai_champion_model_code), text };
      }
    }
    return null;
  }, [result.narrative_facts.pro_refinement]);

  const selectedModelCode = selected?.model_code ?? "";
  const selectedHasFullCharts = useMemo(
    () => candidateHasFullCharts(selected),
    [selected],
  );
  const selectedHasDeepAnalytics = useMemo(
    () => candidateHasDeepAnalytics(selected),
    [selected],
  );
  const needsLazyCharts = !selectedHasFullCharts;
  const needsLazyAnalytics = !selectedHasDeepAnalytics;
  const lazyCharts = selectedModelCode
    ? lazyChartsByCode[selectedModelCode]
    : undefined;

  useEffect(() => {
    if (!selectedModelCode || (!needsLazyCharts && !needsLazyAnalytics)) return;
    if (
      lazyCharts &&
      lazyPayloadComplete(lazyCharts, needsLazyCharts, needsLazyAnalytics)
    ) {
      return;
    }
    let cancelled = false;
    setChartsLoadingCode(selectedModelCode);
    setChartsLoadError(null);
    void (async () => {
      try {
        const payload = await fetchCandidateCharts(
          result.job_id,
          selectedModelCode,
          { rank: selected?.rank },
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
    selected?.rank,
    needsLazyCharts,
    needsLazyAnalytics,
    lazyCharts,
    result.job_id,
  ]);

  const chartsReady =
    (!needsLazyCharts || selectedHasFullCharts || Boolean(lazyCharts)) &&
    (!needsLazyAnalytics ||
      selectedHasDeepAnalytics ||
      Boolean(lazyCharts?.institutional?.rolling?.rolling_sharpe?.length));
  const chartsLoading = Boolean(
    selectedModelCode &&
      !chartsReady &&
      chartsLoadingCode === selectedModelCode,
  );

  const chartCandidate = useMemo(() => {
    if (!selected) return championCandidate;
    if (selectedHasFullCharts && selectedHasDeepAnalytics) return selected;
    if (lazyCharts) return mergeCandidateCharts(selected, lazyCharts);
    return selected;
  }, [
    selected,
    selectedHasFullCharts,
    selectedHasDeepAnalytics,
    lazyCharts,
    championCandidate,
  ]);

  const institutionalCandidate = useMemo(() => {
    if (!selected) return championCandidate;
    if (candidateHasDeepAnalytics(selected)) return selected;
    if (lazyCharts?.institutional) {
      return mergeCandidateCharts(selected, lazyCharts);
    }
    if (
      championCandidate &&
      selected.model_code !== championCandidate.model_code &&
      candidateHasDeepAnalytics(championCandidate)
    ) {
      return championCandidate;
    }
    return chartCandidate ?? selected;
  }, [selected, lazyCharts, championCandidate, chartCandidate]);

  const usingChampionAnalyticsFallback = Boolean(
    selected &&
      championCandidate &&
      selected.model_code !== championCandidate.model_code &&
      !candidateHasDeepAnalytics(selected) &&
      !lazyCharts?.institutional &&
      candidateHasDeepAnalytics(championCandidate),
  );

  const analyticsLoading = Boolean(
    chartsLoading && needsLazyAnalytics && !usingChampionAnalyticsFallback,
  );

  const weightHistory = useMemo(
    () =>
      ((chartCandidate?.analytics?.weight_history ?? []) as (
        | { date: string }
        & Record<string, number>
      )[]),
    [chartCandidate?.analytics?.weight_history],
  );
  const weightHistoryTickers = useMemo(
    () =>
      ((chartCandidate?.analytics?.weight_history_tickers ?? []) as string[]).filter(
        (t) => t !== "date",
      ),
    [chartCandidate?.analytics?.weight_history_tickers],
  );
  const equity = chartCandidate?.equity_curve ?? result.equity_curve ?? [];
  const historySeries = useMemo(() => {
    if (!weightHistory.length) return [];
    const firstEquityDate = equity[0]?.date ? String(equity[0].date) : "";
    const trimmed = firstEquityDate
      ? weightHistory.filter((row) => String(row.date) >= firstEquityDate)
      : weightHistory;
    const aligned = alignWeightHistoryToEquityStart(trimmed, firstEquityDate);
    return aligned.map((row) => {
      const sumShown = weightHistoryTickers.reduce(
        (acc, t) => acc + Number((row as Record<string, unknown>)[t] ?? 0),
        0,
      );
      return {
        ...row,
        OTHER:
          Number((row as Record<string, unknown>).OTHER ?? Math.max(0, 1 - sumShown)),
      };
    });
  }, [weightHistory, weightHistoryTickers, equity]);

  const tickerNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of getUniverseItems()) {
      map.set(item.ticker, item.name);
    }
    return map;
  }, []);

  const latestAllocationDate = useMemo(() => {
    if (weightHistory.length > 0) {
      const last = weightHistory[weightHistory.length - 1];
      if (last?.date) return String(last.date);
    }
    const dqEnd = (
      result.narrative_facts.data_quality as { end?: string } | undefined
    )?.end;
    if (dqEnd) return String(dqEnd);
    return result.period?.end ?? "—";
  }, [weightHistory, result.narrative_facts.data_quality, result.period?.end]);

  const weightCapAudit = useMemo(() => {
    const fromAnalytics = (
      selected?.analytics as { weight_cap_audit?: Record<string, unknown> } | undefined
    )?.weight_cap_audit;
    const fromFacts = result.narrative_facts.weight_cap_audit as
      | Record<string, unknown>
      | undefined;
    return fromAnalytics ?? fromFacts;
  }, [selected?.analytics, result.narrative_facts.weight_cap_audit]);

  const weightCapViolation = useMemo(() => {
    if (result.narrative_facts.weight_cap_violation === true) return true;
    if (!weightCapAudit) return false;
    const violations = Number(weightCapAudit.violation_count ?? 0);
    if (violations > 0) return true;
    return weightCapAudit.feasible === false;
  }, [result.narrative_facts.weight_cap_violation, weightCapAudit]);

  const allocationRows = useMemo(() => {
    const weights = selected?.weights ?? {};
    return Object.entries(weights)
      .filter(([, w]) => w > 0.001)
      .sort(([, a], [, b]) => b - a)
      .map(([ticker, weight]) => ({
        ticker,
        name: holdingDisplayName(ticker, tickerNameMap.get(ticker), lang),
        weight,
      }));
  }, [selected?.weights, tickerNameMap, lang]);

  const benchTicker = String(
    (result.narrative_facts.backtest_spec as { benchmark?: string } | undefined)
      ?.benchmark ?? "SPY",
  );
  const benchmarkEquity = useMemo(() => {
    const fromChart = chartCandidate?.analytics?.benchmark_equity_curve;
    if (fromChart?.length) return fromChart;
    for (const c of result.candidates) {
      const curve = c.analytics?.benchmark_equity_curve;
      if (curve?.length) return curve;
    }
    return [];
  }, [chartCandidate?.analytics?.benchmark_equity_curve, result.candidates]);

  const compareEffectKey = useMemo(
    () =>
      buildCompareEffectKey(
        resultSelectionEpoch,
        benchTicker,
        String(result.narrative_facts.objective ?? request.objective),
      ),
    [resultSelectionEpoch, benchTicker, result.narrative_facts.objective, request.objective],
  );

  useEffect(() => {
    if (result.candidates.length < 2) {
      setCompareSummary("");
      setCompareRetryNote(null);
      setCompareLoading(false);
      return;
    }
    let cancelled = false;
    setCompareLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/candidate-compare-summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            benchmark: benchTicker,
            objective: String(result.narrative_facts.objective ?? request.objective),
            objective_label: String(
              result.narrative_facts.objective_label ??
                result.narrative_facts.objective ??
                request.objective,
            ),
            champion_model_code:
              typeof result.narrative_facts.ai_champion_model_code === "string"
                ? result.narrative_facts.ai_champion_model_code
                : typeof result.narrative_facts.champion_model_code === "string"
                  ? result.narrative_facts.champion_model_code
                  : championModelKey,
            ai_champion_model_code:
              typeof result.narrative_facts.ai_champion_model_code === "string"
                ? result.narrative_facts.ai_champion_model_code
                : championModelKey,
            champion_rationale: championRationale?.text ?? null,
            benchmark_metrics: benchmarkBarMetrics,
            lang,
            candidates: result.candidates.map((c) => {
              const sm = c.analytics?.sample_metrics;
              return {
                model_code: c.model_code,
                rank: c.rank,
                is_champion: c.is_champion === true,
                sharpe: c.sharpe,
                cagr: c.cagr,
                max_drawdown: c.max_drawdown,
                volatility: c.volatility,
                turnover_avg: c.turnover_avg,
                beta: c.beta,
                alpha: c.alpha ?? c.alpha_annual,
                alpha_annual: c.alpha_annual ?? c.alpha,
                information_ratio: c.information_ratio,
                train_sharpe: c.train_sharpe,
                validation_sharpe: c.validation_sharpe,
                horizons: sm
                  ? {
                      in_sample: sm.in_sample,
                      out_of_sample: sm.out_of_sample,
                      full_sample: sm.full_sample,
                      gap: sm.gap,
                    }
                  : undefined,
              };
            }),
          }),
        });
        const json = (await res.json()) as {
          summary: string;
          retried_due_to_token_limit?: boolean;
        };
        if (!cancelled) {
          setCompareSummary(json.summary ?? "");
          setCompareRetryNote(
            json.retried_due_to_token_limit &&
              process.env.NODE_ENV === "development"
              ? t("results.compareRetried")
              : null,
          );
        }
      } catch {
        if (!cancelled) {
          setCompareSummary("");
          setCompareRetryNote(null);
        }
      } finally {
        if (!cancelled) setCompareLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [compareEffectKey, lang]);

  const benchmarkBarMetrics = useMemo(() => {
    const spec = result.narrative_facts.backtest_spec as
      | { benchmark_metrics?: Record<string, number> | null }
      | undefined;
    return spec?.benchmark_metrics ?? null;
  }, [result.narrative_facts.backtest_spec]);

  const allBelowBenchmark = useMemo(
    () =>
      computeAllCandidatesBelowBenchmark({
        benchmark_metrics: benchmarkBarMetrics,
        objective: String(result.narrative_facts.objective ?? request.objective),
        candidates: result.candidates.map((c) => ({
          rank: c.rank,
          sharpe: c.sharpe,
          cagr: c.cagr,
          max_drawdown: c.max_drawdown,
          horizons: c.analytics?.sample_metrics?.full_sample
            ? { full_sample: c.analytics.sample_metrics.full_sample }
            : undefined,
        })),
      }),
    [
      benchmarkBarMetrics,
      result.candidates,
      result.narrative_facts.objective,
      request.objective,
    ],
  );

  const dynamicObjectiveChart = useMemo(() => {
    // Show the regime / allocator-objective overlay whenever regime-adaptive
    // allocation ran — either via objective=dynamic (composite) or the standalone
    // regime_adaptive toggle under any ranking objective (e.g. Max CAGR).
    const showRegimeOverlay =
      request.objective === "dynamic" ||
      request.regime_adaptive === true ||
      result.narrative_facts.objective === "dynamic" ||
      result.narrative_facts.dynamic_objective_mode === true ||
      result.narrative_facts.regime_adaptive === true;
    if (!showRegimeOverlay) return null;

    const fromResult = result.dynamic_objective_timeline ?? [];
    const fromFacts = result.narrative_facts.dynamic_objective_timeline as
      | DynamicObjectiveTimelinePoint[]
      | undefined;
    const fromChampion = (
      (selected?.analytics as {
        sample_metrics?: { dynamic_objective_timeline?: DynamicObjectiveTimelinePoint[] };
      })?.sample_metrics?.dynamic_objective_timeline ?? []
    );
    const timeline =
      fromResult.length > 0
        ? fromResult
        : (fromFacts?.length ? fromFacts : fromChampion);
    if (!timeline.length) return null;

    let benchmarkSeries = (
      result.dynamic_objective_benchmark_series?.length
        ? result.dynamic_objective_benchmark_series
        : (result.narrative_facts.dynamic_objective_benchmark_series as
            | BenchmarkSeriesPoint[]
            | undefined)
    ) ?? [];

    if (!benchmarkSeries.length) {
      const benchByDate = new Map(
        benchmarkEquity.map((p) => [p.date, Number(p.value) - 100]),
      );
      const dateSource = equity.length ? equity : benchmarkEquity;
      if (dateSource.length) {
        benchmarkSeries = dateSource.map((p, i) => ({
          date: p.date,
          cumulative_return_pct: benchByDate.get(p.date) ?? 0,
          price_index: i + 1,
        }));
      }
    }

    return { timeline, benchmarkSeries };
  }, [
    request.objective,
    request.regime_adaptive,
    result.dynamic_objective_timeline,
    result.dynamic_objective_benchmark_series,
    result.narrative_facts,
    selected?.analytics,
    benchmarkEquity,
    equity,
  ]);

  const sortByModelCode = true;

  const modelSelectOptions = useMemo(() => {
    const indexed = result.candidates.map((c, i) => ({ c, i }));
    if (!sortByModelCode) return indexed;
    return [...indexed].sort((a, b) =>
      compareModelCode(
        a.c.model_code ?? `M?${a.c.rank}`,
        b.c.model_code ?? `M?${b.c.rank}`,
      ),
    );
  }, [result.candidates, sortByModelCode]);

  const candidateCompare = useMemo(
    () =>
      buildPerformanceCompareRows({
        candidates: result.candidates,
        championModelKey,
        championRowKey: defaultSelectedRowKey,
        sortByModelCode,
        benchmarkBarMetrics,
        benchTicker,
        selectedChartKey,
      }),
    [
      result.candidates,
      championModelKey,
      defaultSelectedRowKey,
      benchmarkBarMetrics,
      benchTicker,
      sortByModelCode,
      selectedChartKey,
    ],
  );

  const performanceCompareByChartKey = useMemo(
    () => performanceCompareRowsByChartKey(candidateCompare),
    [candidateCompare],
  );

  const [performanceLeftDomain, performanceRightDomain] = useMemo(() => {
    const leftVals = candidateCompare.flatMap((r) => [r.cagr_pct, r.mdd_pct]);
    const rightVals = candidateCompare.flatMap((r) => [r.sharpe, r.sortino]);
    const [left, right] = alignDualAxisZeroDomains(
      extentWithZero(leftVals, PERFORMANCE_MIN_NEGATIVE_RATIO),
      extentWithZero(rightVals, PERFORMANCE_MIN_NEGATIVE_RATIO),
    );
    return [left, capDomainMax(right, tightMaxFromValues(rightVals))];
  }, [candidateCompare]);

  const oosLeaderboardRaw = (
    result.narrative_facts.oos_leaderboard as
      | {
          model_code?: string;
          rank?: number;
          in_sample_objective?: number;
          out_of_sample_objective?: number;
          full_sample_objective?: number;
          gap_objective?: number;
          objective_label?: string;
        }[]
      | null
      | undefined
  )?.filter(Boolean);

  const holdoutLeaderboard = useMemo(() => {
    if (!oosLeaderboardRaw?.length) return [];
    const fullByCode = new Map<string, number>();
    for (const c of result.candidates) {
      const code = c.model_code;
      const full = c.analytics?.sample_metrics?.full_sample?.objective_value;
      if (code && full != null) fullByCode.set(code, Number(full));
    }
    return [...oosLeaderboardRaw]
      .map((row) => ({
        ...row,
        full_sample_objective:
          row.full_sample_objective ?? fullByCode.get(String(row.model_code ?? "")),
      }))
      .sort(
        (a, b) =>
          leaderboardSortValue(b, leaderboardSort) -
          leaderboardSortValue(a, leaderboardSort),
      );
  }, [oosLeaderboardRaw, result.candidates, leaderboardSort]);

  const paramFrontierSamples = useMemo(
    () =>
      filterFrontierSamplesForDisplay(
        result.efficient_frontier,
        result.candidates.map((c) => c.model_code),
      ),
    [result.efficient_frontier, result.candidates],
  );

  const fullMetrics = useMemo(
    () => (selected ? resolveHorizonMetrics(selected, "full_sample") : null),
    [selected],
  );
  const inSampleMetrics = useMemo(
    () =>
      selected?.analytics?.sample_metrics?.in_sample
        ? resolveHorizonMetrics(selected, "in_sample")
        : null,
    [selected],
  );
  const outOfSampleMetrics = useMemo(
    () => (selected ? resolveOutOfSampleMetrics(selected) : null),
    [selected],
  );

  const proRefinementForQuotas = result.narrative_facts.pro_refinement as
    | { per_round?: { regime_class_quotas?: Record<string, Record<string, number>> }[] }
    | null
    | undefined;

  const regimeQuotaMatrix = useMemo(() => {
    const fromFacts = result.narrative_facts.regime_class_quotas as
      | Record<string, Record<string, number>>
      | undefined;
    const perRound = (proRefinementForQuotas?.per_round ?? [])
      .map((r) => r.regime_class_quotas)
      .filter(Boolean)
      .at(-1);
    return normalizeRegimeClassQuotas(fromFacts ?? perRound ?? null);
  }, [result.narrative_facts.regime_class_quotas, proRefinementForQuotas]);

  const activeRegimeForQuotas = (
    (result.narrative_facts.current_regime as { regime?: string } | undefined)?.regime ??
    (
      (result.narrative_facts.dynamic_objective_timeline as { regime?: string }[] | undefined)?.at(
        -1,
      )?.regime
    )
  ) as RegimeQuotaKey | undefined;

  const [quotaRegimeTab, setQuotaRegimeTab] = useState<RegimeQuotaKey>(
    activeRegimeForQuotas && REGIME_QUOTA_KEYS.includes(activeRegimeForQuotas as RegimeQuotaKey)
      ? (activeRegimeForQuotas as RegimeQuotaKey)
      : "neutral",
  );

  if (!selected) return null;
  const top = selected;
  const activeHoldingsCount =
    weightCapAudit?.active_holdings != null
      ? Number(weightCapAudit.active_holdings)
      : Object.values(top.weights ?? {}).filter((w) => Number(w) > 0.0001).length;
  const donut = Object.entries(top.weights ?? {})
    .filter(([, w]) => w > 0.01)
    .map(([name, value]) => ({ name, value }));

  const params = (top.params ?? {}) as Record<string, unknown>;
  const aiGen = (result.narrative_facts.ai_param_generation ??
    {}) as Record<string, unknown>;

  const trialsRequested = Number(result.narrative_facts.trials_requested ?? 0);
  const trialsFeasible = Number(result.narrative_facts.trials_feasible ?? 0);
  const modelsReturned = result.candidates.length;
  const modelsTotalCatalog = Number(result.narrative_facts.models_total_catalog ?? modelsReturned);
  const rebalanceFreq = String(result.narrative_facts.rebalance_freq ?? request.rebalance_freq);
  const rebalanceCount = Number(result.narrative_facts.rebalance_count ?? 0);
  const rebalanceApplied = Number(
    result.narrative_facts.rebalance_applied ??
      (top.analytics as { execution?: { rebalance_applied?: number } } | undefined)
        ?.execution?.rebalance_applied ??
      rebalanceCount,
  );
  const optimizationMode = String(result.narrative_facts.optimization_mode ?? "standard");
  const objectiveLabel = String(
    result.narrative_facts.objective_label ??
      result.narrative_facts.objective ??
      request.objective,
  );
  const proRefinement = result.narrative_facts.pro_refinement as
    | {
        rounds_completed?: number;
        stopped_reason?: string;
        champion_adjusted_score?: number;
      }
    | null
    | undefined;
  const sampleMetrics = top.analytics?.sample_metrics;
  const showHorizonCompare = Boolean(
    inSampleMetrics && outOfSampleMetrics && sampleMetrics?.out_of_sample,
  );
  const displayMetrics = fullMetrics ?? resolveHorizonMetrics(top, "full_sample");
  const fullCalmar =
    top.calmar ??
    (displayMetrics.max_drawdown !== 0
      ? displayMetrics.cagr / Math.abs(displayMetrics.max_drawdown)
      : 0);
  const dataSource = String(result.narrative_facts.data_source ?? "");
  const trustworthy = result.narrative_facts.metrics_trustworthy === true;
  const dq = result.narrative_facts.data_quality as
    | {
        rows?: number;
        start?: string;
        end?: string;
        requested_start?: string;
        warning?: string;
        excluded_late_listing_count?: number;
      }
    | undefined;
  const trainPeriod = result.narrative_facts.train_period as
    | { start?: string; end?: string }
    | undefined;
  const candidateFrontier = result.candidates.map((c, i) => ({
    chartKey: candidateRowKey(c, i),
    name: c.model_code ?? `C${c.rank}`,
    model_code: c.model_code ?? null,
    rank: c.rank,
    volatility: c.volatility ?? 0,
    return: c.cagr ?? 0,
    sharpe: c.sharpe,
    isSelected: candidateRowKey(c, i) === selectedChartKey ? 1 : 0,
    series: "output" as const,
  }));

  const assetClassFilter = (
    (result.narrative_facts.asset_classes_filter as string[] | undefined) ??
    request.asset_classes
  )?.filter(Boolean);
  const quotaKeyList = quotaKeysForClasses(
    assetClassFilter?.length ? assetClassFilter : null,
  );
  const paramToSubLabel = Object.fromEntries(
    (Object.entries(SUB_ASSET_PARAM_KEYS) as [SubAssetClassKey, string][]).map(
      ([sub, param]) => [param, SUB_ASSET_CLASS_LABELS[sub]],
    ),
  );
  const quotaLabel = (key: string) =>
    ASSET_CLASS_LABELS[key as keyof typeof ASSET_CLASS_LABELS] ??
    paramToSubLabel[key] ??
    key;
  const activeRegime = activeRegimeForQuotas;

  const classQuota = Object.fromEntries(
    quotaKeyList.map((k) => [k, Number(params[k] ?? 0)]),
  );
  const quotaSum = Object.values(classQuota).reduce(
    (a, b) => a + (Number.isFinite(b) ? b : 0),
    0,
  );
  const targetTopN = Number(params["top_n_actual"] ?? request.top_n);
  const allowedClassSet = assetClassFilter?.length
    ? new Set(assetClassFilter)
    : null;
  const staticQuotaRows = Object.entries(classQuota).map(([k, v]) => ({
    cls: quotaLabel(k),
    target_count: Math.round((quotaSum > 0 ? v / quotaSum : 0) * targetTopN),
  }));
  const regimeBudget = regimeQuotaMatrix?.[quotaRegimeTab];
  const regimeQuotaRows = regimeBudget
    ? Object.entries(regimeBudget)
        .filter(([cls]) => !allowedClassSet || allowedClassSet.has(cls))
        .map(([cls, w]) => ({
          cls: quotaLabel(cls),
          target_count: Math.round(Number(w) * targetTopN),
        }))
    : staticQuotaRows;
  const quotaRows = regimeQuotaMatrix ? regimeQuotaRows : staticQuotaRows;
  const exposureByClass =
    top.analytics?.exposure?.by_asset_class &&
    Object.keys(top.analytics.exposure.by_asset_class).length > 0
      ? top.analytics.exposure.by_asset_class
      : chartCandidate?.analytics?.exposure?.by_asset_class;
  const actualClassRows = Object.entries(exposureByClass ?? {})
    .filter(([cls]) => !allowedClassSet || allowedClassSet.has(cls))
    .map(([cls, v]) => ({
      cls: quotaLabel(cls),
      actual_pct: Number(v) * 100,
    }));
  const selFactorSummary = top.analytics?.factor_summary;
  const factorSummary =
    selFactorSummary?.factor_contribution &&
    Object.keys(selFactorSummary.factor_contribution).length > 0
      ? selFactorSummary
      : (chartCandidate?.analytics?.factor_summary ?? {});
  const factorContribRows = Object.entries(factorSummary.factor_contribution ?? {}).map(([k, v]) => ({
    factor: k,
    pct: Number(v) * 100,
  }));
  const factorLogicRows = Object.entries(factorSummary.factor_indicator_logic ?? {});
  const selectedIndicators = (top.params ?? {}) as Record<string, string | undefined>;
  const factorLogicLabel = (key: string) => {
    const labels: Record<string, string> = {
      momentum: t("results.factor.momentum"),
      reversal: t("results.factor.reversal"),
      value: t("results.factor.value"),
      lowvol: t("results.factor.lowvol"),
      trend: t("results.factor.trend"),
      drawdown: t("results.factor.drawdown"),
    };
    const paramKey: Record<string, string> = {
      momentum: "mom_indicator",
      reversal: "reversal_indicator",
      value: "value_indicator",
      lowvol: "lowvol_indicator",
      trend: "trend_indicator",
      drawdown: "drawdown_indicator",
    };
    const ind = selectedIndicators[paramKey[key]];
    const base = labels[key] ?? key;
    return ind ? `${base} (${String(ind).replace(/_/g, " ")})` : base;
  };
  const aiRationalesByRound = (
    (aiGen.rationales_by_round as string[] | undefined) ??
    (proRefinement as { ai_rationales?: string[] } | null | undefined)?.ai_rationales
  )?.filter((r) => String(r).trim().length > 0);

  return (
    <div className="space-y-5">
      {!trustworthy && (
        <div className="border-2 border-[var(--amber)] bg-[rgba(255,176,0,0.08)] px-4 py-3 text-sm text-[var(--amber)]">
          {dataSource !== "yfinance"
            ? t("results.warning.sampleData")
            : t("results.warning.unrealistic")}
          {dq?.rows != null && (
            <span className="mt-1 block text-xs opacity-80">
              {t("results.dataRange", {
                start: String(dq.start ?? "—"),
                end: String(dq.end ?? "—"),
                rows: Number(dq.rows ?? 0),
              })}
            </span>
          )}
        </div>
      )}
      {trustworthy && dq && (
        <div className="pixel-badge-cyan inline-block">
          {t("results.liveData", { start: String(dq.start ?? "—"), end: String(dq.end ?? "—"), rows: Number(dq.rows ?? 0) })}
          {dq.requested_start && dq.requested_start !== dq.start && (
            <span className="ml-2 text-[var(--amber)]">
              ({t("results.requested")} {dq.requested_start}
              {dq.excluded_late_listing_count
                ? ` · ${dq.excluded_late_listing_count} ${t("results.lateListingsDropped")}`
                : ""}
              )
            </span>
          )}
        </div>
      )}
      {dq?.warning && (
        <div className="border-2 border-[var(--amber)] bg-[rgba(255,176,0,0.06)] px-4 py-2 text-xs text-[var(--amber)]">
          {dq.warning}
        </div>
      )}
      {result.narrative_facts.is_round_view === true && (
        <div className="border-2 border-[var(--amber)] bg-[rgba(255,176,0,0.06)] px-4 py-2 text-sm text-[var(--amber)]">
          {t("results.viewing")}: {String(result.narrative_facts.round_label ?? t("results.round"))}
          {result.narrative_facts.improved === true && ` · ${t("results.newRoundBest")}`}
        </div>
      )}
      <div className="border-2 border-[var(--border)] bg-[#050508] px-4 py-2 font-terminal text-sm text-dim">
        {optimizationMode === "pro_auto" && !result.narrative_facts.is_round_view ? (
          <>
            <span className="text-[var(--amber)]">{t("results.proRefinement")}</span>
            {" · "}
            {proRefinement?.rounds_completed ?? "—"} {t("results.rounds")} · {trialsRequested} {t("results.trials")} · {t("results.earlyStop")}{" "}
            {proRefinement?.stopped_reason === "patience" ? t("common.yes") : t("common.no")}
          </>
        ) : (
          <>{t("results.parameterSearch")} · {trialsRequested} {t("results.trials")}</>
        )}
        {" · "}{t("results.feasible")} {trialsFeasible} · {t("results.reported")} {modelsReturned}
        {modelsTotalCatalog > modelsReturned && (
          <span className="text-[var(--amber)]"> ({t("results.catalog")} {modelsTotalCatalog})</span>
        )}
        <span>
          {" "}
          · {t("results.rebalance")} {rebalanceFreq} ({rebalanceApplied}/{rebalanceCount} {t("results.applied")})
        </span>
      </div>

      <ReportGroup
        index={1}
        title={t("report.group.summary")}
        subtitle={t("report.group.summaryHint")}
      >
      <div className="pixel-panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-pixel text-xs text-neon glow-title">{t("results.title")}</h3>
          <span className="pixel-badge-cyan text-[10px]">
            {sortByModelCode ? t("results.orderByModel") : `${t("results.sort")}: ${objectiveLabel}`}
          </span>
          <label className="flex items-center gap-2 text-xs text-dim">
            {t("results.model")}
            <select
              value={selectedChartKey}
              onChange={(e) => setSelectedRowKey(e.target.value)}
              className="pixel-input py-1 text-xs"
            >
              {modelSelectOptions.map(({ c, i }) => (
                <option
                  key={candidateRowKey(c, i)}
                  value={candidateRowKey(c, i)}
                >
                  {(c.model_code ?? `M?`)}
                  {candidateModelKey(c) === championModelKey ? " ★" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        {narrative ? (
          <div className="mt-3 border-2 border-[var(--cyan)] bg-[rgba(0,245,255,0.04)] px-4 py-3 text-sm text-dim">
            <p className="mb-2 font-pixel text-[8px] text-[var(--cyan)]">
              {t("results.fullNarrative")}
            </p>
            <p className="whitespace-pre-wrap leading-relaxed text-[#cbd5e1]">
              {narrativePrefix ? `${narrativePrefix}\n\n` : ""}
              {narrative}
            </p>
          </div>
        ) : null}
        {sampleMetrics?.in_sample && (
          <div className="mt-3 border-2 border-[var(--amber)] bg-[rgba(255,176,0,0.06)] px-3 py-2 text-xs">
            <p className="font-pixel text-[8px] text-[var(--amber)]">
              {t("results.rankedOnInSample")} ({Math.round((sampleMetrics.train_ratio ?? 0.7) * 100)}%)
              {sampleMetrics.train_start && sampleMetrics.train_end
                ? ` · ${sampleMetrics.train_start} → ${sampleMetrics.train_end}`
                : sampleMetrics.train_end
                  ? ` · ${t("results.endsOn", { date: String(sampleMetrics.train_end) })}`
                  : trainPeriod?.start && trainPeriod?.end
                    ? ` · ${trainPeriod.start} → ${trainPeriod.end}`
                    : ""}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-center font-terminal text-sm sm:grid-cols-4">
              <div>
                <div className="text-dim">
                  {t("common.inSample")} {sampleMetrics.objective_label ?? objectiveLabel}
                </div>
                <div className="text-neon">
                  {Number(sampleMetrics.in_sample.objective_value).toFixed(4)}
                </div>
              </div>
              <div>
                <div className="text-dim">{t("common.outOfSample")}</div>
                <div className="text-[var(--cyan)]">
                  {sampleMetrics.out_of_sample
                    ? Number(sampleMetrics.out_of_sample.objective_value).toFixed(4)
                    : "—"}
                </div>
              </div>
              <div>
                <div className="text-dim">{t("common.full")}</div>
                <div className="text-slate-200">
                  {sampleMetrics.full_sample
                    ? Number(sampleMetrics.full_sample.objective_value).toFixed(4)
                    : "—"}
                </div>
              </div>
              <div>
                <div className="text-dim">{t("results.gapInOut")}</div>
                <div className="text-[#ff2bd6]">
                  {sampleMetrics.gap?.objective != null
                    ? Number(sampleMetrics.gap.objective).toFixed(4)
                    : "—"}
                </div>
              </div>
            </div>
          </div>
        )}
        {isDynamicObjective && (
          <div className="mt-3 border-2 border-[var(--border)] bg-[#050508] px-3 py-2 text-xs">
            <p className="font-pixel text-[8px] text-[var(--amber)]">
              {t("results.dynamicScoreTitle")}
            </p>
            <p className="mt-1 text-dim leading-relaxed">
              {t("results.dynamicScoreExplain")}
            </p>
            <p className="mt-1 text-[10px] text-dim">
              <code className="text-[10px]">{t("results.proChampionScoreFormula")}</code>
            </p>
          </div>
        )}
        {championRationale && (
          <div className="mt-3 border-2 border-[var(--amber)] bg-[rgba(255,176,0,0.06)] px-3 py-2 text-xs">
            <p className="font-pixel text-[8px] text-[var(--amber)]">
              {t("results.championWhyTitle", { code: championRationale.code })}
            </p>
            <p className="mt-1 leading-relaxed text-[#cbd5e1]">
              {championRationale.text}
            </p>
          </div>
        )}
        <p className="mt-4 text-xs text-dim">{t("results.fullPeriod")}</p>
        <div className="mt-2 grid grid-cols-3 gap-3 text-center">
          <Metric label={t("common.sharpe")} value={displayMetrics.sharpe} />
          <Metric
            label={t("common.maxDd")}
            value={displayMetrics.max_drawdown}
            format="pct"
          />
          <Metric label={t("common.cagr")} value={displayMetrics.cagr} format="pct" />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <Metric label={t("common.vol")} value={displayMetrics.volatility} format="pct" />
          <Metric label={t("common.sortino")} value={displayMetrics.sortino} />
          <Metric label={t("common.calmar")} value={fullCalmar} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <Metric label={t("results.var95")} value={top.var_95 ?? 0} format="pct" />
          <Metric label={t("results.cvar95")} value={top.cvar_95 ?? 0} format="pct" />
          <Metric label={t("results.winRate")} value={top.win_rate ?? 0} format="pct" />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <Metric label={t("results.avgTurnover")} value={top.turnover_avg ?? 0} format="pct" />
          <Metric label={t("results.totalTurnover")} value={top.turnover_total ?? 0} format="pct" />
          <Metric label={t("results.maxDdDays")} value={top.max_drawdown_duration_days ?? 0} />
        </div>
        {(top.beta != null || top.information_ratio != null) && (
          <div className="mt-3 grid grid-cols-4 gap-3 text-center">
            <Metric label={t("common.beta")} value={top.beta ?? 0} />
            <Metric label={t("common.alpha")} value={top.alpha ?? top.alpha_annual ?? 0} format="pct" />
            <Metric label={t("results.te")} value={top.tracking_error ?? 0} format="pct" />
            <Metric label={t("results.ir")} value={top.information_ratio ?? 0} />
          </div>
        )}
        {showHorizonCompare && inSampleMetrics && outOfSampleMetrics ? (
          <div className="mt-4 border-2 border-[var(--border)] bg-[#050508] px-3 py-2">
            <p className="font-pixel text-[8px] text-[var(--cyan)]">
              {t("results.horizonCompareTitle")}
            </p>
            <p className="mt-1 text-xs text-dim">
              {t("results.horizonMetricsHint")}
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-dim">
                  <tr>
                    <th className="pb-1">{t("results.metric")}</th>
                    <th className="pb-1 text-right">{t("common.inSample")}</th>
                    <th className="pb-1 text-right">{t("common.outOfSample")}</th>
                    <th className="pb-1 text-right">{t("common.full")}</th>
                  </tr>
                </thead>
                <tbody>
                  <HorizonMetricRow
                    label={t("common.sharpe")}
                    inSample={inSampleMetrics.sharpe}
                    outOfSample={outOfSampleMetrics.sharpe}
                    full={displayMetrics.sharpe}
                  />
                  <HorizonMetricRow
                    label={t("common.cagr")}
                    inSample={inSampleMetrics.cagr}
                    outOfSample={outOfSampleMetrics.cagr}
                    full={displayMetrics.cagr}
                    format="pct"
                  />
                  <HorizonMetricRow
                    label={t("common.maxDd")}
                    inSample={inSampleMetrics.max_drawdown}
                    outOfSample={outOfSampleMetrics.max_drawdown}
                    full={displayMetrics.max_drawdown}
                    format="pct"
                  />
                  <HorizonMetricRow
                    label={sampleMetrics?.objective_label ?? objectiveLabel}
                    inSample={inSampleMetrics.objective_value}
                    outOfSample={outOfSampleMetrics.objective_value}
                    full={displayMetrics.objective_value}
                    format="obj"
                  />
                </tbody>
              </table>
            </div>
            {sampleMetrics?.gap &&
            (sampleMetrics.gap.sharpe != null ||
              sampleMetrics.gap.objective != null) ? (
              <p className="mt-2 text-xs text-dim">
                {t("results.gapObjectiveSharpe")}{" "}
                {sampleMetrics.gap.objective?.toFixed(4) ?? "—"}, {t("common.sharpe")}{" "}
                {sampleMetrics.gap.sharpe?.toFixed(4) ?? "—"} ({t("results.positiveInSampleStronger")}).
              </p>
            ) : null}
          </div>
        ) : null}
        {holdoutLeaderboard.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-dim">
                {t("results.championLeaderboard")}
              </p>
              <label className="flex items-center gap-2 text-xs text-dim">
                {t("results.sortTableBy")}
                <select
                  value={leaderboardSort}
                  onChange={(e) =>
                    setLeaderboardSort(e.target.value as LeaderboardSort)
                  }
                  className="pixel-input py-0.5 text-xs"
                >
                  <option value="in_sample">{t("results.inSampleSelection")}</option>
                  <option value="out_of_sample">{t("common.outOfSample")}</option>
                  <option value="full_sample">{t("common.full")}</option>
                </select>
              </label>
            </div>
            {isDynamicObjective ? (
              <p className="mb-2 text-[10px] text-dim leading-relaxed">
                {t("results.leaderboardDynamicNote")}
              </p>
            ) : null}
            <table className="w-full text-left text-xs">
              <thead className="text-dim">
                <tr>
                  <th className="pb-1">{t("results.model")}</th>
                  <th className="pb-1 text-right">{t("common.inSample")}</th>
                  <th className="pb-1 text-right">{t("common.outOfSample")}</th>
                  <th className="pb-1 text-right">{t("common.full")}</th>
                  <th className="pb-1 text-right">{t("common.gap")}</th>
                </tr>
              </thead>
              <tbody>
                {holdoutLeaderboard.map((row, i) => {
                  const matchIdx = result.candidates.findIndex(
                    (c) =>
                      c.model_code === row.model_code &&
                      (row.rank == null || c.rank === row.rank),
                  );
                  const match =
                    matchIdx >= 0 ? result.candidates[matchIdx] : undefined;
                  const rowKey = match
                    ? candidateRowKey(match, matchIdx)
                    : "";
                  return (
                  <tr
                    key={`${row.model_code ?? "model"}-oos-${i}`}
                    className={`border-t border-[var(--border)] ${
                      rowKey ? "cursor-pointer hover:bg-[rgba(0,245,255,0.06)]" : ""
                    }`}
                    onClick={() => {
                      if (rowKey) setSelectedRowKey(rowKey);
                    }}
                  >
                    <td className="py-1">
                      {row.model_code}
                      {row.model_code &&
                      championModelKey &&
                      candidateModelKey({
                        model_code: row.model_code,
                        rank: row.rank ?? i + 1,
                      }) === championModelKey
                        ? " ★"
                        : ""}
                    </td>
                    <td className="py-1 text-right text-neon">
                      {row.in_sample_objective?.toFixed(4) ?? "—"}
                    </td>
                    <td className="py-1 text-right text-[var(--cyan)]">
                      {row.out_of_sample_objective?.toFixed(4) ?? "—"}
                    </td>
                    <td className="py-1 text-right text-slate-200">
                      {row.full_sample_objective?.toFixed(4) ?? "—"}
                    </td>
                    <td className="py-1 text-right text-[#ff2bd6]">
                      {row.gap_objective?.toFixed(4) ?? "—"}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-dim">
          {t("results.engine")} {String(result.narrative_facts.engine ?? "—")} · {t("results.holdings")}{" "}
          {String(result.narrative_facts.top_holdings_count ?? activeHoldingsCount)}
          ({t("results.cap")}{" "}
          {String(result.narrative_facts.max_holdings_constraint ?? request.max_holdings ?? "—")}
          ; {t("results.weightChartMayListMore")})
          · {t("results.maxWeight")}{" "}
          {(Math.max(...Object.values(top.weights)) * 100).toFixed(1)}% ({t("results.runCap")}{" "}
          {(Number(result.narrative_facts.max_weight_constraint ?? 0) * 100).toFixed(0)}% ·
          {t("results.effective")}{" "}
          {(
            Number(
              result.narrative_facts.max_weight_effective_cap ??
                result.narrative_facts.max_weight_trial_param ??
                result.narrative_facts.max_weight_actual ??
                0,
            ) * 100
          ).toFixed(0)}% · {t("results.observed")}{" "}
          {(Number(result.narrative_facts.max_weight_observed ?? 0) * 100).toFixed(0)}%)
          {result.narrative_facts.oos_enabled ? ` · ${t("results.selectionHint")}` : ""}
        </p>
        {weightCapViolation ? (
          <p className="mt-2 border-2 border-[#ff2bd6] bg-[rgba(255,43,214,0.08)] px-2 py-1 text-xs text-[#ff9ae8]">
            {t("results.weightCapBreach")}{" "}
            {(
              Number(
                weightCapAudit?.worst_observed_weight ??
                  weightCapAudit?.max_observed_weight ??
                  result.narrative_facts.max_weight_observed ??
                  0,
              ) * 100
            ).toFixed(1)}
            % {t("results.vsEffectiveCap")}{" "}
            {(
              Number(
                weightCapAudit?.max_weight_param ??
                  result.narrative_facts.max_weight_effective_cap ??
                  result.narrative_facts.max_weight_constraint ??
                  0,
              ) * 100
            ).toFixed(0)}
            %
            {weightCapAudit?.first_violation_date
              ? ` · ${t("results.firstOn")} ${String(weightCapAudit.first_violation_date)}`
              : ""}
            {weightCapAudit?.min_holdings_for_cap != null &&
            weightCapAudit?.tradable_count != null &&
            Number(weightCapAudit.tradable_count) <
              Number(weightCapAudit.min_holdings_for_cap) ? (
              <span>
                {" "}
                · {t("results.only")} {String(weightCapAudit.tradable_count)} {t("results.tradableNames")} ({t("results.needAtLeast")}
                {String(weightCapAudit.min_holdings_for_cap)} {t("results.forThisCap")})
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
      </ReportGroup>

      <ReportGroup
        index={2}
        title={t("report.group.performance")}
        subtitle={t("report.group.performanceHint")}
      >
      <ChartCard title={t("results.chart.performanceComparison")} subtitle={t("results.fullPeriod")}>
        <div className="mb-3 border-2 border-[#0a4a4a] bg-[rgba(0,245,255,0.05)] px-3 py-2">
          <p className="ui-section-title mb-1">{t("results.aiComparison")}</p>
          {compareLoading ? (
            <p className="ui-hint">{t("results.generatingComparison")}</p>
          ) : compareSummary ? (
            <div className="ui-body space-y-2">
              {compareRetryNote ? (
                <p className="text-[10px] text-amber-400/90">{compareRetryNote}</p>
              ) : null}
              {compareSummary
                .split(/\n\s*\n+/)
                .map((para) => para.trim())
                .filter(Boolean)
                .map((para, i) => (
                  <p key={i} className="text-[#cbd5e1]">
                    {para}
                  </p>
                ))}
            </div>
          ) : (
            <p className="ui-hint">{t("results.noComparisonYet")}</p>
          )}
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={candidateCompare}
            onClick={(state) => {
              const rawIdx = state?.activeTooltipIndex;
              if (rawIdx == null) return;
              const idx = Number(rawIdx);
              if (!Number.isFinite(idx) || idx < 0 || idx >= candidateCompare.length) return;
              const row = candidateCompare[idx];
              if (!row?.chartKey || row.isBenchmark) return;
              setSelectedRowKey(String(row.chartKey));
            }}
          >
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis
              dataKey="chartKey"
              stroke="#94a3b8"
              fontSize={chartTick}
              tickFormatter={(chartKey) =>
                performanceCompareTickLabel(
                  performanceCompareByChartKey.get(String(chartKey)),
                )
              }
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const row = payload[0]?.payload as
                  | {
                      model_code?: string;
                      name?: string;
                      isChampion?: boolean;
                      isBenchmark?: boolean;
                      sharpe?: number;
                      sortino?: number;
                      cagr_pct?: number;
                      mdd_pct?: number;
                    }
                  | undefined;
                const code = row?.model_code ?? row?.name ?? "M?";
                return (
                  <div
                    className="border-2 border-[var(--neon)] bg-[#050508] px-3 py-2"
                    style={{ fontSize: chartTip }}
                  >
                    <div
                      className="mb-1 font-pixel text-[var(--amber)]"
                      style={{ fontSize: Math.max(11, chartTip - 1) }}
                    >
                      {row?.isBenchmark ? t("results.benchmark") : t("results.model")} {code}
                      {row?.isChampion ? ` · ${t("results.champion")}` : ""}
                    </div>
                    <div>{t("common.cagr")}: {Number(row?.cagr_pct ?? 0).toFixed(2)}%</div>
                    <div>{t("common.maxDd")}: {Number(row?.mdd_pct ?? 0).toFixed(2)}%</div>
                    <div>{t("common.sharpe")}: {Number(row?.sharpe ?? 0).toFixed(3)}</div>
                    <div>{t("common.sortino")}: {Number((row as { sortino?: number } | undefined)?.sortino ?? 0).toFixed(3)}</div>
                  </div>
                );
              }}
            />
            <Legend
              content={({ payload }) => (
                <ul
                  className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1"
                  style={{ fontSize: chartLegend }}
                >
                  {payload?.map((entry) => (
                    <li
                      key={String(entry.value)}
                      className="flex items-center gap-1.5 text-[#94a3b8]"
                    >
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0"
                        style={{ backgroundColor: entry.color }}
                      />
                      {entry.value}
                    </li>
                  ))}
                  {championModelKey ? (
                    <li className="flex items-center gap-1 text-[var(--amber)]">
                      <span className="font-pixel text-[10px]">★ {t("results.champion")}</span>
                    </li>
                  ) : null}
                </ul>
              )}
            />
            <ReferenceLine yAxisId="left" y={0} stroke="#64748b" strokeDasharray="4 4" />
            <ReferenceLine yAxisId="right" y={0} stroke="#64748b" strokeDasharray="4 4" />
            <YAxis
              yAxisId="left"
              domain={performanceLeftDomain}
              allowDataOverflow
              stroke="#34d399"
              fontSize={chartTick}
              tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={performanceRightDomain}
              allowDataOverflow
              stroke="#60a5fa"
              fontSize={chartTick}
            />
            <Bar yAxisId="left" dataKey="cagr_pct" fill={METRIC_FILLS.cagr} name={t("results.cagrPct")}>
              {candidateCompare.map((row) => (
                <Cell
                  key={`cagr-${row.chartKey}`}
                  fill={row.isBenchmark ? BENCHMARK_FILL : METRIC_FILLS.cagr}
                  fillOpacity={row.isBenchmark ? 0.85 : 1}
                  stroke={
                    row.isSelected
                      ? SELECTED_STROKE
                      : row.isChampion
                        ? CHAMPION_STROKE
                        : row.isBenchmark
                          ? BENCHMARK_FILL
                          : undefined
                  }
                  strokeWidth={
                    row.isSelected || row.isChampion || row.isBenchmark ? 2.5 : 0
                  }
                  strokeDasharray={row.isBenchmark ? "4 2" : undefined}
                />
              ))}
            </Bar>
            <Bar yAxisId="left" dataKey="mdd_pct" fill={METRIC_FILLS.mdd} name={t("results.maxDdPct")}>
              {candidateCompare.map((row) => (
                <Cell
                  key={`mdd-${row.chartKey}`}
                  fill={row.isBenchmark ? BENCHMARK_FILL : METRIC_FILLS.mdd}
                  fillOpacity={row.isBenchmark ? 0.55 : 1}
                  stroke={
                    row.isSelected
                      ? SELECTED_STROKE
                      : row.isChampion
                        ? CHAMPION_STROKE
                        : row.isBenchmark
                          ? BENCHMARK_FILL
                          : undefined
                  }
                  strokeWidth={
                    row.isSelected || row.isChampion || row.isBenchmark ? 2.5 : 0
                  }
                  strokeDasharray={row.isBenchmark ? "4 2" : undefined}
                />
              ))}
            </Bar>
            <Bar yAxisId="right" dataKey="sharpe" fill={METRIC_FILLS.sharpe} name={t("common.sharpe")}>
              {candidateCompare.map((row) => (
                <Cell
                  key={`sharpe-${row.chartKey}`}
                  fill={row.isBenchmark ? BENCHMARK_FILL : METRIC_FILLS.sharpe}
                  fillOpacity={row.isBenchmark ? 0.85 : 1}
                  stroke={
                    row.isSelected
                      ? SELECTED_STROKE
                      : row.isChampion
                        ? CHAMPION_STROKE
                        : row.isBenchmark
                          ? BENCHMARK_FILL
                          : undefined
                  }
                  strokeWidth={
                    row.isSelected || row.isChampion || row.isBenchmark ? 2.5 : 0
                  }
                  strokeDasharray={row.isBenchmark ? "4 2" : undefined}
                />
              ))}
            </Bar>
            <Bar yAxisId="right" dataKey="sortino" fill={METRIC_FILLS.sortino} name={t("common.sortino")}>
              {candidateCompare.map((row) => (
                <Cell
                  key={`sortino-${row.chartKey}`}
                  fill={row.isBenchmark ? BENCHMARK_FILL : METRIC_FILLS.sortino}
                  fillOpacity={row.isBenchmark ? 0.55 : 1}
                  stroke={
                    row.isSelected
                      ? SELECTED_STROKE
                      : row.isChampion
                        ? CHAMPION_STROKE
                        : row.isBenchmark
                          ? BENCHMARK_FILL
                          : undefined
                  }
                  strokeWidth={
                    row.isSelected || row.isChampion || row.isBenchmark ? 2.5 : 0
                  }
                  strokeDasharray={row.isBenchmark ? "4 2" : undefined}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        {dynamicObjectiveChart &&
        (result.narrative_facts.dynamic_objectives_used as string[] | undefined)
          ?.length ? (
          <p className="mt-3 text-xs text-dim">
            {t("results.dynamicObjectives")}:{" "}
            {(result.narrative_facts.dynamic_objectives_used as string[]).join(", ")}
            {" "}
            · {t("results.dynamicObjectivesHint")}
          </p>
        ) : null}
      </ChartCard>
      </ReportGroup>

      <ReportGroup
        index={3}
        title={t("report.group.journey")}
        subtitle={t("report.group.journeyHint")}
      >
      <ChartCard title={t("results.chart.trajectoryHoldings")}>
        {chartsLoading ? (
          <p className="mb-3 flex items-center gap-2 text-xs text-dim">
            <span
              className="inline-block h-3 w-3 animate-spin rounded-full border border-[var(--amber)] border-t-transparent"
              aria-hidden
            />
            {t("results.loadingTrajectory", { model: selectedModelCode })}
          </p>
        ) : null}
        {chartsLoadError && !chartsReady ? (
          <p className="mb-3 text-xs text-red-400">{chartsLoadError}</p>
        ) : null}
        {dynamicObjectiveChart ? (
          <p className="mb-3 text-xs text-dim">
            {t("results.walkForwardHint")}
            {isDynamicObjective ? (
              <>
                {" "}
                {t("results.proChampionScorePrefix")}{" "}
                <span className="text-[var(--amber)]">{t("results.comprehensiveScore")}</span> (
                <code className="text-[10px]">objective_value_is</code>
                ) — {t("results.proChampionScoreFormula")}
              </>
            ) : null}
          </p>
        ) : null}
        {chartsReady ? (
          <LinkedEquityWeightChart
            equityCurve={equity}
            benchmarkCurve={benchmarkEquity}
            benchmarkLabel={benchTicker}
            weightHistory={historySeries}
            weightTickers={weightHistoryTickers}
            colors={COLORS}
            regimeTimeline={dynamicObjectiveChart?.timeline}
          />
        ) : chartsLoading ? null : (
          <p className="text-xs text-dim">
            {t("results.selectTrialHint")}
          </p>
        )}
      </ChartCard>
      </ReportGroup>

      <ReportGroup
        index={4}
        title={t("report.group.holdings")}
        subtitle={t("report.group.holdingsHint")}
      >
      <ChartCard title={t("results.chart.latestAllocation")}>
        {Object.keys(top.weights ?? {}).length === 0 ? (
          <p className="text-sm text-dim">
            {t("results.summaryOnlyModel")}
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="border-2 border-[var(--border)] bg-[#050508] p-3">
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={donut} dataKey="value" nameKey="name" innerRadius={50}>
                    {donut.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip valueDecimals={2} valueIsPct />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="max-h-60 overflow-y-auto border-2 border-[var(--border)] bg-[#050508] p-3">
              <table className="w-full text-left text-sm">
                <thead className="text-dim">
                  <tr>
                    <th className="pb-2">{t("common.date")}</th>
                    <th className="pb-2">{t("common.ticker")}</th>
                    <th className="pb-2">{t("common.name")}</th>
                    <th className="pb-2 text-right">{t("institutional.weightShort")}</th>
                  </tr>
                </thead>
                <tbody>
                  {allocationRows.map(({ ticker, name, weight }) => (
                    <tr key={ticker} className="border-t border-[var(--border)]">
                      <td className="py-1.5 text-dim">{latestAllocationDate}</td>
                      <td className="py-1.5">{ticker}</td>
                      <td className="py-1.5 text-dim">{name}</td>
                      <td className="py-1.5 text-right text-neon">
                        {(weight * 100).toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </ChartCard>
      </ReportGroup>

      <ReportGroup
        index={5}
        title={t("report.group.strategy")}
        subtitle={t("report.group.strategyHint")}
      >
      <ChartCard title={t("results.chart.efficientFrontier")}>
        <p className="mb-2 text-xs text-dim">
          {t("results.efficientFrontierHint")}
        </p>
        <ResponsiveContainer width="100%" height={260}>
          <ScatterChart>
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="volatility"
              name={t("common.vol")}
              stroke="#94a3b8"
              fontSize={chartTick}
              tickFormatter={(v) => `${(Number(v) * 100).toFixed(1)}%`}
            >
              <Label
                value={t("results.annVol")}
                position="insideBottom"
                offset={-2}
                fill="#94a3b8"
                fontSize={chartTick}
              />
            </XAxis>
            <YAxis
              type="number"
              dataKey="return"
              name={t("common.return")}
              stroke="#94a3b8"
              fontSize={chartTick}
              tickFormatter={(v) => `${(Number(v) * 100).toFixed(1)}%`}
            >
              <Label
                value={t("results.annReturn")}
                angle={-90}
                position="insideLeft"
                offset={8}
                fill="#94a3b8"
                fontSize={chartTick}
              />
            </YAxis>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const entry = payload.find((e) => e?.payload) ?? payload[0];
                const p = entry?.payload as {
                  name?: string;
                  model_code?: string | null;
                  volatility?: number;
                  return?: number;
                  sharpe?: number;
                  rank?: number;
                  series?: string;
                };
                const seriesLabel =
                  p?.series === "output" || entry?.name === "Output models"
                    ? t("results.outputModel")
                    : t("results.searchTrial");
                const label = frontierTooltipLabel(p);
                return (
                  <div
                    className="border-2 border-[var(--neon)] bg-[#050508] px-3 py-2"
                    style={{ fontSize: chartTip }}
                  >
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-dim">
                      {seriesLabel}
                    </div>
                    <div
                      className="mb-1 font-pixel text-[var(--amber)]"
                      style={{ fontSize: Math.max(11, chartTip - 1) }}
                    >
                      {label}
                      {p?.rank != null ? (
                        <span className="ml-1 font-sans text-dim">
                          (#{p.rank})
                        </span>
                      ) : null}
                    </div>
                    <div>{t("common.vol")}: {((p?.volatility ?? 0) * 100).toFixed(2)}%</div>
                    <div>{t("common.return")}: {((p?.return ?? 0) * 100).toFixed(2)}%</div>
                    <div>{t("common.sharpe")}: {Number(p?.sharpe ?? 0).toFixed(3)}</div>
                  </div>
                );
              }}
            />
            <Legend />
            <Scatter
              name={t("results.paramSamples")}
              data={paramFrontierSamples}
              fill="#60a5fa"
            />
            <ZAxis dataKey="isSelected" range={[80, 220]} />
            <Scatter
              name={t("results.outputModels")}
              data={candidateFrontier}
              fill="#fbbf24"
            >
              {candidateFrontier.map((p) => (
                <Cell
                  key={p.chartKey}
                  fill={p.isSelected ? "#f97316" : "#fbbf24"}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={t("results.chart.aiClassQuotas")}>
        {assetClassFilter?.length ? (
          <p className="mb-2 text-xs text-dim">
            {t("results.universeFilter")}: {assetClassFilter.map(quotaLabel).join(", ")} — {t("results.universeFilterHint")}
          </p>
        ) : null}
        {regimeQuotaMatrix ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {REGIME_QUOTA_KEYS.map((regime) => (
              <button
                key={regime}
                type="button"
                onClick={() => setQuotaRegimeTab(regime)}
                className={`px-2 py-1 font-pixel text-[8px] border ${
                  quotaRegimeTab === regime
                    ? "border-[var(--cyan)] text-[var(--cyan)]"
                    : "border-[var(--border)] text-dim"
                }`}
              >
                {regimeLabel(t, regime)}
                {activeRegime === regime ? ` · ${t("common.active")}` : ""}
              </button>
            ))}
          </div>
        ) : null}
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="border-2 border-[var(--border)] bg-[#050508] p-3">
            <p className="mb-2 text-xs text-dim">
              {regimeQuotaMatrix
                ? t("results.targetNamesRegime", { regime: regimeLabel(t, quotaRegimeTab) })
                : t("results.targetNamesAi")}
            </p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={quotaRows}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis dataKey="cls" stroke="#94a3b8" fontSize={chartTick} />
                <YAxis stroke="#94a3b8" fontSize={chartTick} />
                <Tooltip content={<ChartTooltip valueDecimals={0} />} />
                <Bar dataKey="target_count" name={t("results.targetCount")} fill="#00f5ff" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="border-2 border-[var(--border)] bg-[#050508] p-3">
            <p className="mb-2 text-xs text-dim">{t("results.actualClassWeights")}</p>
            {usingChampionAnalyticsFallback &&
            (!top.analytics?.exposure?.by_asset_class ||
              Object.keys(top.analytics.exposure.by_asset_class).length === 0) ? (
              <p className="mb-2 text-[10px] text-dim">
                {t("results.classBreakdownChampion")}
              </p>
            ) : null}
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={actualClassRows}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis dataKey="cls" stroke="#94a3b8" fontSize={chartTick} />
                <YAxis stroke="#94a3b8" fontSize={chartTick} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} />
                <Tooltip content={<ChartTooltip valueIsPct={false} valueDecimals={2} />} />
                <Bar dataKey="actual_pct" name={t("results.weightPct")} fill="#39ff14" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </ChartCard>

      <ChartCard title={t("results.chart.factorAttribution")}>
        {usingChampionAnalyticsFallback &&
        !(
          top.analytics?.factor_summary?.factor_contribution &&
          Object.keys(top.analytics.factor_summary.factor_contribution).length > 0
        ) ? (
          <p className="mb-2 text-xs text-dim">
            {t("results.factorAttributionChampion")}
          </p>
        ) : null}
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="border-2 border-[var(--border)] bg-[#050508] p-3">
            {factorContribRows.length === 0 ? (
              <p className="ui-hint">{t("results.noFactorAttribution")}</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={factorContribRows}>
                  <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                  <XAxis dataKey="factor" stroke="#94a3b8" fontSize={chartTick} />
                  <YAxis stroke="#94a3b8" fontSize={chartTick} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} />
                  <Tooltip content={<ChartTooltip valueIsPct={false} valueDecimals={2} />} />
                  <Bar dataKey="pct" name={t("results.contribPct")} fill="#ff2bd6" />
                </BarChart>
              </ResponsiveContainer>
            )}
            <p className="ui-hint mt-2">
              {t("results.observations")}: {String(factorSummary.factor_observations ?? 0)} ({t("results.rebalanceCrossSections")})
            </p>
          </div>
          <div className="border-2 border-[var(--border)] bg-[#050508] p-3">
            <p className="ui-section-title mb-2">{t("results.factorMetricLogic")}</p>
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {factorLogicRows.length === 0 ? (
                <p className="ui-hint">{t("results.noMetricLogic")}</p>
              ) : (
                factorLogicRows.map(([k, v]) => (
                  <div key={k} className="border-b border-slate-800 py-1">
                    <span className="ui-body text-slate-200">{factorLogicLabel(k)}</span>
                    <div className="ui-hint">{String(v)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </ChartCard>
      </ReportGroup>

      <ReportGroup
        index={6}
        title={t("report.group.institutional")}
        subtitle={t("report.group.institutionalHint")}
      >
      <InstitutionalReport
        candidate={institutionalCandidate ?? top}
        benchmark={benchTicker}
        isLoadingAnalytics={analyticsLoading}
        loadingModelCode={selectedModelCode || undefined}
        analyticsNote={
          usingChampionAnalyticsFallback
            ? t("results.analyticsFallback")
            : undefined
        }
      />
      </ReportGroup>

      <ReportGroup
        index={7}
        title={t("report.group.reproducibility")}
        subtitle={t("report.group.reproducibilityHint")}
      >
      <ChartCard title={t("results.chart.reproducibleParameters")}>
        {((aiRationalesByRound?.length ?? 0) > 0 || Boolean(aiGen.rationale)) ? (
          <details
            open
            className="mb-3 border-2 border-[var(--border)] bg-[#050508] px-3 py-2"
          >
            <summary className="cursor-pointer text-xs text-[var(--amber)] hover:text-neon">
              {t("results.aiParameterRationale")}
            </summary>
            <div className="mt-2 max-h-72 space-y-3 overflow-y-auto text-xs leading-relaxed text-slate-300">
              {aiRationalesByRound?.length ? (
                aiRationalesByRound.map((text, i) => (
                  <div key={i}>
                    <p className="mb-1 font-pixel text-[8px] text-dim">
                      {aiRationalesByRound.length > 1 ? `${t("results.round")} ${i + 1}` : t("results.generation")}
                    </p>
                    <p className="whitespace-pre-wrap">{text}</p>
                  </div>
                ))
              ) : (
                <p className="whitespace-pre-wrap">{String(aiGen.rationale)}</p>
              )}
            </div>
          </details>
        ) : (
          <p className="mb-3 text-xs text-dim">{t("results.noAiRationale")}</p>
        )}
        <details className="border-2 border-[var(--border)] bg-[#050508] px-3 py-2">
          <summary className="cursor-pointer text-xs text-dim hover:text-[var(--cyan)]">
            {t("results.fullRunConfig")}
          </summary>
          <pre className="mt-2 max-h-[28rem] overflow-auto whitespace-pre-wrap text-xs text-[var(--cyan)]">
            {JSON.stringify(
              {
                request,
                model_params: params,
                ai_param_generation: aiGen,
              },
              null,
              2,
            )}
          </pre>
        </details>
      </ChartCard>
      </ReportGroup>


      {allBelowBenchmark ? (
        <div className="pixel-panel border-2 border-[var(--amber)] bg-[rgba(255,176,0,0.06)]">
          <p className="ui-section-title mb-1 text-[var(--amber)]">
            {t("results.belowBenchmarkTitle")}
          </p>
          <p className="ui-body text-[#cbd5e1]">
            {t("results.belowBenchmarkBody", { benchmark: benchTicker })}
          </p>
          <div className="mt-3">
            <button
              type="button"
              onClick={onRerun}
              className="pixel-btn pixel-btn-amber"
            >
              {t("results.iterateFromHere")}
            </button>
          </div>
        </div>
      ) : null}

      <div className="pixel-panel">
        <QuickRefinements
          request={request}
          onApply={(next, label) => onQuickTweak(next, label ?? t("results.manualAdjustment"))}
          onApplyAndRun={onQuickTweakAndRun}
        />
        <p className="mt-2 text-xs text-dim">{t("results.refineHint")}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={onRerun} className="pixel-btn">
          {t("results.editConfig")}
        </button>
        <button type="button" onClick={onExport} className="pixel-btn">
          {t("results.exportCsv")}
        </button>
      </div>

      <p className="text-xs text-dim">
        {t("results.disclaimer")}{" "}
        {String(result.narrative_facts.data_source ?? t("common.unknown"))}.
      </p>
    </div>
  );
}

function HorizonMetricRow({
  label,
  inSample,
  outOfSample,
  full,
  format = "num",
}: {
  label: string;
  inSample?: number;
  outOfSample?: number;
  full?: number;
  format?: "num" | "pct" | "obj";
}) {
  const fmt = (v?: number) => {
    if (v == null) return "—";
    if (format === "pct") return `${(v * 100).toFixed(2)}%`;
    if (format === "obj") return v.toFixed(4);
    return v.toFixed(3);
  };
  return (
    <tr className="border-t border-[var(--border)]">
      <td className="py-1">{label}</td>
      <td className="py-1 text-right text-neon">{fmt(inSample)}</td>
      <td className="py-1 text-right text-[var(--cyan)]">{fmt(outOfSample)}</td>
      <td className="py-1 text-right text-slate-200">{fmt(full)}</td>
    </tr>
  );
}

function Metric({
  label,
  value,
  format = "num",
}: {
  label: string;
  value: number;
  format?: "num" | "pct";
}) {
  const text =
    format === "pct"
      ? `${(value * 100).toFixed(2)}%`
      : Number.isInteger(value)
        ? String(value)
        : value.toFixed(3);
  return (
    <div className="border-2 border-[var(--border)] bg-[#050508] p-3">
      <div className="text-xs text-dim">{label}</div>
      <div className="font-terminal text-xl text-neon">{text}</div>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pixel-panel">
      <div className="mb-3">
        <h4 className="ui-panel-title text-[var(--cyan)]">{title}</h4>
        {subtitle ? (
          <p className="ui-hint mt-0.5">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/**
 * Visual grouping for the report so it reads top-to-bottom as a guided story:
 * summary → performance → journey → holdings → strategy → institutional →
 * reproducibility. Each group gets a numbered accent header and a bordered
 * container so retail readers can tell where one section ends and the next
 * begins.
 */
function ReportGroup({
  index,
  title,
  subtitle,
  children,
}: {
  index: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-5 border-l-4 border-[var(--border)] pl-3 sm:pl-4">
      <header className="border-b-2 border-[var(--border)] bg-[rgba(0,245,255,0.03)] px-3 py-2">
        <div className="flex items-baseline gap-3">
          <span className="font-pixel text-[10px] text-[var(--amber)]">
            {String(index).padStart(2, "0")}
          </span>
          <h3 className="ui-panel-title text-neon glow-title">{title}</h3>
        </div>
        {subtitle ? <p className="ui-hint mt-1">{subtitle}</p> : null}
      </header>
      <div className="space-y-5">{children}</div>
    </section>
  );
}
