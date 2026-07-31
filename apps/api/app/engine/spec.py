"""Standardized backtest assumptions (Phase A)."""

from dataclasses import dataclass


@dataclass(frozen=True)
class BacktestSpec:
    benchmark_ticker: str = "SPY"
    risk_free_rate: float = 0.04
    fee_bps: float = 10.0
    rebalance_rule: str = "QE"
    min_holdings: int = 5
    max_holdings: int = 30
    cash_reserve_pct: float = 0.0
    cash_return_mode: str = "risk_free"
    deployment_months: int | None = None
    deployment_tranches: int | None = None

    @property
    def fee_rate(self) -> float:
        return self.fee_bps / 10_000.0

    @property
    def target_invested_frac(self) -> float:
        return float(max(0.0, min(1.0, 1.0 - float(self.cash_reserve_pct or 0.0))))


DEFAULT_SPEC = BacktestSpec()


def resolve_candidate_top_n(top_n: int | None, n_assets: int) -> int:
    """Factor-screen candidate count; None means all eligible assets."""
    n = int(n_assets) if top_n is None else int(top_n)
    return int(max(1, min(n, int(n_assets))))


def resolve_top_n_cap(top_n: int | None, n_assets: int, spec: BacktestSpec) -> int:
    """Optuna / AI search ceiling for top_n_actual; unlimited uses full universe."""
    base = resolve_candidate_top_n(top_n, n_assets)
    if top_n is None:
        return base
    return int(max(1, min(base, int(spec.max_holdings))))


def top_n_ai_range_hi(top_n_cap: int | None, tradable_count: int) -> int:
    """Upper bound for AI top_n_actual search range."""
    if top_n_cap is None:
        return int(tradable_count)
    return int(min(int(top_n_cap), int(tradable_count)))


def effective_top_n(
    top_n: int | None,
    spec: BacktestSpec,
    *,
    n_assets: int | None = None,
) -> int:
    """Resolve factor-screen count for simulation; unlimited uses all assets."""
    if top_n is None:
        if n_assets is not None:
            return resolve_candidate_top_n(None, n_assets)
        return int(spec.max_holdings)
    capped = min(int(top_n), int(spec.max_holdings))
    if n_assets is not None:
        capped = min(capped, int(n_assets))
    return int(max(1, capped))
