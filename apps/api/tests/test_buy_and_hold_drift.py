"""Buy-and-hold drift between rebalances (not constant-mix daily returns)."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.engine.portfolio import (
    _rebalance_schedule,
    _safe_returns,
    _simulate_buy_and_hold_path,
    _simulate_pandas,
    _trading_day_rebalance_dates,
    simulate_portfolio,
)
from app.engine.spec import BacktestSpec


def _constant_mix_path(
    rets: pd.DataFrame,
    target_schedule: pd.DataFrame,
    *,
    daily_rf: float,
    cash_mode: str,
    fee_rate: float,
) -> pd.Series:
    """Legacy constant-mix returns for comparison (target weights every day)."""
    lagged = target_schedule.shift(1)
    lagged.iloc[0] = target_schedule.iloc[0]
    risky = (rets * lagged).sum(axis=1)
    invested = lagged.sum(axis=1).clip(lower=0.0, upper=1.0)
    cash_w = (1.0 - invested).clip(lower=0.0, upper=1.0)
    cash_r = cash_w * (daily_rf if cash_mode == "risk_free" else 0.0)
    port = risky + cash_r
    turnover = target_schedule.diff().abs().sum(axis=1).fillna(0.0)
    turnover = turnover + cash_w.diff().abs().fillna(0.0)
    return port - turnover * fee_rate


def test_buy_and_hold_differs_from_constant_mix_when_assets_diverge():
    """Multi-day divergence: drifted weights compound differently than constant mix."""
    idx = pd.bdate_range("2020-01-01", periods=10)
    # A rallies every day; B flat — equal-weight book drifts toward A.
    prices = pd.DataFrame(
        {
            "A": 100.0 * (1.10 ** np.arange(10)),
            "B": np.full(10, 100.0),
        },
        index=idx,
    )
    w = np.array([0.5, 0.5])
    schedule = pd.DataFrame(
        np.tile(w, (len(idx), 1)), index=idx, columns=prices.columns, dtype=float
    )
    rets = _safe_returns(prices)

    bh, _ = _simulate_buy_and_hold_path(
        rets,
        schedule,
        daily_rf=0.0,
        cash_mode="zero",
        fee_rate=0.0,
        rebalance_dates=[],  # pure B&H — no mid-window reset
    )
    cm = _constant_mix_path(
        rets, schedule, daily_rf=0.0, cash_mode="zero", fee_rate=0.0
    )

    # Day 0: pct_change is 0 → both 0.
    assert abs(float(bh.iloc[0])) < 1e-12
    assert abs(float(cm.iloc[0])) < 1e-12
    # Day 1: still equal weights → same return.
    assert abs(float(bh.iloc[1]) - float(cm.iloc[1])) < 1e-12
    # Day 2+: B&H should outperform constant mix when the winner keeps winning.
    assert float(bh.iloc[2]) > float(cm.iloc[2]) + 1e-9
    assert float(bh.sum()) > float(cm.sum()) + 1e-9


def test_rebalance_restores_targets_and_fees_drifted_turnover():
    """After drift, rebalance trades drifted → target (not target → target)."""
    idx = pd.bdate_range("2020-01-01", periods=6)
    prices = pd.DataFrame(
        {
            "A": [100.0, 110.0, 121.0, 121.0, 121.0, 121.0],
            "B": [100.0, 100.0, 100.0, 100.0, 100.0, 100.0],
        },
        index=idx,
    )
    w = np.array([0.5, 0.5])
    schedule = pd.DataFrame(
        np.tile(w, (len(idx), 1)), index=idx, columns=prices.columns, dtype=float
    )
    # Rebalance back to 50/50 on day index 3 (after two up-days on A).
    reb_i = 3
    reb_dt = idx[reb_i]
    rets = _safe_returns(prices)
    fee = 0.01  # 100 bps — large so fee drag is obvious
    bh, turn = _simulate_buy_and_hold_path(
        rets,
        schedule,
        daily_rf=0.0,
        cash_mode="zero",
        fee_rate=fee,
        rebalance_dates=[reb_dt],
    )

    # Manual drift through day reb_i return, then trade to target.
    w_hold = w.copy()
    for t in range(reb_i + 1):
        r = rets.iloc[t].to_numpy(dtype=float)
        v = w_hold * (1.0 + r)
        w_hold = v / float(v.sum())
    # After day reb_i prices, before trade, weight on A should exceed 0.5.
    assert float(w_hold[0]) > 0.5 + 1e-6
    expected_turn = float(np.abs(w - w_hold).sum())
    assert abs(float(turn.iloc[reb_i]) - expected_turn) < 1e-9
    # Target-to-target L1 would be ~0 (same 50/50); drifted turnover must be larger.
    assert float(turn.iloc[reb_i]) > 1e-6
    # Fee reduces that day's net return vs pre-fee path.
    pre_fee = float(bh.iloc[reb_i]) + expected_turn * fee
    assert abs(float(bh.iloc[reb_i]) - (pre_fee - expected_turn * fee)) < 1e-12

    # Next day starts from restored targets: equal-weight on flat prices → 0.
    assert abs(float(bh.iloc[reb_i + 1])) < 1e-12
    # Without the rebalance date, turnover on that day would be 0.
    _, turn_none = _simulate_buy_and_hold_path(
        rets,
        schedule,
        daily_rf=0.0,
        cash_mode="zero",
        fee_rate=fee,
        rebalance_dates=[],
    )
    assert float(turn_none.iloc[reb_i]) < 1e-12


def test_simulate_portfolio_uses_buy_and_hold():
    """Public static path should not match constant-mix when assets diverge."""
    idx = pd.bdate_range("2020-01-01", periods=80)
    a = np.cumprod(1.0 + np.where(np.arange(80) % 2 == 0, 0.02, -0.005))
    b = np.cumprod(1.0 + np.where(np.arange(80) % 2 == 0, -0.005, 0.02))
    prices = pd.DataFrame({"A": 100.0 * a, "B": 100.0 * b}, index=idx)
    w = np.array([0.5, 0.5])
    # Monthly rebalance so there are several resets; still drift between them.
    spec = BacktestSpec(rebalance_rule="ME", fee_bps=0.0, risk_free_rate=0.0)
    m = simulate_portfolio(prices, w, spec)

    schedule = _rebalance_schedule(prices, w, spec.rebalance_rule)
    rets = _safe_returns(prices)
    cm = _constant_mix_path(
        rets, schedule, daily_rf=0.0, cash_mode="zero", fee_rate=0.0
    )
    assert abs(float(m["port_ret"].sum()) - float(cm.sum())) > 1e-6
    # Confirm scheduled month-ends actually fire trades when weights drift.
    reb = _trading_day_rebalance_dates(prices.index, spec.rebalance_rule)
    assert len(reb) >= 1
    assert float(m["turnover_total"]) > 0.0


def test_cash_reserve_still_earns_risk_free_with_drift():
    """Cash overlay behavior: RF cash sleeve still lifts equity vs zero cash return."""
    idx = pd.bdate_range("2020-01-01", periods=60)
    prices = pd.DataFrame(
        {"A": np.full(60, 100.0), "B": np.full(60, 100.0)},
        index=idx,
    )
    w = np.array([0.5, 0.5])
    spec_rf = BacktestSpec(
        rebalance_rule="YE",
        fee_bps=0.0,
        cash_reserve_pct=0.5,
        cash_return_mode="risk_free",
        risk_free_rate=0.10,
    )
    spec_zero = BacktestSpec(
        rebalance_rule="YE",
        fee_bps=0.0,
        cash_reserve_pct=0.5,
        cash_return_mode="zero",
        risk_free_rate=0.10,
    )
    m_rf = _simulate_pandas(prices, w, spec_rf, dynamic=False)
    m_zero = _simulate_pandas(prices, w, spec_zero, dynamic=False)
    assert float(m_rf["cash_weight"]) > 0.4
    assert float(m_rf["equity"].iloc[-1]) > float(m_zero["equity"].iloc[-1])


def test_identical_asset_returns_match_constant_mix():
    """When all assets move together, B&H and constant-mix coincide."""
    idx = pd.bdate_range("2020-01-01", periods=20)
    growth = 1.0 + 0.01 * np.sin(np.arange(20))
    px = 100.0 * np.cumprod(growth)
    prices = pd.DataFrame({"A": px, "B": px.copy()}, index=idx)
    w = np.array([0.6, 0.4])
    schedule = pd.DataFrame(
        np.tile(w, (len(idx), 1)), index=idx, columns=prices.columns, dtype=float
    )
    reb_dt = idx[10]
    rets = _safe_returns(prices)
    bh, turn = _simulate_buy_and_hold_path(
        rets,
        schedule,
        daily_rf=0.0,
        cash_mode="zero",
        fee_rate=0.0,
        rebalance_dates=[reb_dt],
    )
    cm = _constant_mix_path(
        rets, schedule, daily_rf=0.0, cash_mode="zero", fee_rate=0.0
    )
    assert np.allclose(bh.to_numpy(), cm.to_numpy(), atol=1e-12)
    assert float(turn.iloc[10]) < 1e-12
