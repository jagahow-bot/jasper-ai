"""Hard class sleeve enforcement after allocator solve."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.engine.allocator import AllocatorParams
from app.engine.asset_class_policy import (
    class_sleeve_totals,
    enforce_class_weight_budget,
)
from app.engine.factors import FactorParams
from app.engine.portfolio import simulate_dynamic_portfolio
from app.engine.spec import BacktestSpec


def _universe() -> dict[str, dict[str, str]]:
    return {
        "EQ1": {"asset_class": "equity"},
        "EQ2": {"asset_class": "equity"},
        "BD1": {"asset_class": "bond"},
        "BD2": {"asset_class": "bond"},
        "BD3": {"asset_class": "bond"},
    }


def test_enforce_class_weight_budget_respects_sleeve_targets() -> None:
    universe = _universe()
    tickers = list(universe.keys())
    w = np.array([0.4, 0.35, 0.15, 0.10])
    budget = {"bond": 0.7, "equity": 0.3}
    out = enforce_class_weight_budget(w, tickers, universe, budget)
    totals = class_sleeve_totals(out, tickers, universe)
    assert abs(totals["bond"] - 0.7) < 0.02
    assert abs(totals["equity"] - 0.3) < 0.02


def test_enforce_class_weight_budget_preserves_relative_weights_within_class() -> None:
    """Sleeve targets are met without equalizing names inside each class."""
    universe = _universe()
    tickers = list(universe.keys())
    # EQ1:EQ2 = 2:1; BD1:BD2:BD3 = 3:2:1 within each sleeve
    w = np.array([0.40, 0.20, 0.30, 0.20, 0.10])
    budget = {"bond": 0.6, "equity": 0.4}
    out = enforce_class_weight_budget(w, tickers, universe, budget)
    totals = class_sleeve_totals(out, tickers, universe)
    assert abs(totals["bond"] - 0.6) < 0.02
    assert abs(totals["equity"] - 0.4) < 0.02
    eq_ratio = out[0] / out[1]
    assert abs(eq_ratio - 2.0) < 0.05
    bond_slice = out[2:5]
    assert abs(bond_slice[0] / bond_slice[1] - 1.5) < 0.05
    assert abs(bond_slice[0] / bond_slice[2] - 3.0) < 0.05
    # Not equal weight across the whole book (would be 0.2 each for 5 names).
    assert float(out.max() - out.min()) > 0.05


def test_simulate_dynamic_enforces_class_budget_when_enabled() -> None:
    universe = _universe()
    tickers = list(universe.keys())
    dates = pd.bdate_range("2020-01-01", periods=320)
    rng = np.random.default_rng(42)
    prices = pd.DataFrame(
        {
            t: 100
            * np.cumprod(
                1
                + rng.normal(
                    0.0005 if universe[t]["asset_class"] == "equity" else 0.0001,
                    0.01,
                    len(dates),
                )
            )
            for t in tickers
        },
        index=dates,
    )
    budget = {"bond": 0.75, "equity": 0.25}
    common = dict(
        prices=prices,
        report_start="2020-07-01",
        spec=BacktestSpec(rebalance_rule="QE", fee_bps=0.0, max_holdings=5),
        max_weight=0.35,
        min_weight=0.0,
        allocator=AllocatorParams(mode="mean_variance", lookback_days=126),
        factor_params=FactorParams(lookback_days=126, w_mom=1.0),
        top_n=5,
        universe_by_ticker=universe,
        class_budget=budget,
    )
    soft = simulate_dynamic_portfolio(**common, enforce_class_weights=False)
    hard = simulate_dynamic_portfolio(**common, enforce_class_weights=True)
    soft_w = np.asarray(soft["last_weights"], dtype=float)
    hard_w = np.asarray(hard["last_weights"], dtype=float)
    soft_eq = class_sleeve_totals(soft_w, tickers, universe).get("equity", 0.0)
    hard_eq = class_sleeve_totals(hard_w, tickers, universe).get("equity", 0.0)
    assert hard_eq < soft_eq
    assert abs(hard_eq - 0.25) < 0.08
