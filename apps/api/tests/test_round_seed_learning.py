"""Pro round-2+ learning block for generate_ai_round_seed."""

from __future__ import annotations

from app.engine.ai_params import _build_round_seed_learning_block
from app.engine.param_taxonomy import summarize_prior_round_seed
import pandas as pd

from app.engine.refinement import (
    beats_benchmark_from_alpha,
    benchmark_status_from_alpha,
    build_round_seed_learning_payload,
    compute_exploration_phase,
    compute_round_benchmark_fields,
    merge_round_seed_budget_fields,
)
from app.engine.spec import DEFAULT_SPEC


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


def test_merge_round_seed_budget_fields():
    ctx = merge_round_seed_budget_fields(
        None,
        round_index=1,
        total_rounds=4,
        trials_per_round=5,
        total_trial_budget=20,
    )
    assert ctx["round_index"] == 1
    assert ctx["total_rounds"] == 4
    assert ctx["trials_per_round"] == 5
    assert ctx["exploration_phase"] == "explore"


def test_benchmark_status_from_alpha():
    assert benchmark_status_from_alpha(0.0) == "above"
    assert benchmark_status_from_alpha(0.02) == "above"
    assert benchmark_status_from_alpha(-0.01) == "below"
    assert benchmark_status_from_alpha(None) == "unknown"
    assert beats_benchmark_from_alpha(0.0) is True
    assert beats_benchmark_from_alpha(-0.001) is False
    assert beats_benchmark_from_alpha(None) is None


def test_compute_round_benchmark_fields_unknown_without_port_ret():
    fields = compute_round_benchmark_fields({"sharpe": 1.0, "cagr": 0.1})
    assert fields["benchmark_status"] == "unknown"
    assert fields["beats_benchmark"] is None
    assert fields.get("portfolio_vs_benchmark") is None


def test_compute_round_benchmark_fields_below_benchmark():
    idx = pd.date_range("2020-01-01", periods=120, freq="B")
    port_ret = pd.Series(-0.0002, index=idx)
    bench_ret = pd.Series(0.0003, index=idx)
    prices = pd.DataFrame({"SPY": (1 + bench_ret).cumprod()}, index=idx)
    metrics = {"port_ret": port_ret, "sharpe": 0.5, "cagr": -0.05, "max_drawdown": -0.2}
    fields = compute_round_benchmark_fields(
        metrics,
        prices_train=prices,
        benchmark_ticker="SPY",
        spec=DEFAULT_SPEC,
    )
    assert fields["benchmark_status"] == "below"
    assert fields["beats_benchmark"] is False
    assert fields["benchmark_alpha"] is not None
    assert float(fields["benchmark_alpha"]) < 0
    pvb = fields.get("portfolio_vs_benchmark") or {}
    assert pvb.get("portfolio_total_return_pct") is not None
    assert pvb.get("benchmark_total_return_pct") is not None


def test_compute_exploration_phase_late_near_target():
    assert (
        compute_exploration_phase(
            round_index=4,
            total_rounds=4,
            target_adjusted_score=1.0,
            champion_in_sample_objective=0.99,
            benchmark_alpha=0.05,
        )
        == "narrow"
    )
    assert (
        compute_exploration_phase(
            round_index=1,
            total_rounds=4,
            benchmark_alpha=-0.1,
        )
        == "explore"
    )


def test_round1_learning_block_includes_budget():
    block = _build_round_seed_learning_block(
        merge_round_seed_budget_fields(
            None,
            round_index=1,
            total_rounds=3,
            trials_per_round=4,
            total_trial_budget=12,
        )
    )
    assert "REFINEMENT_BUDGET" in block
    assert "EXPLORATION_PHASE" in block


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
        total_rounds=5,
        trials_per_round=4,
        total_trial_budget=24,
    )
    block = _build_round_seed_learning_block(ctx)
    assert "REFINEMENT_BUDGET" in block
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


def test_round2_dynamic_block_keeps_champion_under_tight_budget(monkeypatch):
    """Reproduce round-2 dynamic prompts where PRIOR_REGIME_* used to evict CHAMPION."""
    monkeypatch.setattr(
        "app.engine.ai_params.settings.gemini_round_seed_learning_max_chars", 2400
    )
    ctx = build_round_seed_learning_payload(
        champion_record=_champion_record(),
        champion_score=0.3745,
        min_gain=0.0,
        learning_trials=[{**_failed_rows()[0], "outcome": "failed"}],
        objective="dynamic",
        round_index=2,
        prior_round_setup={
            "lookback_days": 252,
            "max_turnover_actual": 0.5,
            "max_weight_actual": 0.2,
            "mode": "mean_variance",
            "no_trade_tol": 0.005,
            "risk_aversion": 4.0,
            "shrinkage": 0.1,
            "top_n_actual": 20,
            "turnover_penalty_mult": 1.0,
        },
        prior_regime_setups={
            "neutral": {
                "lookback_days": 252,
                "mode": "max_sharpe",
                "risk_aversion": 4.0,
                "shrinkage": 0.1,
            },
            "risk_off": {
                "lookback_days": 252,
                "mode": "min_max_drawdown",
                "risk_aversion": 8.0,
                "shrinkage": 0.15,
            },
            "risk_on": {
                "lookback_days": 126,
                "mode": "max_return",
                "risk_aversion": 2.0,
                "shrinkage": 0.05,
            },
        },
        prior_regime_factor_ranges={
            "neutral": {
                "factor_lookback_days": [126, 378],
                "w_lowvol": [0.1, 1.2],
                "w_mom": [0.1, 1.2],
                "w_reversal": [0.0, 1.0],
                "w_trend": [0.1, 1.0],
                "w_value": [0.1, 1.2],
            },
            "risk_off": {
                "factor_lookback_days": [180, 504],
                "w_lowvol": [0.5, 2.0],
                "w_mom": [0.0, 0.5],
                "w_reversal": [0.1, 1.2],
                "w_trend": [0.0, 0.6],
                "w_value": [0.2, 1.5],
            },
            "risk_on": {
                "factor_lookback_days": [126, 252],
                "w_lowvol": [0.0, 0.6],
                "w_mom": [0.5, 2.0],
                "w_reversal": [0.0, 0.8],
                "w_trend": [0.4, 1.5],
                "w_value": [0.0, 0.8],
            },
        },
        prior_regime_class_quotas={
            "neutral": {
                "alternative": 0.1,
                "bond": 0.3,
                "commodity": 0.1,
                "equity": 0.4,
                "real_estate": 0.1,
            },
            "risk_off": {
                "alternative": 0.1,
                "bond": 0.6,
                "commodity": 0.15,
                "equity": 0.1,
                "real_estate": 0.05,
            },
            "risk_on": {
                "alternative": 0.1,
                "bond": 0.1,
                "commodity": 0.1,
                "equity": 0.6,
                "real_estate": 0.1,
            },
        },
        prior_factor_choices={
            "drawdown_indicator": "maximum_drawdown",
            "lowvol_indicator": "standard_deviation",
            "mom_indicator": "risk_adjusted_return",
            "reversal_indicator": "negative_return",
            "trend_indicator": "moving_average_crossover",
            "value_indicator": "book_to_market",
        },
        benchmark_ticker="SPY",
        total_rounds=3,
        trials_per_round=4,
        total_trial_budget=15,
    )
    ctx["narrative_champion_model_code"] = "M0001"
    ctx["final_champion_model_code"] = "M0001"
    block = _build_round_seed_learning_block(ctx)
    assert "CHAMPION:" in block
    assert "model_code=M0001" in block
    assert "REFINE_AROUND_CHAMPION" in block
    assert "NARRATIVE_CHAMPION" in block
    assert "PRIOR_REGIME_CLASS_QUOTAS" not in block or "CHAMPION:" in block
    assert len(block) <= 2400


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
