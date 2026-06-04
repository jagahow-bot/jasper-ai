"""Memory budget helpers for Render / Optuna search."""

from __future__ import annotations

import pandas as pd

from app.engine.memory_budget import (
    prune_search_records,
    slim_search_metrics,
    trim_weight_history_for_response,
)
from app.engine.refinement import model_signature


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


def test_trim_weight_history_for_response_caps_tickers():
    wh = [
        {"date": "2020-01-01", "A": 0.5, "B": 0.3, "C": 0.2, "OTHER": 0.0},
        {"date": "2020-02-01", "A": 0.4, "B": 0.4, "C": 0.2, "OTHER": 0.0},
    ]
    trimmed, keep = trim_weight_history_for_response(
        wh, tickers=["A", "B", "C"], max_tickers=2
    )
    assert len(keep) == 2
    assert all("OTHER" in row for row in trimmed)
