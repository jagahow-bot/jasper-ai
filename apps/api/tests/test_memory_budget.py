"""Memory budget helpers for Render / Optuna search."""

from __future__ import annotations

import pandas as pd

from app.engine.memory_budget import (
    downsample_keep_endpoints,
    prune_search_records,
    slim_search_metrics,
    trim_weight_history_for_response,
)
from app.engine.refinement import model_signature


def test_slim_search_metrics_deep_copies_overfitting_assessment():
    shared = {"in_sample_objective": 0.5, "out_of_sample_objective": 0.4}
    metrics_a = {"sharpe": 1.0, "overfitting_assessment": shared}
    metrics_b = {"sharpe": 2.0, "overfitting_assessment": shared}
    slim_a = slim_search_metrics(metrics_a)
    slim_b = slim_search_metrics(metrics_b)
    slim_a["overfitting_assessment"]["in_sample_objective"] = 0.1
    assert slim_b["overfitting_assessment"]["in_sample_objective"] == 0.5


def test_slim_search_metrics_drops_equity_keeps_scalars():
    metrics = {
        "sharpe": 1.2,
        "equity": pd.Series([1.0, 1.01]),
        "factor_summary": {"x": 1},
        "raw_score": 1.1,
    }
    slim = slim_search_metrics(metrics)
    assert "equity" not in slim
    assert "factor_summary" not in slim
    assert slim["sharpe"] == 1.2
    assert slim["raw_score"] == 1.1


def test_prune_search_records_keeps_champion_signature():
    params_a = {"lookback_days": 60, "shrinkage": 0.1, "risk_aversion": 2.0, "top_n_actual": 5}
    params_b = {**params_a, "shrinkage": 0.2}
    champ_sig = model_signature(params_a)
    records = [(float(i), dict(params_b), {"sharpe": float(i)}) for i in range(100)]
    records.insert(0, (50.0, dict(params_a), {"sharpe": 50.0}))
    prune_search_records(records, max_records=10, protect_signatures={champ_sig})
    assert len(records) == 10
    assert any(model_signature(r[1]) == champ_sig for r in records)


def test_downsample_keep_endpoints_preserves_last_row():
    rows = [{"date": f"2020-{i:02d}-01"} for i in range(1, 13)]
    out = downsample_keep_endpoints(rows, 4)
    assert out[0]["date"] == "2020-01-01"
    assert out[-1]["date"] == "2020-12-01"
    assert len(out) == 4


def test_trim_weight_history_keeps_last_date_and_explicit_tickers():
    wh = [
        {"date": f"2020-01-{i:02d}", "A": 0.5, "B": 0.5, "OTHER": 0.0}
        for i in range(1, 25)
    ]
    tickers = ["A", "B", "C", "D"]
    trimmed, keep = trim_weight_history_for_response(
        wh, tickers=tickers, max_rows=6, max_tickers=2
    )
    assert keep == tickers
    assert trimmed[-1]["date"] == "2020-01-24"


def test_trim_weight_history_for_response_caps_tickers():
    wh = [
        {"date": "2020-01-01", "A": 0.5, "B": 0.3, "C": 0.2, "OTHER": 0.0},
        {"date": "2020-02-01", "A": 0.4, "B": 0.4, "C": 0.2, "OTHER": 0.0},
    ]
    trimmed, keep = trim_weight_history_for_response(wh, max_tickers=2)
    assert len(keep) == 2
    assert all("OTHER" not in row for row in trimmed)

    explicit, keep_explicit = trim_weight_history_for_response(
        wh, tickers=["A", "B", "C"], max_tickers=2
    )
    assert keep_explicit == ["A", "B", "C"]
    assert len(explicit) == len(wh)


def test_trim_weight_history_with_sim_tickers_no_other():
    """API trim path (backtest) must not produce OTHER rows."""
    import numpy as np
    import pandas as pd

    from app.engine.allocator import AllocatorParams
    from app.engine.memory_budget import trim_weight_history_for_response
    from app.engine.portfolio import simulate_dynamic_portfolio
    from app.engine.spec import BacktestSpec

    dates = pd.bdate_range("2020-01-01", periods=280)
    rng = np.random.default_rng(7)
    cols = [f"E{i}" for i in range(12)]
    prices = pd.DataFrame(
        {c: 100 * np.cumprod(1 + rng.normal(0.0003, 0.012, len(dates))) for c in cols},
        index=dates,
    )
    m = simulate_dynamic_portfolio(
        prices,
        spec=BacktestSpec(rebalance_rule="ME", fee_bps=0.0),
        max_weight=0.35,
        min_weight=0.0,
        allocator=AllocatorParams(mode="mean_variance", lookback_days=126),
        top_n=8,
    )
    wh_raw = m.get("weight_history") or []
    wht_raw = m.get("weight_history_tickers") or []
    trimmed, keep = trim_weight_history_for_response(wh_raw, tickers=wht_raw)
    assert keep == wht_raw
    for row in trimmed:
        assert "OTHER" not in row
