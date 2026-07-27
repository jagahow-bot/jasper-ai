"""Unlimited top_n (full universe) and disabled refinement patience."""

from __future__ import annotations

from unittest.mock import patch

import numpy as np
import pandas as pd
import pytest

from app.engine.backtest import _run_iterative_search
from app.engine.factors import pick_top_n
from app.engine.param_bounds import RunBlueprint, clamp_param_dict, normalize_param_controls
from app.engine.portfolio import _pick_top_n_with_budget
from app.engine.spec import (
    BacktestSpec,
    effective_top_n,
    resolve_candidate_top_n,
    resolve_top_n_cap,
    top_n_ai_range_hi,
)
from app.models import BacktestMode, BacktestRequest, Objective, OptimizationMode


def test_backtest_request_defaults_unlimited():
    req = BacktestRequest(
        scenario_id="custom",
        max_weight=0.5,
        objective=Objective.max_sharpe,
        backtest_mode=BacktestMode.static,
    )
    assert req.top_n is None
    assert req.refinement_patience is None


def test_resolve_candidate_top_n_unlimited():
    assert resolve_candidate_top_n(None, 87) == 87
    assert resolve_candidate_top_n(50, 87) == 50
    assert resolve_candidate_top_n(120, 87) == 87


def test_resolve_top_n_cap_unlimited_uses_full_universe():
    spec = BacktestSpec(max_holdings=30)
    assert resolve_top_n_cap(None, 87, spec) == 87
    assert resolve_top_n_cap(50, 87, spec) == 30


def test_effective_top_n_unlimited_with_n_assets():
    spec = BacktestSpec(max_holdings=8)
    assert effective_top_n(None, spec, n_assets=40) == 40
    assert effective_top_n(50, spec, n_assets=40) == 8


def test_top_n_ai_range_hi_unlimited():
    assert top_n_ai_range_hi(None, 55) == 55
    assert top_n_ai_range_hi(40, 55) == 40


def test_param_bounds_no_top_n_ceiling_when_unlimited():
    bp = RunBlueprint(max_weight=0.5, max_turnover=1.0, top_n=None, max_holdings=30)
    assert bp.ceiling("top_n_actual") is None
    clipped, violations = clamp_param_dict({"top_n_actual": 80}, bp)
    assert clipped["top_n_actual"] == 80
    assert not violations
    out = normalize_param_controls({"top_n_actual": {"mode": "off"}}, bp)
    assert out["top_n_actual"]["mode"] == "off"


def test_pick_top_n_unlimited_uses_all_scores():
    scores = pd.Series({"A": 1.0, "B": 0.8, "C": 0.6, "D": 0.4, "E": 0.2})
    n = resolve_candidate_top_n(None, len(scores))
    chosen = pick_top_n(scores, n)
    assert chosen == list(scores.sort_values(ascending=False).index)


def test_pick_top_n_with_budget_unlimited():
    scores = pd.Series({f"T{i}": float(i) for i in range(10)})
    n = resolve_candidate_top_n(None, len(scores))
    chosen = _pick_top_n_with_budget(
        scores,
        top_n=n,
        tickers=list(scores.index),
        universe_by_ticker=None,
        class_budget=None,
    )
    assert len(chosen) == 10


def _fake_round_seed(**_kwargs):
    return {
        "round_setup": {"mode": "risk_parity", "lookback_days": 252, "top_n_actual": 5},
        "rationale": "test",
    }


def _trial(portfolio_id: int, objective_is: float) -> tuple[float, dict, dict]:
    metrics = {"objective_value_is": objective_is, "sharpe": objective_is}
    return (objective_is, {"mode": "risk_parity", "portfolio_id": portfolio_id}, metrics)


@pytest.fixture
def price_panel() -> pd.DataFrame:
    idx = pd.date_range("2020-01-01", periods=400, freq="B")
    data = {
        "AAA": 100 + pd.Series(range(len(idx))).values * 0.01,
        "BBB": 50 + pd.Series(range(len(idx))).values * 0.02,
        "CCC": 80 + pd.Series(range(len(idx))).values * 0.015,
    }
    return pd.DataFrame(data, index=idx)


def test_refinement_without_patience_runs_all_rounds(price_panel: pd.DataFrame):
    """No patience early-stop: all max_rounds execute even with flat champion."""
    round_outputs = [
        [_trial(1, 0.50), _trial(2, 0.95), _trial(7, 0.40)],
        [_trial(3, 0.94), _trial(4, 0.93)],
        [_trial(5, 0.92), _trial(6, 0.91)],
    ]
    call_idx = {"n": 0}

    def fake_optuna(*_args, **_kwargs):
        idx = call_idx["n"]
        call_idx["n"] += 1
        return round_outputs[idx]

    req = BacktestRequest(
        scenario_id="test-unlimited-patience",
        asset_classes=["equity"],
        objective=Objective.max_sharpe,
        optimization_mode=OptimizationMode.pro_auto,
        trials=5,
        top_models=5,
        max_weight=0.25,
        max_turnover=0.5,
        refinement_batch_size=3,
        refinement_challengers_per_round=2,
        refinement_max_rounds=3,
        refinement_patience=None,
        refinement_min_improvement=0.01,
    )
    prices_train = price_panel.iloc[:280]

    with (
        patch("app.engine.backtest.run_optuna_search", side_effect=fake_optuna),
        patch("app.engine.backtest.generate_ai_round_seed", side_effect=_fake_round_seed),
    ):
        _records, _history, meta = _run_iterative_search(
            req,
            prices_train=prices_train,
            prices_sim_panel=prices_train,
            prices_val=None,
            oos=False,
            objective_effective="max_sharpe",
            rebalance_rule="monthly",
            spec=BacktestSpec(),
            universe_by_ticker={},
            param_controls_dict={},
            report_progress=lambda *_a, **_k: None,
        )

    assert meta["rounds_completed"] == 3
    assert meta["stopped_reason"] == "max_rounds"
