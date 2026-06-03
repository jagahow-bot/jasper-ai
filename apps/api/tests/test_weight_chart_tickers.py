"""Weight history sleeves: minimal Other across rebalance dates."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.engine.portfolio import (
    WEIGHT_CHART_MAX_OTHER,
    _max_other_weight_for_tickers,
    select_weight_chart_tickers,
)


def test_select_weight_chart_tickers_includes_all_material_sleeves():
    dates = pd.bdate_range("2020-01-01", periods=6)
    cols = [f"T{i}" for i in range(12)]
    data = np.zeros((len(dates), len(cols)))
    data[3, :] = [0.12, 0.11, 0.10, 0.09, 0.08, 0.07, 0.06, 0.05, 0.04, 0.03, 0.02, 0.01]
    data[0, 0] = 1.0
    data[1, 1] = 1.0
    data[2, 2] = 1.0
    data[4, 3] = 1.0
    data[5, 4] = 1.0
    schedule = pd.DataFrame(data, index=dates, columns=cols)
    hist = list(dates)
    keep = select_weight_chart_tickers(schedule, hist)
    for t in cols:
        assert t in keep
    assert _max_other_weight_for_tickers(schedule, hist, keep) <= WEIGHT_CHART_MAX_OTHER + 1e-9


def test_select_weight_chart_rotation_union_not_peak_truncated():
    """Many legend sleeves but large Other after cohort rotation — include full union."""
    dates = pd.bdate_range("2020-01-01", periods=8)
    early = [f"E{i}" for i in range(11)]
    late = [f"L{i}" for i in range(11)]
    cols = early + late
    data = np.zeros((len(dates), len(cols)))
    for i in range(4):
        data[i, :11] = 1.0 / 11.0
    for i in range(4, len(dates)):
        data[i, 11:] = 1.0 / 11.0
    schedule = pd.DataFrame(data, index=dates, columns=cols)
    hist = list(dates)
    keep = select_weight_chart_tickers(schedule, hist, top_n=15)
    assert len(keep) == len(cols)
    for t in late:
        assert t in keep
    assert _max_other_weight_for_tickers(schedule, hist, keep) <= 1e-9


def test_select_weight_chart_tickers_30_rotating_holdings_other_under_one_pct():
    """30+ rotating cohorts: Other stays below 1% on every rebalance date."""
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
    assert _max_other_weight_for_tickers(schedule, hist, keep) < 0.01


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
        assert other < 0.01 + 1e-6
