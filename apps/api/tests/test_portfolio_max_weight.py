"""Max single-name weight cap must hold after dynamic rebalance."""



from __future__ import annotations



import numpy as np

import pandas as pd



from app.engine.allocator import AllocatorParams

from app.engine.portfolio import (

    _ensure_chosen_respects_cap,

    simulate_dynamic_portfolio,

)

from app.engine.spec import BacktestSpec

from app.engine.weights import (

    audit_weight_cap,

    effective_max_weight_cap,

    project_max_weight,

)





def test_project_max_weight_caps_concentration():

    w = np.array([1.0, 0.0, 0.0, 0.0])

    out = project_max_weight(w, 0.5)

    assert float(out.max()) <= 0.5 + 1e-6

    assert abs(float(out.sum()) - 1.0) < 1e-6





def test_project_max_weight_single_tradable_infeasible():

    """One name cannot satisfy 50% cap with sum=1; audit must flag it."""

    w = np.array([1.0])

    out = project_max_weight(w, 0.5)

    assert float(out.max()) > 0.5

    audit = audit_weight_cap(out, 0.5, tradable_count=1)

    assert audit["violation"] is True

    assert audit["feasible"] is False





def test_effective_max_weight_cap_clips_trial_to_request():

    assert effective_max_weight_cap(1.0, 0.5) == 0.5

    assert effective_max_weight_cap(0.0, 0.5) == 0.5

    assert effective_max_weight_cap(None, 0.5) == 0.5





def test_ensure_chosen_respects_cap_expands_to_min_names():

    scores = pd.Series({"XLK": 1.0, "AAPL": 0.5, "MSFT": 0.4, "GOOG": 0.3})

    chosen = _ensure_chosen_respects_cap(

        scores,

        ["XLK"],

        max_weight=0.5,

        top_n=1,

        tickers=list(scores.index),

    )

    assert len(chosen) >= 2





def test_simulate_dynamic_respects_max_weight_cap():

    rng = np.random.default_rng(42)

    dates = pd.bdate_range("2015-01-01", periods=600)

    tickers = ["XLK", "AAPL", "MSFT", "GOOG", "AMZN"]

    prices = pd.DataFrame(

        {t: 100 * np.cumprod(1 + rng.normal(0.0004, 0.012, len(dates))) for t in tickers},

        index=dates,

    )

    spec = BacktestSpec(rebalance_rule="QE", fee_bps=10)

    m = simulate_dynamic_portfolio(

        prices,

        spec=spec,

        max_weight=0.5,

        allocator=AllocatorParams(mode="mean_variance", lookback_days=126),

        top_n=3,

    )

    hist = m.get("weight_history") or []

    assert hist, "expected weight history snapshots"

    for row in hist:

        for k, v in row.items():

            if k in ("date", "OTHER"):

                continue

            assert float(v) <= 0.5 + 1e-5, f"{k} weight {v} exceeds 50% cap on {row.get('date')}"

    last_w = np.asarray(m.get("last_weights"), dtype=float)

    assert float(last_w.max()) <= 0.5 + 1e-5

    audit = m.get("weight_cap_audit") or {}

    assert audit.get("violation_count", 0) == 0





def test_qqq_100pct_when_cap_disabled_top_n_one():

    """Reproduces user-visible 100% QQQ when run cap is 100% and Top-N concentrates."""

    rng = np.random.default_rng(7)

    dates = pd.bdate_range("2015-01-01", periods=600)

    tickers = ["QQQ", "XLK", "AAPL", "MSFT", "GOOG"]

    prices = pd.DataFrame(

        {t: 100 * np.cumprod(1 + rng.normal(0.0004, 0.012, len(dates))) for t in tickers},

        index=dates,

    )

    spec = BacktestSpec(rebalance_rule="QE", fee_bps=10)

    m = simulate_dynamic_portfolio(

        prices,

        spec=spec,

        max_weight=1.0,

        allocator=AllocatorParams(mode="mean_variance", lookback_days=126),

        top_n=1,

    )

    last_w = np.asarray(m.get("last_weights"), dtype=float)

    assert float(last_w.max()) >= 0.99





def test_qqq_only_universe_flags_cap_audit():

    rng = np.random.default_rng(42)

    dates = pd.bdate_range("2015-01-01", periods=400)

    prices = pd.DataFrame(

        {"QQQ": 100 * np.cumprod(1 + rng.normal(0.0004, 0.012, len(dates)))},

        index=dates,

    )

    spec = BacktestSpec(rebalance_rule="QE", fee_bps=10)

    m = simulate_dynamic_portfolio(

        prices,

        spec=spec,

        max_weight=0.5,

        allocator=AllocatorParams(mode="mean_variance", lookback_days=126),

        top_n=3,

    )

    audit = m.get("weight_cap_audit") or {}

    assert audit.get("violation_count", 0) >= 1 or audit.get("feasible") is False


