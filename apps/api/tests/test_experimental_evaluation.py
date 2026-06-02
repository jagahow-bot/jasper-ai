from __future__ import annotations

import pandas as pd

from app.engine.experimental_objective_switch import (
    build_evaluation_summary,
    objective_switch_metadata,
)
from app.models import BacktestRequest, Objective, PortfolioCandidate


def _minimal_request() -> BacktestRequest:
    return BacktestRequest(
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


def test_evaluation_summary_includes_fixed_arm() -> None:
    req = _minimal_request()
    prices = pd.DataFrame(
        {"SPY": [100.0, 99.0, 98.5, 98.0, 97.5, 97.0]},
        index=pd.bdate_range("2024-01-01", periods=6),
    )
    meta = objective_switch_metadata(req, prices, "SPY")
    champion = PortfolioCandidate(
        rank=1,
        weights={"SPY": 1.0},
        sharpe=1.1,
        volatility=0.12,
        cagr=0.08,
        max_drawdown=-0.12,
        train_sharpe=1.2,
        validation_sharpe=0.9,
        analytics={
            "sample_metrics": {
                "in_sample": {"sharpe": 1.2},
                "out_of_sample": {"sharpe": 0.9},
                "full_sample": {"sharpe": 1.1},
            }
        },
    )
    summary = build_evaluation_summary(
        req=req,
        user_objective="max_sharpe",
        experimental_meta=meta,
        champion=champion,
    )
    assert summary["user_objective"] == "max_sharpe"
    assert summary["switch_objective"] == "min_max_drawdown"
    assert summary["fixed_arm"]["in_sample_sharpe"] == 1.2
    assert summary["ab_evaluation_ran"] is False
    assert "disclaimer" in summary
