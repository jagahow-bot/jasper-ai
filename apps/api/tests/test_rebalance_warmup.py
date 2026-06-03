"""Dynamic rebalance holds equal weight until factor/allocator lookback is ready."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.engine.allocator import AllocatorParams
from app.engine.factors import FactorParams
from app.engine.portfolio import simulate_dynamic_portfolio
from app.engine.spec import BacktestSpec


def test_early_rebalances_hold_equal_weight_until_lookback_ready():
    dates = pd.bdate_range("2020-01-01", periods=120)
    rng = np.random.default_rng(3)
    cols = ["ACWI", "EEM", "EFA", "IWM", "VTV"]
    prices = pd.DataFrame(
        {c: 100 * np.cumprod(1 + rng.normal(0.0002, 0.01, len(dates))) for c in cols},
        index=dates,
    )
    m = simulate_dynamic_portfolio(
        prices,
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
    n = len(cols)
    for c in cols:
        assert abs(float(first.get(c, 0.0)) - 1.0 / n) < 0.02
    assert float(first.get("OTHER", 0.0)) < 0.05
