"use client";

import { useMemo, useState } from "react";
import { ResultsDashboard } from "@/components/ResultsDashboard";
import {
  pickCatalogChampionModelKey,
} from "@/lib/performance-compare-chart";
import { useI18n, type TFn } from "@/lib/i18n";
import type { ModelPortfolio } from "@/lib/model-portfolios";
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
  onContinueRefinement?: (options: {
    extraRefinementRounds: number;
    extraTrialsPerRound: number;
    extraTrials?: number;
  }) => void;
  continueLoading?: boolean;
  showRunObjectiveBanner?: boolean;
  variant?: "default" | "rm";
  anchorBenchmarkTicker?: string;
  anchorPortfolio?: ModelPortfolio | null;
  /** Dual-track anchor static replay — Quant baseline when set. */
  anchorBaselineResult?: BacktestResult | null;
  anchorBaselineLabel?: string | null;
  selectedRowKey?: string;
  onSelectedRowKeyChange?: (rowKey: string) => void;
  onPromoteTickers?: (tickers: string[]) => void;
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
  const objective = String(base.narrative_facts.objective ?? "max_sharpe");
  const catalogChampion = pickCatalogChampionModelKey(all, base.narrative_facts);
  all.sort((a, b) => {
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
      catalog_champion_model_code: catalogChampion,
    },
  };
}

const PARAM_LABEL_KEYS = new Set([
  "mode",
  "lookback_days",
  "shrinkage",
  "risk_aversion",
  "max_weight_actual",
  "top_n_actual",
  "max_turnover_actual",
  "customization_drift_actual",
  "no_trade_tol",
  "turnover_penalty_mult",
  "factor_lookback_days",
  "reversal_lookback_days",
  "value_lookback_days",
  "w_mom",
  "w_reversal",
  "w_value",
  "w_lowvol",
  "w_trend",
  "w_drawdown",
  "w_equity",
  "w_bond",
  "w_commodity",
  "w_real_estate",
  "w_alternative",
  "mom_indicator",
  "reversal_indicator",
  "value_indicator",
  "lowvol_indicator",
  "trend_indicator",
  "drawdown_indicator",
]);

function formatParamLabel(key: string, t: TFn): string {
  if (PARAM_LABEL_KEYS.has(key)) return t(`pro.param.${key}`);
  return key.replace(/_/g, " ");
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
  const { t } = useI18n();
  if (status !== "below") return null;
  const portRet = pvb?.portfolio_total_return_pct;
  const benchRet = pvb?.benchmark_total_return_pct;
  const alphaVal = alpha ?? pvb?.alpha ?? null;

  return (
    <div
      className="mb-3 border-2 border-[var(--amber)] bg-[rgba(255,176,0,0.12)] p-3"
      role="status"
    >
      <p className="ui-section-title text-[var(--amber)]">
        {t("pro.banner.title")}
      </p>
      <p className="ui-body mt-1 text-[var(--fg)]">
        {t("pro.banner.body", { benchmark: benchmarkTicker })}
      </p>
      <p className="ui-body mt-2 text-[var(--muted)]">
        {t("pro.banner.stats", {
          portfolio: formatPct(portRet),
          benchmark: formatPct(benchRet),
          alpha: formatAlpha(alphaVal),
        })}
      </p>
    </div>
  );
}

function RoundSeedPanel({ round }: { round: ProRoundSnapshot }) {
  const { t } = useI18n();
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
          <p className="ui-section-title mb-1 text-[var(--amber)]">
            {t("pro.seed.regimeMatrix")}
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {regimeEntries.map(([regime, slice]) => (
              <div key={regime} className="border border-[var(--border)] p-2">
                <p className="ui-body mb-1 text-[var(--fg)]">{regime}</p>
                <ul className="ui-body space-y-0.5 text-[var(--muted)]">
                  {Object.entries(slice as Record<string, unknown>).map(([k, v]) => (
                    <li key={k}>
                      <span className="text-[var(--fg)]">{formatParamLabel(k, t)}:</span>{" "}
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
          <p className="ui-section-title mb-1 text-[var(--cyan)]">
            {t("pro.seed.regimeQuotas")}
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {Object.entries(regimeQuotas).map(([regime, slice]) => (
              <div key={regime} className="border border-[var(--border)] p-2">
                <p className="ui-body mb-1 text-[var(--fg)]">{regime}</p>
                <ul className="ui-body space-y-0.5 text-[var(--muted)]">
                  {Object.entries(slice as Record<string, number>).map(([k, v]) => (
                    <li key={k}>
                      <span className="text-[var(--fg)]">{formatParamLabel(k, t)}:</span>{" "}
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
            className={`ui-section-title mb-1 ${
              benchStatus === "below" ? "text-[var(--amber)]" : "text-[var(--fg)]"
            }`}
          >
            {t("pro.seed.assessment")}
          </p>
          <p className="ui-body">{assessment}</p>
        </div>
      ) : null}
      {strategy ? (
        <div className="md:col-span-2">
          <p className="ui-section-title mb-1 text-[var(--amber)]">{t("pro.seed.strategy")}</p>
          <p className="ui-body text-[var(--muted)]">{strategy}</p>
        </div>
      ) : null}
      {setupEntries.length ? (
        <div>
          <p className="ui-section-title mb-1 text-[var(--amber)]">
            {t("pro.seed.roundSetup")}
          </p>
          <ul className="ui-body space-y-0.5 text-[var(--muted)]">
            {setupEntries.map(([k, v]) => (
              <li key={k}>
                <span className="text-[var(--fg)]">{formatParamLabel(k, t)}:</span> {String(v)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {rangeEntries.length || choiceEntries.length ? (
        <div>
          <p className="ui-section-title mb-1 text-[var(--amber)]">{t("pro.seed.factorSearch")}</p>
          <ul className="ui-body space-y-0.5 text-[var(--muted)]">
            {rangeEntries.map(([k, v]) => (
              <li key={k}>
                <span className="text-[var(--fg)]">{formatParamLabel(k, t)}:</span> [{v[0]}, {v[1]}]
              </li>
            ))}
            {choiceEntries.map(([k, v]) => (
              <li key={k}>
                <span className="text-[var(--fg)]">{formatParamLabel(k, t)}:</span> {String(v)} ({t("pro.seed.fixed")})
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
  const { result, request, anchorBenchmarkTicker } = props;
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
      <ul className="ui-body mt-2 space-y-1 text-[var(--muted)]">
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
    const status = round.improved
      ? t("pro.prefix.improved")
      : t("pro.prefix.held");
    const score = round.round_best_adjusted_score?.toFixed(4) ?? "—";
    const label = round.narrative_facts.round_label
      ? String(round.narrative_facts.round_label)
      : t("pro.roundN", { n: round.round });
    return t("pro.prefix.body", {
      label,
      status,
      score,
      trials: round.trials_in_round,
      models: round.candidates.length,
    });
  }, [tab, rounds, t]);

  if (!rounds.length) {
    return <ResultsDashboard {...props} />;
  }

  return (
    <div className="space-y-4">
      <div className="border-2 border-[var(--amber)] bg-[rgba(255,176,0,0.06)] p-3">
        <p className="ui-body mb-2 text-[var(--amber)]">
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
              {t("pro.roundChip", { n: r.round })}
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
                  benchmarkTicker={
                    request.benchmark_ticker ??
                    result.benchmark ??
                    anchorBenchmarkTicker ??
                    "SPY"
                  }
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
