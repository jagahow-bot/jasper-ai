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

/**
 * Build a job-level narrate payload: champion metrics + dates + benchmark + slim pro context.
 * Omits pool_signatures, benchmark series, weight_cap_audit, and full pro round dumps.
 */
export function buildJobNarrativeFacts(
  baseFacts: Record<string, unknown>,
  champion: PortfolioCandidate,
): Record<string, unknown> {
  const sm = champion.analytics?.sample_metrics;
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
      }
    : null;

  const fullMetrics = sm?.full_sample;
  const displaySharpe = fullMetrics?.sharpe ?? champion.sharpe;
  const displayCagr = fullMetrics?.cagr ?? champion.cagr;
  const displayMdd = fullMetrics?.max_drawdown ?? champion.max_drawdown;

  const facts: Record<string, unknown> = {
    narrative_mode: "job_champion",
    model_code: champion.model_code,
    rank: champion.rank,
    is_champion: champion.is_champion === true,
    champion_model_code: baseFacts.champion_model_code,
    ai_champion_model_code: baseFacts.ai_champion_model_code,
    period: baseFacts.period,
    train_period: baseFacts.train_period,
    validation_period: baseFacts.validation_period,
    top_sharpe: champion.sharpe,
    top_max_drawdown: champion.max_drawdown,
    top_cagr: champion.cagr,
    train_sharpe: champion.train_sharpe,
    train_max_drawdown: champion.train_max_drawdown,
    validation_sharpe: champion.validation_sharpe,
    validation_max_drawdown: champion.validation_max_drawdown,
    volatility: champion.volatility,
    sortino: champion.sortino,
    turnover_avg: champion.turnover_avg,
    beta: champion.beta,
    alpha: champion.alpha ?? champion.alpha_annual,
    information_ratio: champion.information_ratio,
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
      train_sharpe: champion.train_sharpe,
      validation_sharpe: champion.validation_sharpe,
      display_sharpe: displaySharpe,
      display_cagr: displayCagr,
      display_max_drawdown: displayMdd,
    },
    oos_enabled: baseFacts.oos_enabled,
    report_analysis_note: baseFacts.report_analysis_note,
    objective: baseFacts.objective,
    objective_input: baseFacts.objective_input,
    objective_label: baseFacts.objective_label,
    trial_scoring_objective: baseFacts.trial_scoring_objective,
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
    regime_adaptive: baseFacts.regime_adaptive,
    dynamic_objectives_used: baseFacts.dynamic_objectives_used,
    current_regime: baseFacts.current_regime,
    is_round_view: baseFacts.is_round_view,
    round_label: baseFacts.round_label,
  };

  return slimNarrativeFacts(facts);
}
