"""Lazy chart rebuild must tolerate scalar-only IS/OOS snapshots."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.candidate_charts import _build_institutional_analytics
from app.engine.objectives import metrics_snapshot
from app.engine.spec import BacktestSpec
from app.models import BacktestRequest, Objective


def test_build_institutional_analytics_scalar_only_is_oos():
    req = BacktestRequest(
        scenario_id="s1",
        start_date="2020-01-01",
        end_date="2024-01-01",
        asset_classes=["equity"],
        objective=Objective.max_sharpe,
        max_weight=0.25,
        max_turnover=0.5,
        top_n=10,
        trials=5,
        top_models=3,
        enable_oos=True,
        train_ratio=0.7,
    )
    idx = pd.bdate_range("2020-01-01", periods=120, freq="B")
    prices = pd.DataFrame(
        {"SPY": np.linspace(100, 140, len(idx)), "AAA": np.linspace(50, 70, len(idx))},
        index=idx,
    )
    full_m = {
        "sharpe": 1.0,
        "max_drawdown": -0.1,
        "cagr": 0.12,
        "volatility": 0.15,
        "port_ret": pd.Series(0.0005, index=idx),
        "equity": (1.0 + pd.Series(0.0005, index=idx)).cumprod(),
        "last_weights": np.array([1.0, 0.0], dtype=float),
        "rebalance_count": 4,
        "rebalance_freq": "M",
        "rebalance_dates": [],
    }
    train_m = metrics_snapshot(
        {"sharpe": 0.8, "cagr": 0.1, "max_drawdown": -0.1, "volatility": 0.13, "sortino": 1.0},
        objective_mode="max_sharpe",
    )
    val_m = metrics_snapshot(
        {"sharpe": 0.6, "cagr": 0.08, "max_drawdown": -0.09, "volatility": 0.12, "sortino": 0.9},
        objective_mode="max_sharpe",
    )
    assert "equity" not in train_m
    assert "equity" not in val_m

    analytics = _build_institutional_analytics(
        req=req,
        params={"model_code": "M0006"},
        tickers=["AAA", "SPY"],
        prices=prices,
        prices_sim_panel=prices[["AAA"]],
        spec=BacktestSpec(benchmark_ticker="SPY"),
        universe_by_ticker={"AAA": {"asset_class": "equity", "region": "us"}},
        full_m=full_m,
        bundle_train_m=train_m,
        bundle_val_m=val_m,
        sim_kw={},
        resolver=None,
    )
    assert analytics.get("periodic_returns_scope") == "full_sample"
