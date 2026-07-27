"""Per-regime Pro round seed matrix for dynamic objective."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.engine.dynamic_objective import (
    allocator_params_from_setup,
    build_regime_matrix_allocator_resolver,
    has_regime_matrix,
    normalize_regime_setups,
    refresh_dynamic_allocator_resolver,
)
from app.engine.objective_switch_lab import allocator_preset_for_objective
from app.engine.param_taxonomy import (
    build_pro_round_param_controls,
    normalize_round_seed,
)
from app.engine.param_bounds import RunBlueprint
from app.engine.regime_policy import objective_for_regime


def _bench_returns(n: int = 520) -> pd.Series:
    idx = pd.bdate_range("2018-01-01", periods=n)
    rng = np.random.default_rng(3)
    ret = rng.normal(0.0004, 0.012, n)
    return pd.Series(ret, index=idx)


def test_normalize_regime_setups_fills_defaults() -> None:
    raw = {
        "risk_on": {"mode": "mean_variance", "lookback_days": 63, "risk_aversion": 1.5},
    }
    matrix = normalize_regime_setups(raw, shared_setup={"shrinkage": 0.2})
    assert set(matrix) == {"risk_off", "neutral", "risk_on"}
    assert matrix["risk_on"]["lookback_days"] == 63
    assert matrix["risk_off"]["mode"] == allocator_preset_for_objective(
        objective_for_regime("risk_off")
    ).mode


def test_regime_matrix_resolver_differs_by_regime() -> None:
    bench = _bench_returns()
    matrix = normalize_regime_setups(
        {
            "risk_off": {"mode": "min_var", "lookback_days": 252, "shrinkage": 0.3, "risk_aversion": 1.0},
            "neutral": {"mode": "mean_variance", "lookback_days": 126, "shrinkage": 0.1, "risk_aversion": 3.5},
            "risk_on": {"mode": "mean_variance", "lookback_days": 63, "shrinkage": 0.05, "risk_aversion": 1.5},
        }
    )
    resolver, timeline, _ = build_regime_matrix_allocator_resolver(
        bench, matrix, regime_mode="auto"
    )
    assert len(timeline) >= 4
    seen_modes: set[str] = set()
    for row in timeline[:: max(1, len(timeline) // 8)]:
        dt = pd.Timestamp(row["date"])
        alloc = resolver(dt)
        seen_modes.add(alloc.mode)
    assert len(seen_modes) >= 1
    risk_off_alloc = allocator_params_from_setup(matrix["risk_off"])
    assert risk_off_alloc.mode == "min_var"
    assert risk_off_alloc.lookback_days == 252


def test_refresh_dynamic_ctx_swaps_resolver() -> None:
    bench = _bench_returns()
    ctx = {
        "bench_ret": bench,
        "regime_mode": "auto",
        "detector_version": "v2",
        "fast_risk_off_exit": True,
        "allocator_resolver": None,
    }
    matrix = normalize_regime_setups(
        {"neutral": {"mode": "risk_parity", "lookback_days": 200, "shrinkage": 0.15, "risk_aversion": 2.0}}
    )
    updated = refresh_dynamic_allocator_resolver(
        ctx, regime_setups=matrix, shared_round_setup={"top_n_actual": 10}
    )
    assert updated.get("regime_setups") is not None
    assert updated["allocator_resolver"] is not None
    assert updated["regime_setups"]["neutral"]["mode"] == "risk_parity"


def test_normalize_round_seed_regime_setups() -> None:
    blueprint = RunBlueprint(max_weight=0.25, max_turnover=0.5, top_n=10, max_holdings=30)
    seed = {
        "rationale": "test",
        "round_setup": {
            "mode": "mean_variance",
            "lookback_days": 252,
            "shrinkage": 0.1,
            "risk_aversion": 4.0,
            "top_n_actual": 8,
            "max_weight_actual": 0.2,
            "max_turnover_actual": 0.4,
            "no_trade_tol": 0.0,
            "turnover_penalty_mult": 1.0,
        },
        "regime_setups": {
            "risk_off": {"mode": "min_var", "lookback_days": 252},
            "neutral": {"mode": "mean_variance", "lookback_days": 126},
            "risk_on": {"mode": "mean_variance", "lookback_days": 63},
        },
        "factor_ranges": {"w_mom": [0.2, 1.0]},
    }
    out = normalize_round_seed(seed, blueprint=blueprint, param_controls={})
    assert has_regime_matrix(out["regime_setups"])
    assert out["regime_setups"]["risk_on"]["lookback_days"] == 63


def test_pro_controls_skip_allocator_keys_when_matrix() -> None:
    blueprint = RunBlueprint(max_weight=0.25, max_turnover=0.5, top_n=10, max_holdings=30)
    round_setup = {
        "mode": "mean_variance",
        "lookback_days": 999,
        "shrinkage": 0.1,
        "risk_aversion": 4.0,
        "top_n_actual": 8,
        "max_weight_actual": 0.2,
        "max_turnover_actual": 0.4,
        "no_trade_tol": 0.0,
        "turnover_penalty_mult": 1.0,
    }
    matrix = normalize_regime_setups(
        {
            "risk_off": {"mode": "min_var", "lookback_days": 252, "shrinkage": 0.2, "risk_aversion": 1.0},
            "neutral": {"mode": "mean_variance", "lookback_days": 126, "shrinkage": 0.1, "risk_aversion": 3.5},
            "risk_on": {"mode": "mean_variance", "lookback_days": 63, "shrinkage": 0.05, "risk_aversion": 1.5},
        },
        shared_setup=round_setup,
    )
    controls = build_pro_round_param_controls(
        {},
        blueprint=blueprint,
        round_setup=round_setup,
        factor_ranges={"w_mom": [0.1, 1.5]},
        factor_choices=None,
        regime_setups=matrix,
    )
    assert controls["lookback_days"]["fixed"] == 126
    assert controls["top_n_actual"]["fixed"] == 8
    assert controls["w_mom"]["mode"] == "search"
