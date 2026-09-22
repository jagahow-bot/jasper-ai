"""customization_search_mode: default full search; constrained is explicit-only."""

from __future__ import annotations

from app.engine.constrained_customization import (
    effective_pro_budget,
    estimate_constrained_trial_count,
    should_use_constrained_customization,
)
from app.jobs import _estimated_trials_total
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


def test_default_flag_does_not_trigger_constrained():
    """A1: anchor + small universe + RM signal, no flag → full search."""
    req = _req()
    assert req.customization_search_mode == "full"
    assert not should_use_constrained_customization(
        req, tradable_count=5, must_include_count=1
    )
    assert estimate_constrained_trial_count(req) is None


def test_explicit_constrained_triggers():
    """A2: same conditions + constrained flag → legacy path."""
    req = _req(customization_search_mode="constrained")
    assert should_use_constrained_customization(
        req, tradable_count=5, must_include_count=1
    )
    assert estimate_constrained_trial_count(req) == 25


def test_explicit_full_does_not_trigger():
    """A3: explicit full → never constrained."""
    req = _req(customization_search_mode="full")
    assert not should_use_constrained_customization(
        req, tradable_count=5, must_include_count=1
    )


def test_pro_not_suppressed_when_default_full():
    """A4 (detector): pro_auto + small locked universe stays eligible for Pro."""
    req = _req(optimization_mode=OptimizationMode.pro_auto)
    assert not should_use_constrained_customization(
        req, tradable_count=5, must_include_count=1
    )


def test_pro_plus_explicit_constrained_still_triggers():
    """A5 (detector): Pro + constrained → still constrained (engine suppresses Pro)."""
    req = _req(
        optimization_mode=OptimizationMode.pro_auto,
        customization_search_mode="constrained",
    )
    assert should_use_constrained_customization(
        req, tradable_count=5, must_include_count=1
    )


def test_jobs_estimate_small_universe_pro_uses_reduced_budget():
    """A6: small locked Pro → ~25 trials; large Pro → 40."""
    small = _req(optimization_mode=OptimizationMode.pro_auto)
    assert _estimated_trials_total(small) == 25  # 5 + 5*(5-1)

    large = _req(
        optimization_mode=OptimizationMode.pro_auto,
        universe_tickers=[f"T{i}" for i in range(30)],
        anchor_weights={f"T{i}": 1.0 / 30 for i in range(30)},
    )
    assert _estimated_trials_total(large) == 40  # 5 + 5*(8-1)


def test_jobs_estimate_constrained_message_path():
    """A7: constrained estimate non-None; default full Pro uses Pro formula."""
    constrained = _req(customization_search_mode="constrained")
    assert estimate_constrained_trial_count(constrained) == 25

    pro = _req(optimization_mode=OptimizationMode.pro_auto)
    assert estimate_constrained_trial_count(pro) is None
    assert _estimated_trials_total(pro) == 25


def test_effective_pro_budget_small_vs_large():
    small = _req()
    max_r, patience = effective_pro_budget(small, tradable_count=5)
    assert max_r == 5
    assert patience == 3

    large = _req(universe_tickers=[f"T{i}" for i in range(30)])
    max_r2, patience2 = effective_pro_budget(large, tradable_count=30)
    assert max_r2 == 8
    assert patience2 is None


def test_effective_pro_budget_respects_explicit_override():
    req = _req(refinement_max_rounds=7, refinement_patience=2)
    max_r, patience = effective_pro_budget(req, tradable_count=5)
    assert max_r == 7
    assert patience == 2


def test_effective_pro_budget_non_customization_unchanged():
    req = _req(anchor_weights=None, universe_tickers=None, client_ref=None)
    max_r, patience = effective_pro_budget(req, tradable_count=5)
    assert max_r == 8
    assert patience is None
