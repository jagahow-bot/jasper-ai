"use client";

import Link from "next/link";
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
import {
  buildGoalChartSeries,
  createGoalId,
  DEFAULT_GOAL_ASSUMPTIONS,
  FINANCIAL_GOAL_TYPES,
  goalsToSearchParams,
  projectFinancialGoals,
  type FinancialGoal,
  type FinancialGoalType,
  type GoalAssumptions,
} from "@/lib/financial-goal";
import type { GoalExtractResult } from "@/lib/financial-goal-extract";
import {
  clearGoalPlan,
  loadGoalPlan,
  saveGoalPlan,
} from "@/lib/financial-goal-store";
import { useI18n, type TFn } from "@/lib/i18n";

type Props = {
  client: DemoClient;
  launchHref: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function typeLabel(t: TFn, type: FinancialGoalType) {
  return t(`goalSim.type.${type}`);
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
  };
}

function buildHandoffHref(
  baseHref: string,
  goals: FinancialGoal[],
  assumptions: GoalAssumptions,
): string {
  const url = new URL(baseHref, "http://local.invalid");
  const extra = goalsToSearchParams(goals, assumptions);
  extra.forEach((value, key) => {
    url.searchParams.set(key, value);
  });
  return `${url.pathname}${url.search}`;
}

export function FinancialGoalSimulator({
  client,
  launchHref,
  open,
  onOpenChange,
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
  const skipNextSaveRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    skipNextSaveRef.current = true;
    const stored = loadGoalPlan(client.client_id);
    if (stored) {
      setNotes(stored.notes);
      setGoals(stored.goals);
      setAssumptions(stored.assumptions);
    } else {
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

  const projection = useMemo(() => {
    if (!validGoals.length) return null;
    return projectFinancialGoals(validGoals, client, assumptions);
  }, [validGoals, client, assumptions]);

  const chartSeries = useMemo(
    () => (projection ? buildGoalChartSeries(projection) : []),
    [projection],
  );

  const goalRefMonths = useMemo(() => {
    const seen = new Set<number>();
    return validGoals
      .map((g) => g.withinMonths)
      .filter((m) => {
        if (seen.has(m)) return false;
        seen.add(m);
        return true;
      });
  }, [validGoals]);

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

  const updateGoal = (id: string, patch: Partial<FinancialGoal>) => {
    setGoals((prev) =>
      prev.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    );
  };

  const removeGoal = (id: string) => {
    setGoals((prev) => prev.filter((g) => g.id !== id));
  };

  const resetAll = () => {
    clearGoalPlan(client.client_id);
    setNotes("");
    setGoals([]);
    setAssumptions(DEFAULT_GOAL_ASSUMPTIONS);
    setQuestions([]);
    setExtractMeta(null);
    setExtractError(null);
  };

  if (!open) return null;

  const handoffHref =
    validGoals.length > 0
      ? buildHandoffHref(launchHref, validGoals, assumptions)
      : launchHref;

  return (
    <section className="pixel-panel space-y-4" data-goal-simulator>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="ui-section-title">{t("goalSim.title")}</h2>
          <p className="mt-1 ui-hint max-w-3xl">{t("goalSim.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] bg-white px-2.5 py-1 text-xs text-[var(--ui-color-body)] hover:bg-[var(--surface-2)]"
            onClick={resetAll}
          >
            {t("goalSim.reset")}
          </button>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] bg-white px-2.5 py-1 text-xs text-[var(--ui-color-body)] hover:bg-[var(--surface-2)]"
            onClick={() => onOpenChange(false)}
          >
            {t("goalSim.close")}
          </button>
        </div>
      </div>

      <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--text-dim)]">
        {t("goalSim.disclaimer")}
      </p>

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
              <span className="ui-hint">{t("goalSim.extractHint")}</span>
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
                    setAssumptions((a) => ({
                      ...a,
                      annualReturn: parsePctInput(e.target.value),
                    }))
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
                    setAssumptions((a) => ({
                      ...a,
                      optimisticDelta: parsePctInput(e.target.value),
                    }))
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
                    setAssumptions((a) => ({
                      ...a,
                      conservativeDelta: parsePctInput(e.target.value),
                    }))
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
                          {t("goalSim.goalAmount")}
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
                      <div className="flex items-end">
                        <button
                          type="button"
                          className="text-xs text-[var(--magenta)] hover:underline"
                          onClick={() => removeGoal(g.id)}
                        >
                          {t("goalSim.removeGoal")}
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right: chart + outcomes */}
        <div className="space-y-3">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
            <h3 className="text-sm font-medium">{t("goalSim.chartTitle")}</h3>
            {chartSeries.length > 1 ? (
              <div className="mt-2 h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chartSeries}
                    margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 10, fill: "#64748b" }}
                      tickFormatter={(v) => `${v}m`}
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
                      formatter={(value, name) => [
                        typeof value === "number"
                          ? formatUsd(value, lang)
                          : String(value ?? ""),
                        name === "base"
                          ? t("goalSim.scenario.base")
                          : name === "optimistic"
                            ? t("goalSim.scenario.optimistic")
                            : t("goalSim.scenario.conservative"),
                      ]}
                      labelFormatter={(label) =>
                        t("goalSim.monthLabel", { n: Number(label) })
                      }
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
                    {goalRefMonths.map((m) => (
                      <ReferenceLine
                        key={m}
                        x={m}
                        stroke="#94a3b8"
                        strokeDasharray="4 4"
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
          </div>

          {projection ? (
            <>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg border border-[var(--border)] p-2">
                  <p className="ui-hint">{t("goalSim.endingWealth")}</p>
                  <p className="font-medium tabular-nums">
                    {formatUsd(projection.scenarios.base.endingWealth, lang)}
                  </p>
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
              </div>

              <div>
                <h3 className="text-sm font-medium">
                  {t("goalSim.eventsTitle")}
                </h3>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {projection.scenarios.base.events.map((ev) => (
                    <li
                      key={`${ev.goal.id}-${ev.month}`}
                      className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)]/60 py-1"
                    >
                      <span>
                        {ev.goal.label || typeLabel(t, ev.goal.type)} ·{" "}
                        {t("goalSim.monthLabel", { n: ev.month })}
                      </span>
                      <span
                        className={`tabular-nums ${
                          ev.covered
                            ? "text-emerald-700"
                            : "text-[var(--magenta)]"
                        }`}
                      >
                        {ev.covered
                          ? t("goalSim.eventCovered")
                          : t("goalSim.eventShortfall", {
                              amount: formatUsd(ev.shortfallUsd, lang),
                            })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-sm font-medium">
                  {t("goalSim.actionsTitle")}
                </h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--ui-color-body)]">
                  {projection.firstShortfall ? (
                    <li>{t("goalSim.action.shortfall")}</li>
                  ) : (
                    <li>{t("goalSim.action.onTrack")}</li>
                  )}
                  <li>{t("goalSim.action.tuneAssumptions")}</li>
                  <li>{t("goalSim.action.customize")}</li>
                </ul>
                <Link
                  href={handoffHref}
                  className="pixel-btn mt-3 inline-flex px-3 py-1.5 text-sm"
                >
                  {t("goalSim.handoffCta")}
                </Link>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
