"""Pro round AI seed schema parse and normalization."""

from __future__ import annotations

from app.engine.ai_params import (
    _ROUND_SEED_PERFORMANCE_ASSESSMENT_RULES,
    _build_round_seed_learning_block,
    _extract_json,
    _round_seed_response_schema,
    round_seed_factor_range_guidance,
    round_seed_regime_factor_range_guidance,
)
from app.engine.param_bounds import RunBlueprint
from app.engine.param_taxonomy import (
    FACTOR_CATEGORICAL_KEYS,
    FACTOR_NUMERIC_KEYS,
    PARAM_NUMERIC_DECIMALS,
    REGIME_KEYS,
    SETUP_PARAM_KEYS,
    _round_seed_numeric,
    complete_factor_ranges,
    normalize_round_seed,
)


def test_round_seed_response_schema_shape():
    schema = _round_seed_response_schema(require_rationale=True)
    props = schema["properties"]
    assert "round_setup" in props
    assert "factor_ranges" in props
    assert "factor_choices" in props
    assert "rationale" in props
    setup_props = props["round_setup"]["properties"]
    assert "w_equity" not in setup_props
    assert "mode" in setup_props
    assert set(schema["required"]) == {"round_setup", "rationale"}
    range_props = props["factor_ranges"]["properties"]
    assert set(range_props.keys()) == set(FACTOR_NUMERIC_KEYS)
    assert "optimization_strategy" in props
    assert "performance_assessment" in props


def test_round_seed_response_schema_compact():
    schema = _round_seed_response_schema(require_rationale=False, compact=True)
    assert schema["required"] == ["round_setup"]
    props = schema["properties"]
    assert props["factor_ranges"]["properties"] == {}
    assert props["factor_choices"]["properties"] == {}


def test_round_seed_response_schema_dynamic_full_regime_ranges():
    schema = _round_seed_response_schema(
        require_rationale=True, include_regime_matrix=True
    )
    props = schema["properties"]
    assert props["factor_ranges"]["properties"] == {}
    assert "regime_class_quotas" in props
    quota_props = props["regime_class_quotas"]["properties"]
    assert set(quota_props.keys()) == set(REGIME_KEYS)
    regime_props = props["regime_factor_ranges"]["properties"]
    assert set(regime_props.keys()) == set(REGIME_KEYS)
    for regime in REGIME_KEYS:
        assert set(regime_props[regime]["properties"].keys()) == set(
            FACTOR_NUMERIC_KEYS
        )


def test_round_seed_regime_factor_range_guidance_requires_all_keys():
    guidance = round_seed_regime_factor_range_guidance(
        exploration_phase="explore", round_index=1, total_rounds=5
    )
    assert "EVERY" in guidance
    assert "2–4" not in guidance
    assert "FOCUS" not in guidance
    assert "risk_off" in guidance and "risk_on" in guidance


def test_normalize_round_seed_clips_ranges():
    bp = RunBlueprint(max_weight=0.5, max_turnover=0.8, top_n=20, max_holdings=30)
    raw = {
        "rationale": "Focus momentum band",
        "round_setup": {
            "mode": "risk_parity",
            "lookback_days": 252,
            "max_weight_actual": 0.9,
            "top_n_actual": 8,
        },
        "factor_ranges": {
            "w_mom": [0.5, 2.5],
            "w_reversal": [0.0, 1.0],
        },
        "factor_choices": {
            "mom_indicator": "risk_adjusted_return",
        },
    }
    parsed = _extract_json(
        '{"rationale":"Focus momentum band","round_setup":{"mode":"risk_parity",'
        '"lookback_days":252,"max_weight_actual":0.9,"top_n_actual":8},'
        '"factor_ranges":{"w_mom":[0.5,2.5],"w_reversal":[0.0,1.0]},'
        '"factor_choices":{"mom_indicator":"risk_adjusted_return"}}'
    )
    assert parsed is not None
    normalized = normalize_round_seed(parsed, blueprint=bp, param_controls={})
    assert normalized["rationale"] == "Focus momentum band"
    assert normalized["round_setup"]["mode"] == "risk_parity"
    assert float(normalized["factor_ranges"]["w_mom"][1]) <= 2.0
    assert normalized["factor_choices"]["mom_indicator"] == "risk_adjusted_return"


def test_round_seed_numeric_uses_four_decimal_places():
    assert PARAM_NUMERIC_DECIMALS == 4
    assert _round_seed_numeric(0.123456789) == 0.1235
    assert _round_seed_numeric(252) == 252.0


def test_round_seed_performance_assessment_rules_require_objectivity():
    rules = _ROUND_SEED_PERFORMANCE_ASSESSMENT_RULES
    assert "performance_assessment" in rules
    assert "below benchmark" in rules or "未達基準" in rules
    assert "optimization_strategy" in rules
    assert "No cheerleading" in rules or "without hype" in rules


def test_learning_block_includes_vs_benchmark_for_below_alpha_prompt():
    block = _build_round_seed_learning_block(
        {
            "round_index": 2,
            "total_rounds": 3,
            "trials_per_round": 5,
            "champion": {
                "train_sharpe": 0.8,
                "in_sample_objective": 0.05,
                "benchmark_vs": {
                    "portfolio_vs_benchmark": {
                        "alpha": -0.04,
                        "portfolio_sharpe": 0.8,
                        "benchmark_total_return_pct": 12.0,
                    }
                },
            },
            "champion_record_params": {"model_code": "M0001"},
            "champion_record_metrics": {"sharpe": 0.8, "objective_value_is": 0.05},
            "narrative_champion_model_code": "M0001",
        }
    )
    assert "CHAMPION:" in block
    assert "VS_BENCHMARK" in block
    assert "REFINE_AROUND_CHAMPION" in block
    assert "NARRATIVE_CHAMPION" in block
    assert "-0.04" in block or "-0.040" in block


def test_learning_block_uses_current_incumbent_model_code_from_narrative():
    """Guard: refinement prompts must inject the current round incumbent model code."""
    block = _build_round_seed_learning_block(
        {
            "round_index": 3,
            "total_rounds": 3,
            "trials_per_round": 4,
            "champion": {"train_sharpe": 0.9, "in_sample_objective": 0.37},
            # Stale/incorrect record code (e.g., first-round champion).
            "champion_record_params": {"model_code": "M0001"},
            "champion_record_metrics": {"sharpe": 0.9, "objective_value_is": 0.37},
            # Current incumbent at start of this round.
            "narrative_champion_model_code": "M0008",
            "final_champion_model_code": "M0008",
        }
    )
    assert "CHAMPION:" in block
    assert "model_code=M0008" in block
    # Stale code may appear as a debug hint, but the injected CHAMPION model_code must be current.
    assert "  model_code=M0001" not in block


def test_normalize_round_seed_keeps_optimization_strategy():
    bp = RunBlueprint(max_weight=0.5, max_turnover=0.8, top_n=20, max_holdings=30)
    normalized = normalize_round_seed(
        {
            "rationale": "r",
            "optimization_strategy": "Round 1: wide bands on 3 factors.",
            "round_setup": {"mode": "risk_parity", "lookback_days": 252},
            "factor_ranges": {"w_mom": [0.2, 1.8], "w_value": [0.0, 1.0]},
        },
        blueprint=bp,
        param_controls={},
    )
    assert normalized["optimization_strategy"] == "Round 1: wide bands on 3 factors."
    assert len(normalized["factor_ranges"]) == len(FACTOR_NUMERIC_KEYS)


def test_normalize_round_seed_keeps_performance_assessment():
    bp = RunBlueprint(max_weight=0.5, max_turnover=0.8, top_n=20, max_holdings=30)
    normalized = normalize_round_seed(
        {
            "rationale": "r",
            "optimization_strategy": "Widen momentum.",
            "performance_assessment": "本輪樣本內表現未達基準，Sharpe 低於 SPY。",
            "round_setup": {"mode": "risk_parity", "lookback_days": 252},
        },
        blueprint=bp,
        param_controls={},
    )
    assert "未達基準" in normalized["performance_assessment"]


def test_round_seed_factor_range_guidance_explore_vs_narrow():
    explore = round_seed_factor_range_guidance(
        exploration_phase="explore", round_index=1, total_rounds=5
    )
    assert "EVERY" in explore and "WIDE" in explore
    assert "NOT narrow" in explore or "do NOT narrow" in explore
    narrow = round_seed_factor_range_guidance(
        exploration_phase="narrow", round_index=5, total_rounds=5
    )
    assert "ALL keys" in narrow
    assert "narrow" in narrow.lower()


def test_complete_factor_ranges_fills_sparse_ai_output():
    bp = RunBlueprint(max_weight=0.5, max_turnover=0.8, top_n=20, max_holdings=30)
    full = complete_factor_ranges(
        {"w_mom": [0.2, 1.8]},
        blueprint=bp,
        param_controls={},
    )
    assert set(full.keys()) == set(FACTOR_NUMERIC_KEYS)
    assert full["w_mom"] == [0.2, 1.8]
    assert full["w_lowvol"][0] >= 0.0


def test_taxonomy_key_lists_complete():
    assert "mode" in SETUP_PARAM_KEYS
    assert "w_mom" in FACTOR_NUMERIC_KEYS
    assert "mom_indicator" in FACTOR_CATEGORICAL_KEYS
    assert "lookback_days" not in FACTOR_NUMERIC_KEYS
