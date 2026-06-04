"""Market data loading and quality checks."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

YFINANCE_CHUNK = 25
MIN_TRADING_DAYS = 504
# Calendar days to fetch before the UI start so factor/allocator lookbacks are ready on day 1.
PRICE_PREP_BUFFER_CALENDAR_DAYS = 840
MAX_MISSING_COL = 0.15
MIN_ROW_COVERAGE = 0.75
# Symbols listed after requested start + this slack are dropped (not used to trim the panel).
LATE_LISTING_TOLERANCE_DAYS = 21
CACHE_TTL_HOURS = 12
ROOT = Path(__file__).resolve().parents[3]
PRICE_CACHE_DIR = ROOT / "apps" / "api" / ".cache" / "prices"


def _cache_key(
    tickers: list[str],
    download_start: str,
    end: str,
    benchmark: str,
) -> str:
    """Cache key uses download_start (includes warmup), not UI report start alone."""
    payload = {
        "tickers": sorted(list(dict.fromkeys([*tickers, benchmark]))),
        "download_start": download_start,
        "end": end,
        "benchmark": benchmark,
    }
    return hashlib.sha1(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


def prep_history_covers(
    panel_start: str | pd.Timestamp,
    requested_start: str | pd.Timestamp,
    *,
    min_calendar_days: int = 380,
) -> bool:
    """True when the price panel begins far enough before the user-facing start."""
    ps = pd.Timestamp(panel_start)
    rs = pd.Timestamp(requested_start)
    return (rs - ps).days >= int(min_calendar_days)


def _cache_path(key: str) -> Path:
    return PRICE_CACHE_DIR / f"{key}.parquet"


def _load_cached_prices(path: Path) -> pd.DataFrame | None:
    if not path.exists():
        return None
    age_h = (pd.Timestamp.utcnow() - pd.Timestamp(path.stat().st_mtime, unit="s", tz="UTC")).total_seconds() / 3600.0
    if age_h > CACHE_TTL_HOURS:
        return None
    try:
        return pd.read_parquet(path)
    except Exception:
        return None


def _first_valid_date(series: pd.Series) -> pd.Timestamp | None:
    s = series.dropna()
    if s.empty:
        return None
    return pd.Timestamp(s.index[0])


def _exclude_late_listing_columns(
    prices: pd.DataFrame,
    start: str,
    *,
    tolerance_days: int = LATE_LISTING_TOLERANCE_DAYS,
) -> tuple[pd.DataFrame, list[str]]:
    """Drop tickers that begin after the requested backtest start.

    Without this, a final ``dropna(how="any")`` forces the whole panel to start
    when the *latest* listing in the universe first has data (often ~2021).
    """
    anchor = pd.Timestamp(start)
    deadline = anchor + pd.Timedelta(days=int(tolerance_days))
    late: list[str] = []
    keep: list[str] = []
    for col in prices.columns:
        first = _first_valid_date(prices[col])
        if first is None or first > deadline:
            late.append(str(col))
        else:
            keep.append(col)
    if not keep:
        raise ValueError(
            f"No tickers have prices near {start} (within {tolerance_days}d); "
            f"excluded {len(late)} late listings — use a later start or narrower universe"
        )
    return prices[keep].copy(), late


def _trim_leading_incomplete_rows(prices: pd.DataFrame) -> pd.DataFrame:
    """Remove warm-up rows before every column has a price (after ffill)."""
    complete = prices.notna().all(axis=1)
    if not complete.any():
        return prices
    first = complete.idxmax()
    return prices.loc[first:].copy()


def price_download_start(
    requested_start: str,
    *,
    buffer_days: int = PRICE_PREP_BUFFER_CALENDAR_DAYS,
) -> str:
    """Earliest calendar date for yfinance download (warmup before backtest start)."""
    return str((pd.Timestamp(requested_start) - pd.Timedelta(days=int(buffer_days))).date())


def _save_cached_prices(path: Path, prices: pd.DataFrame) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        prices.to_parquet(path)
    except Exception:
        pass


def fetch_prices(
    tickers: list[str],
    start: str,
    end: str,
    benchmark: str,
    *,
    prep_buffer_days: int | None = None,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    import yfinance as yf

    requested_start = start
    buffer_days = int(prep_buffer_days or PRICE_PREP_BUFFER_CALENDAR_DAYS)
    download_start = price_download_start(requested_start, buffer_days=buffer_days)
    download_tickers = list(dict.fromkeys([*tickers, benchmark]))
    cpath = _cache_path(_cache_key(tickers, download_start, end, benchmark))
    cached = _load_cached_prices(cpath)
    if cached is not None and not cached.empty:
        if not prep_history_covers(cached.index[0], requested_start):
            cached = None
    if cached is not None and not cached.empty:
        prices = cached.copy()
        data_source = "yfinance_cache"
    else:
        frames: list[pd.DataFrame] = []
        for i in range(0, len(download_tickers), YFINANCE_CHUNK):
            chunk = download_tickers[i : i + YFINANCE_CHUNK]
            data = yf.download(
                chunk,
                start=download_start,
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
            raise ValueError("yfinance returned no price data")
        prices = pd.concat(frames, axis=1)
        _save_cached_prices(cpath, prices)
        data_source = "yfinance"
    prices = prices.loc[:, ~prices.columns.duplicated()]
    prices = prices.sort_index()
    prices = prices.replace([np.inf, -np.inf], np.nan)
    prices = prices.dropna(how="all")

    # Per-column forward fill (do NOT require all columns on same day)
    prices = prices.ffill()
    prices, excluded_late = _exclude_late_listing_columns(prices, requested_start)

    valid_cols: list[str] = []
    for col in prices.columns:
        series = prices[col].dropna()
        if len(series) < MIN_TRADING_DAYS:
            continue
        if series.pct_change().std() < 1e-6:
            continue
        valid_cols.append(col)

    if benchmark not in valid_cols and benchmark in prices.columns:
        if prices[benchmark].notna().sum() >= MIN_TRADING_DAYS:
            valid_cols.append(benchmark)

    if len(valid_cols) < 5:
        raise ValueError(f"Too few valid tickers ({len(valid_cols)}); shorten range or widen filter")

    prices = prices[valid_cols]
    min_cols = max(3, int(len(valid_cols) * MIN_ROW_COVERAGE))
    prices = prices[prices.notna().sum(axis=1) >= min_cols]
    prices = prices.ffill()
    prices = _trim_leading_incomplete_rows(prices)

    if len(prices) < MIN_TRADING_DAYS:
        raise ValueError(f"Insufficient overlapping trading days ({len(prices)}); adjust date range")

    effective_start = str(prices.index[0].date())
    meta: dict[str, Any] = {
        "data_source": data_source,
        "rows": len(prices),
        "columns": len(prices.columns),
        "requested_start": requested_start,
        "warmup_download_start": download_start,
        "prep_buffer_calendar_days": buffer_days,
        "start": effective_start,
        "end": str(prices.index[-1].date()),
        "benchmark_included": benchmark in prices.columns,
        "warmup_panel_covers_report_start": prep_history_covers(
            effective_start, requested_start
        ),
        "excluded_late_listing_count": len(excluded_late),
        "excluded_late_listings": excluded_late[:40],
    }
    if not meta["warmup_panel_covers_report_start"]:
        meta["warning"] = (
            f"Price panel starts {effective_start} (requested {requested_start}); "
            "early chart weights may use placeholder allocations until lookback is ready."
        )
    elif pd.Timestamp(effective_start) > pd.Timestamp(start) + pd.Timedelta(days=60):
        meta["warning"] = (
            f"Effective price panel starts {effective_start} (requested {start}). "
            "In-sample/holdout splits use this window, not the UI start date alone."
        )
    return prices, meta


def synthetic_prices(tickers: list[str], start: str, end: str, benchmark: str) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Demo-only data — not for production interpretation."""
    dates = pd.bdate_range(start=start, end=end)
    rng = np.random.default_rng(42)
    cols: dict[str, np.ndarray] = {}
    all_tickers = list(dict.fromkeys([*tickers, benchmark]))
    for i, t in enumerate(all_tickers):
        daily = rng.normal(0.0002, 0.012, len(dates))
        cols[t] = 100 * np.cumprod(1 + daily)
    prices = pd.DataFrame(cols, index=dates)
    meta = {
        "data_source": "synthetic_fallback",
        "rows": len(prices),
        "columns": len(prices.columns),
        "start": str(prices.index[0].date()),
        "end": str(prices.index[-1].date()),
        "warning": "Simulated random data for UI testing only — not investable performance",
    }
    return prices, meta
