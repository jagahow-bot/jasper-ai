"""Weight history sleeves: all holdings shown, no Other grouping."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.engine.portfolio import (
    WEIGHT_CHART_MIN_PCT,
    select_weight_chart_tickers,
)


def test_select_weight_chart_tickers_returns_all_active():
    """All tickers with meaningful weight are returned."""
    dates = pd.bdate_range("2020-01-01", periods=3)
    cols = ["A", "B", "C", "D", "E", "F"]
    data = [
        [0.76, 0.14, 0.10, 0.0, 0.0, 0.0],
        [0.0, 0.0, 0.0, 0.76, 0.14, 0.10],
        [0.10, 0.14, 0.0, 0.0, 0.0, 0.76],
    ]
    schedule = pd.DataFrame(data, index=dates, columns=cols)
    hist = list(dates)
    keep = select_weight_chart_tickers(schedule, hist)
    assert set(keep) == {"A", "B", "C", "D", "E", "F"}


def test_select_weight_chart_tickers_disjoint_cohorts_all_included():
    """Rotating equal cohorts: all tickers returned."""
    dates = pd.bdate_range("2020-01-01", periods=6)
    early = [f"E{i}" for i in range(11)]
    late = [f"L{i}" for i in range(11)]
    cols = early + late
    data = np.zeros((len(dates), len(cols)))
    for i in range(3):
        data[i, :11] = 1.0 / 11.0
    for i in range(3, len(dates)):
        data[i, 11:] = 1.0 / 11.0
    schedule = pd.DataFrame(data, index=dates, columns=cols)
    hist = list(dates)
    keep = select_weight_chart_tickers(schedule, hist, top_n=15)
    assert set(keep) == set(cols)


def test_select_weight_chart_tickers_many_rotating_holdings():
    """32 rotating cohorts: all active tickers returned."""
    n_holdings = 32
    n_periods = 10
    dates = pd.bdate_range("2020-01-01", periods=n_periods)
    cols = [f"H{i:02d}" for i in range(n_holdings)]
    data = np.zeros((n_periods, n_holdings))
    block = 8
    for p in range(n_periods):
        start = (p * block) % n_holdings
        active = [cols[(start + j) % n_holdings] for j in range(block)]
        for t in active:
            data[p, cols.index(t)] = 1.0 / block
    schedule = pd.DataFrame(data, index=dates, columns=cols)
    hist = list(dates)
    keep = select_weight_chart_tickers(schedule, hist)
    assert len(keep) == n_holdings


def test_select_weight_chart_tickers_filters_dust():
    """Tickers that never exceed WEIGHT_CHART_MIN_PCT are excluded."""
    dates = pd.bdate_range("2020-01-01", periods=2)
    cols = ["A", "B", "DUST"]
    data = [
        [0.60, 0.40, 0.0],
        [0.60, 0.3999, WEIGHT_CHART_MIN_PCT / 2],
    ]
    schedule = pd.DataFrame(data, index=dates, columns=cols)
    hist = list(dates)
    keep = select_weight_chart_tickers(schedule, hist)
    assert "DUST" not in keep
    assert set(keep) == {"A", "B"}


def test_weight_history_integration_no_other():
    from app.engine.allocator import AllocatorParams
    from app.engine.portfolio import simulate_dynamic_portfolio
    from app.engine.spec import BacktestSpec

    dates = pd.bdate_range("2020-01-01", periods=280)
    rng = np.random.default_rng(11)
    cols = [f"E{i}" for i in range(10)]
    prices = pd.DataFrame(
        {c: 100 * np.cumprod(1 + rng.normal(0.0003, 0.012, len(dates))) for c in cols},
        index=dates,
    )
    m = simulate_dynamic_portfolio(
        prices,
        spec=BacktestSpec(rebalance_rule="ME", fee_bps=0.0),
        max_weight=0.35,
        min_weight=0.0,
        allocator=AllocatorParams(mode="mean_variance", lookback_days=126),
        top_n=8,
    )
    wh = m.get("weight_history") or []
    tickers = m.get("weight_history_tickers") or []
    assert tickers
    for row in wh:
        assert "OTHER" not in row
