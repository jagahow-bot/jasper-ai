"""Tests for AI-facing JSON float sanitization."""

from __future__ import annotations

from app.engine.ai_json import dumps_for_ai, round_ai_float, sanitize_for_ai
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
        __import__("json").dumps(params, sort_keys=True, default=str)
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
