"""Run-level max_holdings cap on portfolio sleeves."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.engine.allocator import AllocatorParams
from app.engine.portfolio import simulate_dynamic_portfolio
from app.engine.spec import BacktestSpec, effective_top_n
from app.engine.weights import WEIGHT_EPS, apply_max_holdings


def test_effective_top_n_caps_by_spec():
    spec = BacktestSpec(max_holdings=8)
    assert effective_top_n(50, spec) == 8
    assert effective_top_n(5, spec) == 5


def test_apply_max_holdings_zeros_smallest_positions():
    w = np.array([0.2, 0.2, 0.2, 0.2, 0.2])
    out = apply_max_holdings(w, 3)
    assert int(np.sum(out > WEIGHT_EPS)) == 3
    assert abs(float(out.sum()) - 1.0) < 1e-9


def test_simulate_dynamic_respects_max_holdings():
    rng = np.random.default_rng(11)
    dates = pd.bdate_range("2018-01-01", periods=520)
    cols = [f"T{i:02d}" for i in range(12)]
    prices = pd.DataFrame(
        {c: 100 * np.cumprod(1 + rng.normal(0.0003, 0.012, len(dates))) for c in cols},
        index=dates,
    )
    spec = BacktestSpec(rebalance_rule="QE", fee_bps=0.0, max_holdings=4)
    m = simulate_dynamic_portfolio(
        prices,
        spec=spec,
        max_weight=0.5,
        min_weight=0.0,
        allocator=AllocatorParams(mode="mean_variance", lookback_days=126),
        top_n=10,
    )
    last_w = np.asarray(m.get("last_weights"), dtype=float)
    active = int(np.sum(last_w > 1e-6))
    assert active <= 4, f"expected <=4 holdings, got {active}"

    hist = m.get("weight_history") or []
    for row in hist:
        names = [k for k, v in row.items() if k not in ("date", "OTHER") and float(v) > 1e-6]
        assert len(names) <= 4, f"rebalance {row.get('date')} had {len(names)} names"


def test_simulate_dynamic_max_holdings_with_no_trade_tol():
    rng = np.random.default_rng(17)
    dates = pd.bdate_range("2018-01-01", periods=520)
    cols = [f"T{i:02d}" for i in range(12)]
    prices = pd.DataFrame(
        {c: 100 * np.cumprod(1 + rng.normal(0.0003, 0.012, len(dates))) for c in cols},
        index=dates,
    )
    spec = BacktestSpec(rebalance_rule="QE", fee_bps=0.0, max_holdings=4)
    m = simulate_dynamic_portfolio(
        prices,
        spec=spec,
        max_weight=0.5,
        min_weight=0.0,
        no_trade_tol=0.01,
        allocator=AllocatorParams(mode="mean_variance", lookback_days=126),
        top_n=10,
    )
    last_w = np.asarray(m.get("last_weights"), dtype=float)
    assert int(np.sum(last_w > WEIGHT_EPS)) <= 4


def test_backtest_request_max_holdings_field():
    from app.models import BacktestRequest, Objective, BacktestMode

    req = BacktestRequest(
        scenario_id="custom",
        max_weight=0.5,
        objective=Objective.max_sharpe,
        backtest_mode=BacktestMode.static,
        max_holdings=12,
    )
    assert req.max_holdings == 12


def test_backtest_request_max_holdings_range():
    from pydantic import ValidationError

    from app.models import BacktestRequest, Objective, BacktestMode

    base = dict(
        scenario_id="custom",
        max_weight=0.5,
        objective=Objective.max_sharpe,
        backtest_mode=BacktestMode.static,
    )
    assert BacktestRequest(**base, max_holdings=1).max_holdings == 1
    assert BacktestRequest(**base, max_holdings=50).max_holdings == 50
    for invalid in (0, 51):
        try:
            BacktestRequest(**base, max_holdings=invalid)
            raise AssertionError(f"expected ValidationError for max_holdings={invalid}")
        except ValidationError:
            pass
