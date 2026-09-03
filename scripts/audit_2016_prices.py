"""Count ETF universe tickers with usable 2016 price history (yfinance)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
UNIVERSE_PATH = ROOT / "shared" / "etf-universe.json"
YFINANCE_CHUNK = 25
LOOKBACK_DAYS = 252


def load_tickers() -> list[str]:
    data = json.loads(UNIVERSE_PATH.read_text(encoding="utf-8"))
    return [str(u["ticker"]).upper() for u in data["universe"]]


def download_closes(tickers: list[str], start: str, end: str) -> pd.DataFrame:
    import yfinance as yf

    frames: list[pd.DataFrame] = []
    for i in range(0, len(tickers), YFINANCE_CHUNK):
        chunk = tickers[i : i + YFINANCE_CHUNK]
        data = yf.download(
            chunk,
            start=start,
            end=end,
            auto_adjust=True,
            progress=False,
            group_by="column",
            threads=False,
        )
        if data.empty:
            continue
        if isinstance(data.columns, pd.MultiIndex):
            close = data["Close"].copy()
        else:
            close = data[["Close"]].rename(columns={"Close": chunk[0]})
        frames.append(close)
    if not frames:
        raise SystemExit("yfinance returned no data")
    prices = pd.concat(frames, axis=1)
    prices = prices.loc[:, ~prices.columns.duplicated()]
    return prices.sort_index()


def trading_days_through(series: pd.Series, as_of: pd.Timestamp) -> int:
    s = series.loc[:as_of].dropna()
    return int(s.shape[0])


def main() -> None:
    tickers = load_tickers()
    # Warm-up before 2016 for 252-day lookback checks at year start.
    prices = download_closes(tickers, "2014-01-01", "2017-01-10")
    prices = prices.replace([np.inf, -np.inf], np.nan)

    year_2016 = (prices.index >= "2016-01-01") & (prices.index < "2017-01-01")
    checkpoints = {
        "2016-01-01": pd.Timestamp("2016-01-01"),
        "2016-01-04": pd.Timestamp("2016-01-04"),
        "2016-06-30": pd.Timestamp("2016-06-30"),
        "2016-12-30": pd.Timestamp("2016-12-30"),
    }

    any_in_2016: list[str] = []
    lookback_at: dict[str, list[str]] = {k: [] for k in checkpoints}

    for col in prices.columns:
        series = prices[col]
        if series.loc[year_2016].notna().any():
            any_in_2016.append(str(col))
        for label, as_of in checkpoints.items():
            # Use last available index on or before as_of (holidays/weekends).
            idx = series.index[series.index <= as_of]
            if idx.empty:
                continue
            last = idx[-1]
            if trading_days_through(series, last) >= LOOKBACK_DAYS:
                lookback_at[label].append(str(col))

    print("universe_total", len(tickers))
    print("downloaded_columns", len(prices.columns))
    print("missing_from_download", len(set(tickers) - set(prices.columns.astype(str))))
    print("any_price_in_2016", len(any_in_2016))
    for label in checkpoints:
        print(f"lookback_ge_{LOOKBACK_DAYS}_through_{label}", len(lookback_at[label]))


if __name__ == "__main__":
    main()
