from __future__ import annotations

import pandas as pd

from app.engine.experimental_objective_switch import (
    is_experimental_objective_switch_enabled,
    objective_switch_metadata,
)
from app.models import BacktestRequest, Objective


def _minimal_request() -> BacktestRequest:
    return BacktestRequest(
        scenario_id="test-exp-sandbox",
        max_weight=0.5,
        objective=Objective.max_sharpe,
        trials=10,
        top_models=3,
        asset_classes=["equity", "bond"],
    )


def test_experiment_gate_disabled_by_default() -> None:
    req = _minimal_request()
    assert is_experimental_objective_switch_enabled(req) is False


def test_experiment_gate_enabled_only_with_explicit_flag() -> None:
    req = BacktestRequest(
        **{
            **_minimal_request().model_dump(),
            "experiment": {
                "enabled": True,
                "mode": "objective_switch",
                "regime_mode": "risk_off",
            },
        }
    )
    assert is_experimental_objective_switch_enabled(req) is True


def test_experiment_metadata_uses_explicit_regime_override() -> None:
    req = BacktestRequest(
        **{
            **_minimal_request().model_dump(),
            "experiment": {
                "enabled": True,
                "mode": "objective_switch",
                "regime_mode": "risk_on",
            },
        }
    )
    prices = pd.DataFrame(
        {"SPY": [100.0, 99.0, 98.5, 98.0]},
        index=pd.bdate_range("2024-01-01", periods=4),
    )

    meta = objective_switch_metadata(req, prices, "SPY")
    assert meta["mode"] == "objective_switch"
    assert meta["enabled"] is True
    assert meta["resolved_regime_signal"] == "risk_on"
    assert meta["chosen_objective"] == "max_return"


def test_regime_walk_forward_switch_count() -> None:
    req = BacktestRequest(
        **{
            **_minimal_request().model_dump(),
            "experiment": {
                "enabled": True,
                "mode": "objective_switch",
                "regime_mode": "auto",
            },
        }
    )
    idx = pd.bdate_range("2020-01-01", periods=400)
    rng = pd.Series(range(400), index=idx, dtype=float)
    prices = pd.DataFrame({"SPY": 100 + rng * 0.1}, index=idx)
    meta = objective_switch_metadata(req, prices, "SPY")
    assert "regime_switch_count" in meta
    assert isinstance(meta["regime_labels_sample"], list)
