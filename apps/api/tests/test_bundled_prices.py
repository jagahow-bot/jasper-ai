"""Bundled demo price panel for Render / offline backtests."""

from unittest.mock import patch

import pandas as pd
import pytest

from app.engine.data import (
    BUNDLED_PRICES_PATH,
    _load_bundled_prices_panel,
    fetch_prices,
)
from app.profiles import pin_guaranteed_supplements


def test_bundled_prices_panel_exists_and_covers_demo_tickers():
    panel = _load_bundled_prices_panel()
    assert panel is not None, f"missing bundled panel at {BUNDLED_PRICES_PATH}"
    assert len(panel.columns) >= 18
    for t in ("SPY", "QQQ", "AGG", "GLD", "PDBC"):
        assert t in panel.columns
    assert len(panel) >= 504


@patch("app.engine.data._download_yfinance_closes")
def test_fetch_prices_uses_bundled_without_yfinance(mock_yf):
    mock_yf.return_value = pd.DataFrame()
    tickers = ["SPY", "QQQ", "AGG", "BND", "TLT", "GLD"]
    prices, meta = fetch_prices(tickers, "2018-01-01", "2024-12-31", "SPY")
    assert len(prices.columns) >= 5
    assert meta["data_source"] in {"bundled_parquet", "bundled_parquet+yfinance", "yfinance_cache"}
    if meta["data_source"] == "bundled_parquet":
        mock_yf.assert_not_called()


def test_pin_guaranteed_supplements_includes_outside_asset_class():
    refined = [{"ticker": "SPY", "asset_class": "equity", "category": "us_broad"}]
    pinned = pin_guaranteed_supplements(refined, ["GLD", "AGG"], asset_classes=["equity"])
    tickers = {u["ticker"] for u in pinned}
    assert "SPY" in tickers
    assert "GLD" in tickers
    assert "AGG" in tickers
