"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { fetchPortfolioBackcastMonthly } from "@/lib/api";
import {
  buildClientPerformanceSeries,
  holdingsHavePerformanceMetrics,
} from "@/lib/clients-charts";
import { useClientDailyNav } from "@/lib/use-client-daily-nav";
import {
  buildGoalChartEventMarkers,
  buildGoalChartSeries,
  clampMortgage,
  createGoalId,
  DEFAULT_GOAL_ASSUMPTIONS,
  DEFAULT_HOME_MORTGAGE,
  DEFAULT_RETIREMENT_SPEND_YEARS,
  FINANCIAL_GOAL_TYPES,
  GOAL_CHART_HORIZON_OPTIONS,
  monthlyMortgagePayment,
  projectFinancialGoals,
  resolveChartHorizonMonths,
  clampRetirementSpendYears,
  retirementSpendYearsFromLongevity,
  type FinancialGoal,
  type FinancialGoalType,
  type GoalAssumptions,
  type GoalChartHorizonOption,
  type HomeMortgage,
} from "@/lib/financial-goal";
import {
  holdingsToBackcastWeights,
  monthlyReturnsFromNav,
  parseBackcastMonthly,
  resolveGoalReturnDefaults,
  type GoalReturnDefaults,
  type GoalReturnDefaultsResolution,
} from "@/lib/financial-goal-backcast";
import type { GoalExtractResult } from "@/lib/financial-goal-extract";
import { parseTargetRetirementAge } from "@/lib/financial-goal-extract";
import {
  clearGoalInsights,
  loadGoalPlan,
  saveGoalInsights,
  saveGoalPlan,
} from "@/lib/financial-goal-store";
import {
  projectionSummaryForLlm,
  rewriteLargeMonthDurationsInText,
  type GoalPathInsight,
} from "@/lib/financial-goal-insights";
import { useI18n, type TFn } from "@/lib/i18n";

type Props = {
  client: DemoClient;
  open: boolean;
};

function typeLabel(t: TFn, type: FinancialGoalType) {
  return t(`goalSim.type.${type}`);
}

/** Return fields the auto-fill manages (until the RM edits them). */
type ReturnField = "annualReturn" | "optimisticDelta" | "conservativeDelta";
const RETURN_FIELDS: readonly ReturnField[] = [
  "annualReturn",
  "optimisticDelta",
  "conservativeDelta",
];

/**
 * Apply resolved defaults without fighting RM edits: a field the RM has
 * touched (or restored from a saved plan / AI extract) keeps its value.
 */
function assumptionsWithReturnDefaults(
  a: GoalAssumptions,
  defaults: GoalReturnDefaults,
  touched: ReadonlySet<ReturnField>,
): GoalAssumptions {
  const next = { ...a };
  for (const f of RETURN_FIELDS) {
    if (!touched.has(f)) next[f] = defaults[f];
  }
  return next;
}

function pctInput(fraction: number): string {
  return (fraction * 100).toFixed(1);
}

function parsePctInput(raw: string): number {
  const n = Number(raw.replace(/%/g, "").trim());
  if (!Number.isFinite(n)) return 0;
  return n / 100;
}

function emptyGoal(): FinancialGoal {
  return {
    id: createGoalId(),
    type: "home",
    label: "",
    amountUsd: 0,
    withinMonths: 12,
    priority: 3,
    mortgage: { ...DEFAULT_HOME_MORTGAGE },
  };
}

function formatGoalAxisTick(month: number, useYears: boolean, t: TFn): string {
  if (!useYears) return t("goalSim.axis.m", { n: month });
  if (month <= 0) return t("goalSim.axis.y", { n: 0 });
  if (month % 12 === 0) return t("goalSim.axis.y", { n: month / 12 });
  const years = month / 12;
  const rounded = Math.round(years * 10) / 10;
  return t("goalSim.axis.y", { n: rounded });
}

function formatGoalTimeLabel(month: number, useYears: boolean, t: TFn): string {
  if (!useYears) return t("goalSim.monthLabel", { n: month });
  const y = month / 12;
  const yLabel =
    month % 12 === 0
      ? String(month / 12)
      : (Math.round(y * 10) / 10).toString();
  return t("goalSim.timeLabel.years", { y: yLabel, m: month });
}

function mortgageOrDefault(g: FinancialGoal): HomeMortgage {
  return clampMortgage(g.mortgage) ?? { ...DEFAULT_HOME_MORTGAGE };
}

export function FinancialGoalSimulator({
  client,
  open,
}: Props) {
  const { t, lang } = useI18n();
  const [notes, setNotes] = useState("");
  const [goals, setGoals] = useState<FinancialGoal[]>([]);
  const [assumptions, setAssumptions] =
    useState<GoalAssumptions>(DEFAULT_GOAL_ASSUMPTIONS);
  const [questions, setQuestions] = useState<string[]>([]);
  const [extractMeta, setExtractMeta] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [chartHorizon, setChartHorizon] =
    useState<GoalChartHorizonOption>(60);
  const [pathInsights, setPathInsights] = useState<GoalPathInsight[] | null>(
    null,
  );
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [insightsRetryToken, setInsightsRetryToken] = useState(0);
  const skipNextSaveRef = useRef(false);
  const insightsAbortRef = useRef<AbortController | null>(null);
  /** Return fields the RM (or a saved plan / AI extract) has set explicitly. */
  const returnTouchedRef = useRef<Set<ReturnField>>(new Set());
  const [returnDefaults, setReturnDefaults] =
    useState<GoalReturnDefaultsResolution | null>(null);
  const [returnDefaultsLoading, setReturnDefaultsLoading] = useState(false);
  const [returnDefaultsFailed, setReturnDefaultsFailed] = useState(false);
  const [returnDefaultsRetryToken, setReturnDefaultsRetryToken] = useState(0);

  useEffect(() => {
    if (!open) return;
    skipNextSaveRef.current = true;
    const stored = loadGoalPlan(client.client_id);
    if (stored) {
      // A saved plan's return fields are deliberate RM input — never clobber.
      returnTouchedRef.current = new Set(RETURN_FIELDS);
      setNotes(stored.notes);
      setGoals(stored.goals);
      setAssumptions(stored.assumptions);
    } else {
      returnTouchedRef.current = new Set();
      setNotes("");
      setGoals([]);
      setAssumptions(DEFAULT_GOAL_ASSUMPTIONS);
      setQuestions([]);
      setExtractMeta(null);
    }
  }, [open, client.client_id]);

  useEffect(() => {
    if (!open) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    saveGoalPlan(client.client_id, { notes, goals, assumptions });
  }, [open, client.client_id, notes, goals, assumptions]);

  const validGoals = useMemo(
    () => goals.filter((g) => g.amountUsd > 0 && g.withinMonths >= 1),
    [goals],
  );

  // --- Default return inputs from the client's real performance ---------
  // Realized book history first (per agreed design): the real daily NAV from
  // POST /backcast/daily-nav once loaded, with the calibrated reported series
  // as placeholder/fallback; otherwise a backcast of the current holdings mix
  // via POST /backcast/monthly (real price history).
  const dailyNav = useClientDailyNav(client.holdings, client.as_of_date, {
    enabled: open,
  });
  const realizedMonthly = useMemo(() => {
    if (dailyNav.points?.length) return monthlyReturnsFromNav(dailyNav.points);
    return holdingsHavePerformanceMetrics(client.holdings)
      ? monthlyReturnsFromNav(buildClientPerformanceSeries(client))
      : null;
  }, [dailyNav.points, client]);
  const bookWeights = useMemo(
    () => holdingsToBackcastWeights(client.holdings),
    [client],
  );

  useEffect(() => {
    if (!open) return;
    const prior = DEFAULT_GOAL_ASSUMPTIONS.annualReturn;

    const realized = resolveGoalReturnDefaults({
      realizedMonthly,
      priorReturn: prior,
    });
    if (realized) {
      setReturnDefaults(realized);
      setReturnDefaultsLoading(false);
      setReturnDefaultsFailed(false);
      setAssumptions((a) =>
        assumptionsWithReturnDefaults(a, realized.defaults, returnTouchedRef.current),
      );
      return;
    }

    if (Object.keys(bookWeights).length === 0) {
      setReturnDefaults(null);
      setReturnDefaultsLoading(false);
      setReturnDefaultsFailed(false);
      return;
    }

    let cancelled = false;
    setReturnDefaultsLoading(true);
    void (async () => {
      try {
        const res = await fetchPortfolioBackcastMonthly(bookWeights);
        if (cancelled) return;
        const resolution = resolveGoalReturnDefaults({
          backcastMonthly: parseBackcastMonthly(res.monthly),
          priorReturn: prior,
        });
        setReturnDefaults(resolution);
        setReturnDefaultsFailed(!resolution);
        if (resolution) {
          setAssumptions((a) =>
            assumptionsWithReturnDefaults(
              a,
              resolution.defaults,
              returnTouchedRef.current,
            ),
          );
        }
      } catch {
        if (!cancelled) {
          setReturnDefaults(null);
          setReturnDefaultsFailed(true);
        }
      } finally {
        if (!cancelled) setReturnDefaultsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, client.client_id, realizedMonthly, bookWeights, returnDefaultsRetryToken]);

  /** Manual RM edit — auto-fill must not override this field afterwards. */
  const patchReturnField = (field: ReturnField, value: number) => {
    returnTouchedRef.current.add(field);
    setAssumptions((a) => ({ ...a, [field]: value }));
  };

  /** Refresh: re-apply the portfolio-derived estimate over any RM edits. */
  const reapplyReturnDefaults = () => {
    returnTouchedRef.current = new Set();
    if (returnDefaults) {
      setAssumptions((a) => ({ ...a, ...returnDefaults.defaults }));
    } else {
      setReturnDefaultsRetryToken((n) => n + 1);
    }
  };

  const projection = useMemo(() => {
    if (!validGoals.length) return null;
    return projectFinancialGoals(validGoals, client, assumptions);
  }, [validGoals, client, assumptions]);

  useEffect(() => {
    if (!open || !projection) {
      setPathInsights(null);
      setInsightsError(null);
      setInsightsLoading(false);
      return;
    }

    const summary = projectionSummaryForLlm(projection, lang);
    if (summary.insight_seeds.length === 0) {
      setPathInsights(null);
      setInsightsError(null);
      setInsightsLoading(false);
      return;
    }

    const timer = window.setTimeout(() => {
      insightsAbortRef.current?.abort();
      const ac = new AbortController();
      insightsAbortRef.current = ac;
      setInsightsLoading(true);
      setInsightsError(null);
      setPathInsights(null);

      void (async () => {
        try {
          const res = await fetch("/api/goals/insights", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: ac.signal,
            body: JSON.stringify({
              report_language: lang,
              summary,
              insight_seeds: summary.insight_seeds,
              client: {
                client_id: client.client_id,
                risk_profile: client.risk_profile,
              },
            }),
          });
          const data = (await res.json()) as {
            insights?: GoalPathInsight[];
            error?: string;
            message?: string;
          };
          if (ac.signal.aborted) return;
          if (!res.ok || !data.insights?.length) {
            setPathInsights(null);
            clearGoalInsights(client.client_id);
            setInsightsError(
              data.message || data.error || t("goalSim.insightsFailed"),
            );
            return;
          }
          setPathInsights(data.insights);
          setInsightsError(null);
          saveGoalInsights(client.client_id, data.insights);
        } catch (err) {
          if (ac.signal.aborted) return;
          setPathInsights(null);
          clearGoalInsights(client.client_id);
          setInsightsError(
            err instanceof Error ? err.message : t("goalSim.insightsFailed"),
          );
        } finally {
          if (!ac.signal.aborted) setInsightsLoading(false);
        }
      })();
    }, 600);

    return () => {
      window.clearTimeout(timer);
      insightsAbortRef.current?.abort();
    };
  }, [
    open,
    projection,
    lang,
    client.client_id,
    client.risk_profile,
    insightsRetryToken,
    t,
  ]);

  const chartHorizonMonths = useMemo(() => {
    if (!projection) return 60;
    return resolveChartHorizonMonths(chartHorizon, projection.horizonMonths);
  }, [projection, chartHorizon]);

  /** Horizons longer than 3 years read better in years on the axis. */
  const useYearAxis = chartHorizonMonths > 36;

  const chartYearTicks = useMemo(() => {
    if (!useYearAxis) return undefined;
    const maxYears = Math.ceil(chartHorizonMonths / 12);
    const step = maxYears <= 10 ? 1 : maxYears <= 20 ? 2 : 5;
    const ticks: number[] = [0];
    for (let y = step; y <= maxYears; y += step) {
      const m = y * 12;
      if (m <= chartHorizonMonths) ticks.push(m);
    }
    const lastYearMonth = Math.floor(chartHorizonMonths / 12) * 12;
    if (lastYearMonth > 0 && !ticks.includes(lastYearMonth)) {
      ticks.push(lastYearMonth);
    }
    if (
      chartHorizonMonths > lastYearMonth &&
      !ticks.includes(chartHorizonMonths)
    ) {
      ticks.push(chartHorizonMonths);
    }
    return ticks;
  }, [useYearAxis, chartHorizonMonths]);

  const chartSeries = useMemo(
    () =>
      projection
        ? buildGoalChartSeries(projection, chartHorizonMonths)
        : [],
    [projection, chartHorizonMonths],
  );

  const chartEventMarkers = useMemo(() => {
    if (!projection) return [];
    const raw = buildGoalChartEventMarkers(projection, chartHorizonMonths);
    // One ReferenceLine per month; short on-chart tag + full list label.
    const byMonth = new Map<
      number,
      { chartLabel: string; listLabel: string; kinds: string[] }
    >();
    for (const m of raw) {
      const name = m.goalLabel || typeLabel(t, m.goalType);
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
                    amount: formatUsd(projection.inheritanceUsd, lang),
                  })
                : name;
      // Ultra-short chart tags so labels don't collide across the plot.
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
        chartLabel: prev
          ? `${prev.chartLabel} · ${chartPiece}`
          : chartPiece,
        listLabel: prev ? `${prev.listLabel} · ${listPiece}` : listPiece,
        kinds: prev ? [...prev.kinds, m.kind] : [m.kind],
      });
    }
    return [...byMonth.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([month, labels], index) => {
        const nearEnd = month >= chartHorizonMonths * 0.72;
        // Alternate top/bottom so neighboring markers don't stack on one band.
        const band: "top" | "bottom" = index % 2 === 0 ? "top" : "bottom";
        return {
          month,
          chartLabel: labels.chartLabel,
          listLabel: labels.listLabel,
          stroke: labels.kinds.includes("inheritance")
            ? "#b45309"
            : labels.kinds.includes("mortgage_end")
              ? "#0d9488"
              : "#7c3aed",
          labelPosition:
            band === "top"
              ? nearEnd
                ? ("insideTopRight" as const)
                : ("insideTopLeft" as const)
              : nearEnd
                ? ("insideBottomRight" as const)
                : ("insideBottomLeft" as const),
        };
      });
  }, [projection, chartHorizonMonths, t, lang]);

  const updateGoal = (id: string, patch: Partial<FinancialGoal>) => {
    setGoals((prev) =>
      prev.map((g) => {
        if (g.id !== id) return g;
        const next = { ...g, ...patch };
        if (patch.type && patch.type !== "home") {
          next.mortgage = null;
        } else if (patch.type === "home" && !next.mortgage) {
          next.mortgage = { ...DEFAULT_HOME_MORTGAGE };
        }
        if (patch.type === "retirement" && next.retirementSpendYears == null) {
          const retireAge = parseTargetRetirementAge(notes) ?? 60;
          next.retirementSpendYears = retirementSpendYearsFromLongevity(
            retireAge,
            client.gender ?? null,
          );
        } else if (patch.type && patch.type !== "retirement") {
          next.retirementSpendYears = null;
        }
        return next;
      }),
    );
  };

  const updateMortgage = (id: string, patch: Partial<HomeMortgage>) => {
    setGoals((prev) =>
      prev.map((g) => {
        if (g.id !== id) return g;
        const base = mortgageOrDefault(g);
        return { ...g, mortgage: { ...base, ...patch } };
      }),
    );
  };

  const runExtract = async () => {
    setExtracting(true);
    setExtractError(null);
    try {
      const res = await fetch("/api/goals/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes,
          report_language: lang === "zh" ? "zh-TW" : lang,
          client: {
            client_id: client.client_id,
            age: client.age,
            gender: client.gender ?? null,
            display_name: [
              client.display_name?.en,
              client.display_name?.zh,
              client.display_name?.ko,
            ]
              .filter(Boolean)
              .join(" "),
            aum_usd: client.aum_usd,
            cash_usd: client.cash_usd,
            risk_profile: client.risk_profile,
            as_of_date: client.as_of_date,
          },
        }),
      });
      const data = (await res.json()) as {
        extract?: GoalExtractResult;
        source?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.extract) {
        throw new Error(data.message || data.error || "extract_failed");
      }
      const { extract } = data;
      if (extract.goals.length) setGoals(extract.goals);
      // Extract-provided returns are deliberate input — auto-fill yields.
      returnTouchedRef.current = new Set(RETURN_FIELDS);
      setAssumptions(extract.assumptions);
      setQuestions(extract.clarification_questions ?? []);
      setExtractMeta(
        `${data.source === "gemini" ? "AI" : t("goalSim.rulesFallback")}: ${extract.rationale}`,
      );
    } catch (err) {
      setExtractError(
        err instanceof Error ? err.message : t("goalSim.extractFailed"),
      );
    } finally {
      setExtracting(false);
    }
  };

  const removeGoal = (id: string) => {
    setGoals((prev) => prev.filter((g) => g.id !== id));
  };

  // Parent (ExpandCollapse) owns mount/unmount.
  // Effects already no-op when `open` is false.
  return (
    <section
      id="financial-goal-simulator"
      className="pixel-panel space-y-4"
      data-goal-simulator
    >
      <h2 className="ui-section-title">{t("goalSim.title")}</h2>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Left: notes + assumptions + goals form */}
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">
              {t("goalSim.notesLabel")}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              placeholder={t("goalSim.notesPlaceholder")}
              className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="pixel-btn px-3 py-1.5 text-sm disabled:opacity-40"
                disabled={notes.trim().length < 8 || extracting}
                onClick={() => void runExtract()}
              >
                {extracting ? t("goalSim.extracting") : t("goalSim.extract")}
              </button>
            </div>
            {extractError ? (
              <p className="mt-1 text-xs text-[var(--magenta)]">{extractError}</p>
            ) : null}
            {extractMeta ? (
              <p className="mt-1 text-xs text-[var(--text-dim)]">{extractMeta}</p>
            ) : null}
            {questions.length > 0 ? (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-[var(--amber)]">
                {questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="rounded-lg border border-[var(--border)] p-3">
            <h3 className="text-sm font-medium">{t("goalSim.assumptionsTitle")}</h3>
            {returnDefaultsLoading ? (
              <p className="mt-1 text-[10px] text-[var(--text-dim)]">
                {t("goalSim.returnDefaults.loading")}
              </p>
            ) : returnDefaults ? (
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[var(--text-dim)]">
                <span>{t(`goalSim.returnDefaults.${returnDefaults.source}`)}</span>
                <button
                  type="button"
                  className="font-medium text-[var(--primary)] hover:underline"
                  onClick={reapplyReturnDefaults}
                >
                  {t("goalSim.returnDefaults.refresh")}
                </button>
              </p>
            ) : returnDefaultsFailed ? (
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[var(--text-dim)]">
                <span>{t("goalSim.returnDefaults.unavailable")}</span>
                <button
                  type="button"
                  className="font-medium text-[var(--primary)] hover:underline"
                  onClick={reapplyReturnDefaults}
                >
                  {t("goalSim.returnDefaults.retry")}
                </button>
              </p>
            ) : null}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-xs">
                <span className="text-[var(--text-dim)]">
                  {t("goalSim.annualReturn")}
                </span>
                <input
                  type="number"
                  step="0.1"
                  value={pctInput(assumptions.annualReturn)}
                  onChange={(e) =>
                    patchReturnField("annualReturn", parsePctInput(e.target.value))
                  }
                  className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm"
                />
              </label>
              <label className="block text-xs">
                <span className="text-[var(--text-dim)]">
                  {t("goalSim.annualContribution")}
                </span>
                <input
                  type="number"
                  step="1000"
                  value={assumptions.annualContributionUsd || ""}
                  onChange={(e) =>
                    setAssumptions((a) => ({
                      ...a,
                      annualContributionUsd: Math.max(
                        0,
                        Number(e.target.value) || 0,
                      ),
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm"
                />
                <span className="mt-0.5 block text-[10px] text-[var(--text-dim)]">
                  {t("goalSim.annualContributionHint")}
                </span>
              </label>
              <label className="block text-xs">
                <span className="text-[var(--text-dim)]">
                  {t("goalSim.annualLivingSpend")}
                </span>
                <input
                  type="number"
                  step="1000"
                  value={assumptions.annualLivingSpendUsd || ""}
                  onChange={(e) =>
                    setAssumptions((a) => ({
                      ...a,
                      annualLivingSpendUsd: Math.max(
                        0,
                        Number(e.target.value) || 0,
                      ),
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm"
                />
                <span className="mt-0.5 block text-[10px] text-[var(--text-dim)]">
                  {t("goalSim.annualLivingSpendHint")}
                </span>
              </label>
              <label className="block text-xs">
                <span className="text-[var(--text-dim)]">
                  {t("goalSim.contributionGrowth")}
                </span>
                <input
                  type="number"
                  step="0.1"
                  value={pctInput(assumptions.contributionGrowth)}
                  onChange={(e) =>
                    setAssumptions((a) => ({
                      ...a,
                      contributionGrowth: parsePctInput(e.target.value),
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm"
                />
              </label>
              <label className="block text-xs">
                <span className="text-[var(--text-dim)]">
                  {t("goalSim.inflation")}
                </span>
                <input
                  type="number"
                  step="0.1"
                  value={pctInput(assumptions.inflation)}
                  onChange={(e) =>
                    setAssumptions((a) => ({
                      ...a,
                      inflation: parsePctInput(e.target.value),
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm"
                />
              </label>
              <label className="block text-xs">
                <span className="text-[var(--text-dim)]">
                  {t("goalSim.optimisticDelta")}
                </span>
                <input
                  type="number"
                  step="0.1"
                  value={pctInput(assumptions.optimisticDelta)}
                  onChange={(e) =>
                    patchReturnField(
                      "optimisticDelta",
                      parsePctInput(e.target.value),
                    )
                  }
                  className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm"
                />
              </label>
              <label className="block text-xs">
                <span className="text-[var(--text-dim)]">
                  {t("goalSim.conservativeDelta")}
                </span>
                <input
                  type="number"
                  step="0.1"
                  value={pctInput(assumptions.conservativeDelta)}
                  onChange={(e) =>
                    patchReturnField(
                      "conservativeDelta",
                      parsePctInput(e.target.value),
                    )
                  }
                  className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm"
                />
              </label>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{t("goalSim.goalsTitle")}</h3>
              <button
                type="button"
                className="text-xs font-medium text-[var(--primary)] hover:underline"
                onClick={() => setGoals((prev) => [...prev, emptyGoal()])}
              >
                + {t("goalSim.addGoal")}
              </button>
            </div>
            {goals.length === 0 ? (
              <p className="ui-hint">{t("goalSim.goalsEmpty")}</p>
            ) : (
              <ul className="space-y-3">
                {goals.map((g) => (
                  <li
                    key={g.id}
                    className="rounded-lg border border-[var(--border)] bg-white p-3"
                  >
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="block text-xs">
                        <span className="text-[var(--text-dim)]">
                          {t("goalSim.goalType")}
                        </span>
                        <select
                          value={g.type}
                          onChange={(e) =>
                            updateGoal(g.id, {
                              type: e.target.value as FinancialGoalType,
                            })
                          }
                          className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm"
                        >
                          {FINANCIAL_GOAL_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {typeLabel(t, type)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-xs">
                        <span className="text-[var(--text-dim)]">
                          {t("goalSim.goalLabel")}
                        </span>
                        <input
                          value={g.label}
                          onChange={(e) =>
                            updateGoal(g.id, { label: e.target.value })
                          }
                          className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm"
                        />
                      </label>
                      <label className="block text-xs">
                        <span className="text-[var(--text-dim)]">
                          {g.type === "home"
                            ? t("goalSim.goalAmountDownPayment")
                            : g.type === "retirement"
                              ? t("goalSim.goalAmountAnnualSpend")
                              : t("goalSim.goalAmount")}
                        </span>
                        <input
                          type="number"
                          value={g.amountUsd || ""}
                          onChange={(e) =>
                            updateGoal(g.id, {
                              amountUsd: Math.max(0, Number(e.target.value) || 0),
                            })
                          }
                          className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm"
                        />
                      </label>
                      <label className="block text-xs">
                        <span className="text-[var(--text-dim)]">
                          {t("goalSim.goalMonths")}
                        </span>
                        <input
                          type="number"
                          value={g.withinMonths}
                          onChange={(e) =>
                            updateGoal(g.id, {
                              withinMonths: Math.min(
                                360,
                                Math.max(1, Number(e.target.value) || 1),
                              ),
                            })
                          }
                          className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm"
                        />
                      </label>
                      <label className="block text-xs">
                        <span className="text-[var(--text-dim)]">
                          {t("goalSim.goalPriority")}
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={5}
                          value={g.priority}
                          onChange={(e) =>
                            updateGoal(g.id, {
                              priority: Math.min(
                                5,
                                Math.max(1, Number(e.target.value) || 3),
                              ),
                            })
                          }
                          className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm"
                        />
                      </label>
                      {g.type === "retirement" ? (
                        <label className="block text-xs">
                          <span className="text-[var(--text-dim)]">
                            {t("goalSim.retirementSpendYears")}
                          </span>
                          <input
                            type="number"
                            min={1}
                            max={40}
                            value={clampRetirementSpendYears(
                              g.retirementSpendYears,
                            )}
                            onChange={(e) =>
                              updateGoal(g.id, {
                                retirementSpendYears: clampRetirementSpendYears(
                                  Number(e.target.value) ||
                                    DEFAULT_RETIREMENT_SPEND_YEARS,
                                ),
                              })
                            }
                            className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm"
                          />
                        </label>
                      ) : (
                        <div className="flex items-end">
                          <button
                            type="button"
                            className="rounded-lg border border-[var(--magenta)]/40 bg-white px-2.5 py-1.5 text-xs text-[var(--magenta)] hover:bg-[var(--magenta)]/5"
                            onClick={() => removeGoal(g.id)}
                          >
                            {t("goalSim.removeGoal")}
                          </button>
                        </div>
                      )}
                      {g.type === "retirement" ? (
                        <div className="flex items-end sm:col-span-2">
                          <button
                            type="button"
                            className="rounded-lg border border-[var(--magenta)]/40 bg-white px-2.5 py-1.5 text-xs text-[var(--magenta)] hover:bg-[var(--magenta)]/5"
                            onClick={() => removeGoal(g.id)}
                          >
                            {t("goalSim.removeGoal")}
                          </button>
                          <span className="ml-3 ui-hint">
                            {t("goalSim.retirementSpendHint", {
                              monthly: formatUsd(g.amountUsd / 12, lang),
                            })}{" "}
                            {t("goalSim.retirementLongevityHint", {
                              years: clampRetirementSpendYears(
                                g.retirementSpendYears,
                              ),
                              le:
                                client.gender === "male"
                                  ? 78
                                  : client.gender === "female"
                                    ? 85
                                    : 82,
                            })}
                          </span>
                        </div>
                      ) : null}
                    </div>
                    {g.type === "home" ? (
                      <div className="mt-3 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-2.5">
                        <p className="text-xs font-medium text-[var(--ui-color-body)]">
                          {t("goalSim.mortgageTitle")}
                        </p>
                        <p className="mt-0.5 ui-hint">{t("goalSim.mortgageHint")}</p>
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          <label className="flex min-w-0 flex-col gap-1 text-xs">
                            <span className="truncate text-[var(--text-dim)]" title={t("goalSim.mortgageLoan")}>
                              {t("goalSim.mortgageLoan")}
                            </span>
                            <input
                              type="number"
                              value={mortgageOrDefault(g).loanUsd || ""}
                              onChange={(e) =>
                                updateMortgage(g.id, {
                                  loanUsd: Math.max(
                                    0,
                                    Number(e.target.value) || 0,
                                  ),
                                })
                              }
                              className="w-full min-w-0 rounded-lg border border-[var(--border)] bg-white px-2 py-1.5 text-sm"
                            />
                          </label>
                          <label className="flex min-w-0 flex-col gap-1 text-xs">
                            <span className="truncate text-[var(--text-dim)]" title={t("goalSim.mortgageRate")}>
                              {t("goalSim.mortgageRate")}
                            </span>
                            <input
                              type="number"
                              step="0.1"
                              value={pctInput(mortgageOrDefault(g).annualRate)}
                              onChange={(e) =>
                                updateMortgage(g.id, {
                                  annualRate: parsePctInput(e.target.value),
                                })
                              }
                              className="w-full min-w-0 rounded-lg border border-[var(--border)] bg-white px-2 py-1.5 text-sm"
                            />
                          </label>
                          <label className="flex min-w-0 flex-col gap-1 text-xs">
                            <span className="truncate text-[var(--text-dim)]" title={t("goalSim.mortgageTermYears")}>
                              {t("goalSim.mortgageTermYears")}
                            </span>
                            <input
                              type="number"
                              value={Math.round(
                                mortgageOrDefault(g).termMonths / 12,
                              )}
                              onChange={(e) =>
                                updateMortgage(g.id, {
                                  termMonths: Math.min(
                                    480,
                                    Math.max(
                                      12,
                                      Math.round(
                                        (Number(e.target.value) || 1) * 12,
                                      ),
                                    ),
                                  ),
                                })
                              }
                              className="w-full min-w-0 rounded-lg border border-[var(--border)] bg-white px-2 py-1.5 text-sm"
                            />
                          </label>
                        </div>
                        {mortgageOrDefault(g).loanUsd > 0 ? (
                          <p className="mt-2 text-xs text-[var(--text-dim)]">
                            {t("goalSim.mortgagePayment", {
                              amount: formatUsd(
                                monthlyMortgagePayment(mortgageOrDefault(g)),
                                lang,
                              ),
                            })}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right: chart + outcomes */}
        <div className="space-y-3">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{t("goalSim.chartTitle")}</h3>
              <label className="flex items-center gap-1.5 text-xs text-[var(--text-dim)]">
                <span>{t("goalSim.chartHorizon")}</span>
                <select
                  value={String(chartHorizon)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setChartHorizon(
                      v === "max"
                        ? "max"
                        : (Number(v) as GoalChartHorizonOption),
                    );
                  }}
                  className="rounded-md border border-[var(--border)] bg-white px-1.5 py-1 text-xs text-[var(--ui-color-body)]"
                >
                  {GOAL_CHART_HORIZON_OPTIONS.map((opt) => (
                    <option key={String(opt)} value={String(opt)}>
                      {opt === "max"
                        ? t("goalSim.chartHorizon.max")
                        : opt >= 60
                          ? t("goalSim.chartHorizon.years", {
                              n: opt / 12,
                            })
                          : t("goalSim.chartHorizon.months", { n: opt })}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {chartSeries.length > 1 ? (
              <div className="mt-2 h-80 w-full overflow-visible">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chartSeries}
                    margin={{ top: 36, right: 28, left: 4, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="month"
                      ticks={chartYearTicks}
                      tick={{ fontSize: 10, fill: "#64748b" }}
                      tickFormatter={(v) =>
                        formatGoalAxisTick(Number(v), useYearAxis, t)
                      }
                      padding={{ left: 4, right: 12 }}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "#64748b" }}
                      width={48}
                      tickFormatter={(v) =>
                        v >= 1e6
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
                          typeof value === "number"
                            ? formatUsd(value, lang)
                            : String(value ?? ""),
                          name === "base"
                            ? t("goalSim.scenario.base")
                            : name === "optimistic"
                              ? t("goalSim.scenario.optimistic")
                              : t("goalSim.scenario.conservative"),
                        ];
                      }}
                      labelFormatter={(label, payload) => {
                        const row = payload?.[0]?.payload as
                          | { eventLabel?: string | null }
                          | undefined;
                        const month = formatGoalTimeLabel(
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
                        value === "base"
                          ? t("goalSim.scenario.base")
                          : value === "optimistic"
                            ? t("goalSim.scenario.optimistic")
                            : t("goalSim.scenario.conservative")
                      }
                    />
                    <Line
                      type="monotone"
                      dataKey="optimistic"
                      stroke="#86efac"
                      strokeWidth={1.5}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="base"
                      stroke="#2563eb"
                      strokeWidth={2.5}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="conservative"
                      stroke="#fca5a5"
                      strokeWidth={1.5}
                      dot={false}
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
            ) : (
              <p className="mt-6 flex h-48 items-center justify-center text-center text-sm text-[var(--text-dim)]">
                {t("goalSim.chartEmpty")}
              </p>
            )}
            {chartEventMarkers.length > 0 ? (
              <ul className="mt-2 space-y-1 border-t border-[var(--border)] pt-2 text-xs text-[var(--ui-color-body)]">
                {chartEventMarkers.map((m) => (
                  <li key={`legend-${m.month}`}>
                    <span className="font-medium text-violet-700">
                      {t("goalSim.monthLabel", { n: m.month })}
                    </span>
                    <span className="text-[var(--text-dim)]"> — </span>
                    {m.listLabel}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {projection ? (
            <>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg border border-[var(--border)] p-2">
                  <p className="ui-hint">
                    {projection.lifeExpectancyMonth != null
                      ? t("goalSim.inheritance")
                      : t("goalSim.endingWealth")}
                  </p>
                  <p className="font-medium tabular-nums">
                    {formatUsd(
                      projection.lifeExpectancyMonth != null
                        ? projection.inheritanceUsd
                        : projection.scenarios.base.endingWealth,
                      lang,
                    )}
                  </p>
                  {projection.lifeExpectancyAge != null &&
                  projection.lifeExpectancyMonth != null ? (
                    <p className="mt-0.5 text-[10px] text-[var(--text-dim)]">
                      {t("goalSim.inheritanceHint", {
                        age: projection.lifeExpectancyAge,
                        years: Math.round(projection.lifeExpectancyMonth / 12),
                      })}
                    </p>
                  ) : null}
                </div>
                <div className="rounded-lg border border-[var(--border)] p-2">
                  <p className="ui-hint">{t("goalSim.totalShortfall")}</p>
                  <p
                    className={`font-medium tabular-nums ${
                      projection.scenarios.base.totalShortfall > 0
                        ? "text-[var(--magenta)]"
                        : "text-emerald-700"
                    }`}
                  >
                    {formatUsd(projection.scenarios.base.totalShortfall, lang)}
                  </p>
                </div>
                {projection.scenarios.base.totalMortgagePaid > 0 ? (
                  <div className="col-span-2 rounded-lg border border-[var(--border)] p-2">
                    <p className="ui-hint">{t("goalSim.totalMortgagePaid")}</p>
                    <p className="font-medium tabular-nums">
                      {formatUsd(
                        projection.scenarios.base.totalMortgagePaid,
                        lang,
                      )}
                    </p>
                  </div>
                ) : null}
                {projection.scenarios.base.totalRetirementPaid > 0 ? (
                  <div className="col-span-2 rounded-lg border border-[var(--border)] p-2">
                    <p className="ui-hint">{t("goalSim.totalRetirementPaid")}</p>
                    <p className="font-medium tabular-nums">
                      {formatUsd(
                        projection.scenarios.base.totalRetirementPaid,
                        lang,
                      )}
                    </p>
                  </div>
                ) : null}
                {projection.scenarios.base.totalLivingPaid > 0 ? (
                  <div className="col-span-2 rounded-lg border border-[var(--border)] p-2">
                    <p className="ui-hint">{t("goalSim.totalLivingPaid")}</p>
                    <p className="font-medium tabular-nums">
                      {formatUsd(
                        projection.scenarios.base.totalLivingPaid,
                        lang,
                      )}
                    </p>
                  </div>
                ) : null}
              </div>

              <div>
                <h3 className="text-sm font-medium">
                  {t("goalSim.eventsTitle")}
                </h3>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {projection.scenarios.base.events
                    .filter((ev) => ev.month <= projection.horizonMonths)
                    .map((ev, idx) => (
                    <li
                      key={`${ev.kind}-${ev.goal.id}-${ev.month}-${idx}`}
                      className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)]/60 py-1"
                    >
                      <span>
                        {ev.kind === "mortgage_start"
                          ? t("goalSim.eventMortgageStart", {
                              name:
                                ev.goal.label || typeLabel(t, ev.goal.type),
                              payment: formatUsd(
                                ev.monthlyPaymentUsd ?? 0,
                                lang,
                              ),
                            })
                          : ev.kind === "mortgage_end"
                            ? t("goalSim.eventMortgageEnd", {
                                name:
                                  ev.goal.label || typeLabel(t, ev.goal.type),
                              })
                            : ev.kind === "retirement_start"
                              ? t("goalSim.eventRetirementStart", {
                                  name:
                                    ev.goal.label || typeLabel(t, ev.goal.type),
                                  payment: formatUsd(
                                    ev.monthlyPaymentUsd ?? 0,
                                    lang,
                                  ),
                                })
                              : ev.kind === "inheritance"
                                ? t("goalSim.eventInheritance")
                                : ev.goal.label || typeLabel(t, ev.goal.type)}{" "}
                        · {t("goalSim.monthLabel", { n: ev.month })}
                      </span>
                      <span
                        className={`tabular-nums ${
                          ev.covered
                            ? "text-emerald-700"
                            : "text-[var(--magenta)]"
                        }`}
                      >
                        {ev.kind === "mortgage_start"
                          ? t("goalSim.eventMortgageLoan", {
                              amount: formatUsd(ev.neededUsd, lang),
                            })
                          : ev.kind === "mortgage_end"
                            ? t("goalSim.eventMortgageEndDone")
                            : ev.kind === "retirement_start"
                              ? t("goalSim.eventRetirementTotal", {
                                  amount: formatUsd(ev.neededUsd, lang),
                                })
                              : ev.kind === "inheritance"
                                ? formatUsd(ev.fundedUsd, lang)
                                : ev.covered
                                  ? t("goalSim.eventCovered")
                                  : t("goalSim.eventShortfall", {
                                      amount: formatUsd(ev.shortfallUsd, lang),
                                    })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {projection ? (
        <div className="space-y-4 border-t border-[var(--border)] pt-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)]/60 p-4">
            <h3 className="text-sm font-medium">
              {t("goalSim.insightsTitle")}
            </h3>
            <p className="mt-1 ui-hint">{t("goalSim.insightsSubtitle")}</p>
            {insightsLoading ? (
              <p className="mt-3 text-sm text-[var(--text-dim)]">
                {t("goalSim.insightsLoading")}
              </p>
            ) : null}
            {insightsError && !insightsLoading ? (
              <div className="mt-3 rounded-lg border border-[var(--magenta)]/40 bg-[var(--magenta)]/5 px-3 py-2">
                <p className="text-sm text-[var(--magenta)]">
                  {t("goalSim.insightsFailed")}
                </p>
                <p className="mt-1 text-xs text-[var(--text-dim)]">
                  {insightsError}
                </p>
                <button
                  type="button"
                  className="mt-2 rounded-lg border border-[var(--magenta)]/40 bg-white px-2.5 py-1.5 text-xs text-[var(--magenta)] hover:bg-[var(--magenta)]/5"
                  onClick={() => setInsightsRetryToken((n) => n + 1)}
                >
                  {t("goalSim.insightsRetry")}
                </button>
              </div>
            ) : null}
            {pathInsights && pathInsights.length > 0 && !insightsLoading ? (
              <ul className="mt-3 grid gap-3 md:grid-cols-2">
                {pathInsights.map((insight) => (
                  <li
                    key={insight.id}
                    className="rounded-lg border border-[var(--border)] bg-white px-3 py-2.5"
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                          insight.severity === "critical"
                            ? "bg-[var(--magenta)]"
                            : insight.severity === "warning"
                              ? "bg-amber-500"
                              : insight.severity === "opportunity"
                                ? "bg-sky-500"
                                : "bg-emerald-600"
                        }`}
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--foreground)]">
                          {rewriteLargeMonthDurationsInText(insight.title, lang)}
                        </p>
                        <p className="mt-0.5 text-sm text-[var(--ui-color-body)]">
                          {rewriteLargeMonthDurationsInText(insight.detail, lang)}
                        </p>
                        {insight.talking_point ? (
                          <p className="mt-1 text-xs text-[var(--text-dim)]">
                            {t("goalSim.insightsTalkingPoint", {
                              text: rewriteLargeMonthDurationsInText(
                                insight.talking_point,
                                lang,
                              ),
                            })}
                          </p>
                        ) : null}
                        {insight.customization_hooks.length > 0 ? (
                          <p className="mt-2 text-xs font-medium text-[var(--primary)]">
                            {t("goalSim.insightsSolveInNext", {
                              actions: insight.customization_hooks
                                .map((h) => t(`goalSim.hook.${h}`))
                                .join(
                                  lang === "zh" || lang === "ko" ? "、" : ", ",
                                ),
                            })}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
