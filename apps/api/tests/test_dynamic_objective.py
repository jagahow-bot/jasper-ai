"""Dynamic objective timeline serialization for backtest results."""

from __future__ import annotations

import pandas as pd

from app.engine.dynamic_objective import (
    build_dynamic_backtest_chart_payload,
    serialize_dynamic_timeline,
)


def test_serialize_dynamic_timeline_shape():
    raw = [
        {
            "date": "2024-06-01",
            "regime": "risk_on",
            "objective": "max_return",
            "switched": True,
            "raw_regime": "risk_on",
        },
        {
            "date": "2024-09-01",
            "regime": "risk_off",
            "objective": "min_max_drawdown",
            "switched": False,
        },
    ]
    rows = serialize_dynamic_timeline(raw)
    assert len(rows) == 2
    assert rows[0]["date"] == "2024-06-01"
    assert rows[0]["regime"] == "risk_on"
    assert rows[0]["objective"] == "max_return"
    assert rows[0]["switched"] is True
    assert rows[0]["raw_regime"] == "risk_on"
    assert rows[1]["switched"] is False


def test_build_dynamic_backtest_chart_payload_nonempty():
    idx = pd.date_range("2023-01-01", periods=120, freq="B")
    prices = pd.DataFrame({"SPY": 100 + pd.Series(range(120), index=idx) * 0.1})
    timeline = [
        {"date": "2023-04-01", "regime": "neutral", "objective": "max_sharpe", "switched": False},
        {"date": "2023-08-01", "regime": "risk_on", "objective": "max_return", "switched": True},
    ]
    serialized, series = build_dynamic_backtest_chart_payload(prices, "SPY", timeline)
    assert len(serialized) == 2
    assert serialized[0]["objective"] == "max_sharpe"
    assert len(series) >= 1
    assert "date" in series[0]
    assert "cumulative_return_pct" in series[0]
