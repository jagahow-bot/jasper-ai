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


class BacktestRequest(BaseModel):
    scenario_id: str
    # User-facing cap. Engine/Optuna may choose a stricter cap <= this value.
    max_weight: float = Field(ge=0.0, le=1.0)
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
        description="Optional ticker whitelist after asset-class/category filters",
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
    overfitting_penalty_weight: float = Field(
        default=0.5,
        ge=0.0,
        le=3.0,
        description="Multiplier on train-validation gap penalty in scoring",
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


class ScenarioCard(BaseModel):
    id: str
    title: str
    subtitle: str
    narrative_points: list[str]
    defaults: dict[str, Any]
