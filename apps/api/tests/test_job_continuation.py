"""Tests for below-benchmark job continuation."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.job_continuation import (
    apply_continuation_request,
    build_continuation_snapshot_from_meta,
    continuation_runtime_state,
    extract_continuation_snapshot,
)
from app.models import BacktestMode, BacktestRequest, Objective, OptimizationMode
from app import jobs as job_service


def _pro_request(**overrides) -> BacktestRequest:
    base = dict(
        scenario_id="test",
        max_weight=0.2,
        objective=Objective.max_sharpe,
        backtest_mode=BacktestMode.static,
        start_date="2020-01-01",
        end_date="2024-12-31",
        trials=20,
        top_models=3,
        asset_classes=["equity"],
        enable_oos=True,
        train_ratio=0.7,
        fee_bps=10.0,
        rebalance_freq="QE",
        max_turnover=1.0,
        optimization_mode=OptimizationMode.pro_auto,
        refinement_batch_size=5,
        refinement_challengers_per_round=4,
        refinement_max_rounds=8,
    )
    base.update(overrides)
    return BacktestRequest(**base)


def test_build_continuation_snapshot_round_trip():
    meta = {
        "rounds_completed": 5,
        "trials_total": 24,
        "retired_model_codes": ["M2"],
        "ai_rationales": ["round 5 rationale"],
        "champion_adjusted_score": 1.23,
        "final_champion_params": {"model_code": "M5", "mode": "risk_parity"},
    }
    champion = (
        1.23,
        {"model_code": "M5", "mode": "risk_parity"},
        {"sharpe": 1.1, "cagr": 0.12, "max_drawdown": -0.08, "raw_score": 1.23},
    )
    snap = build_continuation_snapshot_from_meta(
        meta,
        champion_record=champion,
        learning_trials=[{"round": 5, "outcome": "failed"}],
        convergence_history=[{"round": 5, "trial": 24}],
        carry_champion_model_code="M5",
        next_model_no=6,
        prior_challenger_signatures={"sig-a"},
        prior_round_setup={"top_n": 20},
        prior_regime_setups=None,
        prior_regime_factor_ranges=None,
        prior_regime_class_quotas=None,
        prior_factor_ranges={"mom": [0, 1]},
        prior_factor_choices={"mom": "on"},
        rounds_without_gain=2,
        all_records=[champion],
    )
    assert snap["mode"] == "pro"
    assert snap["rounds_completed"] == 5
    assert snap["champion_record"]["params"]["model_code"] == "M5"
    assert snap["learning_trials"][0]["round"] == 5
    runtime = continuation_runtime_state(snap)
    assert runtime["start_round_idx"] == 5
    assert runtime["global_trial"] == 24
    assert runtime["initial_champion_record"][1]["model_code"] == "M5"
    assert runtime["prior_round_setup"] == {"top_n": 20}


def test_apply_continuation_request_bumps_pro_rounds():
    req = _pro_request()
    snap = {"mode": "pro", "rounds_completed": 5, "trials_total": 20}
    next_req = apply_continuation_request(
        req,
        snap,
        extra_refinement_rounds=4,
        extra_trials_per_round=6,
        prior_job_id="abc-123",
    )
    assert next_req.continue_from_job_id == "abc-123"
    assert next_req.refinement_max_rounds == 9
    assert next_req.refinement_challengers_per_round == 6
    assert next_req.extra_refinement_rounds == 4


def test_extract_continuation_from_nested_pro_refinement():
    result = MagicMock()
    result.candidates = []
    result.narrative_facts = {
        "pro_refinement": {
            "rounds_completed": 3,
            "trials_total": 15,
            "final_champion_params": {"model_code": "M3"},
            "champion_adjusted_score": 0.9,
            "convergence_history": [{"round": 3}],
            "ai_rationales": ["ok"],
            "retired_model_codes": [],
        },
        "ai_champion_model_code": "M3",
    }
    snap = extract_continuation_snapshot(result)
    assert snap is not None
    assert snap["rounds_completed"] == 3
    assert snap["champion_record"]["params"]["model_code"] == "M3"


def test_continue_job_queues_with_snapshot():
    prior_req = _pro_request()
    prior_result = MagicMock()
    prior_result.narrative_facts = {
        "continuation_snapshot": {
            "mode": "pro",
            "rounds_completed": 2,
            "trials_total": 10,
            "champion_record": {
                "score": 1.0,
                "params": {"model_code": "M2"},
                "metrics": {"sharpe": 1.0},
            },
        }
    }
    with patch.object(job_service, "_load_completed_job", return_value=(prior_req, prior_result)):
        with patch.object(job_service, "create_job", return_value="new-job-id") as create_mock:
            job_id = job_service.continue_job("old-job", extra_refinement_rounds=3)
    assert job_id == "new-job-id"
    create_mock.assert_called_once()
    new_req, snap = create_mock.call_args[0][0], create_mock.call_args[1]["continuation_snapshot"]
    assert new_req.refinement_max_rounds == 5
    assert snap["prior_job_id"] == "old-job"


def test_continue_job_missing_prior_raises():
    with patch.object(job_service, "_load_completed_job", return_value=None):
        with pytest.raises(LookupError):
            job_service.continue_job("missing")
