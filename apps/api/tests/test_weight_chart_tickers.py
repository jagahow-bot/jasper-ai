"""Weight history sleeves: Other capped at 10% on every rebalance date."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.engine.portfolio import (
    WEIGHT_CHART_OTHER_MAX,
    _max_other_weight_for_tickers,
    select_weight_chart_tickers,
)


def test_select_weight_chart_tickers_greedy_expansion_rotating_leaders():
    """Top-1-per-date union exceeds 10% Other; dynamic pick satisfies cap on every date."""
    dates = pd.bdate_range("2020-01-01", periods=3)
    cols = ["A", "B", "C", "D", "E", "F"]
    data = [
        [0.76, 0.14, 0.10, 0.0, 0.0, 0.0],
        [0.0, 0.0, 0.0, 0.76, 0.14, 0.10],
        [0.10, 0.14, 0.0, 0.0, 0.0, 0.76],
    ]
    schedule = pd.DataFrame(data, index=dates, columns=cols)
    hist = list(dates)
    top1_only = {"A", "D", "F"}
    assert _max_other_weight_for_tickers(schedule, hist, top1_only) > WEIGHT_CHART_OTHER_MAX
    keep = select_weight_chart_tickers(schedule, hist)
    assert _max_other_weight_for_tickers(schedule, hist, keep) <= WEIGHT_CHART_OTHER_MAX + 1e-9


def test_select_weight_chart_tickers_disjoint_cohorts_under_ten_pct():
    """Rotating equal cohorts: dynamic pick, not full universe when possible."""
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
    assert len(keep) < len(cols)
    assert any(t in keep for t in late)
    assert _max_other_weight_for_tickers(schedule, hist, keep) <= WEIGHT_CHART_OTHER_MAX + 1e-9


def test_select_weight_chart_tickers_many_rotating_holdings():
    """32 rotating cohorts: Other stays at or below 10% on every rebalance date."""
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
    assert _max_other_weight_for_tickers(schedule, hist, keep) <= WEIGHT_CHART_OTHER_MAX + 1e-9


def test_weight_history_integration_other_bounded():
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
        other = float(row.get("OTHER", 0.0))
        assert other <= WEIGHT_CHART_OTHER_MAX + 1e-6
