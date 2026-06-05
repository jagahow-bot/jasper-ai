"""Price panel alignment — late listings must not truncate in-sample start."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.engine.data import (
    _exclude_late_listing_columns,
    _trim_leading_incomplete_rows,
    price_download_start,
)
from app.engine.portfolio import split_train_validation


def _make_panel(
    *,
    early_start: str = "2015-01-02",
    late_start: str = "2021-03-01",
    end: str = "2024-12-31",
) -> pd.DataFrame:
    early_idx = pd.bdate_range(early_start, end)
    late_idx = pd.bdate_range(late_start, end)
    spy = pd.Series(100.0, index=early_idx).astype(float)
    late = pd.Series(50.0, index=late_idx).astype(float)
    return pd.DataFrame({"SPY": spy, "LATE": late})


def test_price_download_start_before_requested_backtest_start():
    assert pd.Timestamp(price_download_start("2016-01-01")) < pd.Timestamp("2016-01-01")


def test_late_listing_excluded_instead_of_truncating_panel():
    prices = _make_panel()
    trimmed, excluded = _exclude_late_listing_columns(prices, "2015-01-01")
    assert excluded == ["LATE"]
    assert list(trimmed.columns) == ["SPY"]
    assert str(trimmed.index[0].date()) == "2015-01-02"


def test_dropna_any_would_have_truncated_to_late_listing():
    """Document the old failure mode: full overlap starts at the latest IPO."""
    prices = _make_panel()
    overlap = prices.ffill().dropna(how="any")
    assert str(overlap.index[0].date()) == "2021-03-01"


def test_trim_leading_incomplete_rows_after_late_drop():
    prices = _make_panel()
    trimmed, _ = _exclude_late_listing_columns(prices, "2015-01-01")
    panel = _trim_leading_incomplete_rows(trimmed.ffill())
    assert str(panel.index[0].date()) == "2015-01-02"
    assert panel.notna().all(axis=1).all()


def test_trim_keeps_prep_rows_before_requested_start():
    """Pre-report rows stay for lookback even when a new ticker lists near start."""
    early_idx = pd.bdate_range("2015-01-02", "2024-12-31")
    new_idx = pd.bdate_range("2018-01-15", "2024-12-31")
    prices = pd.DataFrame(
        {
            "SPY": pd.Series(100.0, index=early_idx),
            "NEW": pd.Series(50.0, index=new_idx),
        }
    ).astype(float)
    trimmed, excluded = _exclude_late_listing_columns(prices.ffill(), "2018-01-01")
    assert excluded == []
    panel = _trim_leading_incomplete_rows(trimmed.ffill(), requested_start="2018-01-01")
    assert str(panel.index[0].date()) == "2015-01-02"
    assert str(panel.loc[panel.index >= "2018-01-15"].index[0].date()) == "2018-01-15"


def test_split_train_validation_uses_early_is_start():
    prices = _make_panel()
    trimmed, _ = _exclude_late_listing_columns(prices, "2015-01-01")
    panel = _trim_leading_incomplete_rows(trimmed.ffill())
    train, val, train_end, val_start = split_train_validation(panel, 0.7)
    assert str(train.index[0].date()) == "2015-01-02"
    assert train_end
    assert val_start
    assert len(val) >= 126


def test_all_late_listings_raises():
    prices = _make_panel(early_start="2021-03-01", late_start="2021-06-01")
    with pytest.raises(ValueError, match="No tickers have prices near"):
        _exclude_late_listing_columns(prices, "2015-01-01")
