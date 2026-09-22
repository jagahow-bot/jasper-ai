"""Tests for AI-facing JSON float sanitization."""

from __future__ import annotations

import json

from app.engine.ai_json import (
    AI_NUMBER_DESCRIPTION,
    coerce_factor_range_pair,
    dumps_for_ai,
    factor_range_array_schema,
    factor_range_item_schema,
    prepare_gemini_json_text,
    round_ai_float,
    sanitize_ai_response,
    sanitize_for_ai,
    sanitize_json_text_for_log,
    truncate_json_numeric_literals,
    truncate_json_range_arrays,
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


def test_round_ai_float_shrinkage_noise():
    raw = 0.200000000000000012345678901234567890
    assert round_ai_float(raw, key="shrinkage") == 0.2
    assert "00000000000" not in dumps_for_ai({"shrinkage": raw})


def test_salvage_regime_setups_bloated_shrinkage():
    """Regression: MAX_TOKENS mid-regime_setups shrinkage literal must salvage."""
    from app.engine.ai_params import _extract_json, _salvage_truncated_json

    # Log-realistic: one dot then runaway fractional digits (no embedded dots).
    long_frac = "0.2" + "0" * 18 + "1234567890" * 200
    text = (
        '{"round_setup":{"mode":"max_sharpe","lookback_days":252,"shrinkage":0.1,'
        '"risk_aversion":3.0,"top_n_actual":15,"max_weight_actual":0.25,'
        '"max_turnover_actual":0.5,"no_trade_tol":0.005,"turnover_penalty_mult":1.0},'
        '"regime_setups":{"risk_off":{"mode":"min_max_drawdown","shrinkage":'
        + long_frac
    )
    parsed = _extract_json(text) or _salvage_truncated_json(text)
    assert parsed is not None
    assert parsed["regime_setups"]["risk_off"]["shrinkage"] == 0.2
    assert "00000000000" not in dumps_for_ai(parsed)


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
        blueprint=RunBlueprint(max_weight=0.2, max_turnover=1.0, top_n=50, max_holdings=30),
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

    blueprint = RunBlueprint(max_weight=0.15, max_turnover=0.5, top_n=20, max_holdings=30)
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


def test_factor_range_array_schema_enforces_two_endpoints():
    schema = factor_range_array_schema("w_mom")
    assert schema["minItems"] == 2
    assert schema["maxItems"] == 2


def test_truncate_json_range_arrays_collapses_bloat():
    junk = ", ".join(["1.5e-161"] * 80)
    raw = f'{{"risk_off":{{"w_value":[0.0, 1.0, {junk}]}}}}'
    trimmed = truncate_json_range_arrays(raw)
    parsed = json.loads(trimmed)
    assert len(parsed["risk_off"]["w_value"]) == 2


def test_coerce_factor_range_pair_from_long_array():
    pair = coerce_factor_range_pair([0.0, 1.0] + [1.5e-161] * 50, key="w_value")
    assert pair == [0.0, 1.0]


def test_prepare_gemini_json_text_truncates_arrays_and_floats():
    noisy = (
        '{"w_mom":[0,1.2000000000000002,0.3,0.4],'
        '"shrinkage":0.40000000000000002220446049250313080847263336181640625}'
    )
    parsed = json.loads(prepare_gemini_json_text(noisy))
    assert len(parsed["w_mom"]) == 2
    assert parsed["shrinkage"] == 0.4


def test_detect_text_repetition_short_unit_loop():
    from app.engine.ai_json import detect_text_repetition

    head = "本輪樣本內表現未達基準，差距主要來自回撤控制與因子配置。"
    loop = "因子配置仍缺乏基準優勢，回撤控制未見改善，" * 30
    assert detect_text_repetition(head + loop) is True


def test_detect_text_repetition_long_unit_loop():
    from app.engine.ai_json import detect_text_repetition

    unit = (
        "綜合來看，本輪在因子配置與風險控制上仍未見明顯改善，"
        "回撤控制與基準優勢的缺口持續存在，需在後續輪次中重點關注。"
    ) * 8  # ~400-char unit
    text = "第一輪探索完成，尚未有冠軍。" * 10 + unit * 5
    assert detect_text_repetition(text) is True


def test_detect_text_repetition_chinese_paraphrase_closing_cascade():
    """Paraphrase loop with 確認完畢/結案/無贅言 variants (no exact unit repeat)."""
    from app.engine.ai_json import detect_text_repetition

    text = (
        "現任冠軍 M0002 樣本內最大回撤為 -0.1389，距離目標 -0.1289 仍有約 0.0100 差距，"
        "且歷史樣本外落差達 0.1047 顯示存在泛化風險。"
        "前幾輪失敗試驗證實極端防守因子配置無法有效改善評分，"
        "整體表現仍待進一步收斂突破基準要求。"
        "本輪重點在於縮小回撤差距以超越既有基準表現水準及兼顧泛化度要求，"
        "並嚴控下行風險回撤空間及投資組合權重穩定度至目標水位內且維持有效性評估標準一致性"
        "以利比對確認各項主要指標成果與成效水準以利評選新優勝模型決策落實執行效率檢驗機制"
        "確認完畢無誤且無重複贅述字眼即可達成規範限制終止輸出內容與格式要求確保安全穩定運行"
        "驗證達標狀態即可結案完畢以利後續決策參考依據與執行標的配置落實控管流程。"
        "現階段樣本內成果未達基準線要求，亟需透過收斂參數解決下行回撤過深問題以逼近目標水準"
        "並降低驗證落差以達穩健防守初衷目標規範需求標準範圍內部監控機制即可完整呈現現況評估"
        "與總結分析報告內容終止無誤即停止寫作說明完畢確證有效無誤結尾完成即可結案無贅言"
        "結束完畢無它補充資料提供說明確認完畢無礙各項指標檢核標準完成確認終止動作以利運作"
        "即可順利達成審核確認流程標準。"
        "本輪樣本內表現未達基準，需持續改善回撤差距以利達標並降低模型落差風險因子干擾"
        "成效評估標準作業完竣無誤。"
        "基準表現未達標狀態需透過後續試驗修正以落實回撤控管與資產穩定運作效能目標之達成"
        "現狀分析無誤確證如上所述即止無贅言補充資訊提供確認完竣流程動作執行無誤完工。"
    )
    assert len(" ".join(text.split())) >= 400
    assert detect_text_repetition(text) is True


def test_detect_text_repetition_ignores_normal_prose():
    from app.engine.ai_json import detect_text_repetition

    prose = (
        "本輪樣本內表現未達基準，差距主要來自回撤控制。"
        "冠軍模型在持有 14 檔時表現穩定，但因子權重偏向低波動。"
        "失敗試驗顯示高動量權重與回撤惡化相關。"
        "下一輪應縮窄動量區間並提高低波動權重上限。"
    )
    assert len(prose) < 400  # below min length — never flagged
    assert detect_text_repetition(prose) is False
    # Genuinely varied long prose (each sentence differs) must not flag.
    varied = "".join(
        f"第{i}輪調整因子權重 {0.1 * i:.2f} 後，回撤由 {-0.05 * i:.3f} 改善至 {-0.04 * i:.3f}，"
        f"Sharpe 變化 {0.02 * i:+.3f}，仍低於基準 {0.5 + 0.01 * i:.2f}。"
        for i in range(1, 16)
    )
    assert len(varied) >= 400
    assert detect_text_repetition(varied) is False
    # One legitimate closing phrase in long prose is fine.
    with_one_close = varied + "本輪評估確認完畢，下一輪繼續收斂。"
    assert detect_text_repetition(with_one_close) is False


def test_detect_text_repetition_empty_and_none():
    from app.engine.ai_json import detect_text_repetition

    assert detect_text_repetition("") is False
    assert detect_text_repetition(None) is False
