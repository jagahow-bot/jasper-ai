"""Feature-flagged accessors so call sites go through the stage registry.

When ``settings.engine_stages_enabled`` is False, fall back to the original
engine primitives bit-for-bit (migration coexistence path from the design doc).
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from app.config import settings
from app.engine.allocator import AllocatorParams
from app.engine.allocator import solve_weights as _solve_weights
from app.engine.customization import (
    apply_must_include_floor as _apply_must_include_floor,
)
from app.engine.customization import (
    derive_must_include_tickers as _derive_must_include_tickers,
)
from app.engine.customization import (
    min_holdings_for_customization as _min_holdings_for_customization,
)
from app.engine.customization import (
    project_anchor_l1_drift as _project_anchor_l1_drift,
)
from app.engine.factors import FactorParams
from app.engine.factors import score_assets_with_details as _score_assets_with_details
from app.engine.objectives import (
    compute_client_needs_penalty as _compute_client_needs_penalty,
)
from app.engine.objectives import compute_objective_score as _compute_objective_score
from app.engine.objectives import needs_attainment as _needs_attainment
from app.engine.stages.registry import get_registry
from app.engine.weights import project_max_weight as _project_max_weight

_constraints = None
_allocator = None
_objective = None
_reporting = None
_cash_schedule = None
_rebalance = None
_signals = None
_universe = None


def stages_enabled() -> bool:
    return bool(getattr(settings, "engine_stages_enabled", True))


def _constraints_stage():
    global _constraints
    if _constraints is None:
        _constraints = get_registry().resolve("constraints")
    return _constraints


def _allocator_stage():
    global _allocator
    if _allocator is None:
        _allocator = get_registry().resolve("allocator")
    return _allocator


def _objective_stage():
    global _objective
    if _objective is None:
        _objective = get_registry().resolve("objective")
    return _objective


def _reporting_stage():
    global _reporting
    if _reporting is None:
        _reporting = get_registry().resolve("reporting")
    return _reporting


def _cash_schedule_stage():
    global _cash_schedule
    if _cash_schedule is None:
        _cash_schedule = get_registry().resolve("cash_schedule")
    return _cash_schedule


def _rebalance_stage():
    global _rebalance
    if _rebalance is None:
        _rebalance = get_registry().resolve("rebalance")
    return _rebalance


def _signals_stage():
    global _signals
    if _signals is None:
        _signals = get_registry().resolve("signals")
    return _signals


def _universe_stage():
    global _universe
    if _universe is None:
        _universe = get_registry().resolve("universe")
    return _universe


def reset_accessor_cache_for_tests() -> None:
    global _constraints, _allocator, _objective
    global _reporting, _cash_schedule, _rebalance, _signals, _universe
    _constraints = None
    _allocator = None
    _objective = None
    _reporting = None
    _cash_schedule = None
    _rebalance = None
    _signals = None
    _universe = None


# --- constraints -------------------------------------------------------------


def project_max_weight(w: np.ndarray, max_weight: float, max_iter: int = 100) -> np.ndarray:
    if not stages_enabled():
        return _project_max_weight(w, max_weight, max_iter=max_iter)
    return _constraints_stage().project_max_weight(w, max_weight, max_iter=max_iter)


def project_anchor_l1_drift(
    w: np.ndarray,
    anchor: np.ndarray,
    drift: float,
    max_weight: float,
    *,
    max_iter: int = 24,
) -> np.ndarray:
    if not stages_enabled():
        return _project_anchor_l1_drift(
            w, anchor, drift, max_weight, max_iter=max_iter
        )
    return _constraints_stage().project_anchor_l1_drift(
        w, anchor, drift, max_weight, max_iter=max_iter
    )


def min_holdings_for_customization(
    *,
    n_must_include: int,
    max_weight: float,
    customization_drift: float | None,
    n_assets: int,
) -> int:
    if not stages_enabled():
        return _min_holdings_for_customization(
            n_must_include=n_must_include,
            max_weight=max_weight,
            customization_drift=customization_drift,
            n_assets=n_assets,
        )
    return _constraints_stage().min_holdings_for_customization(
        n_must_include=n_must_include,
        max_weight=max_weight,
        customization_drift=customization_drift,
        n_assets=n_assets,
    )


def apply_must_include_floor(
    w: np.ndarray,
    must_indices: list[int],
    *,
    floor: float,
    max_weight: float,
) -> np.ndarray:
    if not stages_enabled():
        return _apply_must_include_floor(
            w, must_indices, floor=floor, max_weight=max_weight
        )
    return _constraints_stage().apply_must_include_floor(
        w, must_indices, floor=floor, max_weight=max_weight
    )


# --- allocator ---------------------------------------------------------------


def solve_weights(
    *,
    mu_annual: np.ndarray,
    cov_annual: np.ndarray,
    max_weight: float,
    params: AllocatorParams,
    w0: np.ndarray | None = None,
    anchor_weights: np.ndarray | None = None,
    customization_drift: float | None = None,
) -> np.ndarray:
    if not stages_enabled():
        return _solve_weights(
            mu_annual=mu_annual,
            cov_annual=cov_annual,
            max_weight=max_weight,
            params=params,
            w0=w0,
            anchor_weights=anchor_weights,
            customization_drift=customization_drift,
        )
    return _allocator_stage().solve_weights(
        mu_annual=mu_annual,
        cov_annual=cov_annual,
        max_weight=max_weight,
        params=params,
        w0=w0,
        anchor_weights=anchor_weights,
        customization_drift=customization_drift,
    )


# --- objective ---------------------------------------------------------------


def compute_objective_score(objective_mode: str, metrics: dict[str, Any]) -> float:
    if not stages_enabled():
        return _compute_objective_score(objective_mode, metrics)
    return _objective_stage().compute_objective_score(objective_mode, metrics)


def compute_client_needs_penalty(
    metrics: dict[str, Any],
    client_context: Any | None,
    *,
    holdings: dict[str, float] | None = None,
    ticker_meta: dict[str, dict[str, Any]] | None = None,
) -> float:
    if not stages_enabled():
        return _compute_client_needs_penalty(
            metrics,
            client_context,
            holdings=holdings,
            ticker_meta=ticker_meta,
        )
    return _objective_stage().compute_client_needs_penalty(
        metrics,
        client_context,
        holdings=holdings,
        ticker_meta=ticker_meta,
    )


# --- reporting ---------------------------------------------------------------


def needs_attainment(
    metrics: dict[str, Any],
    client_context: Any | None,
    *,
    holdings: dict[str, float] | None = None,
    ticker_meta: dict[str, dict[str, Any]] | None = None,
    must_include_tickers: list[str] | None = None,
    anchor_weights: dict[str, float] | None = None,
    customization_drift: float | None = None,
) -> dict[str, Any] | None:
    if not stages_enabled():
        return _needs_attainment(
            metrics,
            client_context,
            holdings=holdings,
            ticker_meta=ticker_meta,
            must_include_tickers=must_include_tickers,
            anchor_weights=anchor_weights,
            customization_drift=customization_drift,
        )
    return _reporting_stage().needs_attainment(
        metrics,
        client_context,
        holdings=holdings,
        ticker_meta=ticker_meta,
        must_include_tickers=must_include_tickers,
        anchor_weights=anchor_weights,
        customization_drift=customization_drift,
    )


# --- cash_schedule -----------------------------------------------------------


def deployment_fraction(
    dt: pd.Timestamp,
    start: pd.Timestamp,
    months: int | None,
    tranches: int | None,
) -> float:
    """Legacy-compatible DCA fraction (0→1 of target invested book)."""
    if not stages_enabled():
        from app.engine.portfolio import deployment_fraction as _legacy_dep

        return float(_legacy_dep(dt, start, months, tranches))
    return float(
        _cash_schedule_stage().deployment_fraction(dt, start, months, tranches)
    )


# --- rebalance ---------------------------------------------------------------


def trading_day_rebalance_dates(
    index: pd.DatetimeIndex, rule: str
) -> list[pd.Timestamp]:
    if not stages_enabled():
        from app.engine.portfolio import _trading_day_rebalance_dates as _legacy

        return list(_legacy(index, rule))
    return list(_rebalance_stage().trading_day_rebalance_dates(index, rule))


def apply_max_turnover(
    w_new: np.ndarray, w_prev: np.ndarray, max_turnover: float
) -> np.ndarray:
    if not stages_enabled():
        from app.engine.portfolio import _apply_max_turnover as _legacy

        return _legacy(w_new, w_prev, max_turnover)
    return _rebalance_stage().apply(
        w_new, w_prev, max_turnover=float(max_turnover), no_trade_tol=0.0
    )


# --- signals -----------------------------------------------------------------


def score_assets_with_details(
    prices: pd.DataFrame,
    rets: pd.DataFrame,
    params: FactorParams,
    *,
    dividend_panel: pd.DataFrame | None = None,
) -> tuple[pd.Series, dict[str, Any]]:
    if not stages_enabled():
        return _score_assets_with_details(
            prices, rets, params, dividend_panel=dividend_panel
        )
    return _signals_stage().score_assets_with_details(
        prices, rets, params, dividend_panel=dividend_panel
    )


# --- universe ----------------------------------------------------------------


def derive_must_include_tickers(
    tickers: list[str],
    anchor_weights: dict[str, float] | None,
    *,
    explicit: list[str] | None = None,
) -> list[str]:
    if not stages_enabled():
        return _derive_must_include_tickers(
            tickers, anchor_weights, explicit=explicit
        )
    return list(
        _universe_stage().derive_must_include_tickers(
            tickers, anchor_weights, explicit=explicit
        )
    )
