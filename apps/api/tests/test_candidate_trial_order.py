"""Candidate list display preserves Optuna trial order; ranks reflect objective."""

from __future__ import annotations

from app.engine.backtest import _rerank_candidates_by_objective
from app.engine.refinement import top_records_for_report
from app.models import PortfolioCandidate


def _candidate(model_code: str, objective: float) -> PortfolioCandidate:
    return PortfolioCandidate(
        rank=0,
        model_code=model_code,
        weights={},
        sharpe=objective,
        max_drawdown=0.0,
        cagr=0.0,
        volatility=0.0,
        analytics={
            "sample_metrics": {
                "in_sample": {"objective_value": objective, "sharpe": objective},
            },
        },
    )


def test_rerank_assigns_objective_ranks_without_reordering():
    candidates = [
        _candidate("M0001", 0.50),
        _candidate("M0002", 0.95),
        _candidate("M0003", 0.60),
    ]
    out = _rerank_candidates_by_objective(candidates, "max_sharpe")
    assert [c.model_code for c in out] == ["M0001", "M0002", "M0003"]
    assert [c.rank for c in out] == [3, 1, 2]


def test_top_records_for_report_keeps_trial_order_not_objective_order():
    records = [
        (0.50, {"optuna_trial_number": 2, "model_code": "M0003"}, {"objective_value_is": 0.50}),
        (0.95, {"optuna_trial_number": 0, "model_code": "M0001"}, {"objective_value_is": 0.95}),
        (0.60, {"optuna_trial_number": 1, "model_code": "M0002"}, {"objective_value_is": 0.60}),
        (0.40, {"optuna_trial_number": 3, "model_code": "M0004"}, {"objective_value_is": 0.40}),
    ]
    out = top_records_for_report(records, "max_sharpe", top_n_models=3)
    assert [r[1]["model_code"] for r in out] == ["M0001", "M0002", "M0003"]
