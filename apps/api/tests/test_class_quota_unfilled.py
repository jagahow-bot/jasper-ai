"""I4 / fa51bebe-style reproduction: dual-track + unfilled contrast."""

from __future__ import annotations

import logging

from app.engine.asset_class_policy import (
    find_unfilled_class_quotas,
    fixed_class_budget_from_param_controls,
)
from app.engine.objectives import needs_attainment
from app.profiles import (
    _synthetic_supplement_item,
    get_universe,
    pin_guaranteed_supplements,
)


def test_fixed_budget_from_param_controls():
    budget = fixed_class_budget_from_param_controls(
        {
            "w_alternative": {"mode": "fixed", "fixed": 0.15},
            "w_equity": {"mode": "search", "min": 0.4, "max": 0.8},
        }
    )
    assert budget == {"alternative": 0.15}


def test_fa51bebe_control_group_no_hint_unfilled_and_unmet(caplog):
    """Without asset_class hint: synthetic defaults to equity → unfilled + unmet."""
    with caplog.at_level(logging.WARNING, logger="app.profiles"):
        row = _synthetic_supplement_item("PFX")
    assert row["asset_class"] == "equity"

    universe = get_universe(
        tickers=["SPY", "AGG", "PFX"],
        supplement_tickers=["PFX"],
        supplement_meta=None,
    )
    by_t = {u["ticker"]: u for u in universe}
    # PFX not in catalog → synthetic equity
    assert by_t["PFX"]["asset_class"] == "equity"

    budget = fixed_class_budget_from_param_controls(
        {"w_alternative": {"mode": "fixed", "fixed": 0.15}}
    )
    unfilled = find_unfilled_class_quotas(budget, by_t)
    assert any(u["asset_class"] == "alternative" for u in unfilled)

    att = needs_attainment(
        {"max_drawdown": -0.1},
        {
            "group_weight_bands": [
                {"group_id": "w_alternative", "tickers": ["PFX"], "target_pct": 0.15}
            ]
        },
        holdings={"SPY": 0.85, "PFX": 0.15},
        ticker_meta=by_t,
        class_budget={"alternative": 0.15, "equity": 0.85},
    )
    assert att is not None
    assert att["within_class_quotas"] is False
    # Band on PFX weight is met, but class quota fails because PFX is equity.
    assert att["within_group_bands"] is True
    assert att["all_floors_met"] is False


def test_fa51bebe_fixed_with_hint_fills_and_meets():
    """With alternative hint: PFX joins alternative sleeve → quotas fill."""
    universe = get_universe(
        tickers=["SPY", "AGG"],
        supplement_tickers=["PFX"],
        supplement_meta={"PFX": {"asset_class": "alternative"}},
    )
    pinned = pin_guaranteed_supplements(
        universe,
        ["PFX"],
        supplement_meta={"PFX": {"asset_class": "alternative"}},
    )
    by_t = {u["ticker"]: u for u in pinned}
    assert by_t["PFX"]["asset_class"] == "alternative"

    budget = fixed_class_budget_from_param_controls(
        {"w_alternative": {"mode": "fixed", "fixed": 0.15}}
    )
    assert find_unfilled_class_quotas(budget, by_t) == []

    att = needs_attainment(
        {"max_drawdown": -0.1},
        {
            "group_weight_bands": [
                {"group_id": "w_alternative", "tickers": ["PFX"], "target_pct": 0.15}
            ]
        },
        holdings={"SPY": 0.85, "PFX": 0.15},
        ticker_meta=by_t,
        class_budget={"alternative": 0.15, "equity": 0.85},
    )
    assert att is not None
    assert att["within_class_quotas"] is True
    assert att["within_group_bands"] is True
    assert att["all_floors_met"] is True
