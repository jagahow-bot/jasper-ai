"""Dynamic Pro champion uses comprehensive score, not max Sharpe alone."""

from __future__ import annotations

from app.engine.dynamic_objective import DYNAMIC_OBJECTIVE, trial_scoring_objective
from app.engine.objectives import (
    DYNAMIC_COMPREHENSIVE_SCORING,
    compute_dynamic_comprehensive_score,
    compute_objective_score,
)
from app.engine.refinement import best_record_in_pool, record_objective_sort_value


def test_trial_scoring_objective_for_dynamic():
    assert trial_scoring_objective(DYNAMIC_OBJECTIVE) == DYNAMIC_COMPREHENSIVE_SCORING
    assert trial_scoring_objective("max_sharpe") == "max_sharpe"


def test_comprehensive_score_prefers_balanced_trial_over_sharpe_only():
    high_sharpe = {
        "sharpe": 1.9,
        "sortino": 1.7,
        "cagr": 0.06,
        "max_drawdown": -0.55,
        "turnover_avg": 0.45,
    }
    balanced = {
        "sharpe": 1.45,
        "sortino": 1.55,
        "cagr": 0.14,
        "max_drawdown": -0.10,
        "turnover_avg": 0.06,
    }
    assert compute_dynamic_comprehensive_score(balanced) > compute_dynamic_comprehensive_score(
        high_sharpe
    )
    assert compute_objective_score(DYNAMIC_COMPREHENSIVE_SCORING, balanced) > compute_objective_score(
        DYNAMIC_COMPREHENSIVE_SCORING, high_sharpe
    )


def test_best_record_in_pool_uses_comprehensive_objective_value_is():
    metrics_a = {
        "sharpe": 2.0,
        "objective_value_is": 0.5,
    }
    metrics_b = {
        "sharpe": 1.2,
        "objective_value_is": 1.1,
    }
    pool = [
        (0.5, {"model_code": "M0001"}, metrics_a),
        (1.1, {"model_code": "M0002"}, metrics_b),
    ]
    winner = best_record_in_pool(pool, DYNAMIC_OBJECTIVE)
    assert winner is not None
    assert winner[1]["model_code"] == "M0002"
    assert record_objective_sort_value(DYNAMIC_OBJECTIVE, winner[0], winner[2]) == 1.1
