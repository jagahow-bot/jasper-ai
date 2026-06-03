"""Horizon IS/OOS/full metrics must be consistent with one full backtest path."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.engine.objectives import compute_objective_score, metrics_snapshot
from app.engine.portfolio import metrics_for_horizon_window
from app.engine.spec import DEFAULT_SPEC


def _synthetic_sim(
    is_mean: float,
    oos_mean: float,
    *,
    is_days: int = 252,
    oos_days: int = 126,
    vol: float = 0.01,
    seed: int = 0,
) -> dict:
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2018-01-01", periods=is_days + oos_days, freq="B")
    is_r = rng.normal(is_mean, vol, is_days)
    oos_r = rng.normal(oos_mean, vol, oos_days)
    port_ret = pd.Series(np.concatenate([is_r, oos_r]), index=idx, dtype=float)
    equity = (1.0 + port_ret).cumprod()
    return {"port_ret": port_ret, "equity": equity}


def test_horizon_slices_full_sharpe_not_absurdly_below_both_windows():
    """Positive IS and OOS on one path: full Sharpe should not trail both by a huge gap."""
    spec = DEFAULT_SPEC
    sim = _synthetic_sim(0.0012, 0.0014, vol=0.006, seed=11)
    split = 252
    n = len(sim["port_ret"])

    full_m = metrics_for_horizon_window(sim, spec, 0, n)
    is_m = metrics_for_horizon_window(sim, spec, 0, split)
    oos_m = metrics_for_horizon_window(sim, spec, split, n)

    assert is_m["sharpe"] > 0.5
    assert oos_m["sharpe"] > 0.5
    assert full_m["sharpe"] > 0.5
    assert full_m["sharpe"] >= min(is_m["sharpe"], oos_m["sharpe"]) - 0.25


def test_independent_fresh_oos_can_inflate_vs_chained_slice():
    """Fresh-start holdout can look stronger than the OOS slice of the full path."""
    spec = DEFAULT_SPEC
    is_days, oos_days = 252, 126
    sim = _synthetic_sim(-0.0003, 0.0018, is_days=is_days, oos_days=oos_days, seed=2)
    split = is_days
    n = len(sim["port_ret"])

    chained_oos = metrics_for_horizon_window(sim, spec, split, n)
    oos_ret = sim["port_ret"].iloc[split:]
    fresh_oos = metrics_for_horizon_window(
        {"port_ret": oos_ret, "equity": (1.0 + oos_ret).cumprod()},
        spec,
        0,
        len(oos_ret),
    )

    assert fresh_oos["cagr"] >= chained_oos["cagr"] - 0.02
    full_m = metrics_for_horizon_window(sim, spec, 0, n)
    is_m = metrics_for_horizon_window(sim, spec, 0, split)
    assert full_m["sharpe"] >= min(is_m["sharpe"], chained_oos["sharpe"]) - 0.35


def test_objective_snapshots_use_same_window_metrics():
    objective = "max_sharpe"
    spec = DEFAULT_SPEC
    sim = _synthetic_sim(0.0006, 0.0009, seed=3)
    split = 252
    n = len(sim["port_ret"])
    is_m = metrics_for_horizon_window(sim, spec, 0, split)
    full_m = metrics_for_horizon_window(sim, spec, 0, n)

    is_snap = metrics_snapshot(is_m, objective_mode=objective)
    full_snap = metrics_snapshot(full_m, objective_mode=objective)

    assert is_snap["objective_value"] == pytest.approx(
        compute_objective_score(objective, is_m), rel=1e-5
    )
    assert full_snap["sharpe"] >= is_snap["sharpe"] - 0.35
