"""Candidate list display sorted by model_code; ranks reflect objective."""

from __future__ import annotations

from app.engine.backtest import (
    _rerank_candidates_by_objective,
    _sort_candidates_by_model_code,
)
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


def test_sort_candidates_by_model_code_orders_catalog_numbers():
    candidates = [
        _candidate("M0010", 0.50),
        _candidate("M0006", 0.95),
        _candidate("M0001", 0.60),
        _candidate("M0013", 0.40),
    ]
    out = _sort_candidates_by_model_code(candidates)
    assert [c.model_code for c in out] == ["M0001", "M0006", "M0010", "M0013"]


def test_top_records_for_report_sorts_by_model_code_not_completion_order():
    records = [
        (0.50, {"optuna_trial_number": 9, "model_code": "M0010"}, {"objective_value_is": 0.50}),
        (0.95, {"optuna_trial_number": 5, "model_code": "M0006"}, {"objective_value_is": 0.95}),
        (0.60, {"optuna_trial_number": 0, "model_code": "M0001"}, {"objective_value_is": 0.60}),
        (0.70, {"optuna_trial_number": 12, "model_code": "M0013"}, {"objective_value_is": 0.70}),
    ]
    out = top_records_for_report(records, "max_sharpe", top_n_models=4)
    assert [r[1]["model_code"] for r in out] == ["M0001", "M0006", "M0010", "M0013"]
