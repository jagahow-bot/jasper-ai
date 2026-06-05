"""Institutional analytics bundled in lazy chart payload."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.candidate_charts import (
    candidate_has_deep_analytics,
    merge_charts_into_candidate,
)
from app.models import CandidateChartsPayload, PortfolioCandidate


def test_candidate_has_deep_analytics_detects_periodic_or_rolling():
    slim = PortfolioCandidate(
        rank=2,
        model_code="M0005",
        weights={"SPY": 1.0},
        sharpe=1.0,
        max_drawdown=-0.1,
        cagr=0.1,
        volatility=0.15,
        analytics={"sample_metrics": {"in_sample": {"sharpe": 1.0}}},
    )
    assert not candidate_has_deep_analytics(slim)
    with_monthly = slim.model_copy(
        update={
            "analytics": {
                "periodic_returns": {
                    "monthly": [{"period": "2020-01", "return": 0.01}],
                    "annual": [],
                }
            }
        }
    )
    assert candidate_has_deep_analytics(with_monthly)


def test_merge_charts_into_candidate_applies_institutional():
    slim = PortfolioCandidate(
        rank=2,
        model_code="M0005",
        weights={"SPY": 1.0},
        sharpe=1.0,
        max_drawdown=-0.1,
        cagr=0.1,
        volatility=0.15,
        analytics={"sample_metrics": {"in_sample": {"sharpe": 1.0}}},
    )
    payload = CandidateChartsPayload(
        model_code="M0005",
        equity_curve=[{"date": "2020-01-02", "value": 1.0}],
        weight_history=[{"date": "2020-01-02", "SPY": 1.0}],
        weight_history_tickers=["SPY"],
        benchmark_equity_curve=[],
        institutional={
            "rolling": {
                "rolling_sharpe": [{"date": "2020-06-01", "value": 1.2}],
                "rolling_vol": [{"date": "2020-06-01", "value": 0.14}],
            },
            "periodic_returns": {
                "monthly": [{"period": "2020-02", "return": 0.02}],
                "annual": [{"period": "2020", "return": 0.08}],
            },
            "periodic_returns_scope": "in_sample",
            "risk_contribution": [
                {"ticker": "SPY", "weight": 1.0, "risk_contrib": 1.0}
            ],
            "drawdown_episodes": [
                {
                    "start": "2020-03-01",
                    "trough": "2020-03-15",
                    "end": "2020-04-01",
                    "depth": -0.05,
                    "days": 31,
                }
            ],
            "drawdown_series": [{"date": "2020-01-02", "value": 0.0}],
        },
    )
    merged = merge_charts_into_candidate(slim, payload)
    analytics = merged.analytics or {}
    assert analytics.get("rolling", {}).get("rolling_sharpe")
    assert analytics.get("periodic_returns", {}).get("monthly")
    assert analytics.get("risk_contribution")
    assert analytics.get("drawdown_episodes")
    assert (merged.analytics or {}).get("sample_metrics") is not None


def test_build_institutional_analytics_with_oos_train_slice():
    from app.candidate_charts import _build_institutional_analytics
    from app.engine.spec import DEFAULT_SPEC
    from app.models import BacktestRequest

    idx = pd.date_range("2018-01-02", periods=600, freq="B")
    prices_sim = pd.DataFrame(
        {
            "SPY": 100 * (1 + pd.Series(0.0003, index=idx)).cumprod().values,
            "TLT": 100 * (1 + pd.Series(0.0001, index=idx)).cumprod().values,
        },
        index=idx,
    )
    prices = prices_sim.copy()
    port_ret = pd.Series(
        np.linspace(0.0002, 0.0006, len(idx)),
        index=idx,
    )
    equity = (1.0 + port_ret).cumprod()
    full_m = {
        "equity": equity,
        "port_ret": port_ret,
        "last_weights": np.array([0.6, 0.4]),
        "rebalance_count": 12,
        "rebalance_freq": "M",
        "rebalance_dates": [],
    }
    split_idx = 400
    train_idx = idx[:split_idx]
    val_idx = idx[split_idx:]
    train_m = {
        "equity": equity.loc[train_idx],
        "port_ret": port_ret.loc[train_idx],
    }
    val_m = {
        "equity": equity.loc[val_idx],
        "port_ret": port_ret.loc[val_idx],
    }
    from app.models import Objective

    req = BacktestRequest(
        scenario_id="s1",
        start_date="2018-01-01",
        end_date="2020-12-31",
        asset_classes=["equity", "bond"],
        objective=Objective.max_sharpe,
        max_weight=0.25,
        enable_oos=True,
        train_ratio=0.7,
    )
    tickers = ["SPY", "TLT"]
    universe_by_ticker = {
        "SPY": {"ticker": "SPY", "asset_class": "equity", "region": "us"},
        "TLT": {"ticker": "TLT", "asset_class": "bond", "region": "us"},
    }
    out = _build_institutional_analytics(
        req=req,
        params={"model_code": "M0002"},
        tickers=tickers,
        prices=prices,
        prices_sim_panel=prices_sim,
        spec=DEFAULT_SPEC,
        universe_by_ticker=universe_by_ticker,
        full_m=full_m,
        bundle_train_m=train_m,
        bundle_val_m=val_m,
        sim_kw={},
        resolver=None,
    )
    assert out["periodic_returns_scope"] == "in_sample"
    assert len(out["periodic_returns"]["monthly"]) > 0
    assert len(out["rolling"]["rolling_sharpe"]) > 0
    assert out["exposure"]["equity_pct"] > 0
