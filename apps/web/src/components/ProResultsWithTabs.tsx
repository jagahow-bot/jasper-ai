"use client";

import { useMemo, useState } from "react";
import { ResultsDashboard } from "@/components/ResultsDashboard";
import type { BacktestRequest, BacktestResult, ProRoundSnapshot } from "@/lib/types";

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

function RoundSeedPanel({ round }: { round: ProRoundSnapshot }) {
  const setup = round.round_setup ?? {};
  const ranges = round.factor_ranges ?? {};
  const choices = round.factor_choices ?? {};
  const setupEntries = Object.entries(setup).filter(([, v]) => v != null);
  const rangeEntries = Object.entries(ranges).filter(([, v]) => Array.isArray(v) && v.length >= 2);
  const choiceEntries = Object.entries(choices).filter(([, v]) => v != null && v !== "");

  if (!setupEntries.length && !rangeEntries.length && !choiceEntries.length) {
    return null;
  }

  return (
    <div className="mt-3 grid gap-3 border border-[var(--border)] bg-[rgba(0,0,0,0.15)] p-3 md:grid-cols-2">
      {setupEntries.length ? (
        <div>
          <p className="mb-1 font-pixel text-[8px] text-[var(--amber)]">Round setup (fixed all trials)</p>
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
          <p className="mb-1 font-pixel text-[8px] text-[var(--amber)]">Factor search (Optuna samples ranges)</p>
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
      incoming_champion: "Incoming champion",
      challenger: "Round challenger",
      round_winner: "Round winner",
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
  }, [tab, rounds]);

  const activeNarrative = useMemo(() => {
    if (tab === "final") return props.narrative;
    const round = rounds.find((r) => r.round === tab);
    if (!round) return props.narrative;
    const improved = round.improved
      ? "Round winner — incoming champion replaced"
      : "Round winner held (no min-gain beat vs incoming)";
    const score = round.round_best_adjusted_score?.toFixed(4) ?? "—";
    return (
      `[${round.narrative_facts.round_label ?? `Round ${round.round}`}]` +
      ` ${improved} · adj score ${score} · ` +
      `${round.trials_in_round} trials · ${round.candidates.length} models.\n\n` +
      props.narrative
    );
  }, [tab, props.narrative, rounds]);

  if (!rounds.length) {
    return <ResultsDashboard {...props} />;
  }

  return (
    <div className="space-y-4">
      <div className="border-2 border-[var(--amber)] bg-[rgba(255,176,0,0.06)] p-3">
        <p className="mb-2 font-pixel text-[8px] text-[var(--amber)]">
          Pro rounds · each tab = incoming champion + round challengers; ★ = round winner (catalog tab
          = every model ever tried, not the active pool)
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
            ALL ROUNDS (catalog)
          </button>
        </div>
        {roundRoleSummary}
        {tab !== "final" ? (
          (() => {
            const round = rounds.find((r) => r.round === tab);
            return round ? <RoundSeedPanel round={round} /> : null;
          })()
        ) : null}
      </div>

      <ResultsDashboard
        key={tab === "final" ? "final" : `round-${tab}`}
        {...props}
        result={activeResult}
        narrative={activeNarrative}
      />
    </div>
  );
}
