"""Backtest day-1 weights use pre-start history prep, not equal-weight deferral."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.engine.allocator import AllocatorParams
from app.engine.data import price_download_start
from app.engine.factors import FactorParams
from app.engine.portfolio import simulate_dynamic_portfolio, trim_prices_to_report_window
from app.engine.spec import BacktestSpec


def test_price_download_start_extends_before_user_start():
    dl = price_download_start("2016-01-01")
    assert pd.Timestamp(dl) < pd.Timestamp("2016-01-01")


def test_first_report_day_not_equal_weight_with_prep_history():
    """User start 2016-01-01: warmup panel lets first visible snapshot be a real rebalance."""
    warmup = pd.bdate_range("2014-06-02", "2015-12-31")
    report = pd.bdate_range("2016-01-01", periods=80)
    dates = warmup.append(report)
    rng = np.random.default_rng(42)
    cols = ["ACWI", "EEM", "EFA", "IWM", "VTV"]
    prices = pd.DataFrame(
        {
            c: 100
            * np.cumprod(1 + rng.normal(0.0003 + i * 0.00002, 0.011, len(dates)))
            for i, c in enumerate(cols)
        },
        index=dates,
    )
    report_start = "2016-01-01"
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
    assert wh
    first = wh[0]
    assert str(first["date"]) >= report_start
    n = len(cols)
    eq_w = 1.0 / n
    devs = [abs(float(first.get(c, 0.0)) - eq_w) for c in cols]
    assert max(devs) > 0.04, "expected non-equal weights on first report day"
    assert float(first.get("OTHER", 0.0)) < 0.05
    top_hold = max(float(first.get(c, 0.0)) for c in cols)
    assert top_hold < 0.99, "single-ETF 100% artifact should not dominate day 1"


def test_short_panel_without_prep_still_warmups_in_window():
    """Panel that starts at report start with no extra history defers until lookback ready."""
    dates = pd.bdate_range("2020-01-01", periods=120)
    rng = np.random.default_rng(3)
    cols = ["ACWI", "EEM", "EFA", "IWM", "VTV"]
    prices = pd.DataFrame(
        {c: 100 * np.cumprod(1 + rng.normal(0.0002, 0.01, len(dates))) for c in cols},
        index=dates,
    )
    report = trim_prices_to_report_window(prices, "2020-01-01")
    m = simulate_dynamic_portfolio(
        prices,
        report_start=str(report.index[0].date()),
        spec=BacktestSpec(rebalance_rule="ME", fee_bps=0.0),
        max_weight=0.5,
        min_weight=0.0,
        allocator=AllocatorParams(mode="mean_variance", lookback_days=126),
        factor_params=FactorParams(lookback_days=252),
        top_n=3,
    )
    first = (m.get("weight_history") or [])[0]
    n = len(cols)
    for c in cols:
        assert abs(float(first.get(c, 0.0)) - 1.0 / n) < 0.02
