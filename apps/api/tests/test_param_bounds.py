"""Run-level ceilings must bound Optuna search and AI param sets."""

from __future__ import annotations

from app.engine.param_bounds import (
    RunBlueprint,
    cap_search_high,
    clamp_param_dict,
    normalize_param_controls,
)
from app.engine.optimizer import run_optuna_search
from app.engine.spec import BacktestSpec
import numpy as np
import pandas as pd


def test_normalize_off_max_weight_uses_run_slider():
    bp = RunBlueprint(max_weight=0.5, max_turnover=1.0, top_n=50)
    out = normalize_param_controls(
        {"max_weight_actual": {"mode": "off"}},
        bp,
    )
    assert out["max_weight_actual"]["mode"] == "fixed"
    assert float(out["max_weight_actual"]["fixed"]) == 0.5


def test_cap_search_high_never_above_run_max_weight():
    bp = RunBlueprint(max_weight=0.5, max_turnover=1.0, top_n=50)
    hi = cap_search_high(
        "max_weight_actual",
        1.0,
        bp,
        {"mode": "search", "max": 1.0},
    )
    assert float(hi) == 0.5


def test_clamp_param_dict_records_violation():
    bp = RunBlueprint(max_weight=0.5, max_turnover=0.8, top_n=40)
    params = {"max_weight_actual": 0.95, "top_n_actual": 80}
    clipped, violations = clamp_param_dict(params, bp)
    assert clipped["max_weight_actual"] == 0.5
    assert clipped["top_n_actual"] == 40
    assert len(violations) >= 2


def test_ai_apply_controls_clamps_above_ceiling():
    bp = RunBlueprint(max_weight=0.5, max_turnover=1.0, top_n=50)
    controls = normalize_param_controls({}, bp)

    out = {
        "mode": "mean_variance",
        "lookback_days": 252,
        "risk_aversion": 4.0,
        "top_n_actual": 12,
        "max_weight_actual": 0.9,
        "max_turnover_actual": 0.5,
        "w_mom": 1.0,
        "w_lowvol": 0.5,
        "w_equity": 0.6,
        "w_bond": 0.4,
    }
    out, violations = clamp_param_dict(out, bp, param_controls=controls)
    assert out["max_weight_actual"] <= 0.5 + 1e-9
    assert any(v["param"] == "max_weight_actual" for v in violations)


def test_optuna_trial_max_weight_never_exceeds_request():
    rng = np.random.default_rng(0)
    dates = pd.bdate_range("2018-01-01", periods=400)
    tickers = ["A", "B", "C", "D", "E"]
    prices = pd.DataFrame(
        {t: 100 * np.cumprod(1 + rng.normal(0.0003, 0.01, len(dates))) for t in tickers},
        index=dates,
    )
    records = run_optuna_search(
        prices,
        max_weight=0.5,
        max_turnover=1.0,
        top_n=50,
        objective="max_sharpe",
        trials=8,
        param_controls={"max_weight_actual": {"mode": "search", "min": 0.05, "max": 1.0}},
        spec=BacktestSpec(rebalance_rule="QE"),
    )
    assert records, "expected feasible trials"
    for _, params, _ in records:
        assert float(params["max_weight_actual"]) <= 0.5 + 1e-6
