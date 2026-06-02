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
  | "custom";
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

export interface BacktestRequest {
  scenario_id: string;
  max_weight: number;
  objective: Objective;
  backtest_mode: BacktestMode;
  start_date: string;
  end_date: string;
  trials: number;
  top_models: number;
  asset_classes: AssetClass[];
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
  top_n: number;
  max_turnover: number;
  objective_custom_text?: string | null;
  param_controls?: Record<string, ParamControl>;
  optimization_mode?: OptimizationMode;
  enable_iterative_refinement?: boolean;
  refinement_batch_size?: number;
  refinement_challengers_per_round?: number;
  refinement_max_rounds?: number;
  refinement_patience?: number;
  refinement_min_improvement?: number;
  overfitting_penalty_weight?: number;
  experiment?: ExperimentRequest;
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

export interface PortfolioCandidate {
  rank: number;
  model_code?: string | null;
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
}

export type WizardPhase =
  | "scenario"
  | "constraints"
  | "running"
  | "results"
  | "export";

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

export interface RegimeScoreTimelinePoint {
  date: string;
  risk_off_score?: number;
  risk_on_score?: number;
  neutral_score?: number | null;
  active_regime: string;
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
  regime_score_timeline?: RegimeScoreTimelinePoint[];
  current_regime: Record<string, unknown>;
  periods: Record<string, unknown>;
  benchmark_ticker: string;
  regime_mode: string;
  universe_stats: Record<string, unknown>;
}
