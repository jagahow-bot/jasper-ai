"""Tests for Gemini param JSON helpers (token-safety)."""

from __future__ import annotations

import json

from app.engine.ai_params import (
    _build_learning_context_block_for_mode,
    _extract_json,
    _param_response_schema,
    _resolve_learning_context_mode,
    _resolve_round_seed_thinking_level,
    _resolve_thinking_level,
    _round_seed_max_output_tokens,
    _thinking_config_for_model,
    _round_param_numbers,
    _salvage_truncated_json,
    generate_ai_round_seed,
    resolve_ai_param_seed_plan,
)


def test_resolve_ai_param_seed_plan_small_n_unchanged(monkeypatch):
    monkeypatch.setattr("app.engine.ai_params.settings.ai_param_seed_batch_threshold", 10)
    monkeypatch.setattr("app.engine.ai_params.settings.ai_param_seed_max_count", 8)
    plan = resolve_ai_param_seed_plan(5)
    assert plan["target"] == 5
    assert plan["use_batch"] is False
    assert plan["capped"] is False


def test_resolve_ai_param_seed_plan_caps_and_batches_high_n(monkeypatch):
    monkeypatch.setattr("app.engine.ai_params.settings.ai_param_seed_batch_threshold", 10)
    monkeypatch.setattr("app.engine.ai_params.settings.ai_param_seed_max_count", 8)
    plan = resolve_ai_param_seed_plan(50)
    assert plan["target"] == 8
    assert plan["use_batch"] is True
    assert plan["capped"] is True
    assert plan["requested"] == 50


def test_round_param_numbers_truncates_float_noise():
    raw = {
        "w_value": 0.40000000000000002220446049250313080847263336181640625,
        "mode": "mean_variance",
        "lookback_days": 252,
    }
    out = _round_param_numbers(raw)
    assert out["w_value"] == 0.4
    assert out["mode"] == "mean_variance"
    assert out["lookback_days"] == 252


def test_param_response_schema_minimal_omits_optional_numerics():
    slim = _param_response_schema(minimal=True, require_rationale=False)
    props = slim["properties"]["param_sets"]["items"]["properties"]
    assert "w_mom" in props
    assert "w_reversal" not in props
    assert "w_equity_us" not in props


def test_salvage_truncated_json_closes_partial_object():
    broken = (
        '{"param_sets":[{"mode":"factor_risk_parity","lookback_days":252,'
        '"risk_aversion":4.5,"top_n_actual":12,"max_weight_actual":0.25,'
        '"max_turnover_actual":0.4,"w_mom":1.2,"w_lowvol":0.8,'
        '"w_equity":0.5,"w_bond":0.3,"w_value":0.4'
    )
    parsed = _salvage_truncated_json(broken)
    assert parsed is not None
    sets = parsed.get("param_sets", [])
    assert len(sets) == 1
    assert sets[0]["w_value"] == 0.4


def _sample_learning_context() -> dict:
    failed_row = {
        "round": 1,
        "adjusted_score": 0.9,
        "gap_to_beat": 0.2,
        "risk_level": "med",
        "params_summary": "mode=min_var lookback=200 w_mom=1.5 w_lowvol=0.2",
    }
    return {
        "mission": (
            "Round 2: study champion research dossier and beat SPY then champion objective."
        ),
        "priorities": [
            "Beat benchmark SPY on in-sample risk-adjusted basis",
            "Improve champion in-sample Sharpe above 1.25",
            "Avoid failed challenger parameter patterns",
        ],
        "failure_patterns": "High turnover and concentrated factor bets underperformed.",
        "hint": "Read champion weight evolution and benchmark alpha before proposing challengers.",
        "global_config": {
            "objective": "max_sharpe",
            "rebalance_freq": "monthly",
            "max_weight_cap": 0.25,
            "max_turnover_cap": 0.4,
            "top_n_cap": 15,
            "tradable_count": 40,
        },
        "mutable_fields": ["mode", "lookback_days", "w_mom"],
        "target_adjusted_score": 1.25,
        "benchmark_ticker": "SPY",
        "champion": {
            "in_sample_objective": 1.1,
            "train_sharpe": 1.2,
            "validation_sharpe": 0.9,
            "gap_objective": 0.15,
            "overfitting_risk": "low",
            "params_summary": "mode=factor_risk_parity lookback=252",
            "benchmark_vs": {
                "portfolio_vs_benchmark": {
                    "alpha": 0.02,
                    "information_ratio": 0.5,
                }
            },
        },
        "champion_research": {
            "params": '{"mode":"factor_risk_parity","lookback_days":252}',
            "in_sample_outputs": {"sharpe": 1.2, "cagr": 0.08},
            "weight_history": {
                "rebalance_snapshots": 4,
                "top_holdings_latest": [{"ticker": "SPY", "weight_pct": 12.0}],
            },
            "benchmark_comparison": {
                "benchmark": "SPY",
                "portfolio_vs_benchmark": {"alpha": 0.02},
            },
        },
        "failed_challengers": [dict(failed_row, round=i) for i in range(1, 6)],
        "near_miss_challengers": [failed_row],
        "params_to_avoid": ["mode=min_var lookback=180", "mode=equal_weight top_n=5"],
    }


def test_resolve_learning_context_mode_auto_full_with_research(monkeypatch):
    monkeypatch.setattr(
        "app.engine.ai_params.settings.gemini_learning_context_mode", "auto"
    )
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_max_output_tokens", 4096)
    assert _resolve_learning_context_mode(_sample_learning_context()) == "full"


def test_learning_context_standard_includes_weight_history_and_length(monkeypatch):
    monkeypatch.setattr(
        "app.engine.ai_params.settings.gemini_learning_context_mode", "standard"
    )
    block = _build_learning_context_block_for_mode(_sample_learning_context(), "standard")
    assert "weight_history=" in block
    assert len(block) > 500


def test_learning_context_full_includes_champion_research_block():
    block = _build_learning_context_block_for_mode(_sample_learning_context(), "full")
    assert "CHAMPION_RESEARCH:" in block
    assert "benchmark_comparison=" in block
    assert len(block) > 500


def test_extract_json_from_plain_object():
    text = '{"param_sets":[{"mode":"min_var","lookback_days":200}]}'
    parsed = _extract_json(text)
    assert parsed is not None
    assert parsed["param_sets"][0]["mode"] == "min_var"


def test_resolve_thinking_level_off_by_default(monkeypatch):
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_thinking_level", "off")
    assert _resolve_thinking_level(_sample_learning_context()) is None


def test_resolve_thinking_level_minimal_for_non_full(monkeypatch):
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_thinking_level", "medium")
    monkeypatch.setattr(
        "app.engine.ai_params.settings.gemini_learning_context_mode", "standard"
    )
    assert _resolve_thinking_level(_sample_learning_context()) == "minimal"


def test_resolve_thinking_level_low_for_full_context(monkeypatch):
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_thinking_level", "medium")
    monkeypatch.setattr(
        "app.engine.ai_params.settings.gemini_learning_context_mode", "full"
    )
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_thinking_level_full", None)
    assert _resolve_thinking_level(_sample_learning_context()) == "low"


def test_resolve_thinking_level_full_override(monkeypatch):
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_thinking_level", "minimal")
    monkeypatch.setattr(
        "app.engine.ai_params.settings.gemini_learning_context_mode", "full"
    )
    monkeypatch.setattr(
        "app.engine.ai_params.settings.gemini_thinking_level_full", "high"
    )
    assert _resolve_thinking_level(_sample_learning_context()) == "high"


def test_thinking_config_for_gemini_35_uses_thinking_level(monkeypatch):
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_thinking_level", "minimal")
    monkeypatch.setattr(
        "app.engine.ai_params.settings.gemini_learning_context_mode", "standard"
    )
    cfg = _thinking_config_for_model(
        _sample_learning_context(), model="gemini-3.5-flash"
    )
    assert cfg == {"thinkingLevel": "minimal"}


def test_thinking_config_omitted_when_off(monkeypatch):
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_thinking_level", "off")
    cfg = _thinking_config_for_model(
        _sample_learning_context(), model="gemini-3.5-flash"
    )
    assert cfg is None


def test_thinking_config_gemini_3_flash_preview(monkeypatch):
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_thinking_level", "low")
    monkeypatch.setattr(
        "app.engine.ai_params.settings.gemini_learning_context_mode", "full"
    )
    cfg = _thinking_config_for_model(
        _sample_learning_context(), model="gemini-3-flash-preview"
    )
    assert cfg == {"thinkingLevel": "low"}


def test_generate_ai_round_seed_posts_thinking_config(monkeypatch):
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_api_key", "test-key")
    monkeypatch.setattr(
        "app.engine.ai_params.settings.gemini_model", "gemini-3-flash-preview"
    )
    monkeypatch.setattr(
        "app.engine.ai_params.settings.gemini_round_seed_thinking_level", "low"
    )
    captured: dict = {}

    class _FakeResp:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "candidates": [
                    {
                        "finishReason": "STOP",
                        "content": {
                            "parts": [
                                {
                                    "text": json.dumps(
                                        {
                                            "rationale": "test",
                                            "round_setup": {
                                                "mode": "mean_variance",
                                                "lookback_days": 252,
                                                "shrinkage": 0.1,
                                                "risk_aversion": 2.0,
                                                "top_n_actual": 10,
                                                "max_weight_actual": 0.15,
                                                "max_turnover_actual": 0.3,
                                                "no_trade_tol": 0.01,
                                                "turnover_penalty_mult": 1.0,
                                            },
                                            "factor_ranges": {},
                                            "factor_choices": {},
                                        }
                                    )
                                }
                            ]
                        },
                    }
                ]
            }

    def _fake_post(_url: str, *, json: dict | None = None, **_: object) -> _FakeResp:
        captured["json"] = json
        return _FakeResp()

    monkeypatch.setattr("app.engine.ai_params.httpx.post", _fake_post)
    out = generate_ai_round_seed(
        objective="max_sharpe",
        rebalance_freq="monthly",
        max_weight_cap=0.2,
        max_turnover_cap=0.5,
        top_n_cap=20,
        tradable_count=50,
        learning_context=_sample_learning_context(),
    )
    assert out["enabled"] is True
    assert out["thinking_level"] == "low"
    assert out["thinking_config"] == {"thinkingLevel": "low"}
    gen_cfg = captured["json"]["generationConfig"]
    assert gen_cfg["thinkingConfig"] == {"thinkingLevel": "low"}
    assert gen_cfg["responseMimeType"] == "application/json"
    assert gen_cfg["maxOutputTokens"] >= 8192


def test_resolve_round_seed_thinking_level_inherits_global(monkeypatch):
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_round_seed_thinking_level", None)
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_thinking_level", "low")
    assert _resolve_round_seed_thinking_level() == "low"


def test_resolve_round_seed_thinking_level_override(monkeypatch):
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_round_seed_thinking_level", "minimal")
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_thinking_level", "high")
    assert _resolve_round_seed_thinking_level() == "minimal"


def test_round_seed_max_output_tokens_escalates_on_retry(monkeypatch):
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_round_seed_max_output_tokens", 8192)
    assert _round_seed_max_output_tokens(attempt=0) == 8192
    assert _round_seed_max_output_tokens(attempt=1) == 10240
    assert _round_seed_max_output_tokens(attempt=4) == 16384


def test_generate_ai_round_seed_inherits_thinking_from_global(monkeypatch):
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_api_key", "test-key")
    monkeypatch.setattr(
        "app.engine.ai_params.settings.gemini_model", "gemini-3-flash-preview"
    )
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_round_seed_thinking_level", None)
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_thinking_level", "low")
    captured: dict = {}

    class _FakeResp:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "candidates": [
                    {
                        "finishReason": "STOP",
                        "content": {
                            "parts": [
                                {
                                    "text": json.dumps(
                                        {
                                            "rationale": "test",
                                            "round_setup": {
                                                "mode": "mean_variance",
                                                "lookback_days": 252,
                                                "shrinkage": 0.1,
                                                "risk_aversion": 2.0,
                                                "top_n_actual": 10,
                                                "max_weight_actual": 0.15,
                                                "max_turnover_actual": 0.3,
                                                "no_trade_tol": 0.01,
                                                "turnover_penalty_mult": 1.0,
                                            },
                                            "factor_ranges": {},
                                            "factor_choices": {},
                                        }
                                    )
                                }
                            ]
                        },
                    }
                ]
            }

    def _fake_post(_url: str, *, json: dict | None = None, **_: object) -> _FakeResp:
        captured["json"] = json
        return _FakeResp()

    monkeypatch.setattr("app.engine.ai_params.httpx.post", _fake_post)
    out = generate_ai_round_seed(
        objective="max_sharpe",
        rebalance_freq="monthly",
        max_weight_cap=0.2,
        max_turnover_cap=0.5,
        top_n_cap=20,
        tradable_count=50,
    )
    assert out["enabled"] is True
    assert out["thinking_level"] == "low"
    assert captured["json"]["generationConfig"]["thinkingConfig"] == {"thinkingLevel": "low"}


def test_generate_ai_round_seed_max_tokens_returns_disabled(monkeypatch):
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_api_key", "test-key")
    monkeypatch.setattr(
        "app.engine.ai_params.settings.gemini_round_seed_max_output_tokens", 2048
    )
    monkeypatch.setattr(
        "app.engine.ai_params.settings.gemini_param_seed_max_retries", 1
    )

    class _FakeResp:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "candidates": [
                    {
                        "finishReason": "MAX_TOKENS",
                        "content": {"parts": [{"text": ""}]},
                    }
                ]
            }

    monkeypatch.setattr("app.engine.ai_params.httpx.post", lambda *_a, **_k: _FakeResp())
    out = generate_ai_round_seed(
        objective="max_sharpe",
        rebalance_freq="monthly",
        max_weight_cap=0.2,
        max_turnover_cap=0.5,
        top_n_cap=20,
        tradable_count=50,
    )
    assert out["enabled"] is False
    assert out["error"] == "gemini_max_tokens"


def test_generate_ai_round_seed_dynamic_includes_regime_setups_schema(monkeypatch):
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_api_key", "test-key")
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_model", "gemini-3-flash-preview")
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_round_seed_thinking_level", "off")
    captured: dict = {}

    class _FakeResp:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "candidates": [
                    {
                        "finishReason": "STOP",
                        "content": {
                            "parts": [
                                {
                                    "text": json.dumps(
                                        {
                                            "rationale": "dynamic seed",
                                            "optimization_strategy": "explore",
                                            "performance_assessment": "round 1",
                                            "round_setup": {
                                                "mode": "mean_variance",
                                                "lookback_days": 252,
                                                "shrinkage": 0.1,
                                                "risk_aversion": 2.0,
                                                "top_n_actual": 10,
                                                "max_weight_actual": 0.15,
                                                "max_turnover_actual": 0.3,
                                                "no_trade_tol": 0.01,
                                                "turnover_penalty_mult": 1.0,
                                            },
                                            "regime_setups": {
                                                "risk_off": {
                                                    "mode": "min_var",
                                                    "lookback_days": 252,
                                                    "shrinkage": 0.2,
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
                                            "factor_ranges": {"w_mom": [0.1, 1.2]},
                                            "factor_choices": {},
                                        }
                                    )
                                }
                            ]
                        },
                    }
                ]
            }

    def _fake_post(_url: str, *, json: dict | None = None, **_: object) -> _FakeResp:
        captured["json"] = json
        return _FakeResp()

    monkeypatch.setattr("app.engine.ai_params.httpx.post", _fake_post)
    out = generate_ai_round_seed(
        objective="dynamic",
        rebalance_freq="W-FRI",
        max_weight_cap=0.2,
        max_turnover_cap=0.5,
        top_n_cap=20,
        tradable_count=50,
    )
    assert out["enabled"] is True
    schema = captured["json"]["generationConfig"]["responseSchema"]
    assert "regime_setups" in schema["properties"]
    assert "regime_setups" in schema["required"]
    assert "regime_factor_ranges" in schema["properties"]
    risk_off_props = schema["properties"]["regime_factor_ranges"]["properties"][
        "risk_off"
    ]["properties"]
    assert set(risk_off_props.keys()) == {
        "factor_lookback_days",
        "reversal_lookback_days",
        "value_lookback_days",
        "w_mom",
        "w_reversal",
        "w_value",
        "w_lowvol",
        "w_trend",
        "w_drawdown",
    }
    assert out["regime_setups"]["risk_on"]["lookback_days"] == 63
    prompt = captured["json"]["contents"][0]["parts"][0]["text"]
    assert "obj=dynamic" in prompt
    assert "regime_setups" in prompt
    assert "EVERY" in prompt
    assert "2–4 FOCUS" not in prompt
