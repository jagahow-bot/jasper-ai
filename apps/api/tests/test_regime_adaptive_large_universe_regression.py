"""Regression: regime-adaptive Pro round with large multi-class universe."""

from __future__ import annotations

from unittest.mock import patch

import numpy as np
import pandas as pd
import pytest

from app.engine.backtest import _run_iterative_search
from app.engine.dynamic_objective import build_dynamic_objective_context
from app.engine.spec import BacktestSpec
from app.models import BacktestRequest, Objective, OptimizationMode


def _fake_ai_round_seed(**_kwargs):
    return {
        "enabled": True,
        "rationale": "test",
        "round_setup": {
            "mode": "mean_variance",
            "lookback_days": 252,
            "shrinkage": 0.1,
            "risk_aversion": 4.0,
            "top_n_actual": 80,
            "max_weight_actual": 0.12,
            "max_turnover_actual": 0.4,
            "no_trade_tol": 0.0,
            "turnover_penalty_mult": 1.0,
        },
        "regime_setups": {
            "risk_off": {
                "mode": "min_var",
                "lookback_days": 252,
                "shrinkage": 0.2,
                "risk_aversion": 6.0,
            },
            "neutral": {
                "mode": "mean_variance",
                "lookback_days": 126,
                "shrinkage": 0.1,
                "risk_aversion": 3.0,
            },
            "risk_on": {
                "mode": "mean_variance",
                "lookback_days": 63,
                "shrinkage": 0.05,
                "risk_aversion": 1.5,
            },
        },
        "regime_class_quotas": {
            "risk_off": {"w_bond": 0.5, "w_commodity": 0.3, "w_equity": 0.2},
            "neutral": {"w_equity": 0.4, "w_bond": 0.4, "w_commodity": 0.2},
            "risk_on": {"w_equity": 0.6, "w_bond": 0.25, "w_commodity": 0.15},
        },
        "regime_factor_ranges": {
            "risk_off": {
                "w_mom": [0.0, 0.8],
                "w_reversal": [0.0, 1.0],
                "w_value": [0.0, 1.0],
                "w_lowvol": [0.5, 1.5],
                "w_trend": [0.0, 1.0],
                "w_drawdown": [0.0, 1.0],
                "factor_lookback_days": [126, 504],
                "reversal_lookback_days": [63, 252],
                "value_lookback_days": [63, 252],
            },
            "neutral": {
                "w_mom": [0.2, 1.0],
                "w_reversal": [0.0, 1.0],
                "w_value": [0.0, 1.0],
                "w_lowvol": [0.1, 1.0],
                "w_trend": [0.0, 1.0],
                "w_drawdown": [0.0, 1.0],
                "factor_lookback_days": [126, 504],
                "reversal_lookback_days": [63, 252],
                "value_lookback_days": [63, 252],
            },
            "risk_on": {
                "w_mom": [0.5, 1.5],
                "w_reversal": [0.0, 1.0],
                "w_value": [0.0, 1.0],
                "w_lowvol": [0.0, 0.8],
                "w_trend": [0.0, 1.0],
                "w_drawdown": [0.0, 1.0],
                "factor_lookback_days": [126, 504],
                "reversal_lookback_days": [63, 252],
                "value_lookback_days": [63, 252],
            },
        },
        "factor_ranges": {},
        "factor_choices": {},
    }


@pytest.fixture
def large_panel() -> tuple[pd.DataFrame, dict[str, dict[str, str]]]:
    n_assets = 313
    classes = ["equity", "bond", "commodity"]
    dates = pd.bdate_range("2015-01-01", periods=900)
    rng = np.random.default_rng(99)
    universe: dict[str, dict[str, str]] = {}
    data: dict[str, np.ndarray] = {}
    for i in range(n_assets):
        t = f"T{i:03d}"
        ac = classes[i % 3]
        universe[t] = {"asset_class": ac, "region": "us"}
        data[t] = 100 * np.cumprod(1 + rng.normal(0.0003, 0.012, len(dates)))
    prices = pd.DataFrame(data, index=dates)
    prices["SPY"] = 100 * np.cumprod(1 + rng.normal(0.0004, 0.01, len(dates)))
    return prices, universe


def test_pro_regime_adaptive_large_universe_optuna(large_panel) -> None:
    """Real Optuna + simulate with regime class quotas on a 313-name multi-class book."""
    prices, universe = large_panel
    prices_train = prices[[c for c in prices.columns if c != "SPY"]].iloc[:700]
    prices_sim = prices_train
    prices_wb = prices.iloc[:700]
    dynamic_ctx = build_dynamic_objective_context(prices_wb, "SPY", regime_mode="auto")

    req = BacktestRequest(
        scenario_id="regime-large-universe",
        asset_classes=["equity", "bond", "commodity"],
        objective=Objective.max_sharpe,
        optimization_mode=OptimizationMode.pro_auto,
        regime_adaptive=True,
        enforce_class_weights=True,
        trials=5,
        top_models=3,
        max_weight=0.15,
        max_turnover=0.5,
        top_n=None,
        refinement_batch_size=3,
        refinement_challengers_per_round=2,
        refinement_max_rounds=1,
        refinement_patience=None,
        refinement_min_improvement=0.01,
        start_date="2016-01-01",
        end_date="2018-12-31",
    )

    with patch(
        "app.engine.backtest.generate_ai_round_seed",
        side_effect=_fake_ai_round_seed,
    ):
        records, _history, meta = _run_iterative_search(
            req,
            prices_train=prices_train,
            prices_sim_panel=prices_sim,
            prices_val=None,
            oos=False,
            objective_effective="max_sharpe",
            rebalance_rule="QE",
            spec=BacktestSpec(rebalance_rule="QE", max_holdings=30),
            universe_by_ticker=universe,
            param_controls_dict={},
            report_progress=lambda *_a, **_k: None,
            dynamic_ctx=dynamic_ctx,
        )

    assert records
    assert meta.get("rounds_completed") == 1
