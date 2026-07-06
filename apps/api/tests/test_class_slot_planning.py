"""Per-class slot planning and strict top-k selection."""

from __future__ import annotations

import pandas as pd

from app.engine.asset_class_policy import (
    class_budget_from_params,
    pick_top_n_by_class_slots,
    plan_class_slots,
)
from app.engine.portfolio import _pick_top_n_with_budget


def test_plan_class_slots_two_classes_sums_to_max_holdings() -> None:
    slots = plan_class_slots(10, {"equity": 0.6, "bond": 0.4})
    assert slots == {"equity": 6, "bond": 4}
    assert sum(slots.values()) == 10


def test_plan_class_slots_only_active_classes() -> None:
    slots = plan_class_slots(10, {"equity": 0.7, "bond": 0.3})
    assert set(slots.keys()) == {"equity", "bond"}
    assert sum(slots.values()) == 10


def test_plan_class_slots_from_trial_params_respects_asset_filter() -> None:
    params = {
        "w_equity": 0.5,
        "w_bond": 0.5,
        "w_commodity": 0.2,
        "w_real_estate": 0.1,
        "w_alternative": 0.1,
    }
    budget = class_budget_from_params(params, asset_classes=["equity", "bond"])
    slots = plan_class_slots(10, budget)
    assert set(slots.keys()) == {"equity", "bond"}
    assert sum(slots.values()) == 10


def test_static_regime_off_slots_match_largest_remainder() -> None:
    """60/40 on max_holdings=10 → 6 equity, 4 bond slots."""
    budget = {"equity": 0.6, "bond": 0.4}
    assert plan_class_slots(10, budget) == {"equity": 6, "bond": 4}


def test_regime_on_risk_off_more_bond_slots() -> None:
    risk_off = plan_class_slots(10, {"equity": 0.2, "bond": 0.8})
    risk_on = plan_class_slots(10, {"equity": 0.8, "bond": 0.2})
    assert risk_off["bond"] > risk_on["bond"]
    assert risk_off["equity"] < risk_on["equity"]
    assert sum(risk_off.values()) == 10
    assert sum(risk_on.values()) == 10


def test_strict_per_class_top_k_not_global_order() -> None:
    """Bond class must receive its slots even when equities score higher."""
    scores = pd.Series(
        {
            "EQ1": 10.0,
            "EQ2": 9.0,
            "EQ3": 8.0,
            "EQ4": 7.0,
            "EQ5": 6.0,
            "EQ6": 5.0,
            "BD1": 4.0,
            "BD2": 3.0,
            "BD3": 2.0,
            "BD4": 1.0,
        }
    )
    universe = {t: {"asset_class": "equity" if t.startswith("EQ") else "bond"} for t in scores.index}
    chosen = _pick_top_n_with_budget(
        scores,
        top_n=10,
        tickers=list(scores.index),
        universe_by_ticker=universe,
        class_budget={"equity": 0.6, "bond": 0.4},
    )
    eq = sum(1 for t in chosen if universe[t]["asset_class"] == "equity")
    bd = sum(1 for t in chosen if universe[t]["asset_class"] == "bond")
    assert eq == 6
    assert bd == 4
    assert set(chosen) == {"EQ1", "EQ2", "EQ3", "EQ4", "EQ5", "EQ6", "BD1", "BD2", "BD3", "BD4"}


def test_pick_top_n_by_class_slots_risk_off_distribution() -> None:
    """Matches prior risk-off top_n=11 expectation: 2 EQ / 7 BD / 1 CM / 1 ALT."""
    tickers = (
        [f"EQ{i}" for i in range(1, 4)]
        + [f"BD{i}" for i in range(1, 8)]
        + ["CM1", "CM2"]
        + ["ALT1"]
    )
    universe: dict[str, dict[str, str]] = {}
    for t in tickers:
        if t.startswith("EQ"):
            universe[t] = {"asset_class": "equity"}
        elif t.startswith("BD"):
            universe[t] = {"asset_class": "bond"}
        elif t.startswith("CM"):
            universe[t] = {"asset_class": "commodity"}
        else:
            universe[t] = {"asset_class": "alternative"}
    scores = pd.Series({t: float(100 - i) for i, t in enumerate(tickers)})
    budget = {
        "equity": 0.18,
        "bond": 0.64,
        "commodity": 0.09,
        "alternative": 0.09,
    }
    slots = plan_class_slots(11, budget)
    chosen = pick_top_n_by_class_slots(
        scores,
        max_holdings=11,
        tickers=tickers,
        universe_by_ticker=universe,
        class_budget=budget,
        class_slots=slots,
    )
    counts: dict[str, int] = {}
    for t in chosen:
        ac = universe[t]["asset_class"]
        counts[ac] = counts.get(ac, 0) + 1
    assert counts == {"equity": 2, "bond": 7, "commodity": 1, "alternative": 1}
    assert len(chosen) == 11
