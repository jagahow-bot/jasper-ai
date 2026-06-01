"""Pro round-2+ learning block for generate_ai_round_seed."""

from __future__ import annotations

from app.engine.ai_params import _build_round_seed_learning_block
from app.engine.param_taxonomy import summarize_prior_round_seed
from app.engine.refinement import build_round_seed_learning_payload


def _champion_record() -> tuple[float, dict, dict]:
    params = {
        "mode": "mean_variance",
        "objective_mode": "max_return",
        "lookback_days": 252,
        "model_code": "M0001",
    }
    metrics = {
        "sharpe": 1.25,
        "cagr": 0.11,
        "max_drawdown": -0.18,
        "objective_value_is": 0.11,
        "overfitting_assessment": {
            "in_sample_objective": 0.11,
            "out_of_sample_objective": 0.08,
            "gap_objective": 0.03,
            "risk_level": "low",
            "train_sharpe": 1.25,
            "validation_sharpe": 1.05,
        },
        "weight_history": [
            {"date": "2024-01-01", "SPY": 0.12, "QQQ": 0.10},
            {"date": "2024-02-01", "SPY": 0.14, "QQQ": 0.09},
        ],
    }
    return (1.0, params, metrics)


def _failed_rows() -> list[dict]:
    return [
        {
            "round": 1,
            "gap_to_beat": 0.15,
            "risk_level": "high",
            "params_summary": "mode=min_var lookback=180 w_mom=1.8",
        }
    ]


def test_round1_learning_block_empty():
    block = _build_round_seed_learning_block({"round_index": 1})
    assert block == ""


def test_round2_learning_block_has_champion_and_failed(monkeypatch):
    monkeypatch.setattr(
        "app.engine.ai_params.settings.gemini_round_seed_learning_max_chars", 3200
    )
    ctx = build_round_seed_learning_payload(
        champion_record=_champion_record(),
        champion_score=1.0,
        min_gain=0.05,
        learning_trials=[{**_failed_rows()[0], "outcome": "failed"}],
        objective="max_return",
        round_index=2,
        prior_round_setup={"mode": "max_return", "lookback_days": 200},
        prior_factor_ranges={"w_mom": [0.5, 1.5]},
        prior_factor_choices={"mom_indicator": "risk_adjusted_return"},
        benchmark_ticker="SPY",
    )
    block = _build_round_seed_learning_block(ctx)
    assert "CHAMPION:" in block
    assert "FAILED_TRIALS:" in block
    assert "TARGET" in block
    assert "PRIOR_ROUND_SETUP" in block
    assert "mean_variance" in block
    assert '"mode":"max_return"' not in block.split("PRIOR_ROUND_SETUP")[1].split(
        "PRIOR_FACTOR"
    )[0]
    assert "..." not in block


def test_summarize_prior_round_seed_fixes_objective_as_mode():
    prior = summarize_prior_round_seed(
        {"round_setup": {"mode": "max_return", "lookback_days": 200}},
        champion_params={"mode": "mean_variance", "objective_mode": "max_return"},
    )
    assert prior["round_setup"]["mode"] == "mean_variance"


def test_prior_setup_keeps_valid_allocator_mode():
    prior = summarize_prior_round_seed(
        {"round_setup": {"mode": "risk_parity", "lookback_days": 252}},
        champion_params={"mode": "mean_variance", "objective_mode": "max_sharpe"},
    )
    assert prior["round_setup"]["mode"] == "risk_parity"


def test_prior_factor_choices_truncates_absurd_indicator_names():
    long_name = "book_to_market_" + ("0" * 200)
    prior = summarize_prior_round_seed(
        {"factor_choices": {"value_indicator": long_name}},
    )
    assert len(prior["factor_choices"]["value_indicator"]) <= 120


def test_learning_block_sanitizes_long_prior_factor_choices(monkeypatch):
    monkeypatch.setattr(
        "app.engine.ai_params.settings.gemini_round_seed_learning_max_chars", 8000
    )
    long_name = "x" * 500
    block = _build_round_seed_learning_block(
        {
            "round_index": 2,
            "prior_round_setup": {"mode": "mean_variance", "lookback_days": 252},
            "prior_factor_choices": {"value_indicator": long_name},
        }
    )
    assert long_name not in block
    assert "..." in block
