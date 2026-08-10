"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatUsd, type DemoClient } from "@/lib/clients";
import { fetchCandidateCharts } from "@/lib/api";
import {
  candidateHasFullCharts,
  mergeCandidateCharts,
} from "@/lib/candidate-charts-lazy";
import {
  GOAL_CHART_HORIZON_OPTIONS,
  monthsUntilLifeExpectancy,
  projectionHorizonMonths,
  resolveChartHorizonMonths,
  type GoalChartHorizonOption,
} from "@/lib/financial-goal";
import { goalsPlanningHorizonMonths } from "@/lib/financial-goal-compare";
import {
  PLANNING_CONFIDENCE_LEVELS,
  type EquityPoint,
  type PlanningConfidenceLevel,
} from "@/lib/financial-goal-planning-returns";
import {
  buildRuleBasedSegmentation,
  buildSegmentedChartSeries,
  projectSegmentedGoals,
  resolveSegmentBands,
  segmentedEventMarkers,
  type GoalSegmentation,
  type GoalSegmentStrategy,
} from "@/lib/financial-goal-segments";
import { loadGoalPlan } from "@/lib/financial-goal-store";
import { useI18n, type Lang, type TFn } from "@/lib/i18n";
import type {
  BacktestResult,
  CandidateChartsPayload,
  PortfolioCandidate,
  ProposalCard,
} from "@/lib/types";

type Props = {
  client: DemoClient;
  /** Holdings (baseline) backtest — priority source for planning returns. */
  baseResult: BacktestResult;
  /** Customized run — supplies candidate model strategies for segments. */
  adjustedResult: BacktestResult;
  proposalCards?: ProposalCard[];
};

function pctLabel(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
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

function formatMonthRange(
  startMonth: number,
  endMonth: number,
  lang: Lang,
): string {
  const fmt = (m: number) => {
    const y = m / 12;
    const rounded = Math.round(y * 10) / 10;
    return lang === "zh"
      ? `第 ${rounded} 年`
      : lang === "ko"
        ? `${rounded}년`
        : `Y${rounded}`;
  };
  return `${fmt(startMonth)} – ${fmt(endMonth)}`;
}

function candidateToStrategy(
  c: PortfolioCandidate,
  recommendedCode: string | null,
): GoalSegmentStrategy | null {
  const code = (c.model_code ?? "").trim();
  if (!code) return null;
  return {
    modelCode: code,
    label: code,
    cagr: Number.isFinite(c.cagr) ? c.cagr : null,
    volatility: Number.isFinite(c.volatility) ? c.volatility : null,
    maxDrawdown: Number.isFinite(c.max_drawdown) ? c.max_drawdown : null,
    sharpe: Number.isFinite(c.sharpe) ? c.sharpe : null,
    isRecommended:
      recommendedCode != null && code.toUpperCase() === recommendedCode,
  };
}

export function GoalSegmentationPanel({
  client,
  baseResult,
  adjustedResult,
  proposalCards = [],
}: Props) {
  const { t, lang } = useI18n();
  const plan = useMemo(() => loadGoalPlan(client.client_id), [client.client_id]);
  const goals = useMemo(() => plan?.goals ?? [], [plan]);

  const [confidence, setConfidence] = useState<PlanningConfidenceLevel>(0.9);
  const [chartHorizon, setChartHorizon] =
    useState<GoalChartHorizonOption | null>(null);
  const [segmentation, setSegmentation] = useState<GoalSegmentation | null>(
    null,
  );
  const [segLoading, setSegLoading] = useState(false);
  const [lazyChartsByCode, setLazyChartsByCode] = useState<
    Record<string, CandidateChartsPayload>
  >({});

  const goalsHorizon = useMemo(
    () => (goals.length ? goalsPlanningHorizonMonths(goals) : 60),
    [goals],
  );

  /** Priority return source: the client's holdings backtest equity series. */
  const holdingsCurve = useMemo<EquityPoint[]>(() => {
    if (baseResult.equity_curve?.length) return baseResult.equity_curve;
    const champ = baseResult.candidates.find((c) => c.is_champion);
    return champ?.equity_curve ?? [];
  }, [baseResult]);

  const recommendedCode = useMemo(() => {
    const rec = proposalCards.find((p) => p.is_recommended);
    return (rec?.model_code || "").toUpperCase() || null;
  }, [proposalCards]);

  const strategies = useMemo<GoalSegmentStrategy[]>(() => {
    const out: GoalSegmentStrategy[] = [
      { modelCode: null, label: t("goalSegment.strategy.holdings") },
    ];
    for (const c of adjustedResult.candidates) {
      const s = candidateToStrategy(c, recommendedCode);
      if (s) out.push(s);
    }
    return out;
  }, [adjustedResult.candidates, recommendedCode, t]);

  const strategiesKey = useMemo(
    () =>
      strategies
        .map((s) => `${s.modelCode ?? "HOLDINGS"}`)
        .sort()
        .join("|"),
    [strategies],
  );

  const goalsKey = useMemo(
    () =>
      goals
        .map((g) => `${g.id}:${g.amountUsd}:${g.withinMonths}`)
        .join("|"),
    [goals],
  );

  // AI segmentation (rules fallback inside the route; local rules on failure).
  useEffect(() => {
    if (!goals.length) return;
    let cancelled = false;
    setSegLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/goals/segment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            goals,
            horizon_months: goalsHorizon,
            strategies: strategies.map((s) => ({
              model_code: s.modelCode,
              label: s.label,
              cagr: s.cagr,
              volatility: s.volatility,
              max_drawdown: s.maxDrawdown,
              sharpe: s.sharpe,
              is_recommended: s.isRecommended === true,
            })),
            report_language: lang === "zh" ? "zh-TW" : lang,
            client: {
              client_id: client.client_id,
              age: client.age,
              gender: client.gender ?? null,
              aum_usd: client.aum_usd,
              cash_usd: client.cash_usd,
              risk_profile: client.risk_profile,
              as_of_date: client.as_of_date,
            },
          }),
        });
        const data = (await res.json()) as {
          segmentation?: GoalSegmentation;
          error?: string;
        };
        if (!res.ok || !data.segmentation?.segments?.length) {
          throw new Error(data.error ?? "segmentation_failed");
        }
        if (!cancelled) setSegmentation(data.segmentation);
      } catch {
        if (!cancelled) {
          setSegmentation(
            buildRuleBasedSegmentation({
              goals,
              strategies,
              horizonMonths: goalsHorizon,
              lang,
            }),
          );
        }
      } finally {
        if (!cancelled) setSegLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // goalsKey / strategiesKey capture the meaningful identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.client_id, goalsKey, strategiesKey, goalsHorizon, lang]);

  useEffect(() => {
    setLazyChartsByCode({});
  }, [adjustedResult.job_id]);

  const candidatesByCode = useMemo(() => {
    const map = new Map<string, PortfolioCandidate>();
    for (const c of adjustedResult.candidates) {
      const code = (c.model_code || "").toUpperCase();
      if (code) map.set(code, c);
    }
    return map;
  }, [adjustedResult.candidates]);

  // Lazy-load equity curves for segment strategies missing packaged charts.
  const neededCodes = useMemo(() => {
    if (!segmentation) return [];
    return segmentation.segments
      .map((s) => s.modelCode)
      .filter((c): c is string => Boolean(c))
      .map((c) => c.toUpperCase())
      .filter((code) => {
        const cand = candidatesByCode.get(code);
        return cand && !candidateHasFullCharts(cand);
      })
      .filter((code) => !lazyChartsByCode[code]?.equity_curve?.length);
  }, [segmentation, candidatesByCode, lazyChartsByCode]);

  useEffect(() => {
    if (!neededCodes.length) return;
    let cancelled = false;
    void (async () => {
      for (const code of neededCodes) {
        try {
          const payload = await fetchCandidateCharts(
            adjustedResult.job_id,
            code,
            { rank: candidatesByCode.get(code)?.rank },
          );
          if (cancelled) return;
          setLazyChartsByCode((prev) => ({ ...prev, [code]: payload }));
        } catch {
          // Keep prior-fallback band for this segment.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [neededCodes, adjustedResult.job_id, candidatesByCode]);

  const chartsLoading = neededCodes.length > 0;

  const curveForModel = useMemo(() => {
    return (modelCode: string | null): EquityPoint[] | null => {
      if (modelCode == null) {
        return holdingsCurve.length >= 2 ? holdingsCurve : null;
      }
      const upper = modelCode.toUpperCase();
      const cand = candidatesByCode.get(upper);
      const lazy = lazyChartsByCode[upper];
      const merged = cand && lazy ? mergeCandidateCharts(cand, lazy) : cand;
      const curve = merged?.equity_curve ?? null;
      if (curve && curve.length >= 2) return curve;
      // Priority fallback: holdings backtest series (spec: holdings first).
      return holdingsCurve.length >= 2 ? holdingsCurve : null;
    };
  }, [candidatesByCode, lazyChartsByCode, holdingsCurve]);

  const projection = useMemo(() => {
    if (!segmentation || !goals.length || !plan) return null;
    if (chartsLoading) return null;
    const bands = resolveSegmentBands(segmentation, {
      curveForModel,
      priorReturn: plan.assumptions.annualReturn,
      confidence,
    });
    const longevityMonths = monthsUntilLifeExpectancy(
      client.age,
      client.gender ?? null,
    );
    const fullHorizon = projectionHorizonMonths(goals, longevityMonths);
    return projectSegmentedGoals({
      goals,
      client: {
        aum_usd: client.aum_usd,
        cash_usd: client.cash_usd,
        age: client.age,
        gender: client.gender ?? null,
      },
      assumptions: plan.assumptions,
      segmentBands: bands,
      horizonMonths: fullHorizon,
    });
  }, [
    segmentation,
    goals,
    plan,
    chartsLoading,
    curveForModel,
    confidence,
    client,
  ]);

  const fullHorizonMonths = projection?.horizonMonths ?? goalsHorizon;
  const effectiveHorizon: GoalChartHorizonOption = useMemo(() => {
    if (chartHorizon != null) return chartHorizon;
    const numeric = GOAL_CHART_HORIZON_OPTIONS.filter(
      (o) => typeof o === "number",
    ) as number[];
    const target = Math.max(60, Math.min(240, goalsHorizon + 24));
    return (numeric.find((o) => o >= target) ?? 120) as GoalChartHorizonOption;
  }, [chartHorizon, goalsHorizon]);
  const horizonLimit = resolveChartHorizonMonths(
    effectiveHorizon,
    fullHorizonMonths,
  );

  const chart = useMemo(() => {
    if (!projection || !plan) return [];
    return buildSegmentedChartSeries(
      projection,
      goals,
      plan.assumptions,
      horizonLimit,
    );
  }, [projection, plan, goals, horizonLimit]);

  const eventMarkers = useMemo(() => {
    if (!projection || !plan) return [];
    return segmentedEventMarkers(projection, goals, plan.assumptions, horizonLimit)
      .filter((m) => m.kind !== "inheritance")
      .map((m) => ({
        month: m.month,
        label:
          m.goalLabel.length > 8 ? `${m.goalLabel.slice(0, 7)}…` : m.goalLabel,
      }));
  }, [projection, plan, goals, horizonLimit]);

  const segmentBoundaries = useMemo(() => {
    if (!projection) return [];
    return projection.segments
      .slice(1)
      .map((sb) => ({
        month: sb.segment.startMonth,
        label: sb.segment.modelCode ?? t("goalSegment.strategy.holdingsShort"),
      }))
      .filter((b) => b.month <= horizonLimit);
  }, [projection, horizonLimit, t]);

  const useYearAxis = horizonLimit > 36;
  const chartYearTicks = useMemo(() => {
    if (!useYearAxis) return undefined;
    const maxYears = Math.ceil(horizonLimit / 12);
    const step = maxYears <= 10 ? 1 : maxYears <= 20 ? 2 : 5;
    const ticks: number[] = [0];
    for (let y = step; y <= maxYears; y += step) {
      const m = y * 12;
      if (m <= horizonLimit) ticks.push(m);
    }
    return ticks;
  }, [horizonLimit, useYearAxis]);

  if (!goals.length || !plan) return null;

  if (segLoading && !segmentation) {
    return (
      <section className="pixel-panel min-w-0 overflow-hidden" data-goal-segmentation>
        <h3 className="ui-panel-title">{t("goalSegment.title")}</h3>
        <p className="ui-hint mt-2 flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 animate-spin rounded-full border border-[var(--amber)] border-t-transparent"
            aria-hidden
          />
          {t("goalSegment.loading")}
        </p>
      </section>
    );
  }

  if (segmentation && chartsLoading) {
    return (
      <section className="pixel-panel min-w-0 overflow-hidden" data-goal-segmentation>
        <h3 className="ui-panel-title">{t("goalSegment.title")}</h3>
        <p className="ui-hint mt-2 flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 animate-spin rounded-full border border-[var(--amber)] border-t-transparent"
            aria-hidden
          />
          {t("results.loadingTrajectory", {
            model: neededCodes[0] ?? "",
          })}
        </p>
      </section>
    );
  }

  if (!segmentation || !projection || chart.length < 2) return null;

  const bandLowPct = Math.round((1 - confidence) * 100);
  const bandHighPct = Math.round(confidence * 100);
  const anyPriorFallback = projection.segments.some(
    (sb) => sb.bandSource === "prior_fallback",
  );

  return (
    <section className="pixel-panel min-w-0 overflow-hidden" data-goal-segmentation>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="ui-panel-title">{t("goalSegment.title")}</h3>
          <p className="ui-hint mt-1">{t("goalSegment.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
              segmentation.source === "ai"
                ? "border-[var(--primary)]/40 bg-[var(--primary)]/10 text-[var(--primary)]"
                : "border-amber-500/40 bg-amber-50 text-amber-800"
            }`}
          >
            {segmentation.source === "ai"
              ? t("goalSegment.source.ai")
              : t("goalSegment.source.rules")}
          </span>
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

      <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
        {projection.segments.map((sb) => {
          const seg = sb.segment;
          const goalCount = seg.goalIds.length;
          return (
            <div
              key={seg.id}
              className="min-w-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="ui-hint truncate">
                  {t(`goalSegment.segment.${seg.label}`)}
                </p>
                <span className="shrink-0 text-[10px] tabular-nums text-[var(--text-dim)]">
                  {formatMonthRange(seg.startMonth, seg.endMonth, lang)}
                </span>
              </div>
              <p className="mt-1 truncate text-xs font-semibold text-[var(--primary)]">
                {seg.modelCode ?? t("goalSegment.strategy.holdings")}
              </p>
              <p className="mt-0.5 text-[10px] tabular-nums text-[var(--text-dim)]">
                {t("goalSegment.card.returns", {
                  base: pctLabel(sb.band.baseReturn),
                  floor: pctLabel(sb.band.floorReturn),
                  ceiling: pctLabel(sb.band.ceilingReturn),
                })}
                {goalCount > 0
                  ? ` · ${t("goalSegment.card.goals", { n: goalCount })}`
                  : ""}
              </p>
              <p className="mt-1 line-clamp-3 text-[10px] text-[var(--text-dim)]">
                {seg.rationale}
              </p>
            </div>
          );
        })}
      </div>

      <p className="ui-hint mt-2 text-xs">
        {t("goalSegment.bandNote", {
          lo: bandLowPct,
          hi: bandHighPct,
        })}
        {anyPriorFallback ? ` ${t("goalSegment.priorFallbackNote")}` : ""}
      </p>
      {segmentation.rationale ? (
        <p className="mt-1 text-xs text-[var(--text-dim)]">
          {segmentation.rationale}
        </p>
      ) : null}

      <div className="mt-3 h-80 w-full overflow-visible">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chart}
            margin={{ top: 36, right: 28, left: 4, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="month"
              ticks={chartYearTicks}
              tick={{ fontSize: 10, fill: "#64748b" }}
              tickFormatter={(v) => formatAxisTick(Number(v), useYearAxis, t)}
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
                // Band is summarized in the label line; only median gets a row.
                if (name === "p10" || name === "bandRange" || name === "eventLabel") {
                  return [null, null];
                }
                return [
                  typeof value === "number" ? formatUsd(value, lang) : "—",
                  t("goalSegment.series.median"),
                ];
              }}
              labelFormatter={(label, payload) => {
                const row = payload?.[0]?.payload as
                  | {
                      eventLabel?: string | null;
                      p10?: number;
                      p90?: number;
                      segmentLabel?: string | null;
                    }
                  | undefined;
                const month = formatTimeLabel(Number(label), useYearAxis, t);
                const seg = row?.segmentLabel
                  ? ` · ${t(`goalSegment.segment.${row.segmentLabel}`)}`
                  : "";
                const band =
                  typeof row?.p10 === "number" && typeof row?.p90 === "number"
                    ? ` — ${t("goalSegment.series.band", { lo: bandLowPct, hi: bandHighPct })}: ${formatUsd(row.p10, lang)} ~ ${formatUsd(row.p90, lang)}`
                    : "";
                const evt = row?.eventLabel ? ` — ${row.eventLabel}` : "";
                return `${month}${seg}${band}${evt}`;
              }}
            />
            <Legend
              formatter={(value) =>
                value === "median"
                  ? t("goalSegment.series.median")
                  : value === "bandRange"
                    ? t("goalSegment.series.band", {
                        lo: bandLowPct,
                        hi: bandHighPct,
                      })
                    : value
              }
            />
            {/* Shaded band: p10 acts as the (invisible) stack base, bandRange
                (p90 − p10) paints the actual band on top of it. */}
            <Area
              type="monotone"
              dataKey="p10"
              stackId="goalBand"
              stroke="none"
              fill="transparent"
              legendType="none"
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="bandRange"
              stackId="goalBand"
              stroke="none"
              fill="#2563eb"
              fillOpacity={0.15}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="median"
              stroke="#2563eb"
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
            {segmentBoundaries.map((b) => (
              <ReferenceLine
                key={`seg-${b.month}`}
                x={b.month}
                stroke="#0d9488"
                strokeDasharray="6 4"
                label={{
                  value: b.label,
                  position: "insideTopRight",
                  fill: "#0d9488",
                  fontSize: 10,
                  fontWeight: 600,
                  offset: 6,
                }}
              />
            ))}
            {eventMarkers.map((m) => (
              <ReferenceLine
                key={`evt-${m.month}`}
                x={m.month}
                stroke="#7c3aed"
                strokeDasharray="4 4"
                label={{
                  value: m.label,
                  position: "insideBottomLeft",
                  fill: "#7c3aed",
                  fontSize: 10,
                  fontWeight: 600,
                  offset: 6,
                }}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
