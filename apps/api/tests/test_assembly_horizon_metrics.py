"""Metrics-only assembly must keep IS != full when OOS holdout is active."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.engine.backtest import _assemble_candidates_from_records
from app.engine.objectives import metrics_snapshot
from app.engine.portfolio import (
    cached_full_path_needs_stitch,
    stitch_full_path_from_slices,
)
from app.engine.report_sim_cache import TrialReportCache
from app.engine.spec import BacktestSpec
from app.models import BacktestRequest, Objective


def _slice_sim(mean: float, n: int, *, seed: int) -> dict:
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2018-01-01", periods=n, freq="B")
    port_ret = pd.Series(rng.normal(mean, 0.008, n), index=idx, dtype=float)
    equity = (1.0 + port_ret).cumprod()
    return {
        "sharpe": 0.5,
        "max_drawdown": -0.15,
        "cagr": 0.08,
        "volatility": 0.14,
        "sortino": 0.7,
        "equity": equity,
        "port_ret": port_ret,
        "last_weights": np.array([0.5, 0.5], dtype=float),
    }


def test_stitch_full_path_from_slices_chains_port_ret():
    train_m = _slice_sim(0.0002, 200, seed=1)
    val_m = _slice_sim(0.0010, 100, seed=2)
    full = stitch_full_path_from_slices(train_m, val_m)
    assert full is not None
    assert len(full["port_ret"]) == 300


def test_cached_full_path_needs_stitch_when_oos_only():
    train_m = _slice_sim(0.0002, 200, seed=5)
    val_m = _slice_sim(0.0010, 100, seed=6)
    oos_only = {"port_ret": val_m["port_ret"], "equity": val_m["equity"]}
    assert cached_full_path_needs_stitch(train_m, val_m, oos_only) is True
    stitched = stitch_full_path_from_slices(train_m, val_m)
    assert stitched is not None
    assert cached_full_path_needs_stitch(train_m, val_m, stitched) is False


def test_metrics_only_assembly_full_cagr_between_is_and_oos_when_oos_beats_is():
    is_days, oos_days = 200, 100
    train_m = _slice_sim(0.0002, is_days, seed=3)
    val_m = _slice_sim(0.0012, oos_days, seed=4)
    params = {
        "model_code": "M0006",
        "mode": "mean_variance",
        "lookback_days": 60,
        "shrinkage": 0.1,
        "risk_aversion": 2.0,
        "max_weight_actual": 0.25,
        "top_n_actual": 3,
        "rebalance_freq": "M",
    }
    cache = TrialReportCache()
    cache.stash_from_trial(params, train_m=train_m, val_m=val_m, full_m=None)

    tickers = ["AAA", "BBB"]
    idx = pd.bdate_range("2018-01-01", periods=is_days + oos_days)
    prices = pd.DataFrame(
        {
            "AAA": np.linspace(100, 150, len(idx)),
            "BBB": np.linspace(50, 80, len(idx)),
            "SPY": np.linspace(200, 260, len(idx)),
        },
        index=idx,
    )
    split = is_days
    prices_train = prices.iloc[:split]
    prices_val = prices.iloc[split:]
    spec = BacktestSpec(benchmark_ticker="SPY")
    req = BacktestRequest(
        scenario_id="s1",
        start_date="2018-01-01",
        end_date=str(idx[-1].date()),
        asset_classes=["equity"],
        objective=Objective.max_return,
        max_weight=0.25,
        max_turnover=0.5,
        top_n=10,
        trials=5,
        top_models=3,
        enable_oos=True,
        train_ratio=is_days / len(idx),
    )
    universe_by_ticker = {
        "AAA": {"asset_class": "equity", "region": "us"},
        "BBB": {"asset_class": "equity", "region": "intl"},
    }
    records = [
        (
            0.12,
            params,
            {
                "train_metrics": metrics_snapshot(train_m, objective_mode="max_return"),
                "validation_metrics": metrics_snapshot(val_m, objective_mode="max_return"),
                "objective_value_is": 0.08,
                "objective_value_oos": 0.22,
            },
        )
    ]

    candidates = _assemble_candidates_from_records(
        records,
        req=req,
        top_n_models=1,
        tickers=tickers,
        prices=prices,
        prices_sim_panel=prices[tickers],
        prices_train=prices_train[tickers],
        prices_val=prices_val[tickers],
        oos=True,
        rebalance_rule="M",
        spec=spec,
        universe_by_ticker=universe_by_ticker,
        objective_effective="max_return",
        train_start=str(prices_train.index[0].date()),
        train_end=str(prices_train.index[-1].date()),
        val_start=str(prices_val.index[0].date()),
        train_ratio=float(req.train_ratio),
        trial_report_cache=cache,
        full_payload_codes=set(),
    )
    assert len(candidates) == 1
    sm = (candidates[0].analytics or {}).get("sample_metrics") or {}
    is_row = sm.get("in_sample") or {}
    full_row = sm.get("full_sample") or {}
    oos_row = sm.get("out_of_sample") or {}
    assert is_row.get("cagr") is not None
    assert full_row.get("cagr") is not None
    assert oos_row.get("cagr") is not None
    assert is_row["cagr"] != full_row["cagr"]
    assert candidates[0].equity_curve in (None, [])
    # Full period spans IS+OOS: when OOS CAGR > IS, full should sit between them.
    if is_row["cagr"] < oos_row["cagr"]:
        assert is_row["cagr"] <= full_row["cagr"] <= oos_row["cagr"] + 0.02


def test_metrics_only_assembly_stitches_when_cache_full_m_is_oos_only():
    is_days, oos_days = 200, 100
    train_m = _slice_sim(0.0002, is_days, seed=7)
    val_m = _slice_sim(0.0012, oos_days, seed=8)
    params = {
        "model_code": "M0015",
        "mode": "mean_variance",
        "lookback_days": 60,
        "shrinkage": 0.1,
        "risk_aversion": 2.0,
        "max_weight_actual": 0.25,
        "top_n_actual": 3,
        "rebalance_freq": "M",
    }
    cache = TrialReportCache()
    oos_only = {"port_ret": val_m["port_ret"], "equity": val_m["equity"], **val_m}
    cache.stash_from_trial(params, train_m=train_m, val_m=val_m, full_m=oos_only)

    tickers = ["AAA", "BBB"]
    idx = pd.bdate_range("2018-01-01", periods=is_days + oos_days)
    prices = pd.DataFrame(
        {
            "AAA": np.linspace(100, 150, len(idx)),
            "BBB": np.linspace(50, 80, len(idx)),
            "SPY": np.linspace(200, 260, len(idx)),
        },
        index=idx,
    )
    split = is_days
    prices_train = prices.iloc[:split]
    prices_val = prices.iloc[split:]
    spec = BacktestSpec(benchmark_ticker="SPY")
    req = BacktestRequest(
        scenario_id="s1",
        start_date="2018-01-01",
        end_date=str(idx[-1].date()),
        asset_classes=["equity"],
        objective=Objective.max_return,
        max_weight=0.25,
        max_turnover=0.5,
        top_n=10,
        trials=5,
        top_models=3,
        enable_oos=True,
        train_ratio=is_days / len(idx),
    )
    universe_by_ticker = {
        "AAA": {"asset_class": "equity", "region": "us"},
        "BBB": {"asset_class": "equity", "region": "intl"},
    }
    records = [
        (
            0.12,
            params,
            {
                "train_metrics": metrics_snapshot(train_m, objective_mode="max_return"),
                "validation_metrics": metrics_snapshot(val_m, objective_mode="max_return"),
                "objective_value_is": 0.08,
                "objective_value_oos": 0.22,
            },
        )
    ]

    candidates = _assemble_candidates_from_records(
        records,
        req=req,
        top_n_models=1,
        tickers=tickers,
        prices=prices,
        prices_sim_panel=prices[tickers],
        prices_train=prices_train[tickers],
        prices_val=prices_val[tickers],
        oos=True,
        rebalance_rule="M",
        spec=spec,
        universe_by_ticker=universe_by_ticker,
        objective_effective="max_return",
        train_start=str(prices_train.index[0].date()),
        train_end=str(prices_train.index[-1].date()),
        val_start=str(prices_val.index[0].date()),
        train_ratio=float(req.train_ratio),
        trial_report_cache=cache,
        full_payload_codes=set(),
    )
    sm = (candidates[0].analytics or {}).get("sample_metrics") or {}
    is_row = sm.get("in_sample") or {}
    full_row = sm.get("full_sample") or {}
    oos_row = sm.get("out_of_sample") or {}
    assert full_row.get("cagr") is not None
    assert abs(full_row["cagr"] - oos_row["cagr"]) > 0.001
    if is_row["cagr"] < oos_row["cagr"]:
        assert is_row["cagr"] <= full_row["cagr"] <= oos_row["cagr"] + 0.02
