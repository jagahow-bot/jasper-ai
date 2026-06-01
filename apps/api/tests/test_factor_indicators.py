"""Unit tests for per-factor indicator variants."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.engine.factors import FactorParams, score_assets


def _synthetic_prices(n: int = 120, seed: int = 0) -> tuple[pd.DataFrame, pd.DataFrame]:
    rng = np.random.default_rng(seed)
    tickers = ["A", "B", "C"]
    rows = []
    for t in tickers:
        shocks = rng.normal(0.001 if t == "A" else -0.0005, 0.02, n)
        if t == "B":
            shocks[-30:] += 0.008
        if t == "C":
            shocks[-10:] -= 0.015
        price = 100.0 * np.cumprod(1.0 + shocks)
        rows.append(price)
    prices = pd.DataFrame(np.vstack(rows).T, columns=tickers)
    returns = prices.pct_change().fillna(0.0)
    return prices, returns


def test_momentum_indicators_differ():
    prices, returns = _synthetic_prices()
    base = FactorParams(lookback_days=90, mom_indicator="cumulative_return")
    risk_adj = FactorParams(lookback_days=90, mom_indicator="risk_adjusted_return")
    skip = FactorParams(lookback_days=90, mom_indicator="skip_month_12_1")

    s0 = score_assets(prices, returns, base)
    s1 = score_assets(prices, returns, risk_adj)
    s2 = score_assets(prices, returns, skip)

    assert not np.allclose(s0.to_numpy(), s1.to_numpy())
    assert not np.allclose(s0.to_numpy(), s2.to_numpy())


def test_reversal_indicators_differ():
    prices, returns = _synthetic_prices(seed=1)
    neg_ret = FactorParams(
        reversal_lookback_days=60, reversal_indicator="negative_return", w_mom=0.0
    )
    off_peak = FactorParams(
        reversal_lookback_days=60, reversal_indicator="off_peak", w_mom=0.0
    )
    rsi = FactorParams(
        reversal_lookback_days=60, reversal_indicator="rsi_mean_reversion", w_mom=0.0
    )

    s0 = score_assets(prices, returns, neg_ret)
    s1 = score_assets(prices, returns, off_peak)
    s2 = score_assets(prices, returns, rsi)

    assert not np.allclose(s0.to_numpy(), s1.to_numpy())
    assert not np.allclose(s0.to_numpy(), s2.to_numpy())


def test_value_indicators_differ():
    prices, returns = _synthetic_prices(seed=2)
    ma = FactorParams(value_lookback_days=80, value_indicator="ma_price_ratio", w_mom=0.0)
    pct = FactorParams(value_lookback_days=80, value_indicator="price_percentile", w_mom=0.0)
    inv = FactorParams(
        value_lookback_days=80, value_indicator="inverse_long_momentum", w_mom=0.0
    )

    s0 = score_assets(prices, returns, ma)
    s1 = score_assets(prices, returns, pct)
    s2 = score_assets(prices, returns, inv)

    assert not np.allclose(s0.to_numpy(), s1.to_numpy())
    assert not np.allclose(s1.to_numpy(), s2.to_numpy())


def test_backward_compat_defaults_match_legacy_momentum():
    prices, returns = _synthetic_prices(seed=3)
    explicit = FactorParams()
    minimal = FactorParams(
        mom_indicator="cumulative_return",
        reversal_indicator="negative_return",
        value_indicator="ma_price_ratio",
        lowvol_indicator="negative_vol",
        trend_indicator="price_ma_ratio",
        drawdown_indicator="max_drawdown_depth",
    )
    s_explicit = score_assets(prices, returns, explicit)
    s_minimal = score_assets(prices, returns, minimal)
    assert np.allclose(s_explicit.to_numpy(), s_minimal.to_numpy())


def test_indicator_logic_reflects_selection():
    from app.engine.factors import score_assets_with_details

    prices, returns = _synthetic_prices()
    params = FactorParams(mom_indicator="risk_adjusted_return")
    _, details = score_assets_with_details(prices, returns, params)
    assert "annualized vol" in details["indicator_logic"]["momentum"].lower()
    assert details["selected_indicators"]["mom_indicator"] == "risk_adjusted_return"
