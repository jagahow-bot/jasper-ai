import type { PortfolioCandidate } from "./types";

/**
 * Strip chart/UI-only fields from narrative_facts before Gemini narrate calls.
 * Full facts remain in job results for the dashboard; only the LLM prompt is slimmed.
 */
export function slimNarrativeFacts(
  facts: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...facts };

  delete out.dynamic_objective_benchmark_series;
  delete out.dynamic_objective_timeline;
  delete out.weight_cap_audit;
  delete out.portfolio_catalog;
  delete out.oos_leaderboard;
  delete out.efficient_frontier;
  delete out.universe_refine;
  delete out.universe_filter_prompts;
  delete out.allocator;

  const pro = out.pro_refinement;
  if (pro && typeof pro === "object" && !Array.isArray(pro)) {
    const proRec = pro as Record<string, unknown>;
    delete proRec.convergence_history;
    const perRound = proRec.per_round;
    if (Array.isArray(perRound)) {
      out.pro_refinement = {
        ...proRec,
        per_round: perRound.map((row) => {
          if (!row || typeof row !== "object" || Array.isArray(row)) return row;
          const r = { ...(row as Record<string, unknown>) };
          delete r.pool_signatures;
          delete r.records;
          return r;
        }),
      };
    }
  }

  return out;
}

export function narrativeCacheKey(
  candidate: Pick<PortfolioCandidate, "model_code" | "rank">,
): string {
  return `${candidate.model_code ?? "?"}:${candidate.rank}`;
}

type CandidateNarrativeOptions = {
  championModelCode?: string | null;
  aiRecommendedModelCode?: string | null;
};

/**
 * Build a single-candidate narrate payload: metrics + dates + benchmark + slim pro context.
 * Omits pool_signatures, benchmark series, weight_cap_audit, and full pro round dumps.
 */
export function buildCandidateNarrativeFacts(
  baseFacts: Record<string, unknown>,
  candidate: PortfolioCandidate,
  options?: CandidateNarrativeOptions,
): Record<string, unknown> {
  const sm = candidate.analytics?.sample_metrics;
  const spec = baseFacts.backtest_spec as Record<string, unknown> | undefined;
  const dq = baseFacts.data_quality as Record<string, unknown> | undefined;
  const proFull = baseFacts.pro_refinement as Record<string, unknown> | null | undefined;

  const proSummary = proFull
    ? {
        rounds_completed: proFull.rounds_completed,
        stopped_reason: proFull.stopped_reason,
        champion_adjusted_score: proFull.champion_adjusted_score,
        champion_model_code:
          proFull.champion_model_code ?? baseFacts.champion_model_code,
        refinement_max_rounds: proFull.refinement_max_rounds,
        refinement_patience: proFull.refinement_patience,
      }
    : null;

  const fullMetrics = sm?.full_sample;
  const displaySharpe = fullMetrics?.sharpe ?? candidate.sharpe;
  const displayCagr = fullMetrics?.cagr ?? candidate.cagr;
  const displayMdd = fullMetrics?.max_drawdown ?? candidate.max_drawdown;

  const facts: Record<string, unknown> = {
    narrative_mode: "single_candidate",
    model_code: candidate.model_code,
    rank: candidate.rank,
    is_champion: candidate.is_champion === true,
    champion_model_code:
      options?.championModelCode ?? baseFacts.champion_model_code,
    ai_recommended_model_code:
      options?.aiRecommendedModelCode ?? baseFacts.ai_recommended_model_code,
    period: baseFacts.period,
    train_period: baseFacts.train_period,
    validation_period: baseFacts.validation_period,
    top_sharpe: candidate.sharpe,
    top_max_drawdown: candidate.max_drawdown,
    top_cagr: candidate.cagr,
    train_sharpe: candidate.train_sharpe,
    train_max_drawdown: candidate.train_max_drawdown,
    validation_sharpe: candidate.validation_sharpe,
    validation_max_drawdown: candidate.validation_max_drawdown,
    volatility: candidate.volatility,
    sortino: candidate.sortino,
    turnover_avg: candidate.turnover_avg,
    beta: candidate.beta,
    alpha: candidate.alpha ?? candidate.alpha_annual,
    information_ratio: candidate.information_ratio,
    report_horizons: {
      oos_enabled: baseFacts.oos_enabled,
      selection_basis: sm?.selection,
      periods: {
        in_sample: baseFacts.train_period,
        out_of_sample: baseFacts.validation_period,
        full_sample: baseFacts.period,
      },
      in_sample: sm?.in_sample,
      out_of_sample: sm?.out_of_sample,
      full_sample: sm?.full_sample,
      gap: sm?.gap,
      train_sharpe: candidate.train_sharpe,
      validation_sharpe: candidate.validation_sharpe,
      display_sharpe: displaySharpe,
      display_cagr: displayCagr,
      display_max_drawdown: displayMdd,
    },
    oos_enabled: baseFacts.oos_enabled,
    report_analysis_note: baseFacts.report_analysis_note,
    objective: baseFacts.objective,
    objective_label: baseFacts.objective_label,
    optimization_mode: baseFacts.optimization_mode,
    backtest_spec: spec
      ? {
          fee_bps: spec.fee_bps,
          rebalance_freq: spec.rebalance_freq,
          benchmark: spec.benchmark,
          risk_free_rate: spec.risk_free_rate,
        }
      : undefined,
    max_weight_constraint: baseFacts.max_weight_constraint,
    max_weight_observed: baseFacts.max_weight_observed,
    max_weight_trial_param: baseFacts.max_weight_trial_param,
    max_weight_effective_cap: baseFacts.max_weight_effective_cap,
    rebalance_freq: baseFacts.rebalance_freq,
    trials_requested: baseFacts.trials_requested,
    trials_feasible: baseFacts.trials_feasible,
    models_returned: baseFacts.models_returned,
    backtest_methodology: baseFacts.backtest_methodology,
    pro_refinement: proSummary,
    data_quality: dq
      ? {
          start: dq.start,
          end: dq.end,
          rows: dq.rows,
        }
      : undefined,
    engine: baseFacts.engine,
    data_source: baseFacts.data_source,
    metrics_trustworthy: baseFacts.metrics_trustworthy,
    dynamic_objective_mode: baseFacts.dynamic_objective_mode,
    dynamic_objectives_used: baseFacts.dynamic_objectives_used,
    current_regime: baseFacts.current_regime,
    is_round_view: baseFacts.is_round_view,
    round_label: baseFacts.round_label,
  };

  return slimNarrativeFacts(facts);
}
