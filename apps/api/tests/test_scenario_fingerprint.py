"""Scenario fingerprint stability and exclusion rules."""

from __future__ import annotations

from app.models import BacktestRequest, Objective, OptimizationMode
from app.scenario_fingerprint import (
    compute_scenario_fingerprint,
    scenario_identity_field_names,
    scenario_payload,
)


def _base_request(**overrides) -> BacktestRequest:
    base = {
        "scenario_id": "growth",
        "start_date": "2018-01-01",
        "end_date": "2024-12-31",
        "asset_classes": ["equity", "bond"],
        "objective": Objective.max_sharpe,
        "max_weight": 0.25,
        "max_turnover": 0.5,
        "top_n": 10,
        "trials": 50,
        "top_models": 5,
        "optimization_mode": OptimizationMode.standard,
        "notify_email": "user@example.com",
        "report_language": "zh",
    }
    base.update(overrides)
    return BacktestRequest(**base)


def test_fingerprint_stable_for_identical_requests() -> None:
    a = _base_request()
    b = _base_request()
    assert compute_scenario_fingerprint(a) == compute_scenario_fingerprint(b)


def test_excluded_fields_do_not_change_fingerprint() -> None:
    base_fp = compute_scenario_fingerprint(_base_request())
    assert base_fp == compute_scenario_fingerprint(
        _base_request(
            trials=120,
            top_models=20,
            optimization_mode=OptimizationMode.pro_auto,
            refinement_batch_size=12,
            refinement_max_rounds=15,
            notify_email="other@example.com",
            report_language="ko",
        )
    )


def test_market_fields_change_fingerprint() -> None:
    base_fp = compute_scenario_fingerprint(_base_request())
    assert base_fp != compute_scenario_fingerprint(_base_request(max_weight=0.3))
    assert base_fp != compute_scenario_fingerprint(_base_request(objective=Objective.max_return))
    assert base_fp != compute_scenario_fingerprint(_base_request(fee_bps=15.0))


def test_end_date_affects_exact_fingerprint_only() -> None:
    req_a = _base_request(end_date="2024-12-31")
    req_b = _base_request(end_date="2025-06-30")
    assert compute_scenario_fingerprint(req_a) != compute_scenario_fingerprint(req_b)
    assert compute_scenario_fingerprint(req_a, include_end_date=False) == compute_scenario_fingerprint(
        req_b, include_end_date=False
    )


def test_universe_lists_are_order_insensitive() -> None:
    a = _base_request(asset_classes=["bond", "equity"])
    b = _base_request(asset_classes=["equity", "bond"])
    assert compute_scenario_fingerprint(a) == compute_scenario_fingerprint(b)


def test_scenario_payload_omits_search_effort_fields() -> None:
    payload = scenario_payload(_base_request())
    for field in scenario_identity_field_names():
        assert field not in payload
