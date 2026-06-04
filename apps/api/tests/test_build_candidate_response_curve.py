"""Regression: _build_candidate must define response_curve before weight trim."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.engine.backtest import _build_candidate
from app.engine.spec import DEFAULT_SPEC


def _minimal_metrics(n: int = 5) -> dict:
    idx = pd.date_range("2020-01-02", periods=n, freq="B")
    port_ret = pd.Series(0.001, index=idx)
    equity = (1.0 + port_ret).cumprod()
    return {
        "sharpe": 1.0,
        "max_drawdown": -0.05,
        "cagr": 0.1,
        "volatility": 0.12,
        "sortino": 1.0,
        "port_ret": port_ret,
        "equity": equity,
        "last_weights": np.array([1.0]),
        "weight_history": [
            {"date": "2019-12-01", "SPY": 1.0},
            {"date": "2020-01-02", "SPY": 1.0},
        ],
        "weight_history_tickers": ["SPY"],
    }


def test_build_candidate_include_charts_trims_weight_history_to_curve_start():
    tickers = ["SPY"]
    full_m = _minimal_metrics()
    train_m = full_m
    idx = full_m["port_ret"].index
    prices = pd.DataFrame({"SPY": 100.0}, index=idx)
    full_curve = [{"date": "2020-01-02", "value": 1.0}]
    universe = {"SPY": {"asset_class": "equity"}}

    cand = _build_candidate(
        1,
        tickers,
        train_m,
        None,
        oos_enabled=False,
        params={"model_code": "M0001"},
        full_m=full_m,
        full_curve=full_curve,
        prices=prices,
        universe_by_ticker=universe,
        spec=DEFAULT_SPEC,
        include_charts=True,
    )

    assert cand.equity_curve == full_curve
    wh = cand.analytics.get("weight_history", [])
    assert wh
    assert all(str(row.get("date", "")) >= "2020-01-02" for row in wh)
