import type { AssetClass } from "./constants";

export type Objective =
  | "max_sharpe"
  | "max_return"
  | "min_max_drawdown"
  | "max_sortino"
  | "min_cvar"
  | "risk_parity_erc"
  | "max_diversification"
  | "mean_variance_utility"
  | "custom"
  | "dynamic";
export type BacktestMode = "static";
/** standard = 固定試驗次數；pro_auto = 冠軍-挑戰者迭代收斂 */
export type OptimizationMode = "standard" | "pro_auto";
export type JobStatus = "pending" | "running" | "completed" | "failed";
export type ParamControlMode = "fixed" | "search" | "off";
export type ExperimentalRegimeMode = "auto" | "risk_off" | "neutral" | "risk_on";

export interface ParamControl {
  mode: ParamControlMode;
  fixed?: number | string | null;
  min?: number | null;
  max?: number | null;
  step?: number | null;
  options?: string[] | null;
}

export interface ExperimentRequest {
  enabled: boolean;
  mode: "objective_switch";
  regime_mode: ExperimentalRegimeMode;
  note?: string | null;
  /** Run second lightweight Optuna pass under switch objective (standard mode) */
  run_ab_evaluation?: boolean;
}

export interface ScenarioCard {
  id: string;
  title: string;
  subtitle: string;
  narrative_points: string[];
  defaults: {
    max_weight: number;
    objective: Objective;
    backtest_mode: BacktestMode;
    start_date: string;
    end_date: string;
  };
  /** AI 自訂情境建議的資產類別篩選 */
  suggested_asset_classes?: AssetClass[];
}

/**
 * Structured client needs forwarded from the signed RM overlay.
 * Drives the soft drawdown-tolerance penalty in trial scoring and the
 * CLIENT NEEDS block in AI seed / learning prompts.
 */
export interface ClientContext {
  risk_tolerance?: "conservative" | "moderate" | "aggressive" | null;
  investment_horizon_years?: number | null;
  /** Client's max tolerable drawdown (0–1); breaching trials are penalized. */
  max_drawdown_tolerance?: number | null;
  income_need_pct?: number | null;
  /** Soft cap on any single holding weight (0–1). */
  max_single_name_pct?: number | null;
  /** Soft cap on concentrated theme / growth-equity sleeve. */
  theme_exposure_cap_pct?: number | null;
  /** Minimum uninvested cash sleeve the client wants retained. */
  cash_reserve_pct?: number | null;
  /** Plain-language client view, shown to AI prompts only. */
  needs_summary?: string | null;
  /** RM/AI market stance from the overlay; prompt-only. */
  market_stance?: "risk_on" | "neutral" | "risk_off" | null;
  /** RM/AI investment themes from the overlay; prompt-only, max 5. */
  market_themes?: string[] | null;
  /** Signed overlay sleeve targets — enforced in engine simulate. */
  group_weight_bands?: GroupWeightBand[] | null;
}

export interface GroupWeightBand {
  group_id?: string | null;
  tickers: string[];
  target_pct?: number | null;
  min_pct?: number | null;
  max_pct?: number | null;
}

export interface BacktestRequest {
  scenario_id: string;
  max_weight: number;
  /** Minimum holding weight; smaller positions dropped before sim/display */
  min_weight?: number;
  objective: Objective;
  /**
   * Regime-adaptive allocation: allocator preset switches by market regime
   * (risk_off/neutral/risk_on) while the chosen objective still drives ranking.
   * objective="dynamic" implies this and also ranks on the blended composite score.
   */
  regime_adaptive?: boolean;
  backtest_mode: BacktestMode;
  start_date: string;
  end_date: string;
  trials: number;
  top_models: number;
  asset_classes: AssetClass[];
  /** Hard-enforce sleeve weights when w_equity/w_bond/regime quotas are set */
  enforce_class_weights?: boolean;
  universe_categories?: string[] | null;
  universe_tickers?: string[] | null;
  /** AI supplement tickers unioned onto base pool; pinned/guaranteed in backtest after refine */
  universe_supplement_tickers?: string[] | null;
  universe_filter_text?: string | null;
  /** Stacked AI universe rules (AND); legacy jobs may only have universe_filter_text */
  universe_filter_prompts?: string[] | null;
  enable_oos: boolean;
  train_ratio: number;
  fee_bps: number;
  rebalance_freq: string;
  top_n?: number | null;
  /** Maximum portfolio holdings (non-zero positions) per rebalance; slider range 1–50 */
  max_holdings?: number;
  max_turnover: number;
  objective_custom_text?: string | null;
  param_controls?: Record<string, ParamControl>;
  optimization_mode?: OptimizationMode;
  enable_iterative_refinement?: boolean;
  refinement_batch_size?: number;
  refinement_challengers_per_round?: number;
  refinement_max_rounds?: number;
  refinement_patience?: number | null;
  refinement_min_improvement?: number;
  experiment?: ExperimentRequest;
  /** UI locale (en/zh/ko) forwarded so AI-generated prose matches the user's language. */
  report_language?: string;
  /** Optional email to notify when the (server-side) job finishes or fails. */
  notify_email?: string | null;
  /** Demo/client id so email deep links can restore the customized report. */
  client_ref?: string | null;
  /** Paired anchor static-replay job for dual-track RmReportView restore. */
  anchor_job_id?: string | null;
  /** UI id of the model / holdings anchor used for customization. */
  anchor_portfolio_id?: string | null;
  /** Prior job to continue refinement from (server-side warm start). */
  continue_from_job_id?: string | null;
  extra_refinement_rounds?: number | null;
  extra_trials_per_round?: number | null;
  extra_trials?: number | null;
  /** Fixed ticker weights for anchor static replay (skips Optuna). */
  static_replay_holdings?: Record<string, number> | null;
  /** Explicit benchmark for metrics and AI narratives; overrides AI universe pick. */
  benchmark_ticker?: string | null;
  /**
   * Maximum deviation from the anchor model portfolio weights.
   * 0 = hold the anchor exactly, 1 = allow full customization.
   */
  customization_drift?: number;
  /**
   * UI-only: Overlay confirm-time minimum drift floor (RmRunPanel marker / audit).
   * Not sent to the engine — createJob strips it (same as top_n).
   */
  overlay_drift_floor?: number | null;
  /** Anchor model portfolio weights used by the drift constraint. */
  anchor_weights?: Record<string, number> | null;
  /** Structured client needs from the signed overlay (soft constraints + AI context). */
  client_context?: ClientContext | null;
  /** Permanent uninvested cash sleeve (risky weights sum to 1 − this). */
  cash_reserve_pct?: number;
  cash_return_mode?: "risk_free" | "zero";
  /** Annual risk-free rate for cash returns and Sharpe excess. */
  risk_free_rate?: number;
  /** DCA horizon in months; omit for lump-sum. */
  deployment_months?: number | null;
  /** Equal DCA steps; defaults to deployment_months. */
  deployment_tranches?: number | null;
}

export interface ConvergencePreviewPoint {
  trial: number;
  round: number;
  is_objective: number;
  oos_objective?: number | null;
  gap_objective?: number;
  overfitting_penalty?: number;
  overfitting_risk?: string;
  is_champion?: boolean;
  objective_label?: string;
}

export interface PortfolioVsBenchmark {
  portfolio_cagr?: number;
  portfolio_sharpe?: number;
  portfolio_max_drawdown?: number;
  benchmark_total_return_pct?: number | null;
  portfolio_total_return_pct?: number | null;
  beta?: number | null;
  alpha?: number | null;
  information_ratio?: number | null;
  tracking_error?: number | null;
}

export interface JobProgress {
  status: JobStatus;
  message: string;
  trial: number;
  trials_total: number;
  best_sharpe: number | null;
  refinement_round?: number;
  refinement_rounds_total?: number;
  convergence_preview?: ConvergencePreviewPoint[] | null;
  round_benchmark_status?: "above" | "below" | "unknown" | null;
  round_benchmark_alpha?: number | null;
  round_portfolio_vs_benchmark?: PortfolioVsBenchmark | null;
}

export interface JobSummary {
  job_id: string;
  created_at: string;
  status: JobStatus;
  start_date: string;
  end_date: string;
  objective: string;
  optimization_mode: string;
  scenario_id?: string | null;
  champion_model_code?: string | null;
  champion_cagr?: number | null;
  champion_sharpe?: number | null;
}

export interface PortfolioCandidate {
  rank: number;
  model_code?: string | null;
  is_champion?: boolean;
  weights: Record<string, number>;
  sharpe: number;
  max_drawdown: number;
  cagr: number;
  volatility: number;
  sortino?: number | null;
  calmar?: number | null;
  var_95?: number | null;
  cvar_95?: number | null;
  win_rate?: number | null;
  turnover_avg?: number | null;
  turnover_total?: number | null;
  max_drawdown_duration_days?: number | null;
  equity_curve?: { date: string; value: number }[] | null;
  params?: Record<string, unknown> | null;
  train_sharpe?: number | null;
  train_max_drawdown?: number | null;
  validation_sharpe?: number | null;
  validation_max_drawdown?: number | null;
  analytics?: CandidateAnalytics | null;
  beta?: number | null;
  alpha?: number | null;
  alpha_annual?: number | null;
  tracking_error?: number | null;
  information_ratio?: number | null;
  /** Client-floor check vs signed overlay (drawdown tolerance). */
  needs_attainment?: {
    max_drawdown_tolerance?: number;
    max_drawdown_actual?: number;
    within_drawdown_tolerance?: boolean;
    drawdown_breach_pct?: number;
    max_single_name_pct?: number;
    max_single_name_actual?: number;
    within_single_name_cap?: boolean;
    theme_exposure_cap_pct?: number;
    theme_exposure_actual?: number;
    within_theme_cap?: boolean;
    cash_reserve_pct?: number;
    cash_weight_actual?: number;
    within_cash_reserve?: boolean;
    income_need_pct?: number;
    income_actual?: number;
    within_income_need?: boolean;
    must_include_tickers?: string[];
    missing_must_include?: string[];
    within_must_include?: boolean;
    customization_drift_cap?: number;
    customization_drift_l1?: number;
    within_customization_drift?: boolean;
    all_floors_met?: boolean;
  } | null;
}

export interface ProposalCard {
  model_code: string;
  label: string;
  is_recommended: boolean;
  sharpe: number;
  cagr: number;
  max_drawdown: number;
  objective_score?: number | null;
  needs_attainment?: PortfolioCandidate["needs_attainment"];
}

/** Lazy-loaded trajectory/holdings payload for one candidate trial. */
export interface CandidateChartsPayload {
  model_code: string;
  equity_curve: { date: string; value: number }[];
  weight_history: ({ date: string } & Record<string, number | string>)[];
  weight_history_tickers: string[];
  benchmark_equity_curve: { date: string; value: number }[];
  weight_cap_audit?: Record<string, unknown> | null;
  /** Deep analytics for InstitutionalReport (rolling, periodic, drawdown, risk). */
  institutional?: Partial<CandidateAnalytics> | null;
}

export interface CandidateAnalytics {
  benchmark_relative?: Record<string, number>;
  periodic_returns?: {
    monthly?: { period: string; return: number }[];
    annual?: { period: string; return: number }[];
  };
  periodic_returns_scope?: "in_sample" | "full_sample";
  periodic_returns_holdout?: {
    monthly?: { period: string; return: number }[];
    annual?: { period: string; return: number }[];
  };
  rolling?: {
    rolling_sharpe?: { date: string; value: number }[];
    rolling_vol?: { date: string; value: number }[];
  };
  drawdown_episodes?: {
    start: string;
    trough: string;
    end: string;
    depth: number;
    days: number;
  }[];
  drawdown_series?: { date: string; value: number }[];
  exposure?: {
    by_asset_class?: Record<string, number>;
    by_asset_bucket?: Record<string, number>;
    equity_pct?: number;
    bond_pct?: number;
    other_pct?: number;
    duration_proxy_years?: number;
  };
  /** Average rebalance-snapshot mix grouped by active market regime. */
  exposure_by_regime?: Record<string, Record<string, number>>;
  risk_contribution?: {
    ticker: string;
    weight: number;
    risk_contrib: number;
  }[];
  factor_summary?: {
    factor_contribution?: Record<string, number>;
    factor_indicator_logic?: Record<string, string>;
    factor_observations?: number;
  };
  sample_metrics?: {
    selection?: string;
    train_ratio?: number;
    train_start?: string;
    train_end?: string;
    val_start?: string;
    objective?: string;
    objective_label?: string;
    in_sample?: Record<string, number>;
    out_of_sample?: Record<string, number> | null;
    full_sample?: Record<string, number>;
    gap?: { objective?: number | null; sharpe?: number | null };
  };
  weight_history?: ({ date: string } & Record<string, number | string>)[];
  weight_history_tickers?: string[];
  benchmark_equity_curve?: { date: string; value: number }[];
  weight_cap_audit?: Record<string, unknown>;
}

export interface ProRoundSnapshot {
  round: number;
  improved: boolean;
  trials_in_round: number;
  round_best_adjusted_score?: number | null;
  incoming_champion_model_code?: string | null;
  round_winner_model_code?: string | null;
  round_challenger_model_codes?: string[];
  pool_model_codes?: string[];
  round_setup?: Record<string, unknown>;
  regime_setups?: Record<string, Record<string, unknown>>;
  regime_matrix_enabled?: boolean;
  regime_factor_ranges?: Record<string, Record<string, [number, number] | number[]>>;
  regime_factor_matrix_enabled?: boolean;
  regime_class_quotas?: Record<string, Record<string, number>>;
  regime_class_quota_matrix_enabled?: boolean;
  factor_ranges?: Record<string, [number, number] | number[]>;
  factor_choices?: Record<string, string>;
  optimization_strategy?: string;
  performance_assessment?: string;
  benchmark_status?: "above" | "below" | "unknown" | null;
  beats_benchmark?: boolean | null;
  benchmark_alpha?: number | null;
  portfolio_vs_benchmark?: PortfolioVsBenchmark | null;
  candidates: PortfolioCandidate[];
  equity_curve: { date: string; value: number }[];
  efficient_frontier: {
    volatility: number;
    return: number;
    sharpe: number;
    score: number;
    params?: Record<string, unknown>;
  }[];
  narrative_facts: Record<string, unknown>;
}

export interface BacktestResult {
  job_id: string;
  scenario_id: string;
  benchmark: string;
  period: { start: string; end: string };
  candidates: PortfolioCandidate[];
  equity_curve: { date: string; value: number }[];
  efficient_frontier: {
    volatility: number;
    return: number;
    sharpe: number;
    score: number;
    params?: Record<string, unknown>;
  }[];
  narrative_facts: Record<string, unknown>;
  dynamic_objective_timeline?: DynamicObjectiveTimelinePoint[] | null;
  dynamic_objective_benchmark_series?: BenchmarkSeriesPoint[] | null;
  pro_rounds?: ProRoundSnapshot[] | null;
  experimental?: {
    mode?: string;
    enabled?: boolean;
    requested_regime_mode?: string;
    resolved_regime_signal?: string;
    chosen_objective?: string;
    reason?: string;
    benchmark_ticker?: string;
    lookback_days?: number;
    regime_switch_count?: number;
    regime_labels_sample?: string[];
    evaluation?: Record<string, unknown>;
  } | null;
  /** 2–3 trade-off proposals (recommended / defensive / growth) for RM comparison. */
  proposal_set?: ProposalCard[] | null;
  /** Phase 0+ stage catalog pin (legacy jobs → v0-legacy). */
  stage_catalog_version?: string | null;
  stage_implementations?: Record<string, string> | string | null;
  param_catalog_version?: number | null;
  capabilities_used?: Array<{
    stage: string;
    implementation_id: string;
    version: string;
    status: "rm_confirmed" | "approved";
    pending_supervisor_signoff?: boolean;
  }> | null;
}

export type WizardPhase =
  | "scenario"
  | "overlay"
  | "constraints"
  | "running"
  | "results"
  | "export";

/** Dual-track personalization: anchor (base) vs overlay-adjusted run. */
export type PersonalizationCompare = {
  anchorPortfolioId: string;
  anchorLabel: string;
  customizedLabel: string;
  baseResult: BacktestResult;
  baseRequest: BacktestRequest;
  adjustedResult: BacktestResult;
  adjustedRequest: BacktestRequest;
};

export type LabRecommendation = "APPLY" | "NOT_YET" | "NEED_MORE_DATA";
export type RegimeDetectorVersion = "v1" | "v2";

export interface ObjectiveSwitchLabRequest {
  start_date: string;
  end_date: string;
  benchmark_ticker?: string | null;
  regime_mode: ExperimentalRegimeMode;
  fixed_objective: Objective;
  asset_classes?: string[] | null;
  enable_oos: boolean;
  train_ratio: number;
  cooldown_steps?: number;
  confirm_steps?: number;
  regime_detector_version?: RegimeDetectorVersion;
  fast_risk_off_exit?: boolean;
}

export interface LabArmMetrics {
  sharpe: number;
  cagr: number;
  max_drawdown: number;
  return_pct?: number;
}

export interface RegimeQualityBucket {
  segment_count: number;
  avg_segment_return: number | null;
  avg_segment_vol: number | null;
  hit_rate: number | null;
  median_length_days: number | null;
  expectation: string;
}

export interface RegimeSegmentEpisode {
  regime: string;
  start_date: string;
  end_date: string;
  length_days: number;
  segment_return: number;
  segment_vol: number;
  segment_max_drawdown: number;
  aligned_with_regime: boolean;
  miss_reason?: string | null;
}

export interface Forward21dRegimeBucket {
  sample_count: number;
  avg_forward_return: number | null;
  avg_forward_vol: number | null;
  hit_rate: number | null;
  expectation: string;
}

export interface Forward21dDiagnostic {
  regime_quality: Record<string, Forward21dRegimeBucket>;
  switch_timing: {
    date: string;
    from_regime: string;
    to_regime: string;
    forward_return: number;
    forward_vol: number;
    aligned_with_new_regime: boolean;
    note: string;
  }[];
  switch_timing_summary: {
    switch_events: number;
    hit_rate: number | null;
    avg_forward_return: number | null;
  };
  overall_alignment_score: number | null;
  forward_horizon_days: number;
  forward_vol_median?: number;
  explanations?: string[];
}

export interface RegimePredictionQuality {
  regime_quality: Record<string, RegimeQualityBucket>;
  segment_episodes?: RegimeSegmentEpisode[];
  notable_segments?: {
    longest: RegimeSegmentEpisode[];
    failed: RegimeSegmentEpisode[];
  };
  overall_alignment_score: number | null;
  alignment_grade: string | null;
  explanations: string[];
  evaluation_mode?: string;
  segment_vol_median?: number;
  forward_21d_diagnostic?: Forward21dDiagnostic;
}

export interface BenchmarkSeriesPoint {
  date: string;
  cumulative_return_pct: number;
  price_index: number;
}

/** Walk-forward regime step shared by lab results and dynamic Jasper timelines. */
export type RegimeTimelineStep = {
  date: string;
  regime: string;
  active_regime?: string;
  objective?: string;
  switched?: boolean;
  trailing_return?: number;
  annualized_vol?: number;
  raw_regime?: string | null;
  risk_off_score?: number;
  risk_on_score?: number;
  neutral_score?: number;
};

export interface DynamicObjectiveTimelinePoint {
  date: string;
  regime: string;
  objective: string;
  switched?: boolean;
  raw_regime?: string | null;
}

export interface RegimeScoreTimelinePoint {
  date: string;
  risk_off_score?: number;
  risk_on_score?: number;
  neutral_score?: number | null;
  active_regime: string;
  raw_regime?: string;
  score_winner?: string;
  switched: boolean;
}

export interface ObjectiveSwitchLabResult {
  disclaimer: string;
  limitation: string;
  recommendation: LabRecommendation;
  headline: string;
  oos_sharpe_delta_switch_minus_fixed: number | null;
  fixed_arm: {
    label: string;
    objective: string;
    in_sample: LabArmMetrics;
    out_of_sample: LabArmMetrics | null;
    switch_count: number;
  };
  switch_arm: {
    label: string;
    objective: string;
    in_sample: LabArmMetrics;
    out_of_sample: LabArmMetrics | null;
    switch_count: number;
  };
  regime_timeline: {
    date: string;
    regime: string;
    active_regime?: string;
    objective: string;
    switched?: boolean;
    trailing_return?: number;
    annualized_vol?: number;
    raw_regime?: string;
    risk_off_score?: number;
    risk_on_score?: number;
    neutral_score?: number;
  }[];
  regime_prediction_quality?: RegimePredictionQuality;
  benchmark_series?: BenchmarkSeriesPoint[];
  detector_version?: RegimeDetectorVersion;
  fast_risk_off_exit?: boolean | null;
  regime_score_timeline?: RegimeScoreTimelinePoint[];
  current_regime: Record<string, unknown>;
  periods: Record<string, unknown>;
  benchmark_ticker: string;
  regime_mode: string;
  universe_stats: Record<string, unknown>;
}
