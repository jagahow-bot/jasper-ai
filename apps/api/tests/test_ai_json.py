"""Tests for AI-facing JSON float sanitization."""

from __future__ import annotations

import json

from app.engine.ai_json import (
    AI_NUMBER_DESCRIPTION,
    dumps_for_ai,
    factor_range_item_schema,
    round_ai_float,
    sanitize_ai_response,
    sanitize_for_ai,
    sanitize_json_text_for_log,
    truncate_json_numeric_literals,
)
from app.engine.ai_params import (
    _build_round_seed_learning_block,
    _extract_json,
    _round_seed_response_schema,
)
from app.engine.param_taxonomy import normalize_round_seed, summarize_prior_round_seed
from app.engine.param_bounds import RunBlueprint
from app.engine.refinement import summarize_params_for_ai


def test_round_ai_float_weight_noise():
    raw = 0.40000000000000002220446049250313080847263336181640625
    assert round_ai_float(raw, key="w_value") == 0.4


def test_round_ai_float_int_days():
    assert round_ai_float(252.7, key="lookback_days") == 253
    assert round_ai_float(126.2, key="factor_lookback_days") == 126


def test_round_ai_float_metric():
    assert round_ai_float(1.23456789, key="sharpe") == 1.2346


def test_sanitize_for_ai_nested_params():
    blob = {
        "w_mom": 1.2000000000000002,
        "lookback_days": 252.0,
        "nested": {"alpha": 0.0123456789012345},
    }
    out = sanitize_for_ai(blob)
    assert out["w_mom"] == 1.2
    assert out["lookback_days"] == 252
    assert out["nested"]["alpha"] == 0.0123


def test_dumps_for_ai_shortens_float_json():
    params = {
        "w_value": 0.40000000000000002220446049250313080847263336181640625,
        "risk_aversion": 2.0000000000000004,
        "lookback_days": 252,
        "mode": "mean_variance",
    }
    raw_len = len(
        json.dumps(params, sort_keys=True, default=str)
    )
    clean = dumps_for_ai(params)
    assert len(clean) < raw_len
    assert "00000000000" not in clean


def test_summarize_params_for_ai_full_no_long_decimals():
    params = {
        "mode": "factor_risk_parity",
        "w_value": 0.40000000000000002220446049250313080847263336181640625,
        "lookback_days": 252,
        "adjusted_score": 1.1,
    }
    summary = summarize_params_for_ai(params, full=True)
    assert "00000000000" not in summary
    assert len(summary) < 400


def test_regime_factor_ranges_nasty_floats_compact_in_prompt(monkeypatch):
    """Regression: dynamic round seed learning must not bloat with IEEE noise."""
    monkeypatch.setattr(
        "app.engine.ai_params.settings.gemini_round_seed_learning_max_chars", 12000
    )
    noise = 0.40000000000000002220446049250313080847263336181640625
    ctx = {
        "round_index": 2,
        "total_rounds": 5,
        "trials_per_round": 5,
        "exploration_phase": "explore",
        "target_adjusted_score": 1.0500000000000003,
        "prior_round_setup": {
            "mode": "mean_variance",
            "lookback_days": 252.0000000001,
            "shrinkage": noise,
            "risk_aversion": 2.0000000000000004,
        },
        "prior_regime_factor_ranges": {
            "risk_off": {
                "w_mom": [noise, 1.2000000000000002],
                "factor_lookback_days": [126.7, 504.2],
            },
            "neutral": {"w_lowvol": [0.0, noise]},
            "risk_on": {"w_trend": [0.1, 0.9000000000000001]},
        },
        "champion": {
            "in_sample_objective": noise,
            "train_sharpe": 1.234567890123456,
            "gap_objective": 0.030000000000000027,
            "overfitting_risk": "low",
        },
        "champion_record_params": {
            "mode": "mean_variance",
            "w_mom": noise,
            "lookback_days": 252,
        },
    }
    block = _build_round_seed_learning_block(ctx)
    assert "00000000000" not in block
    assert len(block) < 3500
    assert "PRIOR_REGIME_FACTOR_RANGES" in block
    assert "0.4" in block


def test_extract_json_sanitizes_gemini_response():
    noisy = (
        '{"round_setup":{"shrinkage":0.40000000000000002220446049250313080847263336181640625},'
        '"regime_factor_ranges":{"risk_off":{"w_mom":[0.0,1.2000000000000002]}}}'
    )
    parsed = _extract_json(noisy)
    assert parsed is not None
    assert parsed["round_setup"]["shrinkage"] == 0.4
    assert parsed["regime_factor_ranges"]["risk_off"]["w_mom"] == [0.0, 1.2]
    assert "00000000000" not in json.dumps(parsed)


def test_normalize_round_seed_sanitizes_all_numeric_fields():
    noise = 0.40000000000000002220446049250313080847263336181640625
    seed = {
        "rationale": "test",
        "round_setup": {
            "mode": "mean_variance",
            "lookback_days": 252.9,
            "shrinkage": noise,
            "risk_aversion": 2.0000000000000004,
            "top_n_actual": 10,
            "max_weight_actual": noise,
            "max_turnover_actual": 0.3,
            "no_trade_tol": 0.01,
            "turnover_penalty_mult": 1.0,
        },
        "regime_setups": {
            "risk_off": {
                "mode": "min_var",
                "lookback_days": 252.1,
                "shrinkage": noise,
                "risk_aversion": 1.0,
            },
            "neutral": {
                "mode": "mean_variance",
                "lookback_days": 126,
                "shrinkage": 0.1,
                "risk_aversion": 3.0,
            },
            "risk_on": {
                "mode": "mean_variance",
                "lookback_days": 63,
                "shrinkage": 0.05,
                "risk_aversion": 1.5,
            },
        },
        "regime_factor_ranges": {
            "risk_off": {"w_mom": [0.0, noise], "factor_lookback_days": [126.2, 504.8]},
            "neutral": {"w_value": [noise, 1.5]},
            "risk_on": {"w_trend": [0.1, 0.9000000000000001]},
        },
        "factor_choices": {},
    }
    out = normalize_round_seed(
        sanitize_ai_response(seed),
        blueprint=RunBlueprint(max_weight=0.2, max_turnover=1.0, top_n=50),
        param_controls=None,
    )
    dumped = dumps_for_ai(out)
    assert "00000000000" not in dumped
    assert out["round_setup"]["shrinkage"] == 0.4
    assert out["regime_setups"]["risk_off"]["lookback_days"] == 252


def test_summarize_prior_round_seed_rounds_factor_ranges():
    noise = 0.40000000000000002220446049250313080847263336181640625
    prior = summarize_prior_round_seed(
        {
            "factor_ranges": {"w_mom": [0.0, noise]},
            "regime_factor_ranges": {
                "neutral": {"w_lowvol": [noise, 1.2000000000000002]}
            },
        }
    )
    assert prior["factor_ranges"]["w_mom"] == [0.0, 0.4]
    assert prior["regime_factor_ranges"]["neutral"]["w_lowvol"] == [0.4, 1.2]
    assert "00000000000" not in dumps_for_ai(prior)


def test_factor_range_item_schema_uses_integer_for_days():
    assert factor_range_item_schema("factor_lookback_days") == {"type": "INTEGER"}
    assert factor_range_item_schema("w_mom")["type"] == "NUMBER"
    assert AI_NUMBER_DESCRIPTION in factor_range_item_schema("w_mom")["description"]


def test_truncate_json_numeric_literals_long_float():
    long_val = "1.5000" + "1234567890" * 200
    raw = f'{{"w_value":[0.0,{long_val}]}}'
    cleaned = truncate_json_numeric_literals(raw)
    assert len(cleaned) < len(raw)
    parsed = json.loads(cleaned)
    assert parsed["w_value"][1] == 1.5


def test_sanitize_json_text_for_log_truncates_bloat():
    long_val = "0.4" + "0" * 500
    excerpt = sanitize_json_text_for_log(f'{{"shrinkage":{long_val}}}')
    assert len(excerpt) <= 240
    assert "00000000000" not in excerpt


def _full_regime_factor_slice() -> dict[str, list[float | int]]:
    from app.engine.param_taxonomy import FACTOR_NUMERIC_KEYS

    out: dict[str, list[float | int]] = {}
    for key in FACTOR_NUMERIC_KEYS:
        if key.endswith("_days"):
            out[key] = [126, 504]
        else:
            out[key] = [0.0, 1.5]
    return out


def test_dynamic_full_regime_seed_schema_and_compact_json_size():
    """Full per-regime factor keys (3×FACTOR_NUMERIC_KEYS) fit with compact numerics."""
    from app.engine.param_taxonomy import (
        FACTOR_NUMERIC_KEYS,
        REGIME_KEYS,
        normalize_round_seed,
    )

    blueprint = RunBlueprint(max_weight=0.15, max_turnover=0.5, top_n=20)
    slice_full = _full_regime_factor_slice()
    full_ai = {
        "rationale": "Round 1 dynamic explore.",
        "optimization_strategy": "Wide bands per regime on all factor keys.",
        "performance_assessment": "No prior champion.",
        "round_setup": {
            "mode": "max_sharpe",
            "lookback_days": 252,
            "shrinkage": 0.15,
            "risk_aversion": 3.0,
            "top_n_actual": 20,
            "max_weight_actual": 0.15,
            "max_turnover_actual": 0.5,
            "no_trade_tol": 0.005,
            "turnover_penalty_mult": 1.0,
        },
        "regime_setups": {
            "risk_off": {"mode": "min_max_drawdown", "risk_aversion": 6.0, "shrinkage": 0.25},
            "neutral": {"mode": "mean_variance", "risk_aversion": 3.0, "shrinkage": 0.15},
            "risk_on": {"mode": "max_return", "risk_aversion": 1.5, "shrinkage": 0.05},
        },
        "factor_choices": {
            "mom_indicator": "risk_adjusted_return",
            "trend_indicator": "exponential_moving_average",
        },
        "regime_factor_ranges": {r: dict(slice_full) for r in REGIME_KEYS},
    }
    schema = _round_seed_response_schema(include_regime_matrix=True)
    regime_schema = schema["properties"]["regime_factor_ranges"]["properties"]
    for regime in REGIME_KEYS:
        assert set(regime_schema[regime]["properties"]) == set(FACTOR_NUMERIC_KEYS)

    out = normalize_round_seed(
        sanitize_ai_response(full_ai),
        blueprint=blueprint,
        param_controls=None,
    )
    serialized = dumps_for_ai(out)
    assert len(serialized) < 12000
    for regime in REGIME_KEYS:
        assert set(out["regime_factor_ranges"][regime].keys()) == set(
            FACTOR_NUMERIC_KEYS
        )
    assert out["regime_factor_ranges"]["risk_off"]["w_mom"] == [0.0, 1.5]
