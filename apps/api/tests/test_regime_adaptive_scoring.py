"""Regime-adaptive allocation is decoupled from the composite dynamic objective.

When ``regime_adaptive`` is on with a plain objective (e.g. max_return), trial and
champion ranking must use the user's chosen objective, NOT the dynamic composite
score — while the per-regime allocator switching still applies.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.engine.backtest import _resolve_objective
from app.engine.dynamic_objective import (
    DYNAMIC_OBJECTIVE,
    build_dynamic_objective_context,
    is_dynamic_objective,
    trial_scoring_objective,
)
from app.engine.objectives import DYNAMIC_COMPREHENSIVE_SCORING
from app.models import BacktestRequest, Objective


def _synthetic_panel(n: int = 520, n_assets: int = 8) -> pd.DataFrame:
    idx = pd.bdate_range("2018-01-01", periods=n)
    rng = np.random.default_rng(11)
    cols = {
        f"E{i}": 100 * np.cumprod(1 + rng.normal(0.0003, 0.012, n))
        for i in range(n_assets)
    }
    cols["SPY"] = 100 * np.cumprod(1 + rng.normal(0.0005, 0.015, n))
    return pd.DataFrame(cols, index=idx)


def _request(**overrides) -> BacktestRequest:
    base = dict(
        scenario_id="custom",
        max_weight=0.5,
        objective=Objective.max_return,
    )
    base.update(overrides)
    return BacktestRequest(**base)


def test_request_defaults_regime_adaptive_off() -> None:
    req = _request()
    assert req.regime_adaptive is False


def test_regime_adaptive_max_return_ranks_on_user_objective() -> None:
    """regime_adaptive + max_return must NOT switch ranking to dynamic_comprehensive."""
    req = _request(objective=Objective.max_return, regime_adaptive=True)
    objective_effective = _resolve_objective(req.objective.value, req.objective_custom_text)

    # This is exactly how run_backtest derives the two flags.
    regime_adaptive = bool(req.regime_adaptive) or is_dynamic_objective(objective_effective)
    trial_objective = trial_scoring_objective(objective_effective)

    assert regime_adaptive is True  # regime detection/allocator switching enabled
    assert is_dynamic_objective(objective_effective) is False
    assert trial_objective == "max_return"
    assert trial_objective != DYNAMIC_COMPREHENSIVE_SCORING


def test_dynamic_objective_still_ranks_on_composite() -> None:
    """Backward compat: objective=dynamic keeps regime switching + composite ranking."""
    req = _request(objective=Objective.dynamic, regime_adaptive=False)
    objective_effective = _resolve_objective(req.objective.value, req.objective_custom_text)

    regime_adaptive = bool(req.regime_adaptive) or is_dynamic_objective(objective_effective)
    trial_objective = trial_scoring_objective(objective_effective)

    assert objective_effective == DYNAMIC_OBJECTIVE
    assert regime_adaptive is True  # dynamic implies regime adaptive
    assert trial_objective == DYNAMIC_COMPREHENSIVE_SCORING


def test_regime_context_switches_allocator_regardless_of_objective() -> None:
    """Per-regime allocator resolver works even for a non-dynamic objective."""
    prices = _synthetic_panel()
    ctx = build_dynamic_objective_context(prices, "SPY", regime_mode="auto")
    assert ctx.get("allocator_resolver") is not None
    timeline = ctx.get("regime_timeline") or []
    assert len(timeline) >= 4
