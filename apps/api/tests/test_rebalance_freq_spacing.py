"""Rebalance calendar spacing and weight_history snapshot cadence."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.engine.allocator import AllocatorParams
from app.engine.factors import FactorParams
from app.engine.portfolio import (
    WEIGHT_HISTORY_SNAPSHOT_CAP,
    _trading_day_rebalance_dates,
    first_trading_day_on_or_after,
    simulate_dynamic_portfolio,
)
from app.engine.spec import BacktestSpec


def _synthetic_prices(start: str, periods: int, cols: list[str]) -> pd.DataFrame:
    dates = pd.bdate_range(start, periods=periods)
    rng = np.random.default_rng(42)
    return pd.DataFrame(
        {
            c: 100 * np.cumprod(1 + rng.normal(0.0002, 0.01, len(dates)))
            for c in cols
        },
        index=dates,
    )


def test_monthly_rebalance_dates_are_about_one_month_apart():
    prices = _synthetic_prices("2018-01-02", 400, ["SPY", "EFA", "EEM"])
    dates = _trading_day_rebalance_dates(prices.index, "ME")
    gaps = pd.Series(dates).diff().dropna().dt.days
    assert len(dates) >= 10
    assert gaps.median() >= 20
    assert gaps.median() <= 35


def test_quarterly_rebalance_dates_are_about_three_months_apart():
    prices = _synthetic_prices("2018-01-02", 800, ["SPY", "EFA", "EEM"])
    dates = _trading_day_rebalance_dates(prices.index, "QE")
    gaps = pd.Series(dates).diff().dropna().dt.days
    assert len(dates) >= 5
    assert gaps.median() >= 80
    assert gaps.median() <= 100


def test_weight_history_snapshots_match_applied_rebalance_cadence():
    """weight_history records rebalance snapshots only — not daily drift."""
    prices = _synthetic_prices("2018-01-02", 400, ["SPY", "EFA", "EEM", "IWM"])
    report_start = "2018-01-02"
    m = simulate_dynamic_portfolio(
        prices,
        report_start=report_start,
        spec=BacktestSpec(rebalance_rule="ME", fee_bps=0.0),
        max_weight=0.5,
        min_weight=0.0,
        allocator=AllocatorParams(mode="mean_variance", lookback_days=126),
        factor_params=FactorParams(lookback_days=252),
        top_n=3,
    )
    wh = m.get("weight_history") or []
    wh_dates = [str(r["date"]) for r in wh]
    for d in wh_dates:
        assert d >= report_start
    assert len(wh) <= WEIGHT_HISTORY_SNAPSHOT_CAP
    assert len(wh) < len(prices) // 5, "snapshots should be far sparser than trading days"


def test_me_report_window_scheduled_vs_applied_with_prep_history():
    """ME over 2+ years with prep: report-window counts should match monthly cadence."""
    warmup = pd.bdate_range("2016-01-04", "2017-12-29")
    report = pd.bdate_range("2018-01-01", periods=520)
    dates = warmup.append(report)
    rng = np.random.default_rng(2018)
    cols = ["ACWI", "EEM", "EFA", "IWM", "VT", "VTV"]
    prices = pd.DataFrame(
        {
            c: 100
            * np.cumprod(1 + rng.normal(0.0003 + i * 0.00002, 0.011, len(dates)))
            for i, c in enumerate(cols)
        },
        index=dates,
    )
    report_start = "2018-01-01"
    m = simulate_dynamic_portfolio(
        prices,
        report_start=report_start,
        spec=BacktestSpec(rebalance_rule="ME", fee_bps=0.0),
        max_weight=0.5,
        min_weight=0.0,
        allocator=AllocatorParams(mode="mean_variance", lookback_days=252),
        factor_params=FactorParams(lookback_days=252),
        top_n=3,
    )
    anchor = first_trading_day_on_or_after(prices.index, report_start)
    me_in_window = [
        d for d in _trading_day_rebalance_dates(prices.index, "ME") if d >= anchor
    ]
    # report_start injects day-1 rebalance in addition to ME month-ends
    assert m["rebalance_count"] == len(me_in_window) + 1
    assert m["rebalance_applied"] == m["rebalance_count"]
    assert m["rebalance_skipped"] == 0
    assert m["rebalance_snapshots_shown"] == m["rebalance_applied"]
    assert len(m.get("weight_history") or []) == m["rebalance_snapshots_shown"]


def test_me_report_window_skips_without_prep_history():
    """Short panel: early ME dates skipped until factor/allocator lookback is ready."""
    prices = _synthetic_prices("2020-01-01", 520, ["SPY", "EFA", "EEM", "IWM", "VT", "VTV"])
    report_start = "2020-01-01"
    m = simulate_dynamic_portfolio(
        prices,
        report_start=report_start,
        spec=BacktestSpec(rebalance_rule="ME", fee_bps=0.0),
        max_weight=0.5,
        min_weight=0.0,
        allocator=AllocatorParams(mode="mean_variance", lookback_days=252),
        factor_params=FactorParams(lookback_days=252),
        top_n=3,
    )
    assert m["rebalance_count"] > 0
    assert m["rebalance_applied"] < m["rebalance_count"]
    assert m["rebalance_skipped"] == m["rebalance_count"] - m["rebalance_applied"]
    assert m["rebalance_snapshots_shown"] == m["rebalance_applied"]
