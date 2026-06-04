"""Walk-forward regime detection is shared across Optuna trials, not recomputed per trial."""

from __future__ import annotations

from unittest.mock import patch

import numpy as np
import pandas as pd

from app.engine.dynamic_objective import (
    build_dynamic_objective_context,
    refresh_dynamic_allocator_resolver,
)
from app.engine.objective_switch_lab import walk_forward_timeline_for_detector
from app.engine.optimizer import run_optuna_search
from app.engine.regime_detection_cache import compute_regime_detection_bundle


def _bench_returns(n: int = 520) -> pd.Series:
    idx = pd.bdate_range("2018-01-01", periods=n)
    rng = np.random.default_rng(11)
    return pd.Series(rng.normal(0.0004, 0.012, n), index=idx)


def _price_panel(n: int = 520, n_assets: int = 6) -> pd.DataFrame:
    idx = pd.bdate_range("2018-01-01", periods=n)
    rng = np.random.default_rng(12)
    cols = {
        f"E{i}": 100 * np.cumprod(1 + rng.normal(0.0003, 0.012, n))
        for i in range(n_assets)
    }
    cols["SPY"] = 100 * np.cumprod(1 + rng.normal(0.0005, 0.015, n))
    return pd.DataFrame(cols, index=idx)


def test_build_dynamic_context_walk_forward_once() -> None:
    prices = _price_panel()
    calls = 0
    real = walk_forward_timeline_for_detector

    def counting(*args, **kwargs):
        nonlocal calls
        calls += 1
        return real(*args, **kwargs)

    with patch(
        "app.engine.regime_detection_cache.walk_forward_timeline_for_detector",
        side_effect=counting,
    ):
        ctx = build_dynamic_objective_context(prices, "SPY", regime_mode="auto")
    assert calls == 1
    assert ctx.get("regime_bundle") is not None
    assert len(ctx.get("regime_timeline") or []) >= 4


def test_refresh_reuses_bundle_without_second_walk_forward() -> None:
    bench = _bench_returns()
    prices = _price_panel()
    calls = 0
    real = walk_forward_timeline_for_detector

    def counting(*args, **kwargs):
        nonlocal calls
        calls += 1
        return real(*args, **kwargs)

    with patch(
        "app.engine.regime_detection_cache.walk_forward_timeline_for_detector",
        side_effect=counting,
    ):
        ctx = build_dynamic_objective_context(prices, "SPY", regime_mode="auto")
        matrix = {
            "risk_off": {"mode": "min_var", "lookback_days": 252, "shrinkage": 0.2, "risk_aversion": 1.0},
            "neutral": {"mode": "mean_variance", "lookback_days": 126, "shrinkage": 0.1, "risk_aversion": 3.5},
            "risk_on": {"mode": "mean_variance", "lookback_days": 63, "shrinkage": 0.05, "risk_aversion": 1.5},
        }
        ctx2 = refresh_dynamic_allocator_resolver(ctx, regime_setups=matrix)
        ctx3 = refresh_dynamic_allocator_resolver(ctx2, regime_setups=matrix)
    assert calls == 1
    assert ctx3.get("active_regime_resolver") is not None


def test_optuna_trials_reuse_resolver_no_extra_walk_forward() -> None:
    prices = _price_panel()
    train = prices.drop(columns=["SPY"], errors="ignore")
    if train.shape[1] < 5:
        train = prices[[c for c in prices.columns if c != "SPY"]]
    bundle = compute_regime_detection_bundle(
        prices["SPY"].pct_change().dropna(),
        benchmark_ticker="SPY",
        regime_mode="auto",
        detector_version="v2",
    )
    from app.engine.dynamic_objective import bundle_active_regime_resolver

    resolver = bundle_active_regime_resolver(bundle)
    calls = 0
    real = walk_forward_timeline_for_detector

    def counting(*args, **kwargs):
        nonlocal calls
        calls += 1
        return real(*args, **kwargs)

    with patch(
        "app.engine.regime_detection_cache.walk_forward_timeline_for_detector",
        side_effect=counting,
    ), patch(
        "app.engine.optimizer.simulate_dynamic_portfolio",
        return_value={
            "sharpe": 0.5,
            "cagr": 0.08,
            "max_drawdown": -0.1,
            "sortino": 0.6,
            "cvar_95": -0.02,
            "volatility": 0.12,
            "turnover_avg": 0.1,
            "metrics_suspect": False,
        },
    ):
        run_optuna_search(
            train,
            max_weight=0.25,
            max_turnover=0.5,
            top_n=5,
            objective="max_sharpe",
            trials=6,
            active_regime_resolver=resolver,
        )
    assert calls == 0
