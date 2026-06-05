from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class Objective(str, Enum):
    max_sharpe = "max_sharpe"
    max_return = "max_return"
    min_max_drawdown = "min_max_drawdown"
    max_sortino = "max_sortino"
    min_cvar = "min_cvar"
    risk_parity_erc = "risk_parity_erc"
    max_diversification = "max_diversification"
    mean_variance_utility = "mean_variance_utility"
    custom = "custom"
    dynamic = "dynamic"


class BacktestMode(str, Enum):
    static = "static"


class OptimizationMode(str, Enum):
    """standard: fixed trial count; pro_auto: champion-challenger until convergence."""

    standard = "standard"
    pro_auto = "pro_auto"


class JobStatus(str, Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class ParamControl(BaseModel):
    mode: Literal["fixed", "search", "off"] = "search"
    fixed: float | str | None = None
    min: float | None = None
    max: float | None = None
    step: float | None = None
    options: list[str] | None = None


class ExperimentConfig(BaseModel):
    """Explicitly opt-in sandbox knobs for non-production experiments."""

    enabled: bool = False
    mode: Literal["objective_switch"] = "objective_switch"
    regime_mode: Literal["auto", "risk_off", "neutral", "risk_on"] = "auto"
    note: str | None = None
    run_ab_evaluation: bool = Field(
        default=False,
        deprecated=True,
        description="Deprecated — use POST /lab/objective-switch/evaluate instead.",
    )


class BacktestRequest(BaseModel):
    scenario_id: str
    # User-facing cap. Engine/Optuna may choose a stricter cap <= this value.
    max_weight: float = Field(ge=0.0, le=1.0)
    min_weight: float = Field(
        default=0.005,
        ge=0.0,
        le=0.05,
        description=(
            "Minimum holding weight after allocation; smaller positions are dropped "
            "and survivors renormalized before simulation/display"
        ),
    )
    objective: Objective
    backtest_mode: BacktestMode = BacktestMode.static
    start_date: str = "2018-01-01"
    end_date: str = "2024-12-31"
    trials: int = Field(
        default=50,
        ge=5,
        le=200,
        description="Optuna parameter search trials (not the same as output models)",
    )
    top_models: int = Field(
        default=5,
        ge=1,
        le=20,
        description="How many ranked portfolio models to return from trials",
    )
    asset_classes: list[str] | None = Field(
        default=None,
        description="Filter universe: equity, bond, commodity, real_estate, alternative",
    )
    universe_categories: list[str] | None = Field(
        default=None,
        description="Optional universe category tags (e.g. us_sector, treasury)",
    )
    universe_tickers: list[str] | None = Field(
        default=None,
        description="Legacy optional ticker whitelist (prefer universe_supplement_tickers)",
    )
    universe_supplement_tickers: list[str] | None = Field(
        default=None,
        description=(
            "AI-discovered tickers unioned onto the asset-class base pool; "
            "pinned/guaranteed after refine_universe_with_ai (cannot be dropped)"
        ),
    )
    universe_filter_text: str | None = Field(
        default=None,
        description="Natural-language universe filter the user applied via AI (legacy single prompt)",
    )
    universe_filter_prompts: list[str] | None = Field(
        default=None,
        description="Stacked natural-language universe filter rules (AND semantics)",
    )
    enable_oos: bool = Field(
        default=True,
        description="Holdout tail: optimize/rank on in-sample only; report holdout OOS metrics separately",
    )
    train_ratio: float = Field(default=0.7, ge=0.5, le=0.85)
    fee_bps: float = Field(default=10.0, ge=0.0, le=50.0)
    rebalance_freq: str = Field(default="QE", description="Pandas offset alias, e.g. QE, ME")
    top_n: int = Field(default=50, ge=5, le=120, description="Factor selection: pick top N assets each rebalance")
    max_holdings: int = Field(
        default=30,
        ge=1,
        le=50,
        description="Maximum portfolio holdings (non-zero positions) per rebalance",
    )
    max_turnover: float = Field(
        default=1.0,
        ge=0.0,
        le=2.0,
        description="Max one-way turnover per rebalance (AI may choose stricter)",
    )
    objective_custom_text: str | None = Field(
        default=None,
        description="Optional natural-language objective when objective=custom",
    )
    param_controls: dict[str, ParamControl] | None = Field(
        default=None,
        description="Per-parameter control: fixed/search/off with optional bounds",
    )
    optimization_mode: OptimizationMode = Field(
        default=OptimizationMode.standard,
        description="standard = single-pass search; pro_auto = iterative AI convergence",
    )
    enable_iterative_refinement: bool = Field(
        default=False,
        description="Deprecated alias; set True when optimization_mode=pro_auto",
    )
    refinement_batch_size: int = Field(
        default=5,
        ge=3,
        le=100,
        description="Trials in the first refinement round",
    )
    refinement_challengers_per_round: int = Field(
        default=4,
        ge=2,
        le=100,
        description="New challenger trials per subsequent round",
    )
    refinement_max_rounds: int = Field(
        default=8,
        ge=1,
        le=30,
        description="Maximum refinement rounds (including first batch)",
    )
    refinement_patience: int = Field(
        default=2,
        ge=1,
        le=10,
        description="Stop after this many rounds without meaningful improvement",
    )
    refinement_min_improvement: float = Field(
        default=0.01,
        ge=0.0,
        le=1.0,
        description="Minimum adjusted-score gain to count as improvement",
    )
    experiment: ExperimentConfig | None = Field(
        default=None,
        description="Optional sandbox experiment config; ignored unless explicitly enabled.",
    )

    def resolved_universe_filter_prompts(self) -> list[str]:
        """Merged stacked prompts + legacy single-line filter."""
        from_list = [p.strip() for p in (self.universe_filter_prompts or []) if p and p.strip()]
        legacy = (self.universe_filter_text or "").strip()
        if not from_list:
            return [legacy] if legacy else []
        if not legacy:
            return from_list
        joined = "; ".join(from_list)
        if legacy == joined:
            return from_list
        if legacy in from_list:
            return from_list
        return [legacy, *from_list]


class JobProgress(BaseModel):
    status: JobStatus
    message: str
    trial: int = 0
    trials_total: int = 0
    best_sharpe: float | None = None
    refinement_round: int = 0
    refinement_rounds_total: int = 0
    convergence_preview: list[dict[str, Any]] | None = None
    round_benchmark_status: str | None = None
    round_benchmark_alpha: float | None = None
    round_portfolio_vs_benchmark: dict[str, Any] | None = None


class PortfolioCandidate(BaseModel):
    rank: int
    model_code: str | None = None
    is_champion: bool = False
    weights: dict[str, float]
    sharpe: float
    max_drawdown: float
    cagr: float
    volatility: float
    sortino: float | None = None
    calmar: float | None = None
    var_95: float | None = None
    cvar_95: float | None = None
    win_rate: float | None = None
    turnover_avg: float | None = None
    turnover_total: float | None = None
    max_drawdown_duration_days: int | None = None
    equity_curve: list[dict[str, Any]] | None = None
    params: dict[str, Any] | None = None
    train_sharpe: float | None = None
    train_max_drawdown: float | None = None
    validation_sharpe: float | None = None
    validation_max_drawdown: float | None = None
    analytics: dict[str, Any] | None = None
    beta: float | None = None
    alpha: float | None = None
    alpha_annual: float | None = None
    tracking_error: float | None = None
    information_ratio: float | None = None


class DynamicObjectiveTimelinePoint(BaseModel):
    """Walk-forward regime step with effective allocator objective."""

    date: str
    regime: str
    objective: str
    switched: bool = False
    raw_regime: str | None = None


class ProRoundSnapshot(BaseModel):
    """One Pro refinement round, same report shape as the final result."""

    round: int
    improved: bool = False
    trials_in_round: int = 0
    round_best_adjusted_score: float | None = None
    incoming_champion_model_code: str | None = None
    round_winner_model_code: str | None = None
    round_challenger_model_codes: list[str] = Field(default_factory=list)
    pool_model_codes: list[str] = Field(default_factory=list)
    round_setup: dict[str, Any] = Field(default_factory=dict)
    regime_setups: dict[str, Any] = Field(default_factory=dict)
    regime_matrix_enabled: bool = False
    regime_factor_ranges: dict[str, Any] = Field(default_factory=dict)
    regime_factor_matrix_enabled: bool = False
    factor_ranges: dict[str, Any] = Field(default_factory=dict)
    factor_choices: dict[str, Any] = Field(default_factory=dict)
    optimization_strategy: str = ""
    performance_assessment: str = ""
    benchmark_status: str | None = None
    beats_benchmark: bool | None = None
    benchmark_alpha: float | None = None
    portfolio_vs_benchmark: dict[str, Any] | None = None
    candidates: list[PortfolioCandidate]
    equity_curve: list[dict[str, Any]]
    efficient_frontier: list[dict[str, Any]]
    narrative_facts: dict[str, Any] = Field(default_factory=dict)


class BacktestResult(BaseModel):
    job_id: str
    scenario_id: str
    benchmark: str = "SPY"
    period: dict[str, str]
    candidates: list[PortfolioCandidate]
    equity_curve: list[dict[str, Any]]
    # Frontier points are diagnostic; may include extra fields like sampled params.
    efficient_frontier: list[dict[str, Any]]
    narrative_facts: dict[str, Any]
    pro_rounds: list[ProRoundSnapshot] | None = None
    experimental: dict[str, Any] | None = None
    dynamic_objective_timeline: list[DynamicObjectiveTimelinePoint] | None = None
    dynamic_objective_benchmark_series: list[dict[str, Any]] | None = None


class ScenarioCard(BaseModel):
    id: str
    title: str
    subtitle: str
    narrative_points: list[str]
    defaults: dict[str, Any]


LabRecommendation = Literal["APPLY", "NOT_YET", "NEED_MORE_DATA"]


class ObjectiveSwitchLabRequest(BaseModel):
    """Standalone lab evaluation — never enqueued as a backtest job."""

    start_date: str = "2018-01-01"
    end_date: str = "2024-12-31"
    benchmark_ticker: str | None = "SPY"
    regime_mode: Literal["auto", "risk_off", "neutral", "risk_on"] = "auto"
    fixed_objective: Objective = Objective.max_sharpe
    asset_classes: list[str] | None = Field(
        default=None,
        description="Universe filter for tradable pool stats only",
    )
    enable_oos: bool = True
    train_ratio: float = Field(default=0.7, ge=0.5, le=0.85)
    cooldown_steps: int = Field(
        default=2,
        ge=0,
        le=12,
        description="Min walk-forward steps between objective switches (21d steps)",
    )
    confirm_steps: int = Field(
        default=1,
        ge=1,
        le=4,
        description="Consecutive raw regime confirmations before switching",
    )
    regime_detector_version: Literal["v1", "v2"] = Field(
        default="v2",
        description="Regime heuristic: v1 threshold rules, v2 scored indicators + arbitration",
    )
    fast_risk_off_exit: bool = Field(
        default=True,
        description=(
            "V2 only: faster exit from risk_off on 21d rebound (dual window, vol decay, "
            "asymmetric cooldown). Ignored for v1."
        ),
    )


class ObjectiveSwitchLabResult(BaseModel):
    disclaimer: str
    limitation: str
    recommendation: LabRecommendation
    headline: str
    oos_sharpe_delta_switch_minus_fixed: float | None = None
    fixed_arm: dict[str, Any]
    switch_arm: dict[str, Any]
    regime_timeline: list[dict[str, Any]]
    current_regime: dict[str, Any]
    periods: dict[str, Any]
    benchmark_ticker: str
    regime_mode: str
    universe_stats: dict[str, Any]
    data_meta: dict[str, Any] = Field(default_factory=dict)
    # Regime diagnostic (does not replace Sharpe A/B)
    regime_prediction_quality: dict[str, Any] = Field(default_factory=dict)
    benchmark_series: list[dict[str, Any]] = Field(default_factory=list)
    detector_version: str = "v2"
    fast_risk_off_exit: bool | None = None
    regime_score_timeline: list[dict[str, Any]] = Field(default_factory=list)
