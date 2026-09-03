"""Golden masters: stage wrappers must match legacy primitives bit-for-bit.

Full BacktestResult canonical golden sets (design §2.7.2) record deterministic
slices where fixtures allow; remaining scenarios expand stage-primitive parity
so every wired stage stays locked against its pre-refactor implementation.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.engine.allocator import AllocatorParams
from app.engine.allocator import solve_weights as legacy_solve
from app.engine.customization import (
    derive_must_include_tickers as legacy_derive_must,
)
from app.engine.customization import (
    min_holdings_for_customization as legacy_min_holdings,
)
from app.engine.customization import (
    project_anchor_l1_drift as legacy_project_drift,
)
from app.engine.factors import FactorParams
from app.engine.factors import score_assets_with_details as legacy_score
from app.engine.objectives import (
    compute_client_needs_penalty as legacy_needs_penalty,
)
from app.engine.objectives import compute_objective_score as legacy_obj_score
from app.engine.objectives import needs_attainment as legacy_attainment
from app.engine.portfolio import _apply_max_turnover as legacy_turnover
from app.engine.portfolio import _trading_day_rebalance_dates as legacy_schedule
from app.engine.portfolio import deployment_fraction as legacy_deployment
from app.engine.stages import reset_registry_for_tests
from app.engine.stages.accessors import (
    apply_max_turnover,
    compute_client_needs_penalty,
    compute_objective_score,
    deployment_fraction,
    derive_must_include_tickers,
    min_holdings_for_customization,
    needs_attainment,
    project_anchor_l1_drift,
    project_max_weight,
    score_assets_with_details,
    solve_weights,
    trading_day_rebalance_dates,
)
from app.engine.weights import project_max_weight as legacy_project_cap
from app.models import ClientContext


def setup_function() -> None:
    reset_registry_for_tests()


def test_golden_constraints_project_max_weight() -> None:
    rng = np.random.default_rng(42)
    w = rng.random(8)
    w = w / w.sum()
    a = project_max_weight(w, 0.25)
    b = legacy_project_cap(w, 0.25)
    np.testing.assert_allclose(a, b, rtol=0, atol=0)


def test_golden_constraints_l1_drift() -> None:
    rng = np.random.default_rng(7)
    w = rng.random(6)
    w = w / w.sum()
    anchor = np.array([0.4, 0.3, 0.2, 0.1, 0.0, 0.0])
    a = project_anchor_l1_drift(w, anchor, 0.25, 0.40)
    b = legacy_project_drift(w, anchor, 0.25, 0.40)
    np.testing.assert_allclose(a, b, rtol=0, atol=0)


def test_golden_constraints_min_holdings() -> None:
    kwargs = dict(
        n_must_include=2,
        max_weight=0.20,
        customization_drift=0.30,
        n_assets=12,
    )
    assert min_holdings_for_customization(**kwargs) == legacy_min_holdings(**kwargs)


def test_golden_allocator_solve_weights() -> None:
    rng = np.random.default_rng(99)
    n = 5
    mu = rng.normal(0.08, 0.05, size=n)
    a = rng.normal(size=(n, n))
    cov = a @ a.T / n + np.eye(n) * 0.05
    params = AllocatorParams(mode="min_var", lookback_days=126, shrinkage=0.2)
    kwargs = dict(
        mu_annual=mu,
        cov_annual=cov,
        max_weight=0.35,
        params=params,
        w0=None,
        anchor_weights=None,
        customization_drift=None,
    )
    a_w = solve_weights(**kwargs)
    b_w = legacy_solve(**kwargs)
    np.testing.assert_allclose(a_w, b_w, rtol=0, atol=0)


def test_golden_objective_score_and_penalty() -> None:
    metrics = {
        "sharpe": 1.2,
        "cagr": 0.11,
        "max_drawdown": -0.22,
        "volatility": 0.15,
        "sortino": 1.5,
        "turnover_avg": 0.4,
    }
    assert compute_objective_score("max_sharpe", metrics) == legacy_obj_score(
        "max_sharpe", metrics
    )
    ctx = ClientContext(risk_tolerance="conservative", max_single_name_pct=0.15)
    holdings = {"AAA": 0.40, "BBB": 0.30, "CCC": 0.30}
    assert compute_client_needs_penalty(
        metrics, ctx, holdings=holdings
    ) == legacy_needs_penalty(metrics, ctx, holdings=holdings)


def test_golden_reporting_needs_attainment() -> None:
    metrics = {
        "sharpe": 0.9,
        "cagr": 0.08,
        "max_drawdown": -0.18,
        "volatility": 0.12,
    }
    ctx = ClientContext(risk_tolerance="moderate", max_single_name_pct=0.25)
    holdings = {"SPY": 0.5, "AGG": 0.5}
    kwargs = dict(
        holdings=holdings,
        ticker_meta={"SPY": {"asset_class": "equity"}, "AGG": {"asset_class": "bond"}},
        must_include_tickers=["SPY"],
        anchor_weights={"SPY": 1.0},
        customization_drift=0.30,
    )
    assert needs_attainment(metrics, ctx, **kwargs) == legacy_attainment(
        metrics, ctx, **kwargs
    )


def test_golden_cash_schedule_deployment_fraction() -> None:
    start = pd.Timestamp("2020-01-15")
    for months, tranches, offset_months in (
        (None, None, 0),
        (6, 3, 0),
        (6, 3, 2),
        (12, 4, 11),
    ):
        dt = start + pd.DateOffset(months=offset_months)
        a = deployment_fraction(dt, start, months, tranches)
        b = legacy_deployment(dt, start, months, tranches)
        assert a == b


def test_golden_rebalance_turnover_and_schedule() -> None:
    rng = np.random.default_rng(3)
    w_new = rng.random(5)
    w_new = w_new / w_new.sum()
    w_prev = rng.random(5)
    w_prev = w_prev / w_prev.sum()
    np.testing.assert_allclose(
        apply_max_turnover(w_new, w_prev, 0.15),
        legacy_turnover(w_new, w_prev, 0.15),
        rtol=0,
        atol=0,
    )
    idx = pd.bdate_range("2020-01-01", periods=90)
    assert trading_day_rebalance_dates(idx, "QE") == legacy_schedule(idx, "QE")
    assert trading_day_rebalance_dates(idx, "ME") == legacy_schedule(idx, "ME")


def test_golden_signals_score_assets() -> None:
    rng = np.random.default_rng(11)
    idx = pd.bdate_range("2020-01-01", periods=80)
    cols = ["AAA", "BBB", "CCC"]
    prices = pd.DataFrame(
        100 * np.cumprod(1 + rng.normal(0.0005, 0.01, size=(len(idx), 3)), axis=0),
        index=idx,
        columns=cols,
    )
    rets = prices.pct_change().fillna(0.0)
    params = FactorParams()
    a_scores, a_detail = score_assets_with_details(prices, rets, params)
    b_scores, b_detail = legacy_score(prices, rets, params)
    pd.testing.assert_series_equal(a_scores, b_scores)
    assert set(a_detail.keys()) == set(b_detail.keys())


def test_golden_universe_derive_must_include() -> None:
    tickers = ["SPY", "QQQ", "IWM", "TLT"]
    anchor = {"SPY": 0.6, "QQQ": 0.4}
    assert derive_must_include_tickers(tickers, anchor) == legacy_derive_must(
        tickers, anchor
    )


def test_golden_canonical_scenario_slices_smoke() -> None:
    """§2.7.2 canonical scenario shapes — deterministic metric slices."""
    rng = np.random.default_rng(1)
    n = 4
    mu = rng.normal(0.07, 0.04, size=n)
    a = rng.normal(size=(n, n))
    cov = a @ a.T / n + np.eye(n) * 0.04
    params = AllocatorParams(mode="mean_variance", lookback_days=63, shrinkage=0.1)
    w = solve_weights(
        mu_annual=mu,
        cov_annual=cov,
        max_weight=0.40,
        params=params,
    )
    assert abs(float(w.sum()) - 1.0) < 1e-6

    anchor = np.array([0.5, 0.3, 0.2, 0.0])
    w2 = project_anchor_l1_drift(w, anchor, 0.25, 0.40)
    w2_legacy = legacy_project_drift(w, anchor, 0.25, 0.40)
    np.testing.assert_allclose(w2, w2_legacy, rtol=0, atol=0)

    w3 = apply_max_turnover(w2, anchor, 0.10)
    np.testing.assert_allclose(w3, legacy_turnover(w2, anchor, 0.10), rtol=0, atol=0)

    metrics = {"sharpe": 1.0, "cagr": 0.09, "max_drawdown": -0.15, "volatility": 0.14}
    ctx = ClientContext(risk_tolerance="conservative", max_single_name_pct=0.20)
    att = needs_attainment(
        metrics,
        ctx,
        holdings={"A": 0.5, "B": 0.5},
        customization_drift=0.4,
    )
    assert att is None or isinstance(att, dict)

    start = pd.Timestamp("2019-06-01")
    mid = pd.Timestamp("2019-09-01")
    frac = deployment_fraction(mid, start, 6, 3)
    assert 0.0 <= frac <= 1.0
