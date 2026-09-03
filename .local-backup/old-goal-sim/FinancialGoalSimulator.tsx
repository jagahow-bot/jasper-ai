"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChatLog, type ChatMessage } from "@/components/ChatLog";
import { formatUsd, type DemoClient } from "@/lib/clients";
import {
  computeFinancialGoalGap,
  FINANCIAL_GOAL_TYPES,
  GOAL_ASSUMED_ANNUAL_RETURN,
  goalToHandoffParams,
  nextGoalCollectStep,
  parseGoalAmountUsd,
  parseGoalMonths,
  type FinancialGoal,
  type FinancialGoalType,
  type GoalCollectStep,
} from "@/lib/financial-goal";
import {
  clearFinancialGoalSession,
  loadFinancialGoalSession,
  saveFinancialGoalSession,
} from "@/lib/financial-goal-store";
import { useI18n, type TFn } from "@/lib/i18n";

type Props = {
  client: DemoClient;
  /** Base customization launch URL (client/anchor/groups/name). */
  launchHref: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function uid() {
  return `g-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function askKey(step: GoalCollectStep): string {
  if (step === "type") return "goalSim.ask.type";
  if (step === "amount") return "goalSim.ask.amount";
  if (step === "months") return "goalSim.ask.months";
  if (step === "description") return "goalSim.ask.description";
  if (step === "confirm") return "goalSim.ask.confirm";
  return "goalSim.ask.confirm";
}

function typeLabel(t: TFn, type: FinancialGoalType) {
  return t(`goalSim.type.${type}`);
}

function buildHandoffHref(baseHref: string, goal: FinancialGoal): string {
  const url = new URL(baseHref, "http://local.invalid");
  const p = goalToHandoffParams(goal);
  url.searchParams.set("goalType", p.goalType);
  url.searchParams.set("goalAmount", String(p.goalAmount));
  url.searchParams.set("goalMonths", String(p.goalMonths));
  if (p.goalDesc) url.searchParams.set("goalDesc", p.goalDesc);
  return `/${url.search}`;
}

export function FinancialGoalSimulator({
  client,
  launchHref,
  open,
  onOpenChange,
}: Props) {
  const { t, lang } = useI18n();
  const [step, setStep] = useState<GoalCollectStep>("type");
  const [draft, setDraft] = useState<Partial<FinancialGoal>>({});
  const [goal, setGoal] = useState<FinancialGoal | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const resetConversation = (withGreeting: boolean) => {
    setStep("type");
    setDraft({});
    setGoal(null);
    setInput("");
    setError(null);
    clearFinancialGoalSession(client.client_id);
    if (withGreeting) {
      setMessages([
        {
          id: uid(),
          role: "assistant",
          content: t("goalSim.ask.type"),
        },
      ]);
    } else {
      setMessages([]);
    }
  };

  useEffect(() => {
    if (!open) return;
    const stored = loadFinancialGoalSession(client.client_id);
    if (stored?.goal) {
      setGoal(stored.goal);
      setDraft(stored.goal);
      setStep("result");
      setMessages([
        {
          id: uid(),
          role: "assistant",
          content: t("goalSim.ask.confirm"),
        },
      ]);
      return;
    }
    resetConversation(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open/client only
  }, [open, client.client_id]);

  const gap = useMemo(() => {
    if (!goal) return null;
    return computeFinancialGoalGap(goal, client);
  }, [goal, client]);

  const pushAssistant = (content: string) => {
    setMessages((prev) => [...prev, { id: uid(), role: "assistant", content }]);
  };
  const pushUser = (content: string) => {
    setMessages((prev) => [...prev, { id: uid(), role: "user", content }]);
  };

  const advanceAfterType = (type: FinancialGoalType) => {
    pushUser(typeLabel(t, type));
    setDraft((d) => ({ ...d, type }));
    const next = nextGoalCollectStep("type");
    setStep(next);
    pushAssistant(t(askKey(next)));
  };

  const submitText = () => {
    const raw = input.trim();
    setError(null);

    if (step === "amount") {
      const amount = parseGoalAmountUsd(raw);
      if (amount == null) {
        setError(t("goalSim.invalidAmount"));
        return;
      }
      pushUser(raw);
      setInput("");
      setDraft((d) => ({ ...d, amountUsd: amount }));
      const next = nextGoalCollectStep("amount");
      setStep(next);
      pushAssistant(t(askKey(next)));
      return;
    }

    if (step === "months") {
      const months = parseGoalMonths(raw);
      if (months == null) {
        setError(t("goalSim.invalidMonths"));
        return;
      }
      pushUser(raw);
      setInput("");
      setDraft((d) => ({ ...d, withinMonths: months }));
      const next = nextGoalCollectStep("months");
      setStep(next);
      pushAssistant(t(askKey(next)));
      return;
    }

    if (step === "description") {
      pushUser(raw || "—");
      setInput("");
      setDraft((d) => ({
        ...d,
        description: raw ? raw.slice(0, 300) : undefined,
      }));
      const next = nextGoalCollectStep("description");
      setStep(next);
      pushAssistant(t(askKey(next)));
    }
  };

  const confirmGoal = () => {
    if (
      !draft.type ||
      typeof draft.amountUsd !== "number" ||
      typeof draft.withinMonths !== "number"
    ) {
      return;
    }
    const confirmed: FinancialGoal = {
      type: draft.type,
      amountUsd: draft.amountUsd,
      withinMonths: draft.withinMonths,
      ...(draft.description ? { description: draft.description } : {}),
    };
    setGoal(confirmed);
    saveFinancialGoalSession(client.client_id, confirmed);
    setStep("result");
  };

  const handoffHref = goal ? buildHandoffHref(launchHref, goal) : launchHref;

  if (!open) return null;

  const maxBar = gap
    ? Math.max(gap.goal.amountUsd, gap.cashUsd, 1)
    : 1;

  return (
    <section className="pixel-panel space-y-4" data-goal-simulator>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="ui-section-title">{t("goalSim.title")}</h2>
          <p className="mt-1 ui-hint max-w-2xl">{t("goalSim.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] bg-white px-2.5 py-1 text-xs text-[var(--ui-color-body)] hover:bg-[var(--surface-2)]"
            onClick={() => resetConversation(true)}
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
        {t("goalSim.disclaimer", {
          pct: Math.round(GOAL_ASSUMED_ANNUAL_RETURN * 100),
        })}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex min-h-[280px] flex-col rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="min-h-0 flex-1">
            <ChatLog messages={messages} variant="conversation" />
          </div>

          {step === "type" ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {FINANCIAL_GOAL_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-sm hover:border-[var(--primary)] hover:bg-[var(--primary-muted)]"
                  onClick={() => advanceAfterType(type)}
                >
                  {typeLabel(t, type)}
                </button>
              ))}
            </div>
          ) : null}

          {step === "confirm" && draft.type && draft.amountUsd != null ? (
            <div className="mt-3 space-y-2 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/5 p-3 text-sm">
              <p className="font-medium">
                {typeLabel(t, draft.type)}
                {draft.description ? ` · ${draft.description}` : ""}
              </p>
              <p className="tabular-nums">
                {formatUsd(draft.amountUsd, lang)} ·{" "}
                {t("goalSim.metric.months", {
                  n: draft.withinMonths ?? "—",
                })}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="pixel-btn px-3 py-1.5 text-sm"
                  onClick={confirmGoal}
                >
                  {t("goalSim.confirm")}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-sm"
                  onClick={() => resetConversation(true)}
                >
                  {t("goalSim.edit")}
                </button>
              </div>
            </div>
          ) : null}

          {(step === "amount" ||
            step === "months" ||
            step === "description") && (
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                submitText();
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t("goalSim.placeholder")}
                className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
              />
              <button type="submit" className="pixel-btn shrink-0 px-3 py-2 text-sm">
                {t("goalSim.send")}
              </button>
            </form>
          )}
          {error ? (
            <p className="mt-1 text-xs text-[var(--magenta)]">{error}</p>
          ) : null}
        </div>

        <div className="space-y-3">
          {gap ? (
            <>
              <div
                className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                  gap.status === "covered"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800"
                    : gap.status === "partial"
                      ? "border-[var(--amber)]/40 bg-[var(--amber)]/10 text-[var(--ui-color-body)]"
                      : "border-[var(--magenta)]/40 bg-[var(--magenta)]/10 text-[var(--magenta)]"
                }`}
              >
                {t(`goalSim.status.${gap.status}`)}
              </div>

              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="ui-hint">{t("goalSim.metric.goal")}</dt>
                  <dd className="font-medium tabular-nums">
                    {formatUsd(gap.goal.amountUsd, lang)}
                  </dd>
                </div>
                <div>
                  <dt className="ui-hint">{t("goalSim.metric.cash")}</dt>
                  <dd className="font-medium tabular-nums">
                    {formatUsd(gap.cashUsd, lang)}
                  </dd>
                </div>
                <div>
                  <dt className="ui-hint">
                    {gap.cashShortfallUsd > 0
                      ? t("goalSim.metric.shortfall")
                      : t("goalSim.metric.surplus")}
                  </dt>
                  <dd className="font-medium tabular-nums">
                    {formatUsd(
                      gap.cashShortfallUsd > 0
                        ? gap.cashShortfallUsd
                        : gap.surplusCashUsd,
                      lang,
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="ui-hint">{t("goalSim.metric.horizon")}</dt>
                  <dd className="font-medium">
                    {t("goalSim.metric.months", {
                      n: gap.goal.withinMonths,
                    })}
                  </dd>
                </div>
              </dl>

              <div>
                <p className="mb-2 text-xs font-medium text-[var(--text-dim)]">
                  {t("goalSim.chart.gap")}
                </p>
                <div className="space-y-2">
                  <div>
                    <div className="mb-0.5 flex justify-between text-[11px] text-[var(--text-dim)]">
                      <span>{t("goalSim.metric.goal")}</span>
                      <span className="tabular-nums">
                        {formatUsd(gap.goal.amountUsd, lang)}
                      </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
                      <div
                        className="h-full rounded-full bg-[var(--primary)]"
                        style={{
                          width: `${Math.min(100, (gap.goal.amountUsd / maxBar) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="mb-0.5 flex justify-between text-[11px] text-[var(--text-dim)]">
                      <span>{t("goalSim.metric.cash")}</span>
                      <span className="tabular-nums">
                        {formatUsd(gap.cashUsd, lang)}
                      </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{
                          width: `${Math.min(100, (gap.cashUsd / maxBar) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <p className="mb-1 text-xs font-medium text-[var(--text-dim)]">
                  {t("goalSim.chart.timeline")}
                </p>
                <div className="h-40 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={gap.timeline}
                      margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis
                        dataKey="month"
                        tick={{ fontSize: 10, fill: "#64748b" }}
                        tickFormatter={(v) => `${v}m`}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: "#64748b" }}
                        width={42}
                        tickFormatter={(v) =>
                          v >= 1e6
                            ? `${(v / 1e6).toFixed(1)}M`
                            : v >= 1e3
                              ? `${(v / 1e3).toFixed(0)}k`
                              : String(v)
                        }
                      />
                      <Tooltip
                        formatter={(value: number | string, name: string) => [
                          typeof value === "number"
                            ? formatUsd(value, lang)
                            : value,
                          name === "reservedCash"
                            ? t("goalSim.chart.reserved")
                            : name === "investable"
                              ? t("goalSim.chart.investable")
                              : t("goalSim.chart.goalLine"),
                        ]}
                        labelFormatter={(label) =>
                          t("goalSim.metric.months", { n: Number(label) })
                        }
                      />
                      <Bar
                        dataKey="reservedCash"
                        name="reservedCash"
                        fill="#94a3b8"
                        barSize={10}
                      />
                      <Line
                        type="monotone"
                        dataKey="investable"
                        name="investable"
                        stroke="#2563eb"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="goalLine"
                        name="goalLine"
                        stroke="#ef4444"
                        strokeDasharray="4 4"
                        strokeWidth={1.5}
                        dot={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium text-[var(--foreground)]">
                  {t("goalSim.actions.title")}
                </h3>
                <ul className="mt-2 space-y-1.5 text-sm text-[var(--ui-color-body)]">
                  {gap.status === "covered" || gap.status === "partial" ? (
                    <>
                      <li>• {t("goalSim.action.reserve")}</li>
                      {gap.surplusCashUsd > 0 ? (
                        <li>• {t("goalSim.action.deploy")}</li>
                      ) : null}
                    </>
                  ) : (
                    <li>• {t("goalSim.action.raiseLiquidity")}</li>
                  )}
                  <li>• {t("goalSim.action.customize")}</li>
                </ul>
                <Link
                  href={handoffHref}
                  className="pixel-btn mt-3 inline-flex px-3 py-1.5 text-sm"
                >
                  {t("goalSim.handoffCta")}
                </Link>
              </div>
            </>
          ) : (
            <p className="flex h-full min-h-[200px] items-center justify-center px-4 text-center text-sm text-[var(--text-dim)]">
              {t("goalSim.subtitle")}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
