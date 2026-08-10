"""Static replay must carry a CASH pseudo-ticker line into the cash sleeve."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from unittest.mock import patch

from app.engine import backtest as bt
from app.engine.backtest import _split_static_cash_line
from app.models import BacktestRequest, ClientContext, Objective


def test_split_cash_line_no_cash_is_noop():
    weights, reserve = _split_static_cash_line({"SPY": 0.6, "AGG": 0.4}, 0.0)
    assert weights == {"SPY": 0.6, "AGG": 0.4}
    assert reserve == 0.0


def test_split_cash_line_folds_into_reserve_and_renormalizes():
    weights, reserve = _split_static_cash_line(
        {"SPY": 0.45, "AGG": 0.15, "CASH": 0.40}, 0.0
    )
    assert "CASH" not in weights
    assert weights["SPY"] == pytest.approx(0.75)
    assert weights["AGG"] == pytest.approx(0.25)
    assert reserve == pytest.approx(0.40)


def test_split_cash_line_keeps_larger_explicit_reserve():
    weights, reserve = _split_static_cash_line({"SPY": 0.9, "CASH": 0.1}, 0.2)
    assert reserve == pytest.approx(0.2)
    assert weights == {"SPY": pytest.approx(1.0)}


def test_split_cash_line_cash_only_raises():
    with pytest.raises(ValueError, match="cash-only"):
        _split_static_cash_line({"CASH": 1.0}, 0.0)


def _req(**kwargs) -> BacktestRequest:
    base = dict(
        scenario_id="t-cash-replay",
        objective=Objective.max_sharpe,
        start_date="2020-01-01",
        end_date="2020-06-30",
        max_weight=0.6,
        trials=5,
        top_models=1,
        static_replay_holdings={"SPY": 0.45, "AGG": 0.15, "CASH": 0.40},
        universe_tickers=["SPY", "AGG"],
        enable_oos=False,
        fee_bps=0.0,
        rebalance_freq="QE",
        cash_return_mode="zero",
        client_context=ClientContext(cash_reserve_pct=0.4),
    )
    base.update(kwargs)
    return BacktestRequest(**base)


def _fake_prices() -> pd.DataFrame:
    idx = pd.bdate_range("2020-01-01", periods=120)
    return pd.DataFrame(
        {
            "SPY": 100.0 * np.cumprod(1.0 + 0.001 * np.sin(np.arange(120))),
            "AGG": np.full(120, 100.0),
        },
        index=idx,
    )


def test_static_replay_carries_cash_line_into_results():
    """A CASH line must survive as a cash sleeve, not be dropped/redistributed."""
    prices = _fake_prices()
    meta = {"data_source": "yfinance", "rows": len(prices)}
    with patch.object(bt, "fetch_prices", return_value=(prices, meta)):
        res = bt._run_static_replay_backtest(_req(), "job-test-cash")

    champ = res.candidates[0]
    # Invested weights keep the client's original proportions (0.45 / 0.15),
    # leaving 0.40 residual cash — pre-fix CASH was dropped and SPY/AGG were
    # renormalized up to 0.75 / 0.25.
    assert "CASH" not in champ.weights
    assert champ.weights["SPY"] == pytest.approx(0.45, abs=1e-3)
    assert champ.weights["AGG"] == pytest.approx(0.15, abs=1e-3)
    assert sum(champ.weights.values()) == pytest.approx(0.60, abs=1e-3)

    needs = champ.needs_attainment or {}
    assert needs.get("cash_weight_actual") == pytest.approx(0.4, abs=1e-3)
    assert needs.get("within_cash_reserve") is True

    # Equity path includes the cash drag: flat AGG + zero-yield cash means the
    # total return is ~0.45x the SPY-only move, well below full investment.
    invested_only = {t: w for t, w in res.narrative_facts["static_replay_holdings"].items()}
    assert "CASH" not in invested_only
    assert invested_only["SPY"] == pytest.approx(0.75, abs=1e-6)


def test_static_replay_cash_only_book_raises():
    prices = _fake_prices()
    meta = {"data_source": "yfinance", "rows": len(prices)}
    req = _req(static_replay_holdings={"CASH": 1.0}, universe_tickers=["SPY"])
    with patch.object(bt, "fetch_prices", return_value=(prices, meta)):
        with pytest.raises(ValueError, match="cash-only"):
            bt._run_static_replay_backtest(req, "job-test-cash-only")
