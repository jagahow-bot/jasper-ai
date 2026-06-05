"""Post-Optuna AI round champion selection."""

from __future__ import annotations

from app.engine.ai_params import (
    _MAX_ROUND_CHAMPION_ATTEMPTS,
    _round_champion_composite_score,
    _round_champion_fallback_code,
    _round_champion_max_output_tokens,
    _thinking_config_for_round_champion,
    generate_ai_round_champion,
)
from app.engine.refinement import (
    build_round_champion_ai_payload,
    record_for_model_code,
)


def test_build_round_champion_ai_payload_orders_by_model_code():
    pool = [
        (
            0.9,
            {"model_code": "M0002"},
            {
                "sharpe": 1.1,
                "cagr": 0.1,
                "max_drawdown": -0.1,
                "objective_value_is": 0.9,
                "train_metrics": {
                    "sharpe": 1.1,
                    "cagr": 0.1,
                    "max_drawdown": -0.1,
                    "objective_value": 0.9,
                },
            },
        ),
        (
            1.2,
            {"model_code": "M0001"},
            {
                "sharpe": 1.4,
                "cagr": 0.12,
                "max_drawdown": -0.08,
                "objective_value_is": 1.2,
                "train_metrics": {
                    "sharpe": 1.4,
                    "cagr": 0.12,
                    "max_drawdown": -0.08,
                    "objective_value": 1.2,
                },
            },
        ),
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
    assert payload["candidates"][0]["objective_value_is"] == 1.2
    assert payload["candidates"][0]["horizons"]["in_sample"]["sharpe"] == 1.4
    assert payload["candidates"][0]["horizons"]["full_sample"]["objective_value"] == 1.2


def test_build_round_champion_ai_payload_includes_oos_horizons():
    pool = [
        (
            1.0,
            {"model_code": "M0001"},
            {
                "sharpe": 1.5,
                "cagr": 0.15,
                "max_drawdown": -0.1,
                "objective_value_is": 1.5,
                "objective_value_oos": 0.8,
                "gap_objective": 0.7,
                "train_metrics": {
                    "sharpe": 1.5,
                    "cagr": 0.15,
                    "max_drawdown": -0.1,
                    "objective_value": 1.5,
                },
                "validation_metrics": {
                    "sharpe": 0.9,
                    "cagr": 0.08,
                    "max_drawdown": -0.12,
                    "objective_value": 0.8,
                },
                "overfitting_assessment": {
                    "risk_level": "high",
                    "gap_sharpe": 0.6,
                    "gap_objective": 0.7,
                    "out_of_sample_objective": 0.8,
                },
            },
        ),
    ]
    payload = build_round_champion_ai_payload(
        pool,
        objective_effective="max_sharpe",
        round_index=1,
        incoming_champion_model_code=None,
        benchmark_ticker="SPY",
        oos_enabled=True,
    )
    row = payload["candidates"][0]
    assert row["holdout_objective"] == 0.8
    assert row["overfitting_risk"] == "high"
    assert row["horizons"]["out_of_sample"]["objective_value"] == 0.8
    assert row["horizons"]["gap"]["objective"] == 0.7


def test_record_for_model_code_finds_pool_trial():
    pool = [
        (1.0, {"model_code": "M0003"}, {"sharpe": 1.0}),
        (1.2, {"model_code": "M0001"}, {"sharpe": 1.2}),
    ]
    rec = record_for_model_code(pool, "m0001")
    assert rec is not None
    assert rec[1]["model_code"] == "M0001"


def test_round_champion_composite_prefers_balanced_oos_over_high_is():
    payload = {
        "oos_enabled": True,
        "candidates": [
            {
                "model_code": "M0001",
                "objective_value": 1.5,
                "objective_value_is": 1.5,
                "holdout_objective": 0.4,
                "overfitting_risk": "high",
                "horizons": {
                    "in_sample": {"objective_value": 1.5},
                    "out_of_sample": {"objective_value": 0.4},
                    "full_sample": None,
                    "gap": {"objective": 1.1},
                },
            },
            {
                "model_code": "M0002",
                "objective_value": 0.9,
                "objective_value_is": 0.9,
                "holdout_objective": 0.85,
                "overfitting_risk": "low",
                "horizons": {
                    "in_sample": {"objective_value": 0.9},
                    "out_of_sample": {"objective_value": 0.85},
                    "full_sample": None,
                    "gap": {"objective": 0.05},
                },
            },
        ],
    }
    assert _round_champion_fallback_code(payload) == "M0002"
    assert _round_champion_composite_score(
        payload["candidates"][1], oos_enabled=True
    ) > _round_champion_composite_score(payload["candidates"][0], oos_enabled=True)


def test_round_champion_fallback_uses_composite_without_oos():
    payload = {
        "oos_enabled": False,
        "candidates": [
            {
                "model_code": "M0001",
                "objective_value": 0.5,
                "horizons": {
                    "in_sample": {"objective_value": 0.5},
                    "out_of_sample": None,
                    "full_sample": {"objective_value": 0.5},
                    "gap": None,
                },
            },
            {
                "model_code": "M0002",
                "objective_value": 0.9,
                "horizons": {
                    "in_sample": {"objective_value": 0.9},
                    "out_of_sample": None,
                    "full_sample": {"objective_value": 0.9},
                    "gap": None,
                },
            },
        ],
    }
    assert _round_champion_fallback_code(payload) == "M0002"


def test_round_champion_max_output_tokens_bumps_on_retry():
    assert _round_champion_max_output_tokens(attempt=0) == 1024
    assert _round_champion_max_output_tokens(attempt=1) == 2048


def test_round_champion_thinking_disabled_for_gemini_3():
    assert _thinking_config_for_round_champion(model="gemini-3.5-flash") is None


def test_round_champion_allows_single_retry():
    assert _MAX_ROUND_CHAMPION_ATTEMPTS == 2


def test_generate_ai_round_champion_retries_on_max_tokens(monkeypatch):
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_api_key", "test-key")
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_model", "gemini-3.5-flash")
    calls: list[dict] = []

    def fake_post(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            return "MAX_TOKENS", '{"round_champion_model'
        return "STOP", '{"round_champion_model_code":"M0002","rationale":"Best OOS."}'

    monkeypatch.setattr("app.engine.ai_params._gemini_round_seed_post", fake_post)
    payload = {
        "oos_enabled": True,
        "round": 2,
        "candidates": [
            {
                "model_code": "M0001",
                "objective_value": 0.5,
                "horizons": {
                    "in_sample": {"objective_value": 0.5},
                    "out_of_sample": {"objective_value": 0.3},
                },
            },
            {
                "model_code": "M0002",
                "objective_value": 0.9,
                "horizons": {
                    "in_sample": {"objective_value": 0.9},
                    "out_of_sample": {"objective_value": 0.85},
                },
            },
        ],
    }
    out = generate_ai_round_champion(payload=payload)
    assert len(calls) == 2
    assert all(c["thinking_config"] is None for c in calls)
    assert calls[0]["generation_config"]["maxOutputTokens"] == 1024
    assert calls[1]["generation_config"]["maxOutputTokens"] == 2048
    assert out["enabled"] is True
    assert out["round_champion_model_code"] == "M0002"


def test_generate_ai_round_champion_without_api_key_uses_fallback(monkeypatch):
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_api_key", "")
    payload = {
        "oos_enabled": False,
        "round": 1,
        "candidates": [
            {
                "model_code": "M0001",
                "objective_value": 0.5,
                "horizons": {
                    "in_sample": {"objective_value": 0.5},
                    "full_sample": {"objective_value": 0.5},
                },
            },
            {
                "model_code": "M0002",
                "objective_value": 0.9,
                "horizons": {
                    "in_sample": {"objective_value": 0.9},
                    "full_sample": {"objective_value": 0.9},
                },
            },
        ],
    }
    out = generate_ai_round_champion(payload=payload)
    assert out["enabled"] is False
    assert out["round_champion_model_code"] == "M0002"
