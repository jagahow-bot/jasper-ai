"""Overlay group_weight_band enforcement in simulate."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.engine.group_weights import GroupWeightBand, apply_group_weight_bands
from app.engine.portfolio import simulate_dynamic_portfolio
from app.engine.allocator import AllocatorParams
from app.engine.spec import BacktestSpec
from app.models import ClientContext, GroupWeightBand as GroupWeightBandModel


def test_apply_group_weight_bands_ai_hedge_split():
    tickers = ["SPY", "BOTZ", "AIQ", "GOOGL", "BIL", "GLD"]
    w = np.ones(len(tickers)) / len(tickers)
    bands = [
        GroupWeightBand(group_id="ai", tickers=("BOTZ", "AIQ", "GOOGL"), target_pct=0.30),
        GroupWeightBand(group_id="hedge", tickers=("BIL", "GLD"), target_pct=0.70),
        GroupWeightBand(group_id="bil-share", tickers=("BIL",), target_pct=0.70),
    ]
    out = apply_group_weight_bands(w, tickers, bands, max_weight=1.0)
    ai_sum = float(out[1] + out[2] + out[3])
    hedge_sum = float(out[4] + out[5])
    assert abs(ai_sum - 0.30) < 0.02
    assert abs(hedge_sum - 0.70) < 0.02
    assert abs(float(out[4]) / hedge_sum - 0.70) < 0.05


def test_simulate_respects_client_context_group_bands():
    rng = np.random.default_rng(3)
    n = 280
    idx = pd.bdate_range("2019-01-01", periods=n)
    tickers = ["SPY", "BOTZ", "AIQ", "GOOGL", "BIL", "GLD"]
    prices = pd.DataFrame(
        {
            t: 100 * np.cumprod(1 + rng.normal(0.0003, 0.012, size=n))
            for t in tickers
        },
        index=idx,
    )
    ctx = ClientContext(
        group_weight_bands=[
            GroupWeightBandModel(
                group_id="ai",
                tickers=["BOTZ", "AIQ", "GOOGL"],
                target_pct=0.30,
            ),
            GroupWeightBandModel(
                group_id="hedge",
                tickers=["BIL", "GLD"],
                target_pct=0.70,
            ),
            GroupWeightBandModel(group_id="bil", tickers=["BIL"], target_pct=0.70),
        ]
    )
    m = simulate_dynamic_portfolio(
        prices,
        spec=BacktestSpec(rebalance_rule="QE", max_holdings=6, cash_reserve_pct=0.4),
        max_weight=0.6,
        min_weight=0.005,
        allocator=AllocatorParams(mode="mean_variance", lookback_days=63),
        top_n=6,
        anchor_weights={"SPY": 1.0},
        customization_drift=0.95,
        group_weight_bands=ctx.group_weight_bands,
    )
    last_w = np.asarray(m.get("last_weights"), dtype=float).ravel()
    last = dict(zip(tickers, last_w))
    ai = sum(last.get(t, 0.0) for t in ("BOTZ", "AIQ", "GOOGL"))
    hedge = sum(last.get(t, 0.0) for t in ("BIL", "GLD"))
    assert hedge > ai * 1.5
    wh = m.get("weight_history") or []
    assert wh
    assert any(float(r.get("CASH", 0.0) or 0.0) >= 0.35 for r in wh)
