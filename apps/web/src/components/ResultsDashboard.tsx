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
import { OptimizationObjectiveBanner } from "@/components/OptimizationObjectiveBanner";
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
  classBudgetFromParams,
  normalizeRegimeClassQuotas,
  planClassSlots,
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
  championObjectiveScore,
  championSelectionHorizon,
  performanceCompareRowsByChartKey,
  performanceCompareTickLabel,
  pickCatalogChampionModelKey,
  resolveChampionCandidateIndex,
  resolveChampionModelKey,
  resolveDefaultSelectedRowKey,
  resolveHorizonMetrics,
  resolveOutOfSampleMetrics,
} from "@/lib/performance-compare-chart";
import {
  resolveChampionEquityCurve,
} from "@/lib/rm-report-utils";
import {
  buildCompareEffectKey,
  computeAllCandidatesBelowBenchmark,
} from "@/lib/compare-summary";
import {
  benchmarkTickerMismatch,
  resolveJobBenchmarkTicker,
  resolveResultBenchmarkTicker,
} from "@/lib/resolve-result-benchmark";
import { formatBenchmarkDisplayLabel, anchorDiffersFromBenchmarkTicker, type ModelPortfolio } from "@/lib/model-portfolios";
import { ContinueRefinementCTA } from "@/components/ContinueRefinementCTA";
import { fetchCandidateCharts } from "@/lib/api";
import { flushLlmAuditLogs, pushLlmAuditLog, type LlmAuditEntry } from "@/lib/llm-audit";
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
import { etfDisplayName } from "@/lib/etf-display-name";
import { rebalanceFreqLabel, regimeLabel, objectiveLabel, useI18n } from "@/lib/i18n";
import { resolveRunObjective } from "@/lib/resolve-run-objective";
import {
  buildHoldoutLeaderboard,
  type LeaderboardSort,
} from "@/lib/leaderboard";

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

const LEADERBOARD_TITLE_KEYS: Record<LeaderboardSort, string> = {
  in_sample: "results.championLeaderboard",
  out_of_sample: "results.leaderboardTitleOutOfSample",
  full_sample: "results.leaderboardTitleFull",
  gap: "results.leaderboardTitleGap",
};

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
  onContinueRefinement?: (options: {
    extraRefinementRounds: number;
    extraTrialsPerRound: number;
    extraTrials?: number;
  }) => void;
  continueLoading?: boolean;
  /** When false, the run-objective banner is omitted (e.g. parent already shows it). */
  showRunObjectiveBanner?: boolean;
  /** Slim layout for RM quant tab — hides sections duplicated in RmReportView. */
  variant?: "default" | "rm";
  /** Anchor benchmark ticker from RM step 1 (fallback when job request omits it). */
  anchorBenchmarkTicker?: string;
  /** Selected model portfolio (for localized benchmark labels). */
  anchorPortfolio?: ModelPortfolio | null;
  /**
   * When personalization dual-track exists, use this static-replay result as the
   * Quant Analysis baseline (LinkedEquity + performance bars) instead of SPY/ticker.
   */
  anchorBaselineResult?: BacktestResult | null;
  /** Display label for the anchor model portfolio baseline series. */
  anchorBaselineLabel?: string | null;
  /** Controlled candidate row key (sync with parent, e.g. RmReportView). */
  selectedRowKey?: string;
  onSelectedRowKeyChange?: (rowKey: string) => void;
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
  onContinueRefinement,
  continueLoading = false,
  showRunObjectiveBanner = true,
  variant = "default",
  anchorBenchmarkTicker,
  anchorPortfolio = null,
  anchorBaselineResult = null,
  anchorBaselineLabel = null,
  selectedRowKey: selectedRowKeyProp,
  onSelectedRowKeyChange,
}: Props) {
  const { t, lang } = useI18n();
  const isRmCompact = variant === "rm";
  const chartTick = chartTickFontSize();
  const chartLegend = chartLegendFontSize();
  const chartTip = chartTooltipFontSize();
  const [selectedRowKeyState, setSelectedRowKeyState] = useState<string>("");
  const selectedRowKey = selectedRowKeyProp ?? selectedRowKeyState;
  const setSelectedRowKey = onSelectedRowKeyChange ?? setSelectedRowKeyState;
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
  const warmStartFacts = championNarrativeFacts.warm_start as
    | {
        matched?: boolean;
        match_type?: string;
        matched_job_id?: string;
        seeded_model_code?: string;
        improved?: boolean | null;
      }
    | undefined
    | null;

  useEffect(() => {
    setCompareSummary("");
    setCompareRetryNote(null);
    setLazyChartsByCode({});
    setChartsLoadingCode(null);
    setChartsLoadError(null);
  }, [resultSelectionEpoch, result.narrative_facts]);

  useEffect(() => {
    if (selectedRowKeyProp != null) return;
    setSelectedRowKeyState(
      resolveDefaultSelectedRowKey(
        result.candidates,
        championNarrativeFacts,
      ),
    );
  }, [resultSelectionEpoch, result.candidates, championNarrativeFacts, selectedRowKeyProp]);

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

  const catalogChampionForCompare = useMemo(() => {
    const explicit = championNarrativeFacts.catalog_champion_model_code;
    if (typeof explicit === "string" && explicit.trim()) {
      return explicit.trim().toUpperCase();
    }
    return (
      pickCatalogChampionModelKey(
        result.candidates,
        championNarrativeFacts,
        "full_sample",
      ) ?? championModelKey
    );
  }, [result.candidates, championNarrativeFacts, championModelKey]);

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
        return { code: String(row.ai_champion_model_code), text, source: "ai" as const };
      }
    }
    return null;
  }, [result.narrative_facts.pro_refinement]);

  const selectionHorizon = useMemo(
    () => championSelectionHorizon(championNarrativeFacts),
    [championNarrativeFacts],
  );

  const championSelectionMetrics = useMemo(
    () => resolveHorizonMetrics(championCandidate, selectionHorizon),
    [championCandidate, selectionHorizon],
  );

  const championFullMetrics = useMemo(
    () => resolveHorizonMetrics(championCandidate, "full_sample"),
    [championCandidate],
  );

  const ruleBasedChampionRationale = useMemo(() => {
    if (!championCandidate) return null;
    const code =
      championCandidate.model_code ??
      championModelKey ??
      `M?${championCandidate.rank ?? "?"}`;
    const objective = String(
      result.narrative_facts.objective_label ??
        result.narrative_facts.objective ??
        request.objective ??
        "max_sharpe",
    );
    const others = result.candidates.filter(
      (c) => candidateModelKey(c) !== championModelKey,
    );
    // True runner-up = best objective score on the same selection horizon.
    let alt = others[0];
    let bestAltScore = -Infinity;
    for (const c of others) {
      const score = championObjectiveScore(c, championNarrativeFacts);
      if (score > bestAltScore) {
        bestAltScore = score;
        alt = c;
      }
    }
    const altSelection = alt
      ? resolveHorizonMetrics(alt, selectionHorizon)
      : null;
    const altFull = alt ? resolveHorizonMetrics(alt, "full_sample") : null;
    const usesIs = selectionHorizon === "in_sample";
    const parts: string[] = [
      usesIs
        ? t("results.championWhyFallbackLead", {
            code,
            objective,
            horizon: t("results.championHorizonInSample"),
            sharpe: championSelectionMetrics.sharpe.toFixed(3),
            cagr: `${(championSelectionMetrics.cagr * 100).toFixed(2)}%`,
            mdd: `${(championSelectionMetrics.max_drawdown * 100).toFixed(2)}%`,
            fullSharpe: championFullMetrics.sharpe.toFixed(3),
            fullCagr: `${(championFullMetrics.cagr * 100).toFixed(2)}%`,
          })
        : t("results.championWhyFallbackLeadFull", {
            code,
            objective,
            sharpe: championSelectionMetrics.sharpe.toFixed(3),
            cagr: `${(championSelectionMetrics.cagr * 100).toFixed(2)}%`,
            mdd: `${(championSelectionMetrics.max_drawdown * 100).toFixed(2)}%`,
          }),
    ];
    if (alt && altSelection) {
      parts.push(
        usesIs && altFull
          ? t("results.championWhyFallbackAlt", {
              alt: alt.model_code ?? `M?${alt.rank}`,
              altSharpe: altSelection.sharpe.toFixed(3),
              altCagr: `${(altSelection.cagr * 100).toFixed(2)}%`,
              altFullSharpe: altFull.sharpe.toFixed(3),
            })
          : t("results.championWhyFallbackAltFull", {
              alt: alt.model_code ?? `M?${alt.rank}`,
              altSharpe: altSelection.sharpe.toFixed(3),
              altCagr: `${(altSelection.cagr * 100).toFixed(2)}%`,
            }),
      );
    }
    return { code, text: parts.join(" "), source: "rule" as const };
  }, [
    championCandidate,
    championModelKey,
    championSelectionMetrics,
    championFullMetrics,
    selectionHorizon,
    championNarrativeFacts,
    result.candidates,
    result.narrative_facts.objective,
    result.narrative_facts.objective_label,
    request.objective,
    t,
  ]);

  const displayChampionRationale = championRationale ?? ruleBasedChampionRationale;

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
    (!needsLazyCharts || selectedHasFullCharts || lazyPayloadComplete(
      lazyCharts ?? {
        model_code: selectedModelCode,
        equity_curve: [],
        weight_history: [],
        weight_history_tickers: [],
        benchmark_equity_curve: [],
      },
      needsLazyCharts,
      needsLazyAnalytics,
    )) &&
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
  const equity = useMemo(() => {
    const raw = chartCandidate?.equity_curve ?? result.equity_curve ?? [];
    return Array.isArray(raw) ? raw : [];
  }, [chartCandidate?.equity_curve, result.equity_curve]);
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
        name: etfDisplayName(ticker, lang),
        weight,
      }));
  }, [selected?.weights, lang]);

  const benchmarkRequest = useMemo(
    () =>
      request.benchmark_ticker || anchorBenchmarkTicker
        ? {
            ...request,
            benchmark_ticker: request.benchmark_ticker ?? anchorBenchmarkTicker,
          }
        : request,
    [request, anchorBenchmarkTicker],
  );

  const benchTicker = resolveResultBenchmarkTicker(
    benchmarkRequest,
    result.narrative_facts,
  );
  const benchLabel = formatBenchmarkDisplayLabel(benchTicker, lang, {
    anchorPortfolio,
  });
  const showAnchorBenchmarkNote = anchorDiffersFromBenchmarkTicker(
    anchorPortfolio,
    benchTicker,
  );
  const useAnchorPortfolioBaseline = Boolean(anchorBaselineResult);
  const anchorBaselineEquity = useMemo(
    () =>
      anchorBaselineResult
        ? resolveChampionEquityCurve(anchorBaselineResult)
        : [],
    [anchorBaselineResult],
  );
  const anchorBaselineBarMetrics = useMemo(() => {
    if (!anchorBaselineResult) return null;
    const idx = resolveChampionCandidateIndex(
      anchorBaselineResult.candidates,
      anchorBaselineResult.narrative_facts,
    );
    const champ =
      idx >= 0
        ? anchorBaselineResult.candidates[idx]
        : anchorBaselineResult.candidates[0];
    if (!champ) return null;
    const m = resolveHorizonMetrics(champ, "full_sample");
    return {
      sharpe: m.sharpe,
      sortino: m.sortino,
      cagr: m.cagr,
      max_drawdown: m.max_drawdown,
    };
  }, [anchorBaselineResult]);
  const anchorBaselineDisplayLabel =
    (anchorBaselineLabel ?? "").trim() ||
    (anchorPortfolio
      ? formatBenchmarkDisplayLabel(
          anchorPortfolio.benchmark || "ANCHOR",
          lang,
          { anchorPortfolio },
        )
      : t("compare.chart.anchor"));
  const jobBenchTicker = resolveJobBenchmarkTicker(result.narrative_facts);
  const benchMetricsStale =
    jobBenchTicker && benchTicker && jobBenchTicker !== benchTicker
      ? jobBenchTicker
      : undefined;

  useEffect(() => {
    if (
      process.env.NODE_ENV === "development" &&
      benchmarkTickerMismatch(benchmarkRequest, result.narrative_facts)
    ) {
      console.warn(
        "[benchmark] Job backtest_spec disagrees with request.benchmark_ticker — re-run backtest to refresh metrics.",
        {
          request: benchmarkRequest.benchmark_ticker,
          job: (
            result.narrative_facts.backtest_spec as { benchmark?: string } | undefined
          )?.benchmark,
        },
      );
    }
  }, [benchmarkRequest, result.narrative_facts, result.job_id]);
  const benchmarkEquity = useMemo(() => {
    if (useAnchorPortfolioBaseline && anchorBaselineEquity.length > 0) {
      return anchorBaselineEquity;
    }
    const fromChart = chartCandidate?.analytics?.benchmark_equity_curve;
    if (fromChart?.length) return fromChart;
    for (const c of result.candidates) {
      const curve = c.analytics?.benchmark_equity_curve;
      if (curve?.length) return curve;
    }
    return [];
  }, [
    useAnchorPortfolioBaseline,
    anchorBaselineEquity,
    chartCandidate?.analytics?.benchmark_equity_curve,
    result.candidates,
  ]);

  const activeBenchLabel = useAnchorPortfolioBaseline
    ? anchorBaselineDisplayLabel
    : benchLabel;

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
            benchmark: benchLabel,
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
            catalog_champion_model_code: catalogChampionForCompare,
            champion_rationale: displayChampionRationale?.text ?? null,
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
          llm_log?: LlmAuditEntry;
        };
        pushLlmAuditLog(json.llm_log);
        if (result.job_id) {
          void flushLlmAuditLogs(result.job_id);
        }
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
    if (useAnchorPortfolioBaseline && anchorBaselineBarMetrics) {
      return anchorBaselineBarMetrics;
    }
    const spec = result.narrative_facts.backtest_spec as
      | { benchmark_metrics?: Record<string, number> | null }
      | undefined;
    return spec?.benchmark_metrics ?? null;
  }, [
    useAnchorPortfolioBaseline,
    anchorBaselineBarMetrics,
    result.narrative_facts.backtest_spec,
  ]);

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
        benchTicker: useAnchorPortfolioBaseline
          ? "ANCHOR"
          : benchTicker,
        benchDisplayName: activeBenchLabel,
        selectedChartKey,
      }),
    [
      result.candidates,
      championModelKey,
      defaultSelectedRowKey,
      benchmarkBarMetrics,
      benchTicker,
      activeBenchLabel,
      useAnchorPortfolioBaseline,
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
    return buildHoldoutLeaderboard(oosLeaderboardRaw, leaderboardSort, fullByCode);
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
  const rebalanceSkipped = Number(result.narrative_facts.rebalance_skipped ?? 0);
  const rebalanceSnapshotsShown = Number(
    result.narrative_facts.rebalance_snapshots_shown ?? rebalanceApplied,
  );
  const rebalanceSnapshotsTotal = Number(
    result.narrative_facts.rebalance_snapshots_total ?? rebalanceSnapshotsShown,
  );
  const rebalanceChartDownsampled =
    rebalanceSnapshotsTotal > rebalanceSnapshotsShown && rebalanceSnapshotsShown > 0;
  const optimizationMode = String(result.narrative_facts.optimization_mode ?? "standard");
  const runObjectiveKey = resolveRunObjective(request, result.narrative_facts);
  const localizedObjectiveLabel = objectiveLabel(t, runObjectiveKey);
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

  const allowedClassSet = assetClassFilter?.length
    ? new Set(assetClassFilter)
    : null;
  const maxHoldings = Number(
    result.narrative_facts.max_holdings_constraint ?? request.max_holdings ?? 30,
  );
  const staticSleeveBudget = classBudgetFromParams(
    params as Record<string, number | undefined>,
    assetClassFilter?.length ? assetClassFilter : null,
  );
  const staticSlots = planClassSlots(maxHoldings, staticSleeveBudget);
  const staticQuotaRows = Object.entries(staticSleeveBudget).map(([cls, w]) => ({
    cls: quotaLabel(cls),
    target_pct: Number(w) * 100,
    target_count: staticSlots[cls] ?? 0,
  }));
  const regimeBudget = regimeQuotaMatrix?.[quotaRegimeTab];
  const filteredRegimeBudget = regimeBudget
    ? Object.fromEntries(
        Object.entries(regimeBudget).filter(
          ([cls]) => !allowedClassSet || allowedClassSet.has(cls),
        ),
      )
    : null;
  const regimeSlots = filteredRegimeBudget
    ? planClassSlots(maxHoldings, filteredRegimeBudget)
    : null;
  const regimeQuotaRows = filteredRegimeBudget
    ? Object.entries(filteredRegimeBudget).map(([cls, w]) => ({
        cls: quotaLabel(cls),
        target_pct: Number(w) * 100,
        target_count: regimeSlots?.[cls] ?? 0,
      }))
    : staticQuotaRows;
  const quotaRows = regimeQuotaMatrix ? regimeQuotaRows : staticQuotaRows;
  const exposureByRegime =
    top.analytics?.exposure_by_regime ?? chartCandidate?.analytics?.exposure_by_regime;
  const regimeConditionalExposure =
    regimeQuotaMatrix && exposureByRegime?.[quotaRegimeTab]
      ? exposureByRegime[quotaRegimeTab]
      : null;
  const exposureByClass =
    regimeConditionalExposure ??
    (top.analytics?.exposure?.by_asset_class &&
    Object.keys(top.analytics.exposure.by_asset_class).length > 0
      ? top.analytics.exposure.by_asset_class
      : chartCandidate?.analytics?.exposure?.by_asset_class);
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
      {showRunObjectiveBanner && (
        <OptimizationObjectiveBanner
          request={request}
          narrativeFacts={result.narrative_facts}
        />
      )}
      {!trustworthy && (
        <div className="ui-body border-2 border-[var(--amber)] bg-[rgba(255,176,0,0.08)] px-4 py-3 text-[var(--amber)]">
          {dataSource !== "yfinance"
            ? t("results.warning.sampleData")
            : t("results.warning.unrealistic")}
          {dq?.rows != null && (
            <span className="ui-body mt-1 block opacity-80">
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
        <div className="ui-body border-2 border-[var(--amber)] bg-[rgba(255,176,0,0.06)] px-4 py-2 text-[var(--amber)]">
          {dq.warning}
        </div>
      )}
      {result.narrative_facts.is_round_view === true && (
        <div className="ui-body border-2 border-[var(--amber)] bg-[rgba(255,176,0,0.06)] px-4 py-2 text-[var(--amber)]">
          {t("results.viewing")}: {String(result.narrative_facts.round_label ?? t("results.round"))}
          {result.narrative_facts.improved === true && ` · ${t("results.newRoundBest")}`}
        </div>
      )}
      <div className="ui-hint rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2">
        {optimizationMode === "pro_auto" && !result.narrative_facts.is_round_view ? (
          <>
            <span className="text-[var(--amber)]">{t("results.proRefinement")}</span>
            {" · "}
            {t("results.meta.rounds", {
              rounds: proRefinement?.rounds_completed ?? "—",
              trials: trialsRequested,
            })}
            {" · "}
            {proRefinement?.stopped_reason === "patience"
              ? t("results.meta.convergedEarly")
              : t("results.meta.fullSearch")}
          </>
        ) : isRmCompact ? (
          <>
            {championModelKey ? (
              <span className="text-[var(--primary)]">
                {t("results.rmChampionLine", {
                  model: championModelKey,
                  sharpe: displayMetrics.sharpe.toFixed(3),
                  cagr: `${(displayMetrics.cagr * 100).toFixed(2)}%`,
                })}
              </span>
            ) : (
              t("results.meta.search", { trials: trialsRequested })
            )}
          </>
        ) : (
          <>{t("results.meta.search", { trials: trialsRequested })}</>
        )}
        {!isRmCompact && (
        <>
        {" · "}
        {t("results.meta.reported", { feasible: trialsFeasible, reported: modelsReturned })}
        {modelsTotalCatalog > modelsReturned && (
          <span className="text-[var(--amber)]"> {t("results.meta.catalog", { catalog: modelsTotalCatalog })}</span>
        )}
        <span>
          {" · "}
          {t("results.meta.rebalance", {
            freq: rebalanceFreqLabel(t, rebalanceFreq),
            applied: rebalanceApplied,
            count: rebalanceCount,
          })}
          {rebalanceSkipped > 0 && (
            <>
              {" "}
              {t("results.meta.rebalanceSkipped", { skipped: rebalanceSkipped })}
            </>
          )}
          {rebalanceChartDownsampled && (
            <>
              {" · "}
              {t("results.meta.rebalanceChartDownsampled", {
                shown: rebalanceSnapshotsShown,
                total: rebalanceSnapshotsTotal,
              })}
            </>
          )}
        </span>
        </>
        )}
      </div>

      <ReportGroup
        index={1}
        title={t("report.group.summary")}
        subtitle={t("report.group.summaryHint")}
      >
      <div className="pixel-panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="ui-panel-title">{t("results.title")}</h3>
          {!sortByModelCode && (
            <span className="pixel-badge-cyan">
              {`${t("results.sort")}: ${localizedObjectiveLabel}`}
            </span>
          )}
          <label className="ui-body flex items-center gap-2 text-dim">
            {t("results.model")}
            <select
              value={selectedChartKey}
              onChange={(e) => setSelectedRowKey(e.target.value)}
              className="pixel-input ui-body py-1"
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
        {narrative && !isRmCompact ? (
          <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/50 px-4 py-3 text-dim">
            <p className="ui-section-title mb-2 text-[var(--cyan)]">
              {t("results.fullNarrative")}
            </p>
            <p className="ui-body whitespace-pre-wrap text-slate-700">
              {narrativePrefix ? `${narrativePrefix}\n\n` : ""}
              {narrative}
            </p>
          </div>
        ) : null}
        {sampleMetrics?.in_sample && !isRmCompact && (
          <div className="mt-3 border-2 border-[var(--amber)] bg-[rgba(255,176,0,0.06)] px-3 py-2">
            <p className="ui-section-title text-[var(--amber)]">
              {t("results.rankedOnInSample")} ({Math.round((sampleMetrics.train_ratio ?? 0.7) * 100)}%)
              {sampleMetrics.train_start && sampleMetrics.train_end
                ? ` · ${sampleMetrics.train_start} → ${sampleMetrics.train_end}`
                : sampleMetrics.train_end
                  ? ` · ${t("results.endsOn", { date: String(sampleMetrics.train_end) })}`
                  : trainPeriod?.start && trainPeriod?.end
                    ? ` · ${trainPeriod.start} → ${trainPeriod.end}`
                    : ""}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-center ui-body sm:grid-cols-4">
              <div>
                <div className="text-dim">
                  {t("common.inSample")} {localizedObjectiveLabel}
                </div>
                <div className="text-[var(--primary)]">
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
                <div className="text-slate-700">
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
        {isDynamicObjective && !isRmCompact && (
          <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
            <p className="ui-section-title text-[var(--amber)]">
              {t("results.dynamicScoreTitle")}
            </p>
            <p className="ui-body mt-1 text-dim">
              {t("results.dynamicScoreExplain")}
            </p>
            <p className="ui-hint mt-1">
              <code className="ui-hint">{t("results.proChampionScoreFormula")}</code>
            </p>
          </div>
        )}
        {displayChampionRationale && (
          <div className="mt-3 border-2 border-[var(--amber)] bg-[rgba(255,176,0,0.06)] px-3 py-2">
            <p className="ui-section-title text-[var(--amber)]">
              {isRmCompact
                ? t("rm.quant.championWhyTitle")
                : t("results.championWhyTitle", { code: displayChampionRationale.code })}
            </p>
            {!isRmCompact ? (
              <p className="ui-hint mt-1 text-dim">{t("results.championWhyHorizonNote")}</p>
            ) : (
              <>
                <p className="ui-hint mt-1 text-dim">
                  {t("rm.quant.championWhyCode", { code: displayChampionRationale.code })}
                </p>
                <p className="ui-hint mt-1 text-dim">{t("results.championWhyHorizonNote")}</p>
              </>
            )}
            <div className="mt-2 grid grid-cols-3 gap-2 text-center ui-body">
              <div>
                <div className="text-dim">{t("results.championFullSharpe")}</div>
                <div className="text-[var(--primary)]">{championFullMetrics.sharpe.toFixed(3)}</div>
              </div>
              <div>
                <div className="text-dim">{t("results.championFullMaxDd")}</div>
                <div className="text-[var(--pink)]">
                  {(championFullMetrics.max_drawdown * 100).toFixed(2)}%
                </div>
              </div>
              <div>
                <div className="text-dim">{t("results.championFullCagr")}</div>
                <div className="text-slate-700">
                  {(championFullMetrics.cagr * 100).toFixed(2)}%
                </div>
              </div>
            </div>
            <p className="ui-body mt-2 text-slate-700">{displayChampionRationale.text}</p>
          </div>
        )}
        <p className="ui-hint mt-4">{t("results.fullPeriod")}</p>
        <div className="mt-2 grid grid-cols-3 gap-3 text-center">
          <Metric label={t("common.sharpe")} value={displayMetrics.sharpe} />
          <Metric
            label={t("common.maxDd")}
            value={displayMetrics.max_drawdown}
            format="pct"
          />
          <Metric label={t("common.cagr")} value={displayMetrics.cagr} format="pct" />
        </div>
        {!isRmCompact && (
        <>
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
        </>
        )}
        {showHorizonCompare && inSampleMetrics && outOfSampleMetrics && !isRmCompact ? (
          <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
            <p className="ui-section-title text-[var(--cyan)]">
              {t("results.horizonCompareTitle")}
            </p>
            <p className="ui-hint mt-1">
              {t("results.horizonMetricsHint")}
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left ui-body">
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
                    label={localizedObjectiveLabel}
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
              <p className="ui-hint mt-2">
                {t("results.gapObjectiveSharpe")}{" "}
                {sampleMetrics.gap.objective?.toFixed(4) ?? "—"}, {t("common.sharpe")}{" "}
                {sampleMetrics.gap.sharpe?.toFixed(4) ?? "—"} ({t("results.positiveInSampleStronger")}).
              </p>
            ) : null}
          </div>
        ) : null}
        {holdoutLeaderboard.length > 0 && !isRmCompact && (
          <div className="mt-3 overflow-x-auto">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="ui-section-title text-[var(--cyan)]">
                {t(LEADERBOARD_TITLE_KEYS[leaderboardSort])}
              </p>
              <label className="ui-body flex items-center gap-2 text-dim">
                {t("results.sortTableBy")}
                <select
                  value={leaderboardSort}
                  onChange={(e) =>
                    setLeaderboardSort(e.target.value as LeaderboardSort)
                  }
                  className="pixel-input ui-body py-0.5"
                >
                  <option value="in_sample">{t("results.inSampleSelection")}</option>
                  <option value="out_of_sample">{t("common.outOfSample")}</option>
                  <option value="full_sample">{t("common.full")}</option>
                  <option value="gap">{t("results.gapSelection")}</option>
                </select>
              </label>
            </div>
            {isDynamicObjective ? (
              <p className="ui-hint mb-2">
                {t("results.leaderboardDynamicNote")}
              </p>
            ) : null}
            <table className="w-full text-left ui-body">
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
                    key={row.model_code ?? `oos-${i}`}
                    className={`border-t border-[var(--border)] ${
                      rowKey ? "cursor-pointer hover:bg-[var(--primary-muted)]/40" : ""
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
                    <td className="py-1 text-right text-[var(--primary)]">
                      {row.in_sample_objective?.toFixed(4) ?? "—"}
                    </td>
                    <td className="py-1 text-right text-[var(--cyan)]">
                      {row.out_of_sample_objective?.toFixed(4) ?? "—"}
                    </td>
                    <td className="py-1 text-right text-slate-700">
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
        {!isRmCompact && (
        <>
        <p className="ui-hint mt-3">
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
        {warmStartFacts?.matched ? (
          <p className="ui-hint mt-2 text-[#7ee8ff]">
            {t(
              warmStartFacts.match_type === "fuzzy"
                ? "results.warmStartFuzzy"
                : "results.warmStartExact",
              {
                code: String(warmStartFacts.seeded_model_code ?? "—"),
                job: String(warmStartFacts.matched_job_id ?? "—").slice(0, 8),
              },
            )}
            {warmStartFacts.improved === true
              ? ` · ${t("results.warmStartImproved")}`
              : warmStartFacts.improved === false
                ? ` · ${t("results.warmStartKept")}`
                : ""}
          </p>
        ) : null}
        {weightCapViolation ? (
          <p className="ui-body mt-2 border-2 border-[#ff2bd6] bg-[rgba(255,43,214,0.08)] px-2 py-1 text-[#ff9ae8]">
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
        </>
        )}
      </div>
      </ReportGroup>

      <ReportGroup
        index={2}
        title={t("report.group.performance")}
        subtitle={t("report.group.performanceHint")}
      >
      <ChartCard title={t("results.chart.performanceComparison")} subtitle={t("results.fullPeriod")}>
        {useAnchorPortfolioBaseline ? (
          <p className="ui-hint mb-3 text-dim">
            {t("results.anchorPortfolioBaselineNote", {
              anchor: anchorBaselineDisplayLabel,
            })}
          </p>
        ) : showAnchorBenchmarkNote ? (
          <p className="ui-hint mb-3 text-dim">
            {t("results.anchorBenchmarkNote", {
              anchor: benchLabel,
              ticker: benchTicker,
            })}
          </p>
        ) : null}
        {!isRmCompact && (
        <div className="mb-3 rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2">
          <p className="ui-section-title mb-1">{t("results.aiComparison")}</p>
          {compareLoading ? (
            <p className="ui-hint">{t("results.generatingComparison")}</p>
          ) : compareSummary ? (
            <div className="ui-body space-y-2">
              {compareRetryNote ? (
                <p className="ui-hint text-amber-400/90">{compareRetryNote}</p>
              ) : null}
              {compareSummary
                .split(/\n\s*\n+/)
                .map((para) => para.trim())
                .filter(Boolean)
                .map((para, i) => (
                  <p key={i} className="text-slate-700">
                    {para}
                  </p>
                ))}
            </div>
          ) : (
            <p className="ui-hint">{t("results.noComparisonYet")}</p>
          )}
        </div>
        )}
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
                const code = row?.isBenchmark
                  ? (row?.name ?? row?.model_code ?? "—")
                  : (row?.model_code ?? row?.name ?? "M?");
                return (
                  <div
                    className="rounded-lg border border-[var(--primary)] bg-white px-3 py-2"
                    style={{ fontSize: chartTip }}
                  >
                    <div
                      className="mb-1 text-xs font-semibold text-[var(--amber)]"
                      style={{ fontSize: Math.max(11, chartTip - 1) }}
                    >
                      {row?.isBenchmark ? t("results.benchmark") : t("results.model")}{" "}
                      {code}
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
                      <span className="text-xs font-semibold text-[var(--amber)]">★ {t("results.champion")}</span>
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
          <p className="ui-hint mt-3">
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
          <p className="ui-hint mb-3 flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 animate-spin rounded-full border border-[var(--amber)] border-t-transparent"
              aria-hidden
            />
            {t("results.loadingTrajectory", { model: selectedModelCode })}
          </p>
        ) : null}
        {chartsLoadError && !chartsReady ? (
          <p className="ui-hint mb-3 text-red-400">{chartsLoadError}</p>
        ) : null}
        {dynamicObjectiveChart ? (
          <p className="ui-hint mb-3">
            {t("results.walkForwardHint")}
            {isDynamicObjective ? (
              <>
                {" "}
                {t("results.proChampionScorePrefix")}{" "}
                <span className="text-[var(--amber)]">{t("results.comprehensiveScore")}</span> (
                <code className="ui-hint">objective_value_is</code>
                ) — {t("results.proChampionScoreFormula")}
              </>
            ) : null}
          </p>
        ) : null}
        {chartsReady ? (
          <LinkedEquityWeightChart
            equityCurve={equity}
            benchmarkCurve={benchmarkEquity}
            benchmarkLabel={activeBenchLabel}
            weightHistory={historySeries}
            weightTickers={weightHistoryTickers}
            colors={COLORS}
            regimeTimeline={dynamicObjectiveChart?.timeline}
          />
        ) : chartsLoading ? null : (
          <p className="ui-hint">
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
          <p className="ui-body text-dim">
            {t("results.summaryOnlyModel")}
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
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
            <div className="max-h-60 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
              <table className="w-full text-left ui-body">
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
                      <td className="py-1.5 text-right text-[var(--primary)]">
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

      {!isRmCompact && (
      <ReportGroup
        index={5}
        title={t("report.group.strategy")}
        subtitle={t("report.group.strategyHint")}
      >
      <ChartCard title={t("results.chart.efficientFrontier")}>
        <p className="ui-hint mb-2">
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
                    className="rounded-lg border border-[var(--primary)] bg-white px-3 py-2"
                    style={{ fontSize: chartTip }}
                  >
                    <div className="ui-hint mb-1 uppercase tracking-wide">
                      {seriesLabel}
                    </div>
                    <div
                      className="mb-1 text-xs font-semibold text-[var(--amber)]"
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
          <p className="ui-hint mb-2">
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
                className={`rounded border px-2 py-1 text-xs font-medium ${
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
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
            <p className="ui-hint mb-2">
              {regimeQuotaMatrix
                ? t("results.targetNamesRegime", { regime: regimeLabel(t, quotaRegimeTab) })
                : t("results.targetNamesAi")}
            </p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={quotaRows}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis dataKey="cls" stroke="#94a3b8" fontSize={chartTick} />
                <YAxis stroke="#94a3b8" fontSize={chartTick} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} />
                <Tooltip content={<ChartTooltip valueIsPct={false} valueDecimals={1} />} />
                <Bar dataKey="target_pct" name={t("results.targetWeightPct")} fill="#00f5ff" />
              </BarChart>
            </ResponsiveContainer>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={quotaRows}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis dataKey="cls" stroke="#94a3b8" fontSize={chartTick} />
                <YAxis stroke="#94a3b8" fontSize={chartTick} allowDecimals={false} />
                <Tooltip content={<ChartTooltip valueIsPct={false} valueDecimals={0} />} />
                <Bar dataKey="target_count" name={t("results.targetCount")} fill="#a78bfa" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
            <p className="ui-hint mb-2">
              {regimeQuotaMatrix && regimeConditionalExposure
                ? t("results.actualClassWeightsRegime", {
                    regime: regimeLabel(t, quotaRegimeTab),
                  })
                : t("results.actualClassWeights")}
            </p>
            {usingChampionAnalyticsFallback &&
            (!top.analytics?.exposure?.by_asset_class ||
              Object.keys(top.analytics.exposure.by_asset_class).length === 0) ? (
              <p className="ui-hint mb-2">
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
          <p className="ui-hint mb-2">
            {t("results.factorAttributionChampion")}
          </p>
        ) : null}
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
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
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
            <p className="ui-section-title mb-2">{t("results.factorMetricLogic")}</p>
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {factorLogicRows.length === 0 ? (
                <p className="ui-hint">{t("results.noMetricLogic")}</p>
              ) : (
                factorLogicRows.map(([k, v]) => (
                  <div key={k} className="border-b border-slate-800 py-1">
                    <span className="ui-body text-slate-700">{factorLogicLabel(k)}</span>
                    <div className="ui-hint">{String(v)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </ChartCard>
      </ReportGroup>
      )}

      <ReportGroup
        index={6}
        title={t("report.group.institutional")}
        subtitle={t("report.group.institutionalHint")}
      >
      <InstitutionalReport
        candidate={institutionalCandidate ?? top}
        benchmark={benchLabel}
        benchmarkMetricsStale={benchMetricsStale}
        isLoadingAnalytics={analyticsLoading}
        loadingModelCode={selectedModelCode || undefined}
        analyticsNote={
          usingChampionAnalyticsFallback
            ? t("results.analyticsFallback")
            : undefined
        }
        variant={isRmCompact ? "rm" : "default"}
      />
      </ReportGroup>

      {!isRmCompact && (
      <ReportGroup
        index={7}
        title={t("report.group.reproducibility")}
        subtitle={t("report.group.reproducibilityHint")}
      >
      <ChartCard title={t("results.chart.reproducibleParameters")}>
        {((aiRationalesByRound?.length ?? 0) > 0 || Boolean(aiGen.rationale)) ? (
          <details
            open
            className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2"
          >
            <summary className="ui-body cursor-pointer text-[var(--amber)] hover:text-[var(--primary)]">
              {t("results.aiParameterRationale")}
            </summary>
            <div className="ui-body mt-2 max-h-72 space-y-3 overflow-y-auto text-slate-700">
              {aiRationalesByRound?.length ? (
                aiRationalesByRound.map((text, i) => (
                  <div key={i}>
                    <p className="ui-section-title mb-1 text-dim">
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
          <p className="ui-hint mb-3">{t("results.noAiRationale")}</p>
        )}
        <details className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
          <summary className="ui-body cursor-pointer text-dim hover:text-[var(--cyan)]">
            {t("results.fullRunConfig")}
          </summary>
          <pre className="ui-body mt-2 max-h-[28rem] overflow-auto whitespace-pre-wrap text-[var(--cyan)]">
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
      )}


      {allBelowBenchmark ? (
        onContinueRefinement ? (
          <ContinueRefinementCTA
            jobId={result.job_id}
            request={request}
            benchmarkTicker={benchTicker}
            onContinue={onContinueRefinement}
            onAdjustConfig={onRerun}
            loading={continueLoading}
          />
        ) : (
          <div className="pixel-panel border border-amber-200 bg-amber-50/50">
            <p className="ui-section-title mb-1 text-[var(--amber)]">
              {t("results.belowBenchmarkTitle")}
            </p>
            <p className="ui-body text-slate-700">
              {t("results.belowBenchmarkBody", { benchmark: benchLabel })}
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
        )
      ) : null}

      {!isRmCompact ? (
      <div className="pixel-panel">
        <QuickRefinements
          request={request}
          onApply={(next, label) => onQuickTweak(next, label ?? t("results.manualAdjustment"))}
          onApplyAndRun={onQuickTweakAndRun}
        />
        <p className="ui-hint mt-2">{t("results.refineHint")}</p>
      </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={onRerun} className="pixel-btn">
          {t("results.editConfig")}
        </button>
        <button type="button" onClick={onExport} className="pixel-btn">
          {t("results.exportCsv")}
        </button>
      </div>

      <p className="ui-hint">
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
      <td className="py-1 text-right text-[var(--primary)]">{fmt(inSample)}</td>
      <td className="py-1 text-right text-[var(--cyan)]">{fmt(outOfSample)}</td>
      <td className="py-1 text-right text-slate-700">{fmt(full)}</td>
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
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
      <div className="ui-body text-dim">{label}</div>
      <div className="text-xl font-semibold tabular-nums text-[var(--primary)]">{text}</div>
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
      <header className="rounded-lg border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
        <div className="flex items-baseline gap-3">
          <span className="text-xs font-semibold text-[var(--amber)]">
            {String(index).padStart(2, "0")}
          </span>
          <h3 className="ui-panel-title">{title}</h3>
        </div>
        {subtitle ? <p className="ui-hint mt-1">{subtitle}</p> : null}
      </header>
      <div className="space-y-5">{children}</div>
    </section>
  );
}
