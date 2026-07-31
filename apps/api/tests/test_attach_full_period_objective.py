"""Full-period objective is recorded for every leaderboard trial."""

import numpy as np
import pandas as pd

from app.engine.refinement import attach_full_period_objective
from app.engine.backtest import _leaderboard_row_from_record, _oos_leaderboard
from app.engine.spec import BacktestSpec
from app.models import PortfolioCandidate


def _sim_with_returns(rets: list[float], start: str = "2020-01-01") -> dict:
    idx = pd.bdate_range(start, periods=len(rets))
    port_ret = pd.Series(rets, index=idx, dtype=float)
    equity = (1.0 + port_ret).cumprod()
    return {"port_ret": port_ret, "equity": equity}


def test_attach_full_period_objective_from_stitched_is_oos():
    rng = np.random.default_rng(0)
    train = _sim_with_returns((0.001 + 0.01 * rng.standard_normal(200)).tolist())
    val = _sim_with_returns(
        (0.0005 + 0.012 * rng.standard_normal(120)).tolist(),
        start="2020-10-05",
    )
    metrics: dict = {}
    attach_full_period_objective(
        metrics,
        objective_mode="max_sharpe",
        train_m=train,
        val_m=val,
        spec=BacktestSpec(),
    )
    assert metrics.get("objective_value_full") is not None
    assert isinstance(metrics.get("full_metrics"), dict)
    assert metrics["full_metrics"].get("objective_value") == metrics["objective_value_full"]


def test_oos_leaderboard_includes_full_from_records():
    records = [
        (
            0.5,
            {"model_code": "M0036", "optuna_trial_number": 35},
            {
                "objective_value_is": 0.6577,
                "objective_value_oos": 1.2207,
                "objective_value_full": 0.8123,
                "gap_objective": -0.5630,
            },
        )
    ]
    rows = _oos_leaderboard([], records=records, objective_effective="max_sharpe")
    assert len(rows) == 1
    assert rows[0]["full_sample_objective"] == 0.8123


def test_leaderboard_row_falls_back_to_full_metrics_snapshot():
    row = _leaderboard_row_from_record(
        {"model_code": "M0001", "optuna_trial_number": 0},
        {
            "objective_value_is": 0.4,
            "objective_value_oos": 0.5,
            "full_metrics": {"objective_value": 0.44, "sharpe": 0.44},
        },
        objective_effective="max_sharpe",
    )
    assert row is not None
    assert row["full_sample_objective"] == 0.44


def test_candidate_still_overrides_record_full_for_same_code():
    records = [
        (
            0.9,
            {"model_code": "M0018", "optuna_trial_number": 17},
            {
                "objective_value_is": 0.9,
                "objective_value_oos": 1.1,
                "objective_value_full": 0.99,
            },
        )
    ]
    candidates = [
        PortfolioCandidate(
            rank=1,
            model_code="M0018",
            is_champion=True,
            weights={"SPY": 1.0},
            sharpe=0.65,
            max_drawdown=-0.3,
            cagr=0.1,
            volatility=0.2,
            analytics={
                "sample_metrics": {
                    "in_sample": {"objective_value": 0.4715},
                    "out_of_sample": {"objective_value": 1.1606},
                    "full_sample": {"objective_value": 0.6555},
                    "gap": {"objective": -0.6891},
                }
            },
        )
    ]
    rows = _oos_leaderboard(
        candidates, records=records, objective_effective="max_sharpe"
    )
    m18 = next(r for r in rows if r["model_code"] == "M0018")
    assert m18["full_sample_objective"] == 0.6555
    assert m18["in_sample_objective"] == 0.4715
