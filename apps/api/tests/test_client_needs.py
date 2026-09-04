"""Client-needs soft constraints: scoring penalty + AI prompt card."""

from __future__ import annotations

from app.engine.objectives import (
    CLIENT_NEEDS_DRAWDOWN_PENALTY,
    compute_client_needs_penalty,
    compute_objective_score,
    needs_attainment,
)
from app.engine.refinement import client_needs_prompt_block


def test_penalty_zero_when_within_tolerance():
    metrics = {"max_drawdown": -0.08, "sharpe": 1.2}
    ctx = {"max_drawdown_tolerance": 0.10}
    assert compute_client_needs_penalty(metrics, ctx) == 0.0


def test_penalty_scales_with_breach():
    metrics = {"max_drawdown": -0.20, "sharpe": 1.2}
    ctx = {"max_drawdown_tolerance": 0.10}
    expected = CLIENT_NEEDS_DRAWDOWN_PENALTY * 0.10
    assert abs(compute_client_needs_penalty(metrics, ctx) - expected) < 1e-9


def test_penalty_absent_without_context():
    metrics = {"max_drawdown": -0.50, "sharpe": 1.2}
    assert compute_client_needs_penalty(metrics, None) == 0.0
    assert compute_client_needs_penalty(metrics, {}) == 0.0


def test_needs_attainment_reports_breach():
    metrics = {"max_drawdown": -0.22}
    ctx = {"max_drawdown_tolerance": 0.15}
    result = needs_attainment(metrics, ctx)
    assert result is not None
    assert result["within_drawdown_tolerance"] is False
    assert abs(result["drawdown_breach_pct"] - 0.07) < 1e-9
    assert result["max_drawdown_actual"] == 0.22


def test_needs_attainment_none_without_tolerance():
    assert needs_attainment({"max_drawdown": -0.1}, None) is None
    assert needs_attainment({"max_drawdown": -0.1}, {"risk_tolerance": "moderate"}) is None


def test_scoring_with_penalty_reorders_preference():
    """A higher-Sharpe but floor-breaching trial should score below a safer one."""
    safe = {"sharpe": 0.9, "max_drawdown": -0.08}
    aggressive = {"sharpe": 1.2, "max_drawdown": -0.25}
    ctx = {"max_drawdown_tolerance": 0.10}
    safe_score = compute_objective_score("max_sharpe", safe) - compute_client_needs_penalty(
        safe, ctx
    )
    agg_score = compute_objective_score("max_sharpe", aggressive) - compute_client_needs_penalty(
        aggressive, ctx
    )
    assert safe_score > agg_score


def test_client_needs_prompt_block_shape():
    block = client_needs_prompt_block(
        {
            "risk_tolerance": "conservative",
            "investment_horizon_years": 7,
            "max_drawdown_tolerance": 0.1,
            "needs_summary": "Prefer capital preservation with gradual equity exposure.",
            "market_stance": "risk_off",
            "market_themes": ["defensive income", "quality bonds"],
        }
    )
    assert block is not None
    assert block["risk_tolerance"] == "conservative"
    assert block["max_drawdown_tolerance"] == 0.1
    assert "drawdown_floor_rule" in block
    assert "capital preservation" in block["needs_summary"]
    assert block["market_stance"] == "risk_off"
    assert block["market_themes"] == ["defensive income", "quality bonds"]


def test_client_needs_prompt_block_stance_only():
    block = client_needs_prompt_block({"market_stance": "risk_on"})
    assert block == {"market_stance": "risk_on"}


def test_client_needs_prompt_block_empty():
    assert client_needs_prompt_block(None) is None
    assert client_needs_prompt_block({}) is None
    assert client_needs_prompt_block({"market_stance": "bogus"}) is None


def test_single_name_and_cash_penalties():
    metrics = {"max_drawdown": -0.05, "cash_weight": 0.02}
    ctx = {
        "max_single_name_pct": 0.20,
        "cash_reserve_pct": 0.10,
    }
    holdings = {"AAA": 0.35, "BBB": 0.63}
    penalty = compute_client_needs_penalty(
        metrics, ctx, holdings=holdings, ticker_meta={}
    )
    assert penalty > 0.0
    att = needs_attainment(metrics, ctx, holdings=holdings, ticker_meta={})
    assert att is not None
    assert att["within_single_name_cap"] is False
    assert att["within_cash_reserve"] is False


def test_client_needs_prompt_line_includes_stance_themes():
    from app.engine.ai_params import _client_needs_prompt_line

    line = _client_needs_prompt_line(
        {
            "client_needs": {
                "risk_tolerance": "moderate",
                "market_stance": "risk_on",
                "market_themes": ["AI", "semiconductors"],
            }
        }
    )
    assert line is not None
    assert "stance=risk_on" in line
    assert 'themes="AI;semiconductors"' in line
    assert "risk=moderate" in line


def test_truncate_at_sentence_boundaries():
    from app.engine.ai_json import truncate_at_sentence

    short = "short view"
    assert truncate_at_sentence(short, 2000) == short

    text = "First sentence. Second sentence. Third sentence."
    assert truncate_at_sentence(text, 32) == "First sentence. Second sentence."

    cjk = "第一句話。第二句話。第三句話。"
    assert truncate_at_sentence(cjk, 14) == "第一句話。第二句話。"

    # Numbered-list periods ("1.") are not sentence boundaries.
    listed = "1. AI 配置: 核心衛星策略,聚焦供應鏈龍頭。" + "補充說明。" * 10
    out = truncate_at_sentence(listed, 40)
    assert out.startswith("1. AI")
    assert out.endswith("。")


def test_client_needs_prompt_line_preserves_full_view():
    """Regression: view= was cut mid-sentence at 120 chars; full rationale must pass."""
    from app.engine.ai_params import _client_needs_prompt_line

    view = (
        "1. AI 直接指數化配置: 客戶希望以 AI 供應鏈為核心衛星配置。"
        "2. 避開高估值科技股以外的擁擠交易。"
        "3. 配置避險資產以對沖尾部風險,包含黃金與短天期公債。"
        "4. 維持百分之五現金緩衝以因應流動性需求。"
        "5. 單一持股上限百分之十五,主題曝險上限百分之二十五。"
    )
    assert len(view) > 120  # old cap cut this mid-sentence
    line = _client_needs_prompt_line(
        {
            "client_needs": {
                "risk_tolerance": "aggressive",
                "investment_horizon_years": 5.0,
                "market_stance": "risk_on",
                "needs_summary": view,
            }
        }
    )
    assert line is not None
    assert f'view="{view}"' in line
    assert "..." not in line


def test_client_needs_prompt_line_truncates_huge_view_at_sentence_boundary():
    from app.engine.ai_params import (
        _CLIENT_NEEDS_VIEW_MAX_LEN,
        _client_needs_prompt_line,
    )

    view = "這是一句關於客戶投資觀點的完整描述。" * 200  # ~3600 chars, over budget
    line = _client_needs_prompt_line({"client_needs": {"needs_summary": view}})
    assert line is not None
    payload = line.split('view="', 1)[1].rstrip('"')
    assert len(payload) <= _CLIENT_NEEDS_VIEW_MAX_LEN
    assert payload.endswith("。")  # sentence boundary, not mid-sentence


def test_client_needs_prompt_block_preserves_long_summary():
    """Regression: prompt block used to hard-cut needs_summary at 300 chars."""
    summary = "Prefer capital preservation. " + (
        "Gradual equity exposure with quality tilt. " * 60
    )
    block = client_needs_prompt_block({"needs_summary": summary})
    assert block is not None
    assert len(block["needs_summary"]) > 300
    assert "capital preservation" in block["needs_summary"]
    assert block["needs_summary"].endswith(".")
