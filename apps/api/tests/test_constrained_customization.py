"""Constrained Customization Mode: trigger + named scenarios + proposals."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.engine.constrained_customization import (
    MAX_TRADABLE_FOR_CONSTRAINED,
    build_constrained_param_rationale,
    build_constrained_proposal_set,
    build_constrained_scenario_seeds,
    estimate_constrained_trial_count,
    select_constrained_champion_code,
    should_use_constrained_customization,
)
from app.models import BacktestRequest, Objective, OptimizationMode


def _req(**kwargs):
    base = dict(
        scenario_id="t",
        max_weight=0.25,
        objective=Objective.max_sharpe,
        start_date="2018-01-01",
        end_date="2024-12-31",
        trials=25,
        top_models=5,
        customization_drift=0.2,
        anchor_weights={"IVV": 0.5, "TLT": 0.5},
        universe_tickers=["IVV", "TLT", "AGG", "GLD", "BOTZ"],
        client_ref="chen",
    )
    base.update(kwargs)
    return BacktestRequest(**base)


def test_trigger_requires_anchor_and_small_universe():
    req = _req()
    assert should_use_constrained_customization(
        req, tradable_count=5, must_include_count=1
    )
    assert estimate_constrained_trial_count(req) == 4  # theme included (BOTZ)

    no_anchor = _req(anchor_weights=None)
    assert not should_use_constrained_customization(
        no_anchor, tradable_count=5, must_include_count=0
    )


def test_trigger_skips_large_universe_without_small_overlay():
    big = _req(
        universe_tickers=[f"T{i}" for i in range(MAX_TRADABLE_FOR_CONSTRAINED + 5)],
        anchor_weights={f"T{i}": 1.0 / 30 for i in range(30)},
    )
    assert not should_use_constrained_customization(
        big,
        tradable_count=MAX_TRADABLE_FOR_CONSTRAINED + 5,
        must_include_count=MAX_TRADABLE_FOR_CONSTRAINED,  # many adds
    )


def test_trigger_allows_small_overlay_even_if_tradable_borderline():
    # Many tradable but few overlay adds still qualifies via small_overlay.
    req = _req(
        universe_tickers=[f"T{i}" for i in range(25)],
        anchor_weights={f"T{i}": 1.0 / 24 for i in range(24)},
    )
    assert should_use_constrained_customization(
        req, tradable_count=25, must_include_count=1
    )


def test_static_replay_never_triggers():
    req = _req(static_replay_holdings={"IVV": 0.5, "TLT": 0.5})
    assert not should_use_constrained_customization(
        req, tradable_count=2, must_include_count=0
    )


def test_scenario_seeds_distinct_styles_and_drift():
    req = _req()
    seeds = build_constrained_scenario_seeds(
        req,
        tradable_count=5,
        must_include=["BOTZ"],
        objective="max_sharpe",
    )
    styles = [s["scenario_style"] for s in seeds]
    assert styles == ["anchor_close", "full_drift", "defensive", "theme"]
    drifts = {s["scenario_style"]: s["customization_drift_actual"] for s in seeds}
    assert drifts["anchor_close"] < drifts["full_drift"]
    assert drifts["full_drift"] == pytest.approx(0.2)
    assert seeds[0]["allocator_mode"] in {"mean_variance", "min_var", "risk_parity"}
    assert seeds[2]["allocator_mode"] == "min_var"
    assert all(s.get("param_source") == "constrained_scenario" for s in seeds)


def test_scenario_seeds_omit_theme_without_must_include():
    req = _req(
        universe_tickers=["IVV", "TLT"],
        anchor_weights={"IVV": 0.5, "TLT": 0.5},
        universe_supplement_tickers=None,
    )
    seeds = build_constrained_scenario_seeds(
        req, tradable_count=2, must_include=[], objective="max_sharpe"
    )
    assert [s["scenario_style"] for s in seeds] == [
        "anchor_close",
        "full_drift",
        "defensive",
    ]
    assert estimate_constrained_trial_count(req) == 3


def test_proposal_set_friendly_labels_no_alternative_n():
    cards = build_constrained_proposal_set(
        [
            {
                "model_code": "M1",
                "scenario_style": "anchor_close",
                "sharpe": 0.8,
                "cagr": 0.06,
                "max_drawdown": -0.10,
                "is_champion": False,
                "weights": {"IVV": 0.55, "TLT": 0.45},
                "needs_attainment": {"all_floors_met": True},
            },
            {
                "model_code": "M2",
                "scenario_style": "full_drift",
                "sharpe": 1.1,
                "cagr": 0.09,
                "max_drawdown": -0.15,
                "is_champion": True,
                "weights": {"IVV": 0.40, "TLT": 0.35, "BOTZ": 0.25},
                "needs_attainment": {"all_floors_met": True},
            },
            {
                "model_code": "M3",
                "scenario_style": "defensive",
                "sharpe": 0.6,
                "cagr": 0.04,
                "max_drawdown": -0.05,
                "is_champion": False,
                "weights": {"IVV": 0.30, "TLT": 0.70},
                "needs_attainment": {"all_floors_met": True},
            },
        ],
        champion_code="M2",
        max_n=4,
    )
    labels = [c["label"] for c in cards]
    assert "recommended" in labels
    assert any(c["is_recommended"] for c in cards)
    assert all(not lab.upper().startswith("ALTERNATIVE_") for lab in labels)
    assert "defensive" in labels or "anchor_close" in labels


def test_select_champion_prefers_needs_then_objective():
    cands = [
        SimpleNamespace(
            model_code="A",
            sharpe=1.5,
            needs_attainment={
                "all_floors_met": False,
                "within_customization_drift": False,
            },
            analytics={},
            params={"scenario_style": "full_drift"},
        ),
        SimpleNamespace(
            model_code="B",
            sharpe=1.0,
            needs_attainment={
                "all_floors_met": True,
                "within_customization_drift": True,
            },
            analytics={},
            params={"scenario_style": "anchor_close"},
        ),
    ]
    assert select_constrained_champion_code(cands) == "B"


def test_pro_flag_does_not_block_trigger():
    """Engine suppresses Pro when constrained triggers; detector itself ignores Pro."""
    req = _req(optimization_mode=OptimizationMode.pro_auto)
    assert should_use_constrained_customization(
        req, tradable_count=5, must_include_count=1
    )


def test_param_rationale_zh_uses_champion_metadata_not_english_blob():
    text = build_constrained_param_rationale(
        "zh",
        ["anchor_close", "full_drift", "defensive", "theme"],
        champion_style="anchor_close",
        drift_actual=0.175,
        drift_cap=0.5,
        allocator_mode="mean_variance",
    )
    assert "具名優化情境" in text
    assert "貼近錨定" in text
    assert "18%" in text
    assert "50%" in text
    assert "報酬—風險平衡" in text
    assert "Constrained customization mode" not in text
    assert "anchor_close" not in text


def test_param_rationale_en_and_ko_cover_styles():
    en = build_constrained_param_rationale(
        "en",
        ["anchor_close", "full_drift"],
        champion_style="full_drift",
        drift_actual=0.4,
        drift_cap=0.4,
        allocator_mode="min_var",
    )
    assert "Full customization space" in en
    assert "40%" in en
    assert "lowest volatility" in en

    ko = build_constrained_param_rationale(
        "ko",
        ["defensive"],
        champion_style="defensive",
        drift_actual=0.2,
        drift_cap=0.5,
        allocator_mode="min_var",
    )
    assert "방어형" in ko
    assert "20%" in ko
