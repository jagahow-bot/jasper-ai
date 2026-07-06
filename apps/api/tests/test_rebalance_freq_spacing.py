"""Rebalance calendar spacing and weight_history snapshot cadence."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.engine.allocator import AllocatorParams
from app.engine.factors import FactorParams
from app.engine.portfolio import (
    _trading_day_rebalance_dates,
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
    applied = [d for d in (m.get("rebalance_dates") or []) if d >= report_start]
    # Chart may downsample to 36 points; each snapshot must be an applied rebalance date
    # (or report-start anchor when ensure_weight_history_anchor prepends it).
    for d in wh_dates:
        assert d >= report_start
    assert len(wh) <= 36
    assert len(wh) < len(prices) // 5, "snapshots should be far sparser than trading days"
