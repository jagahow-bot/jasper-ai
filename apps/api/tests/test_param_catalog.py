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
