"""Assembly reuses trial simulation cache instead of redundant backtests."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from app.engine.backtest import _assemble_candidates_from_records
from app.engine.report_sim_cache import ReportSimBundle, TrialReportCache
from app.models import BacktestRequest, Objective


def _minimal_sim(sharpe: float = 1.0, *, with_weights: bool = True) -> dict:
    idx = pd.date_range("2020-01-01", periods=80, freq="B")
    port_ret = pd.Series(0.0005, index=idx)
    equity = (1.0 + port_ret).cumprod()
    out = {
        "sharpe": sharpe,
        "max_drawdown": -0.1,
        "cagr": 0.12,
        "volatility": 0.15,
        "sortino": 1.1,
        "calmar": 1.0,
        "var_95": -0.02,
        "cvar_95": -0.03,
        "win_rate": 0.55,
        "turnover_avg": 0.01,
        "turnover_total": 0.5,
        "max_drawdown_duration_days": 10,
        "equity": equity,
        "port_ret": port_ret,
        "last_weights": [0.2, 0.2, 0.2, 0.2, 0.2],
        "rebalance_count": 4,
        "rebalance_applied": 4,
        "rebalance_freq": "M",
        "rebalance_dates": [],
        "factor_summary": {},
    }
    if with_weights:
        out["weight_history"] = [{"date": "2020-01-01", "A": 0.5, "B": 0.5, "OTHER": 0.0}]
        out["weight_history_tickers"] = ["A", "B"]
    return out


def _price_panel() -> tuple[list[str], pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    tickers = ["A", "B", "C", "D", "E"]
    idx = pd.date_range("2020-01-01", periods=120, freq="B")
    prices = pd.DataFrame({t: 100.0 + i for i, t in enumerate(tickers)}, index=idx)
    split = 80
    return tickers, prices, prices.iloc[:split], prices.iloc[split:]


def _req() -> BacktestRequest:
    return BacktestRequest(
        scenario_id="test-assembly-cache",
        start_date="2020-01-01",
        end_date="2020-06-30",
        asset_classes=["equity"],
        objective=Objective.max_sharpe,
        max_weight=0.25,
        max_turnover=0.5,
        top_n=10,
        trials=5,
        top_models=1,
    )


def test_assembly_skips_train_val_when_cache_complete():
    tickers, prices, prices_train, prices_val = _price_panel()
    train_m = _minimal_sim(1.2, with_weights=False)
    val_m = _minimal_sim(0.9, with_weights=False)
    full_m = _minimal_sim(1.0, with_weights=True)
    params = {
        "model_code": "M0001",
        "mode": "min_var",
        "lookback_days": 60,
        "shrinkage": 0.1,
        "risk_aversion": 2.0,
        "max_weight_actual": 0.25,
        "top_n_actual": 3,
        "rebalance_freq": "M",
    }
    records = [(1.0, params, {})]
    cache = TrialReportCache()
    cache.stash_from_trial(
        params,
        train_m=train_m,
        val_m=val_m,
        full_m=full_m,
        retain_weight_history=True,
    )

    sim_mock = MagicMock(side_effect=AssertionError("simulate should not run"))

    with patch("app.engine.backtest.simulate_dynamic_portfolio", sim_mock):
        out = _assemble_candidates_from_records(
            records,
            req=_req(),
            top_n_models=1,
            tickers=tickers,
            prices=prices,
            prices_train=prices_train,
            prices_val=prices_val,
            oos=True,
            rebalance_rule="M",
            spec=MagicMock(
                benchmark_ticker="SPY",
                risk_free_rate=0.0,
                fee_bps=0.0,
                rebalance_rule="M",
                min_holdings=2,
                max_holdings=30,
            ),
            universe_by_ticker={},
            objective_effective="max_sharpe",
            train_start="2020-01-01",
            train_end="2020-04-01",
            val_start="2020-04-02",
            train_ratio=0.7,
            trial_report_cache=cache,
        )
    sim_mock.assert_not_called()
    assert len(out) == 1
    assert out[0].model_code == "M0001"


def test_assembly_cache_hit_runs_only_full_for_weights():
    tickers, prices, prices_train, prices_val = _price_panel()
    train_m = _minimal_sim(1.2, with_weights=False)
    val_m = _minimal_sim(0.9, with_weights=False)
    full_m = _minimal_sim(1.0, with_weights=False)
    params = {
        "model_code": "M0002",
        "mode": "min_var",
        "lookback_days": 60,
        "shrinkage": 0.1,
        "risk_aversion": 2.0,
        "max_weight_actual": 0.25,
        "top_n_actual": 3,
        "rebalance_freq": "M",
    }
    records = [(1.0, params, {})]
    cache = TrialReportCache()
    cache.stash_from_trial(params, train_m=train_m, val_m=val_m, full_m=full_m)

    full_with_weights = _minimal_sim(1.0, with_weights=True)
    sim_mock = MagicMock(return_value=full_with_weights)

    with patch("app.engine.backtest.simulate_dynamic_portfolio", sim_mock):
        _assemble_candidates_from_records(
            records,
            req=_req(),
            top_n_models=1,
            tickers=tickers,
            prices=prices,
            prices_train=prices_train,
            prices_val=prices_val,
            oos=True,
            rebalance_rule="M",
            spec=MagicMock(
                benchmark_ticker="SPY",
                risk_free_rate=0.0,
                fee_bps=0.0,
                rebalance_rule="M",
                min_holdings=2,
                max_holdings=30,
            ),
            universe_by_ticker={},
            objective_effective="max_sharpe",
            train_start="2020-01-01",
            train_end="2020-04-01",
            val_start="2020-04-02",
            train_ratio=0.7,
            trial_report_cache=cache,
        )
    assert sim_mock.call_count == 1
    sim_mock.assert_called_once()
    assert sim_mock.call_args[0][0] is prices


def test_report_sim_bundle_complete_flags():
    b = ReportSimBundle(
        train_m=_minimal_sim(with_weights=False),
        val_m=_minimal_sim(with_weights=False),
        full_m=_minimal_sim(with_weights=True),
    )
    assert b.complete_for_oos(oos=True, val_required=True)
    b2 = ReportSimBundle(
        train_m=_minimal_sim(with_weights=False),
        val_m=_minimal_sim(with_weights=False),
        full_m=_minimal_sim(with_weights=False),
    )
    assert not b2.complete_for_oos(oos=True, val_required=True)
