"""Regime-conditional exposure from rebalance weight snapshots."""

from __future__ import annotations

from app.engine.analytics import exposure_by_regime_from_weight_history


def test_exposure_by_regime_averages_snapshots_per_regime() -> None:
    universe = {
        "EQ": {"asset_class": "equity"},
        "BD": {"asset_class": "bond"},
    }
    timeline = [
        {"date": "2020-01-01", "regime": "risk_off"},
        {"date": "2020-07-01", "regime": "risk_on"},
    ]
    weight_history = [
        {"date": "2020-03-01", "EQ": 0.2, "BD": 0.8},
        {"date": "2020-04-01", "EQ": 0.3, "BD": 0.7},
        {"date": "2020-09-01", "EQ": 0.9, "BD": 0.1},
    ]
    out = exposure_by_regime_from_weight_history(
        weight_history, universe, timeline
    )
    assert abs(out["risk_off"]["bond"] - 0.75) < 0.02
    assert abs(out["risk_off"]["equity"] - 0.25) < 0.02
    assert abs(out["risk_on"]["equity"] - 0.9) < 0.02


def test_exposure_by_regime_counts_other_bucket() -> None:
    """OTHER sleeve mass must not be dropped from class averages."""
    universe = {
        "EQ": {"asset_class": "equity"},
        "BD": {"asset_class": "bond"},
    }
    timeline = [{"date": "2020-01-01", "regime": "risk_off"}]
    weight_history = [
        {"date": "2020-03-01", "EQ": 0.2, "BD": 0.05, "OTHER": 0.75},
    ]
    out = exposure_by_regime_from_weight_history(
        weight_history, universe, timeline
    )
    assert abs(out["risk_off"]["equity"] - 0.2) < 0.02
    assert abs(out["risk_off"]["bond"] - 0.05) < 0.02
    assert abs(out["risk_off"]["other"] - 0.75) < 0.02
