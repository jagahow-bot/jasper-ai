"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatUsd, type DemoClient } from "@/lib/clients";
import {
  buildClientPerformanceSeries,
  holdingsHavePerformanceMetrics,
} from "@/lib/clients-charts";
import { useClientDailyNav } from "@/lib/use-client-daily-nav";
import { fetchCandidateCharts, fetchPortfolioBackcastMonthly } from "@/lib/api";
import {
  candidateHasFullCharts,
  mergeCandidateCharts,
} from "@/lib/candidate-charts-lazy";
import {
  GOAL_CHART_HORIZON_OPTIONS,
  type GoalChartHorizonOption,
} from "@/lib/financial-goal";
import {
  backcastProxySummary,
  monthlyReturnsFromNav,
  parseBackcastMonthly,
  resolveGoalReturnDefaults,
  weightsMatchClientBook,
  type BackcastMonthlyResponse,
} from "@/lib/financial-goal-backcast";
import {
  buildGoalPathCompare,
  goalsPlanningHorizonMonths,
  type GoalPathCompareResult,
} from "@/lib/financial-goal-compare";
import {
  PLANNING_CONFIDENCE_LEVELS,
  planningReturnBandFromEquityCurve,
  type PlanningConfidenceLevel,
  type PlanningReturnBand,
} from "@/lib/financial-goal-planning-returns";
import { loadGoalPlan } from "@/lib/financial-goal-store";
import { useI18n, type Lang, type TFn } from "@/lib/i18n";
import { candidateModelKey } from "@/lib/performance-compare-chart";
import { normalizeProposalLabel } from "@/lib/proposal-set";
import {
  buildMetricCompareRows,
  resolveCustomizedCandidate,
  resolveCustomizedEquityCurve,
  type RmCandidatePick,
} from "@/lib/rm-report-utils";
import type {
  BacktestResult,
  CandidateChartsPayload,
  PortfolioCandidate,
  ProposalCard,
} from "@/lib/types";

export type GoalPathCandidateOption = {
  c: PortfolioCandidate;
  rowKey: string;
};

/** Where the planning band's return distribution comes from. */
type ReturnSource = "realized" | "backcast" | "overall" | "cagrFallback";

type Props = {
  client: DemoClient;
  baseResult: BacktestResult;
  adjustedResult: BacktestResult;
  candidatePick?: RmCandidatePick;
  customizedLabel: string;
  /** Synced with RmReportView so RMs can change portfolio/model here. */
  candidateOptions?: GoalPathCandidateOption[];
  selectedRowKey?: string;
  onSelectedRowKeyChange?: (rowKey: string) => void;
  proposalCards?: ProposalCard[];
  championModelKey?: string | null;
};

function pctLabel(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

/** Compact USD for tight summary cards (e.g. $17.2M) — avoids overflow. */
function formatUsdCompact(amount: number, lang: Lang): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  const locale = lang === "zh" ? "zh-TW" : lang === "ko" ? "ko-KR" : "en-US";
  if (abs >= 1e9) {
    return `${sign}US$${(abs / 1e9).toLocaleString(locale, {
      maximumFractionDigits: 2,
      minimumFractionDigits: 1,
    })}B`;
  }
  if (abs >= 1e6) {
    return `${sign}US$${(abs / 1e6).toLocaleString(locale, {
      maximumFractionDigits: 2,
      minimumFractionDigits: 1,
    })}M`;
  }
  if (abs >= 1e4) {
    return `${sign}US$${(abs / 1e3).toLocaleString(locale, {
      maximumFractionDigits: 0,
    })}k`;
  }
  return formatUsd(amount, lang);
}

function CompareStatCard({
  label,
  before,
  after,
  afterClassName,
  hint,
}: {
  label: string;
  before: string;
  after: string;
  afterClassName?: string;
  hint: string;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2">
      <p className="ui-hint truncate">{label}</p>
      <div className="mt-1 space-y-0.5 text-xs font-medium tabular-nums leading-snug">
        <p className="truncate text-[var(--text-dim)]" title={before}>
          {before}
        </p>
        <p className={`truncate ${afterClassName ?? ""}`} title={after}>
          <span className="mr-1 text-[var(--text-dim)]" aria-hidden>
            →
          </span>
          {after}
        </p>
      </div>
      <p className="mt-1 line-clamp-2 text-[10px] text-[var(--text-dim)]">
        {hint}
      </p>
    </div>
  );
}

function defaultHorizonOption(goalsHorizon: number): GoalChartHorizonOption {
  const numeric = GOAL_CHART_HORIZON_OPTIONS.filter(
    (o): o is Extract<GoalChartHorizonOption, number> => typeof o === "number",
  );
  const target = Math.max(60, Math.min(240, goalsHorizon + 24));
  const hit = numeric.find((o) => o >= target);
  return hit ?? 120;
}

function formatAxisTick(month: number, useYears: boolean, t: TFn): string {
  if (!useYears) return t("goalCompare.axisMonth", { n: month });
  if (month <= 0) return t("goalCompare.axisYear", { n: 0 });
  if (month % 12 === 0) return t("goalCompare.axisYear", { n: month / 12 });
  return t("goalCompare.axisYear", {
    n: Math.round((month / 12) * 10) / 10,
  });
}

function formatTimeLabel(month: number, useYears: boolean, t: TFn): string {
  if (!useYears) return t("goalCompare.monthLabel", { n: month });
  const y =
    month % 12 === 0
      ? String(month / 12)
      : (Math.round((month / 12) * 10) / 10).toString();
  return t("goalCompare.timeLabel.years", { y, m: month });
}

function proposalLabelI18nKey(label: string): string | null {
  const normalized = normalizeProposalLabel(label);
  if (
    normalized === "recommended" ||
    normalized === "defensive" ||
    normalized === "growth" ||
    normalized === "alternative" ||
    normalized === "anchor_close" ||
    normalized === "full_drift" ||
    normalized === "theme"
  ) {
    return `results.proposalLabel.${normalized}`;
  }
  return null;
}

export function GoalPathComparePanel({
  client,
  baseResult,
  adjustedResult,
  candidatePick,
  customizedLabel,
  candidateOptions = [],
  selectedRowKey,
  onSelectedRowKeyChange,
  proposalCards = [],
  championModelKey = null,
}: Props) {
  const { t, lang } = useI18n();
  const plan = useMemo(() => loadGoalPlan(client.client_id), [client.client_id]);
  const goalsHorizon = useMemo(
    () => (plan?.goals?.length ? goalsPlanningHorizonMonths(plan.goals) : 60),
    [plan],
  );
  const [chartHorizon, setChartHorizon] = useState<GoalChartHorizonOption | null>(
    null,
  );
  const [confidence, setConfidence] =
    useState<PlanningConfidenceLevel>(0.6);
  const effectiveHorizon =
    chartHorizon ?? defaultHorizonOption(goalsHorizon);

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

  const chartsLoading = Boolean(
    needsLazyCharts &&
      chartsLoadingCode === selectedModelCode &&
      !lazyChartsByCode[selectedModelCode ?? ""]?.equity_curve?.length,
  );

  const metricCagr = useMemo(() => {
    const rows = buildMetricCompareRows(
      baseResult,
      enrichedAdjustedResult,
      { cagr: "cagr", sharpe: "sharpe", mdd: "mdd", vol: "vol" },
      candidatePick,
    );
    return rows.find((r) => r.key === "cagr")?.customizedValue ?? null;
  }, [baseResult, enrichedAdjustedResult, candidatePick]);

  const equityCurve = useMemo(
    () => resolveCustomizedEquityCurve(enrichedAdjustedResult, candidatePick),
    [enrichedAdjustedResult, candidatePick],
  );

  const usingOverallEquity = equityCurve.length >= 2;

  // --- Planning-return series resolution (realized > backcast > engine curve) ---
  // The band describes the *selected* portfolio. Same candidate resolution as
  // the equity curve so weights and curve never diverge.
  const selectedWeights = useMemo(
    () =>
      resolveCustomizedCandidate(enrichedAdjustedResult, candidatePick)
        ?.weights ?? null,
    [enrichedAdjustedResult, candidatePick],
  );
  const backcastWeightsKey = useMemo(() => {
    if (!selectedWeights) return "";
    const entries = Object.entries(selectedWeights)
      .filter(([, w]) => Number.isFinite(w) && w > 0)
      .map(([t, w]) => [t.toUpperCase(), Math.round(w * 1e4) / 1e4] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));
    return entries.length ? JSON.stringify(entries) : "";
  }, [selectedWeights]);

  // Real history priority: only when the selected mix *is* the client's
  // current book (same tickers, ±5pp) does realized book performance apply.
  const useRealizedHistory = useMemo(
    () =>
      Boolean(
        selectedWeights &&
          holdingsHavePerformanceMetrics(client.holdings) &&
          weightsMatchClientBook(selectedWeights, client.holdings),
      ),
    [selectedWeights, client],
  );
  // Real daily NAV (real prices) once loaded; calibrated reported series as
  // placeholder/fallback — both describe realized book performance.
  const dailyNav = useClientDailyNav(client.holdings, client.as_of_date, {
    enabled: useRealizedHistory,
  });
  const realizedMonthly = useMemo(() => {
    if (!useRealizedHistory) return null;
    if (dailyNav.points?.length) return monthlyReturnsFromNav(dailyNav.points);
    return monthlyReturnsFromNav(buildClientPerformanceSeries(client));
  }, [useRealizedHistory, dailyNav.points, client]);

  // Reuse the run's rebalance/fee convention when narrative_facts carries it.
  const { runRebalanceFreq, runFeeBps } = useMemo(() => {
    const nf = adjustedResult.narrative_facts as
      | Record<string, unknown>
      | undefined;
    const spec = nf?.backtest_spec as
      | { rebalance_freq?: unknown; fee_bps?: unknown }
      | undefined;
    const rf = nf?.rebalance_freq ?? spec?.rebalance_freq;
    const fee = spec?.fee_bps;
    return {
      runRebalanceFreq:
        typeof rf === "string" && rf.trim() ? rf.trim() : "QE",
      runFeeBps: typeof fee === "number" && Number.isFinite(fee) ? fee : 10,
    };
  }, [adjustedResult.narrative_facts]);

  const [backcast, setBackcast] = useState<BackcastMonthlyResponse | null>(null);
  const [backcastError, setBackcastError] = useState<string | null>(null);

  useEffect(() => {
    setBackcast(null);
    setBackcastError(null);
  }, [adjustedResult.job_id]);

  useEffect(() => {
    if (useRealizedHistory || !backcastWeightsKey || !selectedWeights) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchPortfolioBackcastMonthly(selectedWeights, {
          rebalanceFreq: runRebalanceFreq,
          feeBps: runFeeBps,
        });
        if (!cancelled) setBackcast(res);
      } catch (err) {
        if (!cancelled) {
          setBackcastError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // backcastWeightsKey tracks weight content; selectedWeights is read directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    useRealizedHistory,
    backcastWeightsKey,
    adjustedResult.job_id,
    runRebalanceFreq,
    runFeeBps,
  ]);

  const backcastMonthly = useMemo(
    () => parseBackcastMonthly(backcast?.monthly),
    [backcast],
  );

  // Priority per agreed design: realized book history (when the selected mix
  // is the current book) > synthetic backcast > engine backtest curve > CAGR.
  const planning = useMemo<{
    band: PlanningReturnBand | null;
    source: ReturnSource;
  }>(() => {
    const prior = plan?.assumptions.annualReturn ?? 0.05;
    const seriesDefaults = resolveGoalReturnDefaults({
      realizedMonthly,
      backcastMonthly,
      priorReturn: prior,
      confidenceLevel: confidence,
    });
    if (seriesDefaults) {
      return { band: seriesDefaults.band, source: seriesDefaults.source };
    }
    if (usingOverallEquity) {
      return {
        band: planningReturnBandFromEquityCurve(equityCurve, prior, confidence),
        source: "overall",
      };
    }
    return { band: null, source: "cagrFallback" };
  }, [
    plan,
    confidence,
    realizedMonthly,
    backcastMonthly,
    usingOverallEquity,
    equityCurve,
  ]);

  const compare: GoalPathCompareResult | null = useMemo(() => {
    if (!plan?.goals?.length) return null;
    // Wait for overall equity of the selected model before falling back to CAGR.
    if (chartsLoading) return null;
    const prior = plan.assumptions.annualReturn;
    const planningBand = planning.band;
    if (!planningBand && metricCagr == null) return null;
    return buildGoalPathCompare({
      goals: plan.goals,
      assumptions: plan.assumptions,
      client: {
        aum_usd: client.aum_usd,
        cash_usd: client.cash_usd,
        age: client.age,
        gender: client.gender ?? null,
      },
      planningBand,
      afterAnnualReturnRaw: metricCagr ?? prior,
      chartHorizonMonths: effectiveHorizon,
    });
  }, [
    metricCagr,
    chartsLoading,
    plan,
    client,
    effectiveHorizon,
    planning,
  ]);

  const showPortfolioPicker =
    Boolean(onSelectedRowKeyChange) && proposalCards.length > 1;
  // Prefer proposal-label picker when available; avoid a second model dropdown.
  const showModelPicker =
    Boolean(onSelectedRowKeyChange) &&
    candidateOptions.length > 1 &&
    !showPortfolioPicker;

  const selectedProposalCode = useMemo(() => {
    const code = (selectedModelCode || "").toUpperCase();
    if (!code || !proposalCards.length) return "";
    const hit = proposalCards.find(
      (p) => p.model_code.toUpperCase() === code,
    );
    return hit?.model_code ?? proposalCards[0]?.model_code ?? "";
  }, [proposalCards, selectedModelCode]);

  const selectByModelCode = (modelCode: string) => {
    if (!onSelectedRowKeyChange) return;
    const match = candidateOptions.find(
      (o) =>
        (o.c.model_code || "").toUpperCase() === modelCode.toUpperCase(),
    );
    if (match) onSelectedRowKeyChange(match.rowKey);
  };

  const chartEventMarkers = useMemo(() => {
    if (!compare) return [];
    const byMonth = new Map<
      number,
      { chartLabel: string; listLabel: string; kinds: string[] }
    >();
    for (const m of compare.eventMarkers) {
      const name = m.goalLabel;
      const listPiece =
        m.kind === "mortgage_start"
          ? t("goalSim.chart.mortgageMarker", {
              name,
              payment: formatUsd(m.monthlyPaymentUsd ?? 0, lang),
            })
          : m.kind === "mortgage_end"
            ? t("goalSim.chart.mortgageEndMarker", { name })
            : m.kind === "retirement_start"
              ? t("goalSim.chart.retirementMarker", {
                  name,
                  payment: formatUsd(m.monthlyPaymentUsd ?? 0, lang),
                })
              : m.kind === "inheritance"
                ? t("goalSim.chart.inheritanceMarker", {
                    amount: formatUsd(compare.after.inheritanceUsd, lang),
                  })
                : name;
      const chartPiece =
        m.kind === "mortgage_start"
          ? t("goalSim.chart.tag.home")
          : m.kind === "mortgage_end"
            ? t("goalSim.chart.tag.mortgageEnd")
            : m.kind === "retirement_start"
              ? t("goalSim.chart.tag.retirement")
              : m.kind === "inheritance"
                ? t("goalSim.chart.tag.inheritance")
                : m.goalType === "home"
                  ? t("goalSim.chart.tag.home")
                  : m.goalType === "retirement"
                    ? t("goalSim.chart.tag.retirement")
                    : name.length > 6
                      ? `${name.slice(0, 5)}…`
                      : name;
      const prev = byMonth.get(m.month);
      byMonth.set(m.month, {
        chartLabel: prev ? `${prev.chartLabel} · ${chartPiece}` : chartPiece,
        listLabel: prev ? `${prev.listLabel} · ${listPiece}` : listPiece,
        kinds: prev ? [...prev.kinds, m.kind] : [m.kind],
      });
    }
    return [...byMonth.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([month, labels], index) => ({
        month,
        chartLabel: labels.chartLabel,
        listLabel: labels.listLabel,
        stroke: labels.kinds.includes("inheritance")
          ? "#b45309"
          : labels.kinds.includes("mortgage_end")
            ? "#0d9488"
            : "#7c3aed",
        labelPosition:
          index % 2 === 0
            ? ("insideTopLeft" as const)
            : ("insideBottomLeft" as const),
      }));
  }, [compare, t, lang]);

  const useYearAxis = (compare?.horizonMonths ?? 0) > 36;
  const chartYearTicks = useMemo(() => {
    if (!compare || !useYearAxis) return undefined;
    const maxYears = Math.ceil(compare.horizonMonths / 12);
    const step = maxYears <= 10 ? 1 : maxYears <= 20 ? 2 : 5;
    const ticks: number[] = [0];
    for (let y = step; y <= maxYears; y += step) {
      const m = y * 12;
      if (m <= compare.horizonMonths) ticks.push(m);
    }
    const lastYearMonth = Math.floor(compare.horizonMonths / 12) * 12;
    if (lastYearMonth > 0 && !ticks.includes(lastYearMonth)) {
      ticks.push(lastYearMonth);
    }
    if (
      compare.horizonMonths > lastYearMonth &&
      !ticks.includes(compare.horizonMonths)
    ) {
      ticks.push(compare.horizonMonths);
    }
    return ticks;
  }, [compare, useYearAxis]);

  if (!plan?.goals?.length) return null;

  if (chartsLoading) {
    return (
      <section className="pixel-panel min-w-0 overflow-hidden" data-goal-path-compare>
        <h3 className="ui-panel-title">{t("goalCompare.title")}</h3>
        <p className="ui-hint mt-2 flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 animate-spin rounded-full border border-[var(--amber)] border-t-transparent"
            aria-hidden
          />
          {t("results.loadingTrajectory", {
            model: selectedModelCode ?? "",
          })}
        </p>
      </section>
    );
  }

  if (!compare || compare.chart.length < 2) return null;

  const { summary } = compare;

  return (
    <section className="pixel-panel min-w-0 overflow-hidden" data-goal-path-compare>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="ui-panel-title">{t("goalCompare.title")}</h3>
          <p className="ui-hint mt-1">{t("goalCompare.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {showPortfolioPicker && proposalCards.length > 0 ? (
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-dim)]">
              <span>{t("goalCompare.portfolioLabel")}</span>
              <select
                value={selectedProposalCode}
                onChange={(e) => selectByModelCode(e.target.value)}
                className="rounded-md border border-[var(--border)] bg-white px-1.5 py-1 text-xs text-[var(--ui-color-body)]"
              >
                {proposalCards.map((p) => {
                  const key = proposalLabelI18nKey(p.label);
                  const label = key ? t(key) : p.label;
                  return (
                    <option key={p.model_code} value={p.model_code}>
                      {label}
                      {p.is_recommended
                        ? ` ${t("rm.report.candidateChampion")}`
                        : ""}
                    </option>
                  );
                })}
              </select>
            </label>
          ) : null}
          {showModelPicker ? (
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-dim)]">
              <span>{t("goalCompare.modelLabel")}</span>
              <select
                value={selectedRowKey ?? ""}
                onChange={(e) => onSelectedRowKeyChange?.(e.target.value)}
                className="rounded-md border border-[var(--border)] bg-white px-1.5 py-1 text-xs text-[var(--ui-color-body)]"
              >
                {candidateOptions.map(({ c, rowKey }) => (
                  <option key={rowKey} value={rowKey}>
                    {c.model_code ?? `M?${c.rank}`}
                    {candidateModelKey(c) === championModelKey
                      ? ` ${t("rm.report.candidateChampion")}`
                      : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex items-center gap-1.5 text-xs text-[var(--text-dim)]">
            <span>{t("goalCompare.confidence")}</span>
            <select
              value={String(confidence)}
              onChange={(e) =>
                setConfidence(Number(e.target.value) as PlanningConfidenceLevel)
              }
              className="rounded-md border border-[var(--border)] bg-white px-1.5 py-1 text-xs text-[var(--ui-color-body)]"
            >
              {PLANNING_CONFIDENCE_LEVELS.map((c) => (
                <option key={c} value={String(c)}>
                  {t("goalCompare.confidenceOption", {
                    pct: Math.round(c * 100),
                  })}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-[var(--text-dim)]">
            <span>{t("goalSim.chartHorizon")}</span>
            <select
              value={String(effectiveHorizon)}
              onChange={(e) => {
                const v = e.target.value;
                setChartHorizon(
                  v === "max" ? "max" : (Number(v) as GoalChartHorizonOption),
                );
              }}
              className="rounded-md border border-[var(--border)] bg-white px-1.5 py-1 text-xs text-[var(--ui-color-body)]"
            >
              {GOAL_CHART_HORIZON_OPTIONS.map((opt) => (
                <option key={String(opt)} value={String(opt)}>
                  {opt === "max"
                    ? t("goalSim.chartHorizon.max")
                    : opt >= 60
                      ? t("goalSim.chartHorizon.years", { n: opt / 12 })
                      : t("goalSim.chartHorizon.months", { n: opt })}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <p className="ui-hint mt-2 text-xs">
        {t("goalCompare.returnNote", {
          before: pctLabel(compare.beforeReturn),
          after: pctLabel(compare.afterReturn),
          floor: pctLabel(compare.planningBand.floorReturn),
          ceiling: pctLabel(compare.planningBand.planningCeiling),
          conf: Math.round(compare.planningBand.confidenceLevel * 100),
          years: compare.planningBand.sampleYears,
          vol: pctLabel(compare.planningBand.annualVol),
          customized: customizedLabel,
          model: selectedModelCode ?? "—",
          source: t(`goalCompare.returnSource.${planning.source}`),
        })}
      </p>
      <p className="ui-hint mt-1 text-xs">
        {t("goalCompare.percentileNote", {
          p10: pctLabel(compare.planningBand.p10Return),
          p50: pctLabel(compare.planningBand.p50Return),
          p90: pctLabel(compare.planningBand.p90Return),
        })}
        {planning.source === "backcast"
          ? (() => {
              const proxy = backcastProxySummary(backcast?.meta);
              return proxy.filledTickers.length
                ? ` ${t("goalCompare.backcastProxyNote", {
                    tickers: proxy.filledTickers.join(", "),
                    months: proxy.monthsFilled,
                  })}`
                : "";
            })()
          : ""}
      </p>
      {backcastError && planning.source !== "backcast" ? (
        <p className="mt-1 text-[10px] text-[var(--text-dim)]">
          {t("goalCompare.backcastUnavailable")}
        </p>
      ) : null}
      {chartsLoadError ? (
        <p className="mt-1 text-xs text-[var(--magenta)]">{chartsLoadError}</p>
      ) : null}

      {compare.surplusGlide.suggest ? (
        <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-50 px-3 py-2 text-sm text-[var(--ui-color-body)]">
          <p className="font-medium text-amber-900">
            {t("goalCompare.glideTitle")}
          </p>
          <p className="mt-1 text-xs text-amber-900/90">
            {t("goalCompare.glideBody", {
              multiple: compare.surplusGlide.surplusMultiple.toFixed(1),
              need: formatUsdCompact(
                compare.surplusGlide.totalGoalNeedUsd,
                lang,
              ),
              ending: formatUsdCompact(compare.summary.afterEndingUsd, lang),
            })}
          </p>
        </div>
      ) : null}

      <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
        <CompareStatCard
          label={t("goalCompare.atGoalsHorizon")}
          before={formatUsdCompact(summary.beforeAtGoalsHorizonUsd, lang)}
          after={formatUsdCompact(summary.afterAtGoalsHorizonUsd, lang)}
          afterClassName="text-[var(--primary)]"
          hint={t("goalCompare.atGoalsHorizonHint")}
        />
        <CompareStatCard
          label={t("goalCompare.totalShortfall")}
          before={formatUsdCompact(summary.beforeShortfallUsd, lang)}
          after={formatUsdCompact(summary.afterShortfallUsd, lang)}
          afterClassName={
            summary.shortfallImproved
              ? "text-emerald-700"
              : summary.shortfallDeltaUsd > 0
                ? "text-[var(--magenta)]"
                : undefined
          }
          hint={
            summary.shortfallImproved
              ? t("goalCompare.shortfallImproved")
              : summary.afterShortfallUsd <= 0 &&
                  summary.beforeShortfallUsd <= 0
                ? t("goalCompare.shortfallStillCovered")
                : t("goalCompare.shortfallNotImproved")
          }
        />
        <CompareStatCard
          label={t("goalCompare.endingWealth")}
          before={formatUsdCompact(summary.beforeEndingUsd, lang)}
          after={formatUsdCompact(summary.afterEndingUsd, lang)}
          hint={t("goalCompare.endingWealthHint")}
        />
      </div>

      <div className="mt-3 h-80 w-full overflow-visible">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={compare.chart}
            margin={{ top: 36, right: 28, left: 4, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="month"
              ticks={chartYearTicks}
              tick={{ fontSize: 10, fill: "#64748b" }}
              tickFormatter={(v) =>
                formatAxisTick(Number(v), useYearAxis, t)
              }
              padding={{ left: 4, right: 12 }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#64748b" }}
              width={52}
              tickFormatter={(v) =>
                v >= 1e9
                  ? `${(v / 1e9).toFixed(1)}B`
                  : v >= 1e6
                    ? `${(v / 1e6).toFixed(1)}M`
                    : v >= 1e3
                      ? `${(v / 1e3).toFixed(0)}k`
                      : String(v)
              }
            />
            <Tooltip
              formatter={(value, name) => {
                if (name === "eventLabel") return [null, null];
                return [
                  typeof value === "number" ? formatUsd(value, lang) : "—",
                  name === "before"
                    ? t("goalCompare.series.before")
                    : name === "after"
                      ? t("goalCompare.series.after")
                      : name === "afterOptimistic"
                        ? t("goalCompare.series.afterOptimistic")
                        : t("goalCompare.series.afterConservative"),
                ];
              }}
              labelFormatter={(label, payload) => {
                const row = payload?.[0]?.payload as
                  | { eventLabel?: string | null }
                  | undefined;
                const month = formatTimeLabel(
                  Number(label),
                  useYearAxis,
                  t,
                );
                return row?.eventLabel
                  ? `${month} — ${row.eventLabel}`
                  : month;
              }}
            />
            <Legend
              formatter={(value) =>
                value === "before"
                  ? t("goalCompare.series.before")
                  : value === "after"
                    ? t("goalCompare.series.after")
                    : value === "afterOptimistic"
                      ? t("goalCompare.series.afterOptimistic")
                      : t("goalCompare.series.afterConservative")
              }
            />
            <Line
              type="monotone"
              dataKey="afterOptimistic"
              stroke="#86efac"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="after"
              stroke="#2563eb"
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="afterConservative"
              stroke="#fca5a5"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="before"
              stroke="#64748b"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
            />
            {chartEventMarkers.map((m) => (
              <ReferenceLine
                key={`evt-${m.month}`}
                x={m.month}
                stroke={m.stroke}
                strokeDasharray="4 4"
                label={{
                  value: m.chartLabel,
                  position: m.labelPosition,
                  fill: m.stroke,
                  fontSize: 10,
                  fontWeight: 600,
                  offset: 6,
                }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {chartEventMarkers.length > 0 ? (
        <ul className="mt-2 space-y-1 border-t border-[var(--border)] pt-2 text-xs text-[var(--ui-color-body)]">
          {chartEventMarkers.map((m) => (
            <li key={`legend-${m.month}`}>
              <span className="font-medium text-violet-700">
                {formatTimeLabel(m.month, useYearAxis, t)}
              </span>
              <span className="text-[var(--text-dim)]"> — </span>
              {m.listLabel}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
