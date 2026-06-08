"use client";

import { useMemo, useState } from "react";
import { ResultsDashboard } from "@/components/ResultsDashboard";
import { useI18n } from "@/lib/i18n";
import type {
  BacktestRequest,
  BacktestResult,
  PortfolioVsBenchmark,
  ProRoundSnapshot,
} from "@/lib/types";

type TabId = "final" | number;

type Props = {
  result: BacktestResult;
  narrative: string;
  request: BacktestRequest;
  onRerun: () => void;
  onExport: () => void;
  onQuickTweak: (next: BacktestRequest, label: string) => void;
  onQuickTweakAndRun: (next: BacktestRequest, label: string) => void;
};

function mergeRoundIntoResult(
  base: BacktestResult,
  round: ProRoundSnapshot,
): BacktestResult {
  return {
    ...base,
    candidates: round.candidates,
    equity_curve: round.equity_curve,
    efficient_frontier: round.efficient_frontier,
    narrative_facts: {
      ...base.narrative_facts,
      ...round.narrative_facts,
      viewing_round: round.round,
      round_label: round.narrative_facts.round_label ?? `Round ${round.round}`,
      is_round_view: true,
    },
  };
}

function mergeAllPortfolios(base: BacktestResult): BacktestResult {
  const rounds = base.pro_rounds ?? [];
  const allByCode = new Map<string, (typeof base.candidates)[number]>();
  for (const c of base.candidates) {
    allByCode.set(c.model_code ?? `R${c.rank}`, c);
  }
  for (const r of rounds) {
    for (const c of r.candidates) {
      const code = c.model_code ?? `R${r.round}-${c.rank}`;
      if (!allByCode.has(code)) allByCode.set(code, c);
    }
  }
  const all = Array.from(allByCode.values());
  all.sort((a, b) => {
    const objective = String(base.narrative_facts.objective ?? "max_sharpe");
    const scoreOf = (x: (typeof all)[number]) => {
      const isObj = x.analytics?.sample_metrics?.in_sample?.objective_value;
      if (isObj != null) return Number(isObj);
      if (objective === "max_return") return Number(x.cagr ?? -999);
      if (objective === "min_max_drawdown") return -Math.abs(Number(x.max_drawdown ?? 0));
      if (objective === "max_sortino") return Number(x.sortino ?? -999);
      if (objective === "min_cvar") return Number(x.cvar_95 ?? -999);
      return Number(x.sharpe ?? -999);
    };
    const ds = scoreOf(b) - scoreOf(a);
    if (Math.abs(ds) > 1e-12) return ds;
    const sa = Number((a.params ?? {}).adjusted_score ?? -999);
    const sb = Number((b.params ?? {}).adjusted_score ?? -999);
    return sb - sa;
  });
  return {
    ...base,
    candidates: all,
    narrative_facts: {
      ...base.narrative_facts,
      models_total_catalog: Number(base.narrative_facts.models_total_catalog ?? all.length),
      is_all_portfolios_view: true,
    },
  };
}

function formatParamLabel(key: string): string {
  const labels: Record<string, string> = {
    mode: "Allocator mode",
    lookback_days: "Covariance lookback",
    shrinkage: "Shrinkage",
    risk_aversion: "Risk aversion",
    max_weight_actual: "Max weight",
    top_n_actual: "Top N holdings",
    max_turnover_actual: "Max turnover",
    no_trade_tol: "No-trade tolerance",
    turnover_penalty_mult: "Turnover penalty",
    factor_lookback_days: "Factor lookback",
    reversal_lookback_days: "Reversal lookback",
    value_lookback_days: "Value lookback",
    w_mom: "Momentum weight",
    w_reversal: "Reversal weight",
    w_value: "Value weight",
    w_lowvol: "Low-vol weight",
    w_trend: "Trend weight",
    w_drawdown: "Drawdown weight",
    w_equity: "Equity quota",
    w_bond: "Bond quota",
    w_commodity: "Commodity quota",
    w_real_estate: "Real estate quota",
    w_alternative: "Alternative quota",
    mom_indicator: "Momentum indicator",
    reversal_indicator: "Reversal indicator",
    value_indicator: "Value indicator",
    lowvol_indicator: "Low-vol indicator",
    trend_indicator: "Trend indicator",
    drawdown_indicator: "Drawdown indicator",
  };
  return labels[key] ?? key.replace(/_/g, " ");
}

function formatPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toFixed(2)}%`;
}

function formatAlpha(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  if (Math.abs(n) <= 2) return `${(n * 100).toFixed(2)}%`;
  return n.toFixed(4);
}

function RoundBenchmarkBanner({
  status,
  alpha,
  pvb,
  benchmarkTicker,
}: {
  status?: ProRoundSnapshot["benchmark_status"];
  alpha?: number | null;
  pvb?: PortfolioVsBenchmark | null;
  benchmarkTicker: string;
}) {
  if (status !== "below") return null;
  const portRet = pvb?.portfolio_total_return_pct;
  const benchRet = pvb?.benchmark_total_return_pct;
  const alphaVal = alpha ?? pvb?.alpha ?? null;

  return (
    <div
      className="mb-3 border-2 border-[var(--amber)] bg-[rgba(255,176,0,0.12)] p-3"
      role="status"
    >
      <p className="font-pixel text-[9px] text-[var(--amber)]">
        ROUND UNDERPERFORMED BENCHMARK
      </p>
      <p className="mt-1 font-pixel text-[8px] leading-relaxed text-[var(--fg)]">
        Portfolio return trails the benchmark ({benchmarkTicker}) in this sample.
        Consider wider exploration or strategy tweaks next round.
      </p>
      <p className="mt-2 font-pixel text-[8px] text-[var(--muted)]">
        Portfolio return {formatPct(portRet)} · Benchmark {formatPct(benchRet)} · Alpha{" "}
        {formatAlpha(alphaVal)}
      </p>
    </div>
  );
}

function RoundSeedPanel({ round }: { round: ProRoundSnapshot }) {
  const setup = round.round_setup ?? {};
  const regimes = round.regime_setups ?? {};
  const regimeQuotas = round.regime_class_quotas ?? {};
  const ranges = round.factor_ranges ?? {};
  const choices = round.factor_choices ?? {};
  const setupEntries = Object.entries(setup).filter(([, v]) => v != null);
  const regimeEntries = Object.entries(regimes).filter(
    ([, v]) => v && typeof v === "object" && Object.keys(v as object).length > 0,
  );
  const rangeEntries = Object.entries(ranges).filter(([, v]) => Array.isArray(v) && v.length >= 2);
  const choiceEntries = Object.entries(choices).filter(([, v]) => v != null && v !== "");

  const strategy = round.optimization_strategy?.trim();
  const assessment = round.performance_assessment?.trim();
  const benchStatus = round.benchmark_status;
  const assessmentTone =
    benchStatus === "below"
      ? "border-[var(--amber)] bg-[rgba(255,176,0,0.08)] text-[var(--fg)]"
      : benchStatus === "above"
        ? "border-[var(--border)] bg-[rgba(0,0,0,0.12)] text-[var(--muted)]"
        : "border-[var(--border)] bg-[rgba(0,0,0,0.12)] text-[var(--muted)]";

  if (
    !strategy &&
    !assessment &&
    !setupEntries.length &&
    !regimeEntries.length &&
    !rangeEntries.length &&
    !choiceEntries.length
  ) {
    return null;
  }

  return (
    <div className="mt-3 grid gap-3 border border-[var(--border)] bg-[rgba(0,0,0,0.15)] p-3 md:grid-cols-2">
      {round.regime_matrix_enabled && regimeEntries.length ? (
        <div className="md:col-span-2">
          <p className="mb-1 font-pixel text-[8px] text-[var(--amber)]">
            Regime matrix (allocator per regime — used at each rebalance switch)
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {regimeEntries.map(([regime, slice]) => (
              <div key={regime} className="border border-[var(--border)] p-2">
                <p className="mb-1 font-pixel text-[8px] text-[var(--fg)]">{regime}</p>
                <ul className="space-y-0.5 font-pixel text-[8px] text-[var(--muted)]">
                  {Object.entries(slice as Record<string, unknown>).map(([k, v]) => (
                    <li key={k}>
                      <span className="text-[var(--fg)]">{formatParamLabel(k)}:</span>{" "}
                      {String(v)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {round.regime_class_quota_matrix_enabled &&
      Object.keys(regimeQuotas).length > 0 ? (
        <div className="md:col-span-2">
          <p className="mb-1 font-pixel text-[8px] text-[var(--cyan)]">
            Regime class quotas (Top N asset classes per regime)
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {Object.entries(regimeQuotas).map(([regime, slice]) => (
              <div key={regime} className="border border-[var(--border)] p-2">
                <p className="mb-1 font-pixel text-[8px] text-[var(--fg)]">{regime}</p>
                <ul className="space-y-0.5 font-pixel text-[8px] text-[var(--muted)]">
                  {Object.entries(slice as Record<string, number>).map(([k, v]) => (
                    <li key={k}>
                      <span className="text-[var(--fg)]">{formatParamLabel(k)}:</span>{" "}
                      {(Number(v) * 100).toFixed(1)}%
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {assessment ? (
        <div className={`md:col-span-2 border p-2 ${assessmentTone}`}>
          <p
            className={`mb-1 font-pixel text-[8px] ${
              benchStatus === "below" ? "text-[var(--amber)]" : "text-[var(--fg)]"
            }`}
          >
            AI performance assessment
          </p>
          <p className="font-pixel text-[8px] leading-relaxed">{assessment}</p>
        </div>
      ) : null}
      {strategy ? (
        <div className="md:col-span-2">
          <p className="mb-1 font-pixel text-[8px] text-[var(--amber)]">AI optimization strategy</p>
          <p className="font-pixel text-[8px] leading-relaxed text-[var(--muted)]">{strategy}</p>
        </div>
      ) : null}
      {setupEntries.length ? (
        <div>
          <p className="mb-1 font-pixel text-[8px] text-[var(--amber)]">
            Round setup (applies to every strategy this round)
          </p>
          <ul className="space-y-0.5 font-pixel text-[8px] text-[var(--muted)]">
            {setupEntries.map(([k, v]) => (
              <li key={k}>
                <span className="text-[var(--fg)]">{formatParamLabel(k)}:</span> {String(v)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {rangeEntries.length || choiceEntries.length ? (
        <div>
          <p className="mb-1 font-pixel text-[8px] text-[var(--amber)]">Factor search (ranges Jasper explored)</p>
          <ul className="space-y-0.5 font-pixel text-[8px] text-[var(--muted)]">
            {rangeEntries.map(([k, v]) => (
              <li key={k}>
                <span className="text-[var(--fg)]">{formatParamLabel(k)}:</span> [{v[0]}, {v[1]}]
              </li>
            ))}
            {choiceEntries.map(([k, v]) => (
              <li key={k}>
                <span className="text-[var(--fg)]">{formatParamLabel(k)}:</span> {String(v)} (fixed)
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function ProResultsWithTabs(props: Props) {
  const { t } = useI18n();
  const { result } = props;
  const rounds = result.pro_rounds ?? [];
  const [tab, setTab] = useState<TabId>("final");

  const activeResult = useMemo(() => {
    if (tab === "final") return mergeAllPortfolios(result);
    const round = rounds.find((r) => r.round === tab);
    if (!round) return result;
    return mergeRoundIntoResult(result, round);
  }, [tab, result, rounds]);

  const roundRoleSummary = useMemo(() => {
    if (tab === "final") return null;
    const round = rounds.find((r) => r.round === tab);
    if (!round?.candidates?.length) return null;
    const roleLabel: Record<string, string> = {
      incoming_champion: t("pro.role.incoming"),
      challenger: t("pro.role.challenger"),
      round_winner: t("pro.role.winner"),
    };
    const groups: Record<string, string[]> = {
      incoming_champion: [],
      challenger: [],
      round_winner: [],
    };
    for (const c of round.candidates) {
      const role = String((c.params as { pro_round_role?: string })?.pro_round_role ?? "challenger");
      const key = role in groups ? role : "challenger";
      groups[key].push(c.model_code ?? `R${c.rank}`);
    }
    const incomingCode =
      round.incoming_champion_model_code ??
      (groups.incoming_champion.length ? groups.incoming_champion.join(", ") : null);
    const winnerCode =
      round.round_winner_model_code ??
      (groups.round_winner.length ? groups.round_winner.join(", ") : null);
    const challengerCodes = round.round_challenger_model_codes?.length
      ? round.round_challenger_model_codes
      : (round.pool_model_codes ?? []).filter(
          (code) => code && code !== incomingCode && code !== winnerCode,
        );
    return (
      <ul className="mt-2 space-y-1 font-pixel text-[8px] text-[var(--muted)]">
        {incomingCode ? (
          <li>
            <span className="text-[var(--amber)]">{roleLabel.incoming_champion}:</span>{" "}
            {incomingCode}
          </li>
        ) : null}
        {challengerCodes.length ? (
          <li>
            <span className="text-[var(--amber)]">{roleLabel.challenger}s:</span>{" "}
            {challengerCodes.join(", ")}
          </li>
        ) : null}
        {winnerCode ? (
          <li>
            <span className="text-[var(--amber)]">{roleLabel.round_winner}:</span> {winnerCode}
          </li>
        ) : null}
      </ul>
    );
  }, [tab, rounds, t]);

  const narrativePrefix = useMemo(() => {
    if (tab === "final") return undefined;
    const round = rounds.find((r) => r.round === tab);
    if (!round) return undefined;
    const improved = round.improved
      ? "Round winner — replaced the incoming champion"
      : "Incoming champion held (improvement below threshold)";
    const score = round.round_best_adjusted_score?.toFixed(4) ?? "—";
    return (
      `[${round.narrative_facts.round_label ?? `Round ${round.round}`}]` +
      ` ${improved} · adj score ${score} · ` +
      `${round.trials_in_round} trials · ${round.candidates.length} models.`
    );
  }, [tab, rounds]);

  if (!rounds.length) {
    return <ResultsDashboard {...props} />;
  }

  return (
    <div className="space-y-4">
      <div className="border-2 border-[var(--amber)] bg-[rgba(255,176,0,0.06)] p-3">
        <p className="mb-2 font-pixel text-[8px] text-[var(--amber)]">
          {t("pro.tabsHint")}
        </p>
        <div className="flex flex-wrap gap-2">
          {rounds.map((r) => (
            <button
              key={r.round}
              type="button"
              onClick={() => setTab(r.round)}
              className={`pixel-chip ${tab === r.round ? "pixel-chip-active !border-[var(--amber)] !text-[var(--amber)]" : ""}`}
            >
              R{r.round}
              {r.improved && <span className="ml-1">↑</span>}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setTab("final")}
            className={`pixel-chip ${tab === "final" ? "pixel-chip-active" : ""}`}
          >
            {t("pro.allRounds")}
          </button>
        </div>
        {roundRoleSummary}
        {tab !== "final" ? (
          (() => {
            const round = rounds.find((r) => r.round === tab);
            if (!round) return null;
            return (
              <>
                <RoundBenchmarkBanner
                  status={round.benchmark_status}
                  alpha={round.benchmark_alpha}
                  pvb={round.portfolio_vs_benchmark}
                  benchmarkTicker={result.benchmark ?? "SPY"}
                />
                <RoundSeedPanel round={round} />
              </>
            );
          })()
        ) : null}
      </div>

      <ResultsDashboard
        key={tab === "final" ? "final" : `round-${tab}`}
        {...props}
        result={activeResult}
        narrativePrefix={narrativePrefix}
      />
    </div>
  );
}
