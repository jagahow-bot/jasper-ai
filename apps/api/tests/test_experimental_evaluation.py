from __future__ import annotations

import pandas as pd

from app.engine.experimental_objective_switch import objective_switch_metadata
from app.models import BacktestRequest, Objective


def test_objective_metadata_points_to_lab() -> None:
    req = BacktestRequest(
        scenario_id="test-exp-eval",
        max_weight=0.5,
        objective=Objective.max_sharpe,
        trials=10,
        top_models=3,
        asset_classes=["equity", "bond"],
        experiment={
            "enabled": True,
            "mode": "objective_switch",
            "regime_mode": "risk_off",
        },
    )
    prices = pd.DataFrame(
        {"SPY": [100.0, 99.0, 98.5, 98.0, 97.5, 97.0]},
        index=pd.bdate_range("2024-01-01", periods=6),
    )
    meta = objective_switch_metadata(req, prices, "SPY")
    assert meta["chosen_objective"] == "min_max_drawdown"
    assert "lab_note" in meta
