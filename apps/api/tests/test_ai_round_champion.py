"""Post-Optuna AI round champion selection."""

from __future__ import annotations

from app.engine.ai_params import (
    _round_champion_fallback_code,
    generate_ai_round_champion,
)
from app.engine.refinement import (
    build_round_champion_ai_payload,
    record_for_model_code,
)


def test_build_round_champion_ai_payload_orders_by_model_code():
    pool = [
        (0.9, {"model_code": "M0002"}, {"sharpe": 1.1, "cagr": 0.1, "max_drawdown": -0.1}),
        (1.2, {"model_code": "M0001"}, {"sharpe": 1.4, "cagr": 0.12, "max_drawdown": -0.08}),
    ]
    payload = build_round_champion_ai_payload(
        pool,
        objective_effective="max_sharpe",
        round_index=2,
        incoming_champion_model_code="M0001",
        benchmark_ticker="SPY",
        oos_enabled=False,
    )
    codes = [c["model_code"] for c in payload["candidates"]]
    assert codes == ["M0001", "M0002"]
    assert payload["candidates"][0]["role"] == "incoming_champion"
    assert payload["candidates"][1]["role"] == "challenger"


def test_record_for_model_code_finds_pool_trial():
    pool = [
        (1.0, {"model_code": "M0003"}, {"sharpe": 1.0}),
        (1.2, {"model_code": "M0001"}, {"sharpe": 1.2}),
    ]
    rec = record_for_model_code(pool, "m0001")
    assert rec is not None
    assert rec[1]["model_code"] == "M0001"


def test_round_champion_fallback_picks_highest_objective():
    payload = {
        "candidates": [
            {"model_code": "M0001", "objective_value": 0.5},
            {"model_code": "M0002", "objective_value": 0.9},
        ]
    }
    assert _round_champion_fallback_code(payload) == "M0002"


def test_generate_ai_round_champion_without_api_key_uses_fallback(monkeypatch):
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_api_key", "")
    payload = {
        "round": 1,
        "candidates": [
            {"model_code": "M0001", "objective_value": 0.5},
            {"model_code": "M0002", "objective_value": 0.9},
        ],
    }
    out = generate_ai_round_champion(payload=payload)
    assert out["enabled"] is False
    assert out["round_champion_model_code"] == "M0002"
