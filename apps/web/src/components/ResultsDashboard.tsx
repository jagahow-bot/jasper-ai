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
import {
  OverfittingConvergenceChart,
  type ConvergencePoint,
} from "@/components/OverfittingConvergenceChart";
import { QuickRefinements } from "@/components/QuickRefinements";
import {
  ASSET_CLASS_LABELS,
  SUB_ASSET_CLASS_LABELS,
  SUB_ASSET_PARAM_KEYS,
  type SubAssetClassKey,
} from "@/lib/constants";
import { quotaKeysForClasses } from "@/lib/asset-class-policy";
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
} from "@/lib/performance-compare-chart";
import type {
  BacktestRequest,
  BacktestResult,
  BenchmarkSeriesPoint,
  DynamicObjectiveTimelinePoint,
} from "@/lib/types";
import {
  chartLegendFontSize,
  chartTickFontSize,
  chartTooltipFontSize,
} from "@/lib/benchmark-chart-scale";
import { getUniverseItems } from "@/lib/universe";

const CHAMPION_STROKE = "#ffb000";
const BENCHMARK_FILL = "#ffb000";
const METRIC_FILLS = {
  cagr: "#34d399",
  mdd: "#f87171",
  sharpe: "#60a5fa",
  sortino: "#a78bfa",
} as const;

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

/** Prefer ticker when catalog name is CJK (legacy universe labels). */
function holdingDisplayName(ticker: string, catalogName?: string): string {
  if (!catalogName || catalogName === ticker) return ticker;
  if (/[\u4e00-\u9fff\u3040-\u30ff]/.test(catalogName)) return ticker;
  return catalogName;
}

type Props = {
  result: BacktestResult;
  narrative: string;
  request: BacktestRequest;
  onRerun: () => void;
  onExport: () => void;
  onQuickTweak: (next: BacktestRequest, label: string) => void;
  onQuickTweakAndRun: (next: BacktestRequest, label: string) => void;
};

export function ResultsDashboard({
  result,
  narrative,
  request,
  onRerun,
  onExport,
  onQuickTweak,
  onQuickTweakAndRun,
}: Props) {
  const chartTick = chartTickFontSize();
  const chartLegend = chartLegendFontSize();
  const chartTip = chartTooltipFontSize();
  const [selectedRowKey, setSelectedRowKey] = useState<string>("");
  const [compareSummary, setCompareSummary] = useState("");
  const [aiRecommendedModelCode, setAiRecommendedModelCode] = useState<
    string | null
  >(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [leaderboardSort, setLeaderboardSort] =
    useState<LeaderboardSort>("in_sample");

  const resultSelectionEpoch = useMemo(
    () =>
      `${result.job_id}\0${result.candidates
        .map((c, i) => candidateRowKey(c, i))
        .join("\0")}`,
    [result.job_id, result.candidates],
  );

  const championNarrativeFacts = useMemo(() => {
    if (!aiRecommendedModelCode) return result.narrative_facts;
    return {
      ...result.narrative_facts,
      ai_recommended_model_code: aiRecommendedModelCode,
    };
  }, [result.narrative_facts, aiRecommendedModelCode]);

  useEffect(() => {
    setAiRecommendedModelCode(null);
    setCompareSummary("");
  }, [resultSelectionEpoch]);

  useEffect(() => {
    setSelectedRowKey(
      resolveDefaultSelectedRowKey(
        result.candidates,
        championNarrativeFacts,
      ),
    );
  }, [resultSelectionEpoch, result.candidates, championNarrativeFacts]);

  useEffect(() => {
    if (!aiRecommendedModelCode) return;
    setSelectedRowKey(
      resolveDefaultSelectedRowKey(
        result.candidates,
        championNarrativeFacts,
      ),
    );
  }, [aiRecommendedModelCode, result.candidates, championNarrativeFacts]);

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

  const selectedHasFullCharts = useMemo(() => {
    if (!selected) return false;
    const wh = selected.analytics?.weight_history;
    const ec = selected.equity_curve;
    return Boolean((wh && wh.length > 0) || (ec && ec.length > 0));
  }, [selected]);

  const chartCandidate = useMemo(() => {
    if (selectedHasFullCharts && selected) return selected;
    return championCandidate ?? selected;
  }, [selected, selectedHasFullCharts, championCandidate]);

  const chartsUseChampionFallback =
    Boolean(selected && chartCandidate && selected !== chartCandidate);

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
    const aligned = firstEquityDate
      ? weightHistory.filter((row) => String(row.date) >= firstEquityDate)
      : weightHistory;
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
        name: holdingDisplayName(ticker, tickerNameMap.get(ticker)),
        weight,
      }));
  }, [selected?.weights, tickerNameMap]);

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

  useEffect(() => {
    if (result.candidates.length < 2) {
      setCompareSummary("");
      setAiRecommendedModelCode(null);
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
              typeof result.narrative_facts.champion_model_code === "string"
                ? result.narrative_facts.champion_model_code
                : championModelKey,
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
          recommended_model_code?: string | null;
        };
        if (!cancelled) {
          setCompareSummary(json.summary ?? "");
          const rec = json.recommended_model_code?.trim();
          setAiRecommendedModelCode(rec ? rec.toUpperCase() : null);
        }
      } catch {
        if (!cancelled) {
          setCompareSummary("");
          setAiRecommendedModelCode(null);
        }
      } finally {
        if (!cancelled) setCompareLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    benchTicker,
    championModelKey,
    result.candidates,
    result.narrative_facts,
    request.objective,
    result.job_id,
  ]);

  const benchmarkBarMetrics = useMemo(() => {
    const spec = result.narrative_facts.backtest_spec as
      | { benchmark_metrics?: Record<string, number> | null }
      | undefined;
    return spec?.benchmark_metrics ?? null;
  }, [result.narrative_facts.backtest_spec]);

  const dynamicObjectiveChart = useMemo(() => {
    const isDynamic =
      request.objective === "dynamic" ||
      result.narrative_facts.objective === "dynamic" ||
      result.narrative_facts.dynamic_objective_mode === true;
    if (!isDynamic) return null;

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
    result.dynamic_objective_timeline,
    result.dynamic_objective_benchmark_series,
    result.narrative_facts,
    selected?.analytics,
    benchmarkEquity,
    equity,
  ]);

  const preserveTrialOrder = Boolean(result.narrative_facts.is_round_view);

  const modelSelectOptions = useMemo(() => {
    const indexed = result.candidates.map((c, i) => ({ c, i }));
    if (preserveTrialOrder) return indexed;
    return [...indexed].sort((a, b) =>
      compareModelCode(
        a.c.model_code ?? `M?${a.c.rank}`,
        b.c.model_code ?? `M?${b.c.rank}`,
      ),
    );
  }, [result.candidates, preserveTrialOrder]);

  const candidateCompare = useMemo(
    () =>
      buildPerformanceCompareRows({
        candidates: result.candidates,
        championModelKey,
        preserveTrialOrder,
        benchmarkBarMetrics,
        benchTicker,
        selectedChartKey,
      }),
    [
      result.candidates,
      championModelKey,
      benchmarkBarMetrics,
      benchTicker,
      preserveTrialOrder,
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
      extentWithZero(leftVals),
      extentWithZero(rightVals),
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

  if (!selected) return null;
  const top = selected;
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
        convergence_history?: ConvergencePoint[];
        rounds_completed?: number;
        stopped_reason?: string;
        champion_adjusted_score?: number;
      }
    | null
    | undefined;
  const convergenceHistory = proRefinement?.convergence_history ?? [];
  const sampleMetrics = top.analytics?.sample_metrics;
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
  const classQuota = Object.fromEntries(
    quotaKeyList.map((k) => [k, Number(params[k] ?? 0)]),
  );
  const quotaSum = Object.values(classQuota).reduce(
    (a, b) => a + (Number.isFinite(b) ? b : 0),
    0,
  );
  const targetTopN = Number(params["top_n_actual"] ?? request.top_n);
  const quotaRows = Object.entries(classQuota).map(([k, v]) => ({
    cls: quotaLabel(k),
    target_count: Math.round((quotaSum > 0 ? v / quotaSum : 0) * targetTopN),
  }));
  const allowedClassSet = assetClassFilter?.length
    ? new Set(assetClassFilter)
    : null;
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
      momentum: "Momentum",
      reversal: "Reversal",
      value: "Value",
      lowvol: "Low vol",
      trend: "Trend",
      drawdown: "Drawdown",
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
            ? "WARN: not using live yfinance — metrics are UI test only."
            : "WARN: metrics look unrealistic (e.g. extreme Sharpe, flat DD) — check data/params."}
          {dq?.rows != null && (
            <span className="mt-1 block text-xs opacity-80">
              Data: {dq.start} → {dq.end}, {dq.rows} sessions · {dataSource}
            </span>
          )}
        </div>
      )}
      {trustworthy && dq && (
        <div className="pixel-badge-cyan inline-block">
          Live yfinance · {dq.start} → {dq.end} · {dq.rows} sessions
          {dq.requested_start && dq.requested_start !== dq.start && (
            <span className="ml-2 text-[var(--amber)]">
              (requested {dq.requested_start}
              {dq.excluded_late_listing_count
                ? ` · ${dq.excluded_late_listing_count} late listings dropped`
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
          Viewing: {String(result.narrative_facts.round_label ?? "round")}
          {result.narrative_facts.improved === true && " · new round best"}
        </div>
      )}
      <div className="border-2 border-[var(--border)] bg-[#050508] px-4 py-2 font-terminal text-sm text-dim">
        {optimizationMode === "pro_auto" && !result.narrative_facts.is_round_view ? (
          <>
            <span className="text-[var(--amber)]">Pro convergence</span>
            {" · "}
            {proRefinement?.rounds_completed ?? "—"} rounds · {trialsRequested} trials · early stop{" "}
            {proRefinement?.stopped_reason === "patience" ? "yes (flat)" : "no (max rounds)"}
          </>
        ) : (
          <>Param search {trialsRequested} trials</>
        )}
        {" · "}feasible {trialsFeasible} · report {modelsReturned}
        {modelsTotalCatalog > modelsReturned && (
          <span className="text-[var(--amber)]"> (catalog {modelsTotalCatalog})</span>
        )}
        <span>
          {" "}
          · rebalance {rebalanceFreq} ({rebalanceApplied}/{rebalanceCount} applied)
        </span>
      </div>

      {optimizationMode === "pro_auto" &&
        !result.narrative_facts.is_round_view &&
        convergenceHistory.length > 0 && (
        <div className="pixel-panel border-[var(--amber)] p-5">
          <OverfittingConvergenceChart
            history={convergenceHistory}
            objectiveLabel={objectiveLabel}
          />
        </div>
      )}
      <div className="pixel-panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-pixel text-xs text-neon glow-title">Results · institutional</h3>
          <span className="pixel-badge-cyan text-[10px]">
            {preserveTrialOrder ? "order: Optuna trials" : `sort: ${objectiveLabel}`}
          </span>
          <label className="flex items-center gap-2 text-xs text-dim">
            model
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
          <details className="mt-3 text-sm text-dim">
            <summary className="cursor-pointer hover:text-[var(--cyan)]">
              Full backtest narrative
            </summary>
            <p className="mt-2 whitespace-pre-wrap leading-relaxed">{narrative}</p>
          </details>
        ) : null}
        {sampleMetrics?.in_sample && (
          <div className="mt-3 border-2 border-[var(--amber)] bg-[rgba(255,176,0,0.06)] px-3 py-2 text-xs">
            <p className="font-pixel text-[8px] text-[var(--amber)]">
              Ranked on in-sample ({Math.round((sampleMetrics.train_ratio ?? 0.7) * 100)}%)
              {sampleMetrics.train_start && sampleMetrics.train_end
                ? ` · ${sampleMetrics.train_start} → ${sampleMetrics.train_end}`
                : sampleMetrics.train_end
                  ? ` · ends ${sampleMetrics.train_end}`
                  : trainPeriod?.start && trainPeriod?.end
                    ? ` · ${trainPeriod.start} → ${trainPeriod.end}`
                    : ""}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-center font-terminal text-sm sm:grid-cols-4">
              <div>
                <div className="text-dim">IS {sampleMetrics.objective_label ?? objectiveLabel}</div>
                <div className="text-neon">
                  {Number(sampleMetrics.in_sample.objective_value).toFixed(4)}
                </div>
              </div>
              <div>
                <div className="text-dim">OOS (holdout)</div>
                <div className="text-[var(--cyan)]">
                  {sampleMetrics.out_of_sample
                    ? Number(sampleMetrics.out_of_sample.objective_value).toFixed(4)
                    : "—"}
                </div>
              </div>
              <div>
                <div className="text-dim">Full period</div>
                <div className="text-slate-200">
                  {sampleMetrics.full_sample
                    ? Number(sampleMetrics.full_sample.objective_value).toFixed(4)
                    : "—"}
                </div>
              </div>
              <div>
                <div className="text-dim">Gap (IS−OOS)</div>
                <div className="text-[#ff2bd6]">
                  {sampleMetrics.gap?.objective != null
                    ? Number(sampleMetrics.gap.objective).toFixed(4)
                    : "—"}
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <Metric
            label={sampleMetrics ? "Sharpe (in-sample)" : "Sharpe"}
            value={top.sharpe}
          />
          <Metric
            label="Max DD"
            value={top.max_drawdown}
            format="pct"
          />
          <Metric label="CAGR" value={top.cagr} format="pct" />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <Metric label="Vol" value={top.volatility} format="pct" />
          <Metric label="Sortino" value={top.sortino ?? 0} />
          <Metric label="Calmar" value={top.calmar ?? 0} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <Metric label="VaR 95% (d)" value={top.var_95 ?? 0} format="pct" />
          <Metric label="CVaR 95% (d)" value={top.cvar_95 ?? 0} format="pct" />
          <Metric label="Win rate" value={top.win_rate ?? 0} format="pct" />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <Metric label="Avg turnover" value={top.turnover_avg ?? 0} format="pct" />
          <Metric label="Total turnover" value={top.turnover_total ?? 0} format="pct" />
          <Metric label="Max DD days" value={top.max_drawdown_duration_days ?? 0} />
        </div>
        {(top.beta != null || top.information_ratio != null) && (
          <div className="mt-3 grid grid-cols-4 gap-3 text-center">
            <Metric label="Beta" value={top.beta ?? 0} />
            <Metric label="Alpha" value={top.alpha ?? top.alpha_annual ?? 0} format="pct" />
            <Metric label="TE" value={top.tracking_error ?? 0} format="pct" />
            <Metric label="IR" value={top.information_ratio ?? 0} />
          </div>
        )}
        {top.train_sharpe != null && sampleMetrics?.out_of_sample && (
          <div className="mt-3 grid grid-cols-2 gap-3 text-center">
            <Metric label="Sharpe (in-sample)" value={top.train_sharpe} />
            <Metric label="Sharpe (holdout)" value={top.validation_sharpe ?? 0} />
          </div>
        )}
        {holdoutLeaderboard.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-dim">
                Champion leaderboard · AI trials ranked on in-sample only
              </p>
              <label className="flex items-center gap-2 text-xs text-dim">
                Sort table by
                <select
                  value={leaderboardSort}
                  onChange={(e) =>
                    setLeaderboardSort(e.target.value as LeaderboardSort)
                  }
                  className="pixel-input py-0.5 text-xs"
                >
                  <option value="in_sample">In-sample (selection)</option>
                  <option value="out_of_sample">Out-of-sample</option>
                  <option value="full_sample">Full period</option>
                </select>
              </label>
            </div>
            <table className="w-full text-left text-xs">
              <thead className="text-dim">
                <tr>
                  <th className="pb-1">Model</th>
                  <th className="pb-1 text-right">IS obj</th>
                  <th className="pb-1 text-right">OOS obj</th>
                  <th className="pb-1 text-right">Full obj</th>
                  <th className="pb-1 text-right">Gap</th>
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
          engine {String(result.narrative_facts.engine ?? "—")} · holdings{" "}
          {String(result.narrative_facts.top_holdings_count ?? Object.keys(top.weights).length)}
          · max weight{" "}
          {(Math.max(...Object.values(top.weights)) * 100).toFixed(1)}% (run cap{" "}
          {(Number(result.narrative_facts.max_weight_constraint ?? 0) * 100).toFixed(0)}% ·
          effective{" "}
          {(
            Number(
              result.narrative_facts.max_weight_effective_cap ??
                result.narrative_facts.max_weight_trial_param ??
                result.narrative_facts.max_weight_actual ??
                0,
            ) * 100
          ).toFixed(0)}% · observed{" "}
          {(
            Number(result.narrative_facts.max_weight_observed ?? 0) * 100
          ).toFixed(0)}%)
          {result.narrative_facts.oos_enabled
            ? " · selection = in-sample; holdout = pseudo live"
            : ""}
        </p>
        {weightCapViolation ? (
          <p className="mt-2 border-2 border-[#ff2bd6] bg-[rgba(255,43,214,0.08)] px-2 py-1 text-xs text-[#ff9ae8]">
            Weight cap breach: observed{" "}
            {(
              Number(
                weightCapAudit?.worst_observed_weight ??
                  weightCapAudit?.max_observed_weight ??
                  result.narrative_facts.max_weight_observed ??
                  0,
              ) * 100
            ).toFixed(1)}
            % vs effective cap{" "}
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
              ? ` · first on ${String(weightCapAudit.first_violation_date)}`
              : ""}
            {weightCapAudit?.min_holdings_for_cap != null &&
            weightCapAudit?.tradable_count != null &&
            Number(weightCapAudit.tradable_count) <
              Number(weightCapAudit.min_holdings_for_cap) ? (
              <span>
                {" "}
                · only {String(weightCapAudit.tradable_count)} tradable names (need ≥
                {String(weightCapAudit.min_holdings_for_cap)} for this cap)
              </span>
            ) : null}
          </p>
        ) : null}
      </div>

      <ChartCard title="Performance comparison">
        <div className="mb-3 border-2 border-[#0a4a4a] bg-[rgba(0,245,255,0.05)] px-3 py-2">
          <p className="mb-1 font-pixel text-[8px] text-[var(--cyan)]">AI compare</p>
          {compareLoading ? (
            <p className="text-xs text-dim">Generating compare narrative…</p>
          ) : compareSummary ? (
            <div className="space-y-2 text-xs leading-relaxed">
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
            <p className="text-xs text-dim">No compare narrative yet</p>
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
                      {row?.isBenchmark ? "benchmark" : "model"} {code}
                      {row?.isChampion ? " · champion" : ""}
                    </div>
                    <div>CAGR: {Number(row?.cagr_pct ?? 0).toFixed(2)}%</div>
                    <div>MaxDD：{Number(row?.mdd_pct ?? 0).toFixed(2)}%</div>
                    <div>Sharpe：{Number(row?.sharpe ?? 0).toFixed(3)}</div>
                    <div>Sortino：{Number((row as { sortino?: number } | undefined)?.sortino ?? 0).toFixed(3)}</div>
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
                      <span className="font-pixel text-[10px]">★ champion</span>
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
            <Bar yAxisId="left" dataKey="cagr_pct" fill={METRIC_FILLS.cagr} name="CAGR %">
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
            <Bar yAxisId="left" dataKey="mdd_pct" fill={METRIC_FILLS.mdd} name="MaxDD %">
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
            <Bar yAxisId="right" dataKey="sharpe" fill={METRIC_FILLS.sharpe} name="Sharpe">
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
            <Bar yAxisId="right" dataKey="sortino" fill={METRIC_FILLS.sortino} name="Sortino">
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
            Dynamic objectives:{" "}
            {(result.narrative_facts.dynamic_objectives_used as string[]).join(", ")}
            {" "}
            · Regime and objective bands are in Portfolio trajectory and holdings below.
          </p>
        ) : null}
      </ChartCard>

      <ChartCard title="Portfolio trajectory & holdings">
        {chartsUseChampionFallback ? (
          <p className="mb-3 text-xs text-dim">
            Full trajectory and weight history are available for the ★ champion only. Select the
            champion trial for charts tied to that model, or use the comparison table above for
            metrics on other trials.
          </p>
        ) : null}
        {dynamicObjectiveChart ? (
          <p className="mb-3 text-xs text-dim">
            Walk-forward regime and active objective bands (linked cursor with return and weight charts).
            Pro ★ champion: ranked on in-sample{" "}
            <span className="text-[var(--amber)]">comprehensive score</span> (
            <code className="text-[10px]">objective_value_is</code>
            ) — 0.45×Sharpe + 0.25×Sortino + 0.20×(5×CAGR) − 0.35×|max DD| − 0.10×turnover —
            not per-rebalance regime objectives.
          </p>
        ) : null}
        <LinkedEquityWeightChart
          equityCurve={equity}
          benchmarkCurve={benchmarkEquity}
          benchmarkLabel={benchTicker}
          weightHistory={historySeries}
          weightTickers={weightHistoryTickers}
          colors={COLORS}
          regimeTimeline={dynamicObjectiveChart?.timeline}
        />
      </ChartCard>

      <ChartCard title="Efficient frontier (samples)">
        <p className="mb-2 text-xs text-dim">
          Blue: search trials (subsampled). Orange: ranked output models (Top-N).
          The same model_code is not plotted twice.
        </p>
        <ResponsiveContainer width="100%" height={260}>
          <ScatterChart>
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="volatility"
              name="Vol"
              stroke="#94a3b8"
              fontSize={chartTick}
              tickFormatter={(v) => `${(Number(v) * 100).toFixed(1)}%`}
            >
              <Label
                value="Ann. vol (%)"
                position="insideBottom"
                offset={-2}
                fill="#94a3b8"
                fontSize={chartTick}
              />
            </XAxis>
            <YAxis
              type="number"
              dataKey="return"
              name="Return"
              stroke="#94a3b8"
              fontSize={chartTick}
              tickFormatter={(v) => `${(Number(v) * 100).toFixed(1)}%`}
            >
              <Label
                value="Ann. return (%)"
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
                    ? "Output model"
                    : "Search trial";
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
                    <div>Vol: {((p?.volatility ?? 0) * 100).toFixed(2)}%</div>
                    <div>Return: {((p?.return ?? 0) * 100).toFixed(2)}%</div>
                    <div>Sharpe: {Number(p?.sharpe ?? 0).toFixed(3)}</div>
                  </div>
                );
              }}
            />
            <Legend />
            <Scatter
              name="Param samples"
              data={paramFrontierSamples}
              fill="#60a5fa"
            />
            <ZAxis dataKey="isSelected" range={[80, 220]} />
            <Scatter
              name="Output models"
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

      <ChartCard title="AI class quotas (Top N)">
        {assetClassFilter?.length ? (
          <p className="mb-2 text-xs text-dim">
            Universe filter: {assetClassFilter.map(quotaLabel).join(", ")} — other
            sleeves excluded from search and Top-N screening.
          </p>
        ) : null}
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="border-2 border-[var(--border)] bg-[#050508] p-3">
            <p className="mb-2 text-xs text-dim">Target names (from AI params)</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={quotaRows}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis dataKey="cls" stroke="#94a3b8" fontSize={chartTick} />
                <YAxis stroke="#94a3b8" fontSize={chartTick} />
                <Tooltip content={<ChartTooltip valueDecimals={0} />} />
                <Bar dataKey="target_count" name="Target count" fill="#00f5ff" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="border-2 border-[var(--border)] bg-[#050508] p-3">
            <p className="mb-2 text-xs text-dim">Actual class weights (holdings)</p>
            {chartsUseChampionFallback &&
            (!top.analytics?.exposure?.by_asset_class ||
              Object.keys(top.analytics.exposure.by_asset_class).length === 0) ? (
              <p className="mb-2 text-[10px] text-dim">
                Class breakdown from ★ champion (selected trial has slim payload).
              </p>
            ) : null}
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={actualClassRows}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis dataKey="cls" stroke="#94a3b8" fontSize={chartTick} />
                <YAxis stroke="#94a3b8" fontSize={chartTick} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} />
                <Tooltip content={<ChartTooltip valueIsPct={false} valueDecimals={2} />} />
                <Bar dataKey="actual_pct" name="Weight %" fill="#39ff14" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </ChartCard>

      <ChartCard title="Factor attribution">
        {chartsUseChampionFallback &&
        !(
          top.analytics?.factor_summary?.factor_contribution &&
          Object.keys(top.analytics.factor_summary.factor_contribution).length > 0
        ) ? (
          <p className="mb-2 text-xs text-dim">
            Factor attribution from ★ champion when the selected trial omits full sim output.
          </p>
        ) : null}
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="border-2 border-[var(--border)] bg-[#050508] p-3">
            {factorContribRows.length === 0 ? (
              <p className="text-xs text-dim">No factor attribution data</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={factorContribRows}>
                  <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                  <XAxis dataKey="factor" stroke="#94a3b8" fontSize={chartTick} />
                  <YAxis stroke="#94a3b8" fontSize={chartTick} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} />
                  <Tooltip content={<ChartTooltip valueIsPct={false} valueDecimals={2} />} />
                  <Bar dataKey="pct" name="Contrib %" fill="#ff2bd6" />
                </BarChart>
              </ResponsiveContainer>
            )}
            <p className="mt-2 text-[11px] text-dim">
              Observations: {String(factorSummary.factor_observations ?? 0)} (rebalance cross-sections)
            </p>
          </div>
          <div className="border-2 border-[var(--border)] bg-[#050508] p-3">
            <p className="mb-2 text-xs text-dim">Factor metric logic</p>
            <div className="max-h-56 space-y-1 overflow-y-auto text-xs">
              {factorLogicRows.length === 0 ? (
                <p className="text-dim">No metric logic data</p>
              ) : (
                factorLogicRows.map(([k, v]) => (
                  <div key={k} className="border-b border-slate-800 py-1">
                    <span className="text-slate-300">{factorLogicLabel(k)}</span>
                    <div className="text-slate-500">{String(v)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </ChartCard>

      <ChartCard title="Latest allocation (holdings)">
        {Object.keys(top.weights ?? {}).length === 0 ? (
          <p className="text-sm text-dim">
            Catalog-only model (no full holdings/curves). Pick a model with a full backtest report.
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
                    <th className="pb-2">Date</th>
                    <th className="pb-2">Ticker</th>
                    <th className="pb-2">Name</th>
                    <th className="pb-2 text-right">Wt</th>
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

      <InstitutionalReport
        candidate={chartCandidate ?? top}
        benchmark={benchTicker}
        analyticsNote={
          chartsUseChampionFallback
            ? "Rolling, exposure, and return tables use ★ champion analytics; headline metrics follow the selected trial."
            : undefined
        }
      />

      <ChartCard title="Reproducible params">
        {((aiRationalesByRound?.length ?? 0) > 0 || Boolean(aiGen.rationale)) ? (
          <details
            open
            className="mb-3 border-2 border-[var(--border)] bg-[#050508] px-3 py-2"
          >
            <summary className="cursor-pointer text-xs text-[var(--amber)] hover:text-neon">
              AI param rationale
            </summary>
            <div className="mt-2 max-h-72 space-y-3 overflow-y-auto text-xs leading-relaxed text-slate-300">
              {aiRationalesByRound?.length ? (
                aiRationalesByRound.map((text, i) => (
                  <div key={i}>
                    <p className="mb-1 font-pixel text-[8px] text-dim">
                      {aiRationalesByRound.length > 1 ? `Round ${i + 1}` : "Generation"}
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
          <p className="mb-3 text-xs text-dim">No AI rationale for this run.</p>
        )}
        <details className="border-2 border-[var(--border)] bg-[#050508] px-3 py-2">
          <summary className="cursor-pointer text-xs text-dim hover:text-[var(--cyan)]">
            Raw JSON (request + params + ai_param_generation)
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


      <div className="pixel-panel">
        <QuickRefinements
          request={request}
          onApply={(next, label) => onQuickTweak(next, label ?? "patch")}
          onApplyAndRun={onQuickTweakAndRun}
        />
        <p className="mt-2 text-xs text-dim">
          Click to patch params · double-click chip to rerun immediately.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={onRerun} className="pixel-btn">
          Edit config
        </button>
        <button type="button" onClick={onExport} className="pixel-btn">
          Export CSV
        </button>
      </div>

      <p className="text-xs text-dim">
        Disclaimer: research & education only — not investment advice. Data:{" "}
        {String(result.narrative_facts.data_source ?? "unknown")}.
      </p>
    </div>
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
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pixel-panel">
      <h4 className="mb-3 font-pixel text-[8px] text-[var(--cyan)]">{title}</h4>
      {children}
    </div>
  );
}
