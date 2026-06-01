"""Pro round AI seed schema parse and normalization."""

from __future__ import annotations

from app.engine.ai_params import _extract_json, _round_seed_response_schema, normalize_round_seed
from app.engine.param_bounds import RunBlueprint
from app.engine.param_taxonomy import (
    FACTOR_CATEGORICAL_KEYS,
    FACTOR_NUMERIC_KEYS,
    PARAM_NUMERIC_DECIMALS,
    SETUP_PARAM_KEYS,
    _round_seed_numeric,
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
    assert "w_mom" in range_props
    assert "w_reversal" not in range_props


def test_round_seed_response_schema_compact():
    schema = _round_seed_response_schema(require_rationale=False, compact=True)
    assert schema["required"] == ["round_setup"]
    props = schema["properties"]
    assert props["factor_ranges"]["properties"] == {}
    assert props["factor_choices"]["properties"] == {}


def test_normalize_round_seed_clips_ranges():
    bp = RunBlueprint(max_weight=0.5, max_turnover=0.8, top_n=20)
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


def test_taxonomy_key_lists_complete():
    assert "mode" in SETUP_PARAM_KEYS
    assert "w_mom" in FACTOR_NUMERIC_KEYS
    assert "mom_indicator" in FACTOR_CATEGORICAL_KEYS
    assert "lookback_days" not in FACTOR_NUMERIC_KEYS
