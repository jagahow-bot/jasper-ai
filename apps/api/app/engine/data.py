"""Market data loading and quality checks."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from app.config import ROOT

YFINANCE_CHUNK = 25
MIN_TRADING_DAYS = 504
# Calendar days to fetch before the UI start so factor/allocator lookbacks are ready on day 1.
PRICE_PREP_BUFFER_CALENDAR_DAYS = 840
MAX_MISSING_COL = 0.15
MIN_ROW_COVERAGE = 0.75
# Symbols listed after requested start + this slack are dropped (not used to trim the panel).
LATE_LISTING_TOLERANCE_DAYS = 21
CACHE_TTL_HOURS = 12
PRICE_CACHE_DIR = ROOT / "apps" / "api" / ".cache" / "prices"
DIVIDEND_CACHE_DIR = ROOT / "apps" / "api" / ".cache" / "dividends"
BUNDLED_PRICES_PATH = ROOT / "apps" / "api" / "data" / "bundled_prices" / "closes.parquet"
BUNDLED_DIVIDENDS_PATH = ROOT / "apps" / "api" / "data" / "bundled_prices" / "dividends.parquet"
DEMO_TICKERS_PATH = ROOT / "shared" / "demo-tickers.json"


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


def _dividend_cache_key(tickers: list[str], start: str, end: str) -> str:
    payload = {
        "tickers": sorted(list(dict.fromkeys([str(t).upper() for t in tickers]))),
        "start": start,
        "end": end,
    }
    return hashlib.sha1(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


def _dividend_cache_path(key: str) -> Path:
    return DIVIDEND_CACHE_DIR / f"{key}.parquet"


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
    keep_tickers: list[str] | tuple[str, ...] | None = None,
) -> tuple[pd.DataFrame, list[str]]:
    """Drop tickers that begin after the requested backtest start.

    Without this, a final ``dropna(how="any")`` forces the whole panel to start
    when the *latest* listing in the universe first has data (often ~2021).

    ``keep_tickers`` (overlay / locked supplements) are retained even when they
    list after ``start`` so confirmed adds still reach must-include pinning;
    early NaNs are handled by ``_trim_leading_incomplete_rows``.
    """
    anchor = pd.Timestamp(start)
    deadline = anchor + pd.Timedelta(days=int(tolerance_days))
    pinned = {str(t).upper() for t in (keep_tickers or []) if str(t).strip()}
    late: list[str] = []
    keep: list[str] = []
    for col in prices.columns:
        first = _first_valid_date(prices[col])
        col_u = str(col).upper()
        if first is None:
            # Empty series — drop unless pinned (caller should have re-fetched).
            if col_u in pinned:
                keep.append(col)
            else:
                late.append(str(col))
        elif first > deadline and col_u not in pinned:
            late.append(str(col))
        else:
            keep.append(col)
    if not keep:
        raise ValueError(
            f"No tickers have prices near {start} (within {tolerance_days}d); "
            f"excluded {len(late)} late listings — use a later start or narrower universe"
        )
    return prices[keep].copy(), late


def _trim_leading_incomplete_rows(
    prices: pd.DataFrame,
    *,
    requested_start: str | None = None,
) -> pd.DataFrame:
    """Trim incomplete rows while keeping pre-start rows for factor/allocator lookback."""
    if prices.empty:
        return prices
    n_cols = len(prices.columns)
    min_cols = min(n_cols, max(3, int(n_cols * MIN_ROW_COVERAGE)))

    if requested_start is None:
        complete = prices.notna().all(axis=1)
        if not complete.any():
            return prices
        return prices.loc[complete.idxmax():].copy()

    anchor = pd.Timestamp(requested_start)
    pre = prices.loc[prices.index < anchor]
    post = prices.loc[prices.index >= anchor]

    if not post.empty:
        post_complete = post.notna().all(axis=1)
        if post_complete.any():
            post = post.loc[post_complete.idxmax():]
        else:
            ok = post.notna().sum(axis=1) >= min_cols
            if ok.any():
                post = post.loc[ok.idxmax():]

    if not pre.empty:
        early_cols = [
            c
            for c in pre.columns
            if (first := _first_valid_date(prices[c])) is not None
            and first <= anchor
        ]
        prep_min = max(1, min(min_cols, len(early_cols)))
        if early_cols:
            pre_ok = pre[early_cols].notna().sum(axis=1) >= prep_min
            if pre_ok.any():
                pre = pre.loc[pre_ok.idxmax():]
            else:
                pre = pre.iloc[0:0]
        else:
            pre = pre.iloc[0:0]

    if pre.empty and post.empty:
        complete = prices.notna().all(axis=1)
        if not complete.any():
            return prices
        return prices.loc[complete.idxmax():].copy()
    if pre.empty:
        return post.copy()
    if post.empty:
        return pre.copy()
    combined = pd.concat([pre, post])
    return combined.loc[~combined.index.duplicated(keep="last")].sort_index()


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


def _load_bundled_prices_panel() -> pd.DataFrame | None:
    """Committed demo closes panel (Render / offline fallback)."""
    if not BUNDLED_PRICES_PATH.exists():
        return None
    try:
        panel = pd.read_parquet(BUNDLED_PRICES_PATH)
    except Exception:
        return None
    if panel.empty:
        return None
    panel.index = pd.to_datetime(panel.index)
    panel = panel.sort_index()
    panel.columns = [str(c).upper() for c in panel.columns]
    return panel


def _slice_price_panel(
    panel: pd.DataFrame,
    download_start: str,
    end: str,
    tickers: list[str],
) -> pd.DataFrame:
    want = [str(t).upper() for t in tickers]
    cols = [c for c in want if c in panel.columns]
    if not cols:
        return pd.DataFrame()
    out = panel.loc[:, cols].copy()
    start_ts = pd.Timestamp(download_start)
    end_ts = pd.Timestamp(end)
    out = out.loc[(out.index >= start_ts) & (out.index <= end_ts)]
    return out


def _download_yfinance_closes(
    tickers: list[str],
    download_start: str,
    end: str,
) -> pd.DataFrame:
    import yfinance as yf

    frames: list[pd.DataFrame] = []
    for i in range(0, len(tickers), YFINANCE_CHUNK):
        chunk = tickers[i : i + YFINANCE_CHUNK]
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
        return pd.DataFrame()
    prices = pd.concat(frames, axis=1)
    prices.columns = [str(c).upper() for c in prices.columns]
    return prices


def _merge_price_panels(*panels: pd.DataFrame) -> pd.DataFrame:
    usable = [p for p in panels if p is not None and not p.empty]
    if not usable:
        return pd.DataFrame()
    merged = pd.concat(usable, axis=1)
    merged = merged.loc[:, ~merged.columns.duplicated()]
    return merged.sort_index()


def fetch_prices(
    tickers: list[str],
    start: str,
    end: str,
    benchmark: str,
    *,
    prep_buffer_days: int | None = None,
    min_valid_tickers: int = 5,
    pinned_tickers: list[str] | None = None,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    requested_start = start
    buffer_days = int(prep_buffer_days or PRICE_PREP_BUFFER_CALENDAR_DAYS)
    download_start = price_download_start(requested_start, buffer_days=buffer_days)
    download_tickers = list(dict.fromkeys([str(t).upper() for t in [*tickers, benchmark]]))
    pinned = [
        str(t).strip().upper()
        for t in (pinned_tickers or [])
        if str(t).strip() and str(t).strip().upper() not in {"CASH"}
    ]
    pinned_set = set(pinned)
    cpath = _cache_path(_cache_key(tickers, download_start, end, benchmark))
    cached = _load_cached_prices(cpath)
    if cached is not None and not cached.empty:
        if not prep_history_covers(cached.index[0], requested_start):
            cached = None
    if cached is not None and not cached.empty:
        prices = cached.copy()
        data_source = "yfinance_cache"
        # Stale/partial cache can keep an all-NaN column (e.g. failed SOXX merge)
        # and then late-listing logic silently drops a confirmed overlay add.
        need_refetch = [
            t
            for t in download_tickers
            if t not in prices.columns or prices[t].dropna().empty
        ]
        if need_refetch:
            yf_prices = _download_yfinance_closes(need_refetch, download_start, end)
            if not yf_prices.empty:
                drop_cols = [t for t in need_refetch if t in prices.columns]
                if drop_cols:
                    prices = prices.drop(columns=drop_cols)
                prices = _merge_price_panels(prices, yf_prices)
                data_source = f"{data_source}+yfinance_refetch"
                _save_cached_prices(cpath, prices)
    else:
        bundled_panel = _load_bundled_prices_panel()
        bundled_slice = (
            _slice_price_panel(bundled_panel, download_start, end, download_tickers)
            if bundled_panel is not None
            else pd.DataFrame()
        )
        bundled_ok = [
            t
            for t in download_tickers
            if t in bundled_slice.columns and bundled_slice[t].dropna().shape[0] >= MIN_TRADING_DAYS
        ]
        bundled_ok_set = set(bundled_ok)
        yf_tickers = [t for t in download_tickers if t not in bundled_ok_set]
        yf_prices = (
            _download_yfinance_closes(yf_tickers, download_start, end) if yf_tickers else pd.DataFrame()
        )
        prices = _merge_price_panels(
            bundled_slice[bundled_ok] if bundled_ok else pd.DataFrame(),
            yf_prices,
        )
        if prices.empty:
            raise ValueError("no price data from bundled panel or yfinance")
        if bundled_ok and yf_prices.empty:
            data_source = "bundled_parquet"
        elif bundled_ok:
            data_source = "bundled_parquet+yfinance"
        else:
            data_source = "yfinance"
        _save_cached_prices(cpath, prices)
    prices = prices.loc[:, ~prices.columns.duplicated()]
    prices = prices.sort_index()
    prices = prices.replace([np.inf, -np.inf], np.nan)
    prices = prices.dropna(how="all")

    # Per-column forward fill (do NOT require all columns on same day)
    prices = prices.ffill()
    deadline = pd.Timestamp(requested_start) + pd.Timedelta(
        days=int(LATE_LISTING_TOLERANCE_DAYS)
    )
    would_be_late = [
        str(col)
        for col in prices.columns
        if str(col).upper() in pinned_set
        and (
            (first := _first_valid_date(prices[col])) is None or first > deadline
        )
    ]
    prices, excluded_late = _exclude_late_listing_columns(
        prices,
        requested_start,
        keep_tickers=pinned or None,
    )
    pinned_kept_late = [
        t for t in would_be_late if str(t).upper() in {c.upper() for c in prices.columns}
    ]

    valid_cols: list[str] = []
    for col in prices.columns:
        series = prices[col].dropna()
        col_u = str(col).upper()
        if len(series) < MIN_TRADING_DAYS:
            # Pinned overlay adds may list mid-sample; keep if any usable history.
            if col_u in pinned_set and len(series) >= 60:
                valid_cols.append(col)
            continue
        if series.pct_change().std() < 1e-6:
            continue
        valid_cols.append(col)

    if benchmark not in valid_cols and benchmark in prices.columns:
        if prices[benchmark].notna().sum() >= MIN_TRADING_DAYS:
            valid_cols.append(benchmark)

    min_needed = max(1, int(min_valid_tickers))
    if len(valid_cols) < min_needed:
        raise ValueError(
            f"Too few valid tickers ({len(valid_cols)}); shorten range or widen filter "
            f"[data_source={data_source}, requested={len(download_tickers)}, "
            f"bundled_available={BUNDLED_PRICES_PATH.exists()}, min_needed={min_needed}]"
        )

    prices = prices[valid_cols]
    min_cols = min(len(valid_cols), max(3, int(len(valid_cols) * MIN_ROW_COVERAGE)))
    prices = prices[prices.notna().sum(axis=1) >= min_cols]
    prices = prices.ffill()
    prices = _trim_leading_incomplete_rows(prices, requested_start=requested_start)

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
        "pinned_late_listings_kept": pinned_kept_late[:40],
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


def _load_bundled_dividends_panel() -> pd.DataFrame | None:
    """Committed demo dividend panel (Render / offline fallback)."""
    if not BUNDLED_DIVIDENDS_PATH.exists():
        return None
    try:
        panel = pd.read_parquet(BUNDLED_DIVIDENDS_PATH)
    except Exception:
        return None
    if panel.empty:
        return None
    panel.index = pd.to_datetime(panel.index)
    panel = panel.sort_index()
    panel.columns = [str(c).upper() for c in panel.columns]
    return panel


def _slice_dividend_panel(
    panel: pd.DataFrame,
    start: str,
    end: str,
    tickers: list[str],
) -> pd.DataFrame:
    want = [str(t).upper() for t in tickers]
    cols = [c for c in want if c in panel.columns]
    if not cols:
        return pd.DataFrame(columns=want)
    out = panel.loc[:, cols].copy()
    start_ts = pd.Timestamp(start)
    end_ts = pd.Timestamp(end)
    out = out.loc[(out.index >= start_ts) & (out.index <= end_ts)]
    return out


def _dividends_to_daily_cash(
    div: pd.Series,
    index: pd.DatetimeIndex,
) -> pd.Series:
    daily = pd.Series(0.0, index=index, dtype=float)
    if div is None or div.empty:
        return daily
    s = div.copy()
    s.index = pd.to_datetime(s.index)
    if getattr(s.index, "tz", None) is not None:
        s.index = s.index.tz_localize(None)
    s = s.sort_index()
    for dt, val in s.items():
        ts = pd.Timestamp(dt).normalize()
        if ts in daily.index:
            daily.loc[ts] += float(val)
        else:
            pos = int(daily.index.searchsorted(ts))
            if 0 <= pos < len(daily.index):
                daily.iloc[pos] += float(val)
    return daily


def _download_yfinance_dividends(
    tickers: list[str],
    start: str,
    end: str,
) -> pd.DataFrame:
    import yfinance as yf

    tickers_u = [str(t).upper() for t in tickers]
    index = pd.bdate_range(start=start, end=end)
    if len(index) == 0:
        return pd.DataFrame(columns=tickers_u)
    out = pd.DataFrame(0.0, index=index, columns=tickers_u, dtype=float)
    start_ts = pd.Timestamp(start)
    end_ts = pd.Timestamp(end)
    for t in tickers_u:
        try:
            div = yf.Ticker(t).dividends
        except Exception:
            continue
        if div is None or div.empty:
            continue
        div = div.copy()
        div.index = pd.to_datetime(div.index)
        if getattr(div.index, "tz", None) is not None:
            div.index = div.index.tz_localize(None)
        div = div.loc[(div.index >= start_ts) & (div.index <= end_ts)]
        out[t] = _dividends_to_daily_cash(div, index).to_numpy(dtype=float)
    return out


def fetch_dividends(
    tickers: list[str],
    start: str,
    end: str,
) -> pd.DataFrame:
    """Wide daily dividend cash panel (0 on non-ex-dates), indexed by DatetimeIndex."""
    download_tickers = list(dict.fromkeys([str(t).upper() for t in tickers]))
    if not download_tickers:
        return pd.DataFrame()
    cpath = _dividend_cache_path(_dividend_cache_key(download_tickers, start, end))
    cached = _load_cached_prices(cpath)
    if cached is not None and not cached.empty:
        panel = cached.copy()
    else:
        bundled_panel = _load_bundled_dividends_panel()
        bundled_slice = (
            _slice_dividend_panel(bundled_panel, start, end, download_tickers)
            if bundled_panel is not None
            else pd.DataFrame()
        )
        bundled_ok = [
            t
            for t in download_tickers
            if t in bundled_slice.columns and bundled_slice[t].notna().any()
        ]
        bundled_ok_set = set(bundled_ok)
        yf_tickers = [t for t in download_tickers if t not in bundled_ok_set]
        yf_divs = (
            _download_yfinance_dividends(yf_tickers, start, end)
            if yf_tickers
            else pd.DataFrame()
        )
        panel = _merge_price_panels(
            bundled_slice[bundled_ok] if bundled_ok else pd.DataFrame(),
            yf_divs,
        )
        if panel.empty:
            return pd.DataFrame(columns=download_tickers)
        panel = panel.reindex(columns=download_tickers, fill_value=0.0)
        _save_cached_prices(cpath, panel)
    panel = panel.loc[:, ~panel.columns.duplicated()]
    panel = panel.sort_index()
    panel = panel.replace([np.inf, -np.inf], np.nan).fillna(0.0)
    missing = [t for t in download_tickers if t not in panel.columns]
    if missing:
        for t in missing:
            panel[t] = 0.0
    return panel.reindex(columns=download_tickers, fill_value=0.0)


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
