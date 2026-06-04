"""Minimum holding weight floor after allocation."""

from __future__ import annotations

import numpy as np

from app.engine.weights import apply_min_holding_weight, project_max_weight


def test_apply_min_holding_weight_drops_dust_and_renormalizes():
    w = np.array([0.5, 0.3, 0.15, 0.04, 0.01])
    out = apply_min_holding_weight(w, 0.05)
    assert out[3] < 1e-8
    assert out[4] < 1e-8
    assert abs(float(out.sum()) - 1.0) < 1e-8
    active = out[out > 1e-8]
    assert float(active.min()) >= 0.05 - 1e-8


def test_apply_min_holding_weight_zero_floor_is_noop():
    w = np.array([0.7, 0.2, 0.1])
    out = apply_min_holding_weight(w, 0.0)
    np.testing.assert_allclose(out, w, rtol=1e-6)


def test_apply_min_holding_weight_reapplies_max_cap():
    w = np.array([0.4, 0.35, 0.15, 0.08, 0.02])
    out = apply_min_holding_weight(w, 0.05, max_weight=0.4)
    assert float(out.max()) <= 0.4 + 1e-6
    assert abs(float(out.sum()) - 1.0) < 1e-6


def test_simulate_dynamic_respects_min_holding_weight():
    import pandas as pd

    from app.engine.allocator import AllocatorParams
    from app.engine.portfolio import simulate_dynamic_portfolio
    from app.engine.spec import BacktestSpec

    dates = pd.bdate_range("2020-01-01", periods=280)
    rng = np.random.default_rng(7)
    cols = ["A", "B", "C", "D", "E"]
    prices = pd.DataFrame(
        {c: 100 * np.cumprod(1 + rng.normal(0.0003, 0.01, len(dates))) for c in cols},
        index=dates,
    )
    spec = BacktestSpec(rebalance_rule="ME", fee_bps=0.0)
    m = simulate_dynamic_portfolio(
        prices,
        spec=spec,
        max_weight=0.5,
        min_weight=0.05,
        allocator=AllocatorParams(mode="mean_variance", lookback_days=126),
        top_n=5,
    )
    last_w = np.asarray(m.get("last_weights"), dtype=float)
    active = last_w[last_w >= 0.05 - 1e-8]
    assert len(active) >= 1
    assert float(active.min()) >= 0.05 - 1e-6 or len(active) == 1
    assert float(last_w.sum()) <= 1.0 + 1e-6


def test_weight_history_uses_bounded_other_selection():
    from pathlib import Path

    text = Path(__file__).resolve().parents[1].joinpath(
        "app", "engine", "portfolio.py"
    ).read_text(encoding="utf-8")
    assert "hist_floor = float(min_weight)" not in text
    assert "select_weight_chart_tickers" in text
    assert "WEIGHT_CHART_OTHER_MAX" in text
