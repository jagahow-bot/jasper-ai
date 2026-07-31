"""True cash sleeve + DCA deployment overlay tests."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.engine.portfolio import (
    _apply_execution_overlay,
    _simulate_pandas,
    deployment_fraction,
)
from app.engine.spec import BacktestSpec
from app.engine.weights import scale_invested_weights


def _flat_prices(n_days: int = 120, n_assets: int = 3) -> pd.DataFrame:
    idx = pd.bdate_range("2020-01-01", periods=n_days)
    data = {f"T{i}": np.full(n_days, 100.0 + i) for i in range(n_assets)}
    # mild upward drift so equity is well-defined
    for i, col in enumerate(data):
        data[col] = data[col] * (1.0 + 0.0002 * np.arange(n_days))
    return pd.DataFrame(data, index=idx)


def test_scale_invested_weights_leaves_cash():
    w = np.array([0.5, 0.5])
    scaled = scale_invested_weights(w, 0.8)
    assert abs(float(scaled.sum()) - 0.8) < 1e-9
    assert abs(float(scaled[0] / scaled[1]) - 1.0) < 1e-9


def test_deployment_fraction_lump_sum_and_dca():
    start = pd.Timestamp("2020-01-15")
    assert deployment_fraction(start, start, None, None) == 1.0
    assert deployment_fraction(start, start, 6, 6) == 0.0
    m1 = pd.Timestamp("2020-02-15")
    assert abs(deployment_fraction(m1, start, 6, 6) - 1.0 / 6.0) < 1e-9
    m6 = pd.Timestamp("2020-07-15")
    assert abs(deployment_fraction(m6, start, 6, 6) - 1.0) < 1e-9


def test_execution_overlay_cash_reserve():
    prices = _flat_prices()
    schedule = pd.DataFrame(
        np.tile(np.array([1 / 3, 1 / 3, 1 / 3]), (len(prices), 1)),
        index=prices.index,
        columns=prices.columns,
    )
    spec = BacktestSpec(cash_reserve_pct=0.2)
    out = _apply_execution_overlay(schedule, spec)
    assert abs(float(out.iloc[-1].sum()) - 0.8) < 1e-6


def test_simulate_cash_earns_risk_free():
    prices = _flat_prices(n_days=60)
    # Zero asset returns → equity growth should come from cash RF only
    for col in prices.columns:
        prices[col] = 100.0
    w = np.ones(len(prices.columns)) / len(prices.columns)
    spec_rf = BacktestSpec(cash_reserve_pct=0.5, cash_return_mode="risk_free", risk_free_rate=0.10)
    spec_zero = BacktestSpec(cash_reserve_pct=0.5, cash_return_mode="zero", risk_free_rate=0.10)
    m_rf = _simulate_pandas(prices, w, spec_rf, dynamic=False)
    m_zero = _simulate_pandas(prices, w, spec_zero, dynamic=False)
    assert float(m_rf["cash_weight"]) > 0.4
    assert float(m_rf["equity"].iloc[-1]) > float(m_zero["equity"].iloc[-1])


def test_dca_path_starts_undeployed():
    prices = _flat_prices(n_days=150)
    schedule = pd.DataFrame(
        np.tile(np.array([1 / 3, 1 / 3, 1 / 3]), (len(prices), 1)),
        index=prices.index,
        columns=prices.columns,
    )
    spec = BacktestSpec(cash_reserve_pct=0.0, deployment_months=6, deployment_tranches=6)
    out = _apply_execution_overlay(schedule, spec)
    assert float(out.iloc[0].sum()) < 1e-9
    assert float(out.iloc[-1].sum()) > 0.9
