"""U7–U12: class quota unfilled detection + needs_attainment extensions."""

from __future__ import annotations

from app.engine.asset_class_policy import find_unfilled_class_quotas
from app.engine.objectives import _needs_score, needs_attainment


def test_u7_find_unfilled_when_no_members():
    out = find_unfilled_class_quotas(
        {"alternative": 0.15},
        {
            "SPY": {"asset_class": "equity"},
            "QQQ": {"asset_class": "equity"},
        },
    )
    assert out == [
        {
            "asset_class": "alternative",
            "target_pct": 0.15,
            "reason": "no_universe_members",
        }
    ]


def test_u8_find_unfilled_empty_when_member_exists():
    out = find_unfilled_class_quotas(
        {"alternative": 0.15},
        {
            "SPY": {"asset_class": "equity"},
            "PFX": {"asset_class": "alternative"},
        },
    )
    assert out == []


def test_u9_class_quota_attainment_miss():
    att = needs_attainment(
        {"max_drawdown": -0.1},
        {"risk_tolerance": "moderate"},
        holdings={"SPY": 1.0},
        ticker_meta={"SPY": {"asset_class": "equity"}},
        class_budget={"alternative": 0.15, "equity": 0.85},
    )
    assert att is not None
    assert att["within_class_quotas"] is False
    assert att["all_floors_met"] is False
    alt = next(r for r in att["class_quotas"] if r["asset_class"] == "alternative")
    assert alt["within_class_quota"] is False
    assert alt["actual_pct"] == 0.0


def test_u10_class_quota_attainment_met_excludes_cash():
    att = needs_attainment(
        {"max_drawdown": -0.1},
        {"risk_tolerance": "moderate"},
        holdings={"SPY": 0.8075, "PFX": 0.1425, "CASH": 0.05},
        ticker_meta={
            "SPY": {"asset_class": "equity"},
            "PFX": {"asset_class": "alternative"},
        },
        class_budget={"alternative": 0.15, "equity": 0.85},
    )
    assert att is not None
    assert att["within_class_quotas"] is True
    assert att["all_floors_met"] is True
    alt = next(r for r in att["class_quotas"] if r["asset_class"] == "alternative")
    assert abs(alt["actual_pct"] - 0.15) < 1e-3


def test_u11_group_band_attainment_miss():
    att = needs_attainment(
        {"max_drawdown": -0.1},
        {
            "group_weight_bands": [
                {
                    "group_id": "私募基金",
                    "tickers": ["PFX"],
                    "target_pct": 0.15,
                }
            ]
        },
        holdings={"SPY": 1.0},
        ticker_meta={"SPY": {"asset_class": "equity"}},
    )
    assert att is not None
    assert att["within_group_bands"] is False
    assert att["group_bands"][0]["within_band"] is False
    assert att["group_bands"][0]["actual_pct"] == 0.0
    assert att["group_bands"][0]["min_pct"] == pytest_approx_band_lo()
    assert att["group_bands"][0]["max_pct"] == pytest_approx_band_hi()


def pytest_approx_band_lo():
    return round(0.15 - 0.02, 4)


def pytest_approx_band_hi():
    return round(0.15 + 0.02, 4)


def test_u12_needs_score_unchanged_without_new_checks():
    legacy = {
        "within_drawdown_tolerance": True,
        "within_must_include": False,
    }
    assert _needs_score(legacy) == 0.5
    with_new = {
        **legacy,
        "within_class_quotas": False,
        "within_group_bands": True,
    }
    # New keys change the denominator only when present.
    assert _needs_score(with_new) == 0.5
    # Absent new keys → same as before the feature.
    assert "within_class_quotas" not in legacy
    assert _needs_score(legacy) == _needs_score(
        {"within_drawdown_tolerance": True, "within_must_include": False}
    )
