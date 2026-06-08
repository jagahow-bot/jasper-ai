"""Regression: champion assembly must not KeyError when cached IS/OOS metrics
are scalar-only snapshots (no equity series).

Repro of production failure where packaging the champion crashed with `'equity'`
because ``train_metrics`` / ``validation_metrics`` snapshots carry scalars only,
yet ``_build_candidate`` reached for ``train_m['equity']`` to draw IS/OOS chart
segments.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.engine.backtest import _build_candidate
from app.engine.objectives import metrics_snapshot
from app.engine.spec import BacktestSpec


def _full_metrics(index: pd.DatetimeIndex) -> dict:
    rng = np.random.default_rng(7)
    port_ret = pd.Series(rng.normal(0.0004, 0.01, size=len(index)), index=index)
    equity = (1.0 + port_ret).cumprod()
    return {
        "sharpe": 0.9,
        "max_drawdown": -0.12,
        "cagr": 0.11,
        "volatility": 0.14,
        "sortino": 1.1,
        "calmar": 0.8,
        "var_95": -0.02,
        "cvar_95": -0.03,
        "win_rate": 0.54,
        "turnover_avg": 0.05,
        "turnover_total": 1.5,
        "max_drawdown_duration_days": 30,
        "metrics_suspect": False,
        "equity": equity,
        "port_ret": port_ret,
        "last_weights": np.array([0.5, 0.3, 0.2], dtype=float),
        "weight_history": [],
        "factor_summary": {},
        "rebalance_freq": "QE",
        "rebalance_count": 4,
        "rebalance_applied": 4,
        "rebalance_dates": [],
    }


def test_build_candidate_survives_snapshot_only_is_oos_metrics():
    tickers = ["AAA", "BBB", "CCC"]
    idx = pd.bdate_range("2018-01-01", periods=300)
    prices = pd.DataFrame(
        {
            "AAA": np.linspace(100, 180, len(idx)),
            "BBB": np.linspace(50, 70, len(idx)),
            "CCC": np.linspace(20, 32, len(idx)),
            "SPY": np.linspace(200, 320, len(idx)),
        },
        index=idx,
    )
    universe_by_ticker = {
        "AAA": {"asset_class": "equity", "region": "us"},
        "BBB": {"asset_class": "equity", "region": "intl"},
        "CCC": {"asset_class": "bond", "region": "us"},
    }
    spec = BacktestSpec(benchmark_ticker="SPY")

    full_m = _full_metrics(idx)
    from app.engine.portfolio import equity_curve_series

    full_curve = equity_curve_series(full_m["equity"])

    # Scalar-only snapshots, exactly what train_metrics / validation_metrics carry.
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

    candidate = _build_candidate(
        1,
        tickers,
        train_m,
        val_m,
        True,  # oos_enabled
        {"model_code": "M0014", "mode": "min_var"},
        full_m,
        full_curve,
        prices,
        universe_by_ticker,
        spec,
        objective_effective="max_sharpe",
        train_start="2018-01-01",
        train_end="2019-01-01",
        val_start="2019-01-02",
        train_ratio=0.5,
        is_split_idx=150,
        include_charts=True,
    )

    assert candidate.model_code == "M0014"
    assert candidate.equity_curve  # full-period curve still rendered
    # No separate IS/OOS equity available, so periodic returns fall back to full.
    assert candidate.analytics["periodic_returns_scope"] == "full_sample"
    assert "periodic_returns_holdout" not in candidate.analytics
