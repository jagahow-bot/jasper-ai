"""Unit tests for dividend / income factor scoring."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.engine.factors import FactorParams, score_assets


def _synthetic_prices(n: int = 120, seed: int = 0) -> tuple[pd.DataFrame, pd.DataFrame]:
    rng = np.random.default_rng(seed)
    tickers = ["LOW", "HIGH", "MID"]
    rows = []
    for t in tickers:
        shocks = rng.normal(0.0005, 0.015, n)
        price = 100.0 * np.cumprod(1.0 + shocks)
        rows.append(price)
    prices = pd.DataFrame(np.vstack(rows).T, columns=tickers, index=pd.bdate_range("2020-01-01", periods=n))
    returns = prices.pct_change().fillna(0.0)
    return prices, returns


def _synthetic_dividend_panel(
    prices: pd.DataFrame,
    *,
    high_ticker: str = "HIGH",
    low_ticker: str = "LOW",
) -> pd.DataFrame:
    panel = pd.DataFrame(0.0, index=prices.index, columns=prices.columns)
    for i in range(0, len(prices.index), 63):
        panel.iloc[i, panel.columns.get_loc(high_ticker)] = 0.50
        panel.iloc[i, panel.columns.get_loc(low_ticker)] = 0.05
    return panel


def test_w_income_zero_matches_without_panel():
    prices, returns = _synthetic_prices(seed=11)
    panel = _synthetic_dividend_panel(prices)
    base = FactorParams(w_income=0.0)
    s_no_panel = score_assets(prices, returns, base)
    s_with_panel = score_assets(prices, returns, base, dividend_panel=panel)
    assert np.allclose(s_no_panel.to_numpy(), s_with_panel.to_numpy())


def test_high_yield_ranks_higher_when_w_income_positive():
    prices, returns = _synthetic_prices(seed=12)
    panel = _synthetic_dividend_panel(prices, high_ticker="HIGH", low_ticker="LOW")
    neutral = FactorParams(
        w_mom=0.0,
        w_reversal=0.0,
        w_value=0.0,
        w_lowvol=0.0,
        w_trend=0.0,
        w_drawdown=0.0,
        w_income=0.0,
    )
    income_only = FactorParams(
        w_mom=0.0,
        w_reversal=0.0,
        w_value=0.0,
        w_lowvol=0.0,
        w_trend=0.0,
        w_drawdown=0.0,
        w_income=1.0,
    )
    s_neutral = score_assets(prices, returns, neutral, dividend_panel=panel)
    s_income = score_assets(prices, returns, income_only, dividend_panel=panel)
    assert float(s_income["HIGH"]) > float(s_income["LOW"])
    assert not np.allclose(s_neutral.to_numpy(), s_income.to_numpy())
