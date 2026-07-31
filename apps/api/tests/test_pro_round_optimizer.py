"""Pro round: fixed setup + factor range sampling in Optuna."""

from __future__ import annotations

from unittest.mock import patch

import numpy as np
import pandas as pd
import pytest

from app.engine.param_bounds import RunBlueprint
from app.engine.param_taxonomy import (
    FACTOR_NUMERIC_KEYS,
    SETUP_PARAM_KEYS,
    build_pro_round_param_controls,
    is_factor_key,
    is_setup_key,
)
from app.engine.optimizer import run_optuna_search
from app.engine.spec import BacktestSpec


def _feasible_metrics(**overrides):
    base = {
        "sharpe": 1.2,
        "cagr": 0.08,
        "max_drawdown": -0.12,
        "volatility": 0.14,
        "sortino": 1.5,
        "cvar_95": -0.05,
        "turnover_avg": 0.2,
        "metrics_suspect": False,
        "equity": pd.Series([100, 101, 102]),
    }
    base.update(overrides)
    return base


@pytest.fixture
def price_panel() -> pd.DataFrame:
    rng = np.random.default_rng(0)
    dates = pd.bdate_range("2018-01-01", periods=400)
    tickers = ["A", "B", "C", "D", "E"]
    return pd.DataFrame(
        {t: 100 * np.cumprod(1 + rng.normal(0.0003, 0.01, len(dates))) for t in tickers},
        index=dates,
    )


def test_taxonomy_helpers():
    assert is_setup_key("lookback_days")
    assert is_setup_key("w_equity")
    assert is_setup_key("customization_drift_actual")
    assert not is_setup_key("w_mom")
    assert is_factor_key("w_mom")
    assert is_factor_key("mom_indicator")
    assert not is_setup_key("objective_mode")
    assert "lookback_days" in SETUP_PARAM_KEYS
    assert "customization_drift_actual" in SETUP_PARAM_KEYS


def test_build_pro_round_param_controls_forces_setup_fixed():
    bp = RunBlueprint(max_weight=0.5, max_turnover=0.8, top_n=20, max_holdings=30)
    controls = build_pro_round_param_controls(
        {"lookback_days": {"mode": "search", "min": 126, "max": 504}},
        blueprint=bp,
        round_setup={"mode": "risk_parity", "lookback_days": 252, "top_n_actual": 10},
        factor_ranges={"w_mom": [0.6, 1.2]},
        factor_choices={"mom_indicator": "risk_adjusted_return"},
    )
    assert controls["lookback_days"]["mode"] == "fixed"
    assert controls["lookback_days"]["fixed"] == 252
    assert controls["w_mom"]["mode"] == "search"
    assert float(controls["w_mom"]["min"]) >= 0.6
    assert float(controls["w_mom"]["max"]) <= 1.2
    assert controls["mom_indicator"]["fixed"] == "risk_adjusted_return"


def test_build_pro_round_param_controls_completes_sparse_factor_ranges():
    bp = RunBlueprint(max_weight=0.5, max_turnover=0.8, top_n=20, max_holdings=30)
    controls = build_pro_round_param_controls(
        {},
        blueprint=bp,
        round_setup={"mode": "risk_parity", "lookback_days": 252, "top_n_actual": 10},
        factor_ranges={"w_mom": [0.6, 1.2]},
        factor_choices={},
    )
    for key in FACTOR_NUMERIC_KEYS:
        assert controls[key]["mode"] == "search"


def test_optuna_pro_round_fixed_setup_and_factor_in_range(price_panel: pd.DataFrame):
    round_setup = {
        "mode": "risk_parity",
        "lookback_days": 252,
        "shrinkage": 0.1,
        "risk_aversion": 3.0,
        "max_weight_actual": 0.2,
        "top_n_actual": 5,
        "no_trade_tol": 0.005,
        "turnover_penalty_mult": 1.0,
        "max_turnover_actual": 0.4,
        "w_equity": 0.7,
        "w_bond": 0.3,
    }
    factor_ranges = {"w_mom": [0.8, 1.0], "w_lowvol": [0.3, 0.5]}
    factor_choices = {"mom_indicator": "risk_adjusted_return", "lowvol_indicator": "negative_vol"}

    with patch(
        "app.engine.optimizer.simulate_dynamic_portfolio",
        side_effect=lambda *_a, **_k: _feasible_metrics(),
    ):
        records = run_optuna_search(
            price_panel,
            max_weight=0.5,
            max_turnover=0.8,
            top_n=20,
            objective="max_sharpe",
            trials=6,
            round_setup=round_setup,
            factor_ranges=factor_ranges,
            factor_choices=factor_choices,
            spec=BacktestSpec(rebalance_rule="QE"),
        )

    assert len(records) >= 1
    for _score, params, _metrics in records:
        assert params["lookback_days"] == 252
        assert params["mode"] == "risk_parity"
        assert params["top_n_actual"] == 5
        assert 0.8 <= params["w_mom"] <= 1.0 + 1e-9
        assert 0.3 <= params["w_lowvol"] <= 0.5 + 1e-9
        assert params["mom_indicator"] == "risk_adjusted_return"
        assert params["lowvol_indicator"] == "negative_vol"
        assert params["param_source"] == "pro_round_optuna"
