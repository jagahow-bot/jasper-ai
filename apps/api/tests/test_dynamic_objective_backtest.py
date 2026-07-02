"""Dynamic objective integration for main Jasper backtest."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.engine.dynamic_objective import (
    DYNAMIC_OBJECTIVE,
    build_dynamic_objective_context,
    is_dynamic_objective,
    trial_scoring_objective,
)
from app.engine.objectives import DYNAMIC_COMPREHENSIVE_SCORING
from app.engine.backtest import _resolve_objective
from app.models import Objective


def _synthetic_panel(n: int = 520, n_assets: int = 8) -> pd.DataFrame:
    idx = pd.bdate_range("2018-01-01", periods=n)
    rng = np.random.default_rng(7)
    cols = {
        f"E{i}": 100 * np.cumprod(1 + rng.normal(0.0003, 0.012, n))
        for i in range(n_assets)
    }
    cols["SPY"] = 100 * np.cumprod(1 + rng.normal(0.0005, 0.015, n))
    return pd.DataFrame(cols, index=idx)


def test_resolve_dynamic_objective() -> None:
    assert _resolve_objective("dynamic", None) == DYNAMIC_OBJECTIVE
    assert is_dynamic_objective(DYNAMIC_OBJECTIVE)
    assert trial_scoring_objective(DYNAMIC_OBJECTIVE) == DYNAMIC_COMPREHENSIVE_SCORING
    assert trial_scoring_objective("max_return") == "max_return"


def test_dynamic_context_uses_multiple_objectives() -> None:
    prices = _synthetic_panel()
    ctx = build_dynamic_objective_context(prices, "SPY", regime_mode="auto")
    timeline = ctx.get("regime_timeline") or []
    assert len(timeline) >= 4
    objectives = {str(row["objective"]) for row in timeline}
    assert len(objectives) >= 2, objectives
    assert ctx.get("allocator_resolver") is not None
    assert ctx.get("active_regime_resolver") is not None
    assert Objective.dynamic.value == "dynamic"
