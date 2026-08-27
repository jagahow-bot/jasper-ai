"""Standard-mode hybrid: AI seeds enqueue + Optuna explores remaining budget."""

from __future__ import annotations

from unittest.mock import patch

import pandas as pd
import pytest

from app.engine.optimizer import prepare_enqueue_params, run_optuna_search
from app.engine.param_bounds import RunBlueprint


@pytest.fixture
def tiny_prices() -> pd.DataFrame:
    idx = pd.date_range("2020-01-01", periods=120, freq="B")
    return pd.DataFrame(
        {
            "AAA": 100 + pd.Series(range(len(idx))).values * 0.01,
            "BBB": 50 + pd.Series(range(len(idx))).values * 0.02,
        },
        index=idx,
    )


def test_prepare_enqueue_remaps_mode_and_snaps_lookback():
    bp = RunBlueprint(
        max_weight=0.3,
        max_turnover=0.5,
        top_n=10,
        max_holdings=10,
        customization_drift=1.0,
    )
    prepared = prepare_enqueue_params(
        {
            "mode": "risk_parity",
            "lookback_days": 200,
            "w_mom": 1.2,
            "scenario_style": "defensive",
            "model_code": "M0001",
        },
        blueprint=bp,
        param_controls=None,
    )
    assert prepared["allocator_mode"] == "risk_parity"
    assert "mode" not in prepared
    assert prepared["lookback_days"] == 189  # 126 + 3*21
    assert prepared["w_mom"] == 1.2
    assert "scenario_style" not in prepared
    assert "model_code" not in prepared


def test_ai_seeds_are_enqueued_not_truncating_trials(tiny_prices: pd.DataFrame):
    captured: dict = {"enqueued": [], "n_trials": None}

    class FakeStudy:
        def enqueue_trial(self, seed: dict) -> None:
            captured["enqueued"].append(dict(seed))

        def optimize(self, _objective, *, n_trials: int, **_kwargs) -> None:
            captured["n_trials"] = n_trials

    seeds = [
        {"mode": "min_var", "lookback_days": 252, "w_mom": 0.5},
        {"mode": "risk_parity", "lookback_days": 126, "w_lowvol": 1.0},
    ]
    with patch("app.engine.optimizer.optuna.create_study", return_value=FakeStudy()):
        with pytest.raises(ValueError, match="No feasible"):
            run_optuna_search(
                tiny_prices,
                max_weight=0.5,
                max_turnover=0.5,
                top_n=2,
                objective="max_sharpe",
                trials=6,
                ai_seed_param_sets=seeds,
            )

    assert captured["n_trials"] == 6
    assert len(captured["enqueued"]) == 2
    assert captured["enqueued"][0]["allocator_mode"] == "min_var"
    assert captured["enqueued"][1]["allocator_mode"] == "risk_parity"


def test_ai_seed_enqueue_capped_by_trial_budget(tiny_prices: pd.DataFrame):
    captured: dict = {"enqueued": []}

    class FakeStudy:
        def enqueue_trial(self, seed: dict) -> None:
            captured["enqueued"].append(dict(seed))

        def optimize(self, _objective, *, n_trials: int, **_kwargs) -> None:
            captured["n_trials"] = n_trials

    seeds = [{"mode": "min_var", "lookback_days": 252} for _ in range(10)]
    with patch("app.engine.optimizer.optuna.create_study", return_value=FakeStudy()):
        with pytest.raises(ValueError, match="No feasible"):
            run_optuna_search(
                tiny_prices,
                max_weight=0.5,
                max_turnover=0.5,
                top_n=2,
                objective="max_sharpe",
                trials=3,
                ai_seed_param_sets=seeds,
            )

    assert captured["n_trials"] == 3
    assert len(captured["enqueued"]) == 3


def test_prepare_enqueue_omits_fixed_controls():
    bp = RunBlueprint(
        max_weight=0.3,
        max_turnover=0.5,
        top_n=10,
        max_holdings=10,
        customization_drift=1.0,
    )
    prepared = prepare_enqueue_params(
        {
            "allocator_mode": "min_var",
            "lookback_days": 252,
            "w_mom": 0.8,
            "customization_drift_actual": 0.2,
        },
        blueprint=bp,
        param_controls={
            "allocator_mode": {"mode": "fixed", "fixed": "min_var"},
            "customization_drift_actual": {"mode": "fixed", "fixed": 0.2},
        },
    )
    assert "allocator_mode" not in prepared
    assert "customization_drift_actual" not in prepared
    assert prepared["w_mom"] == 0.8
    assert prepared["lookback_days"] == 252
