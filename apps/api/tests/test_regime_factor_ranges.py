"""Per-regime factor_ranges for dynamic Pro rounds (Option A prefixed Optuna keys)."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.engine.dynamic_objective import (
    REGIME_KEYS,
    factor_by_regime_from_trial_params,
)
from app.engine.param_taxonomy import (
    build_pro_round_param_controls,
    has_regime_factor_ranges,
    normalize_round_seed,
    regime_factor_param_key,
)
from app.engine.param_bounds import RunBlueprint
from app.engine.optimizer import run_optuna_search


@pytest.fixture
def price_panel() -> pd.DataFrame:
    rng = np.random.default_rng(0)
    dates = pd.bdate_range("2018-01-01", periods=400)
    tickers = ["A", "B", "C", "D", "E"]
    return pd.DataFrame(
        {t: 100 * np.cumprod(1 + rng.normal(0.0003, 0.01, len(dates))) for t in tickers},
        index=dates,
    )


def test_normalize_round_seed_regime_factor_ranges() -> None:
    blueprint = RunBlueprint(max_weight=0.25, max_turnover=0.5, top_n=10)
    seed = {
        "rationale": "per-regime factors",
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
        "regime_factor_ranges": {
            "risk_off": {"w_mom": [0.0, 0.5], "w_lowvol": [0.5, 1.5]},
            "risk_on": {"w_mom": [0.8, 2.0], "w_trend": [0.2, 1.0]},
        },
    }
    out = normalize_round_seed(seed, blueprint=blueprint, param_controls={})
    assert has_regime_factor_ranges(out["regime_factor_ranges"])
    assert out["regime_factor_ranges"]["risk_off"]["w_mom"][1] <= 0.5
    assert out["regime_factor_ranges"]["risk_on"]["w_mom"][0] >= 0.8
    assert out["factor_ranges"] == {}
    # Omitted neutral regime still gets full Optuna bounds (server defaults).
    assert "neutral" in out["regime_factor_ranges"]
    assert set(out["regime_factor_ranges"]["neutral"].keys()) == set(
        out["regime_factor_ranges"]["risk_off"].keys()
    )


def test_pro_controls_prefixed_regime_factor_keys() -> None:
    blueprint = RunBlueprint(max_weight=0.25, max_turnover=0.5, top_n=10)
    round_setup = {
        "mode": "mean_variance",
        "lookback_days": 252,
        "shrinkage": 0.1,
        "risk_aversion": 4.0,
        "top_n_actual": 8,
        "max_weight_actual": 0.2,
        "max_turnover_actual": 0.4,
        "no_trade_tol": 0.0,
        "turnover_penalty_mult": 1.0,
    }
    regime_setups = {
        "risk_off": {"mode": "min_var", "lookback_days": 252, "shrinkage": 0.2, "risk_aversion": 1.0},
        "neutral": {"mode": "mean_variance", "lookback_days": 126, "shrinkage": 0.1, "risk_aversion": 3.5},
        "risk_on": {"mode": "mean_variance", "lookback_days": 63, "shrinkage": 0.05, "risk_aversion": 1.5},
    }
    regime_factor_ranges = {
        "risk_off": {"w_mom": [0.0, 0.4]},
        "risk_on": {"w_mom": [1.0, 2.0]},
    }
    controls = build_pro_round_param_controls(
        {},
        blueprint=blueprint,
        round_setup=round_setup,
        factor_ranges={"w_mom": [0.1, 1.5]},
        factor_choices=None,
        regime_setups=regime_setups,
        regime_factor_ranges=regime_factor_ranges,
    )
    ro_key = regime_factor_param_key("risk_off", "w_mom")
    rn_key = regime_factor_param_key("risk_on", "w_mom")
    assert controls[ro_key]["max"] == 0.4
    assert controls[rn_key]["min"] == 1.0
    assert "w_mom" not in controls


def test_optuna_samples_distinct_regime_factor_keys(price_panel) -> None:
    import pandas as pd

    prices = price_panel.iloc[:260]
    round_setup = {
        "mode": "mean_variance",
        "lookback_days": 252,
        "shrinkage": 0.1,
        "risk_aversion": 4.0,
        "top_n_actual": 5,
        "max_weight_actual": 0.2,
        "max_turnover_actual": 0.4,
        "no_trade_tol": 0.0,
        "turnover_penalty_mult": 1.0,
    }
    regime_setups = {
        r: {
            "mode": "mean_variance",
            "lookback_days": 126,
            "shrinkage": 0.1,
            "risk_aversion": 3.0,
        }
        for r in REGIME_KEYS
    }
    regime_factor_ranges = {
        "risk_off": {"w_mom": [0.0, 0.3]},
        "risk_on": {"w_mom": [1.2, 2.0]},
    }
    records = run_optuna_search(
        prices,
        max_weight=0.25,
        max_turnover=0.5,
        top_n=8,
        objective="max_sharpe",
        trials=2,
        round_setup=round_setup,
        regime_setups=regime_setups,
        regime_factor_ranges=regime_factor_ranges,
    )
    assert records
    _score, params, _metrics = records[0]
    ro = regime_factor_param_key("risk_off", "w_mom")
    rn = regime_factor_param_key("risk_on", "w_mom")
    assert ro in params
    assert rn in params
    assert float(params[ro]) <= 0.3
    assert float(params[rn]) >= 1.2
    assert params.get("regime_factor_matrix") is True


def test_factor_by_regime_from_trial_params_rebuilds_slices():
    ro = regime_factor_param_key("risk_off", "w_mom")
    rn = regime_factor_param_key("risk_on", "w_mom")
    params = {
        "regime_factor_matrix": True,
        ro: 0.2,
        rn: 1.5,
        "w_mom": 0.9,
        "mom_indicator": "risk_adjusted_return",
    }
    by_regime = factor_by_regime_from_trial_params(params, default_lookback=252)
    assert by_regime is not None
    assert float(by_regime["risk_off"].w_mom) == pytest.approx(0.2)
    assert float(by_regime["risk_on"].w_mom) == pytest.approx(1.5)
    assert by_regime["risk_off"].mom_indicator == "risk_adjusted_return"
