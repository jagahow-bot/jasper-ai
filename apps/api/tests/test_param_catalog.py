"""Param capability catalog export shape."""

from __future__ import annotations

from app.engine.param_taxonomy import (
    FACTOR_NUMERIC_KEYS,
    SETUP_PARAM_KEYS,
    build_param_catalog,
)


def test_param_catalog_covers_setup_and_factor_keys():
    catalog = build_param_catalog()
    keys = {p["key"] for p in catalog["params"]}
    for key in SETUP_PARAM_KEYS:
        assert key in keys
    for key in FACTOR_NUMERIC_KEYS:
        assert key in keys
    assert catalog["version"] >= 1


def test_overlay_eligible_includes_factor_weights_not_class_budgets():
    catalog = build_param_catalog()
    eligible = set(catalog["overlay_eligible_keys"])
    assert "w_mom" in eligible
    assert "w_income" in eligible
    assert "customization_drift_actual" in eligible
    assert "w_equity" not in eligible
    assert "mode" not in eligible
    for entry in catalog["params"]:
        if entry["key"] in eligible:
            assert entry["overlay_eligible"] is True
            assert "bounds" in entry or "choices" in entry


def test_overlay_eligible_includes_allocator_constraint_knobs():
    """Whitelist expansion: constraint knobs with clear client semantics are eligible."""
    catalog = build_param_catalog()
    eligible = set(catalog["overlay_eligible_keys"])
    for key in (
        "max_weight_actual",
        "top_n_actual",
        "max_holdings_actual",
        "max_turnover_actual",
    ):
        assert key in eligible, key
    # Still closed: Pro-only technical knobs and class-budget quotas.
    for key in ("no_trade_tol", "turnover_penalty_mult", "shrinkage", "risk_aversion"):
        assert key not in eligible, key
    for key in ("w_equity", "w_bond"):
        assert key not in eligible, key

    by_key = {p["key"]: p for p in catalog["params"]}
    assert by_key["top_n_actual"]["bounds"] == [2, 150]
    assert by_key["max_holdings_actual"]["bounds"] == [1, 150]
    assert by_key["max_weight_actual"]["bounds"] == [0.05, 1.0]
    assert by_key["max_turnover_actual"]["bounds"] == [0.05, 1.0]
    # Hints carry the zh-TW trigger language for the interpret prompt.
    assert "集中持股" in by_key["top_n_actual"]["client_hint"]
    assert "換手" in by_key["max_turnover_actual"]["client_hint"]
    assert "max_single_position_pct" in by_key["max_weight_actual"]["client_hint"]
    assert "持有" in by_key["max_holdings_actual"]["client_hint"]
