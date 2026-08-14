"""Opportunistic refresh of demo-client price history to the latest close.

Triggered when the website is open (POST /clients/refresh-performance), not by
cron. Fetches the union of demo-client tickers once, writes the existing
backcast price cache plus a well-known latest panel so subsequent daily-NAV
calls reuse it instead of hitting Yahoo again.
"""

from __future__ import annotations

import json
from typing import Any

import numpy as np
import pandas as pd

from app.config import ROOT
from app.engine.data import (
    _download_yfinance_closes,
    _load_bundled_prices_panel,
    _save_cached_prices,
    _slice_price_panel,
    cache_file_written_today,
    client_perf_latest_path,
    load_client_perf_latest,
    panel_covers_end,
)
from app.engine.goal_backcast import CASH_TICKERS, MAX_BACKCAST_YEARS

DEMO_CLIENTS_PATH = ROOT / "shared" / "clients" / "demo-clients.json"


def _is_cash_holding(ticker: str, asset_class: str | None) -> bool:
    t = ticker.strip().upper()
    ac = (asset_class or "").strip().lower()
    return t in CASH_TICKERS or "cash" in ac or "現金" in ac


def _iter_raw_holdings(client: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = list(client.get("holdings") or [])
    for group in client.get("holdings_groups") or []:
        out.extend(group.get("holdings") or [])
    return out


def collect_demo_client_universe(
    path: Any | None = None,
) -> tuple[list[str], str | None, int]:
    """Unique non-cash tickers, earliest invested_at, and client count."""
    src = path if path is not None else DEMO_CLIENTS_PATH
    data = json.loads(src.read_text(encoding="utf-8"))
    tickers: set[str] = set()
    invested: list[str] = []
    clients = data.get("clients") or []
    for client in clients:
        if not isinstance(client, dict):
            continue
        for holding in _iter_raw_holdings(client):
            if not isinstance(holding, dict):
                continue
            ticker = str(holding.get("ticker") or "").strip().upper()
            if not ticker:
                continue
            asset_class = str(holding.get("asset_class") or "")
            if _is_cash_holding(ticker, asset_class):
                continue
            tickers.add(ticker)
            inv = holding.get("invested_at")
            if inv and str(inv).strip():
                invested.append(str(inv).strip()[:10])
    earliest = min(invested) if invested else None
    return sorted(tickers), earliest, len(clients)


def _extend_with_latest(base: pd.DataFrame, overlay: pd.DataFrame) -> pd.DataFrame:
    """Union of dates; overlay (yfinance) values win where present."""
    if overlay is None or overlay.empty:
        return base if base is not None else pd.DataFrame()
    if base is None or base.empty:
        return overlay
    return overlay.combine_first(base).sort_index()


def refresh_all_client_performance(*, end: str | None = None) -> dict[str, Any]:
    """Fetch latest closes for every demo-client ticker and warm the price cache."""
    tickers, earliest_invested, client_count = collect_demo_client_universe()
    end_ts = (
        pd.Timestamp(end).normalize()
        if end
        else pd.Timestamp.utcnow().tz_localize(None).normalize()
    )
    end_str = str(end_ts.date())
    if earliest_invested:
        start_ts = pd.Timestamp(earliest_invested).normalize()
    else:
        start_ts = end_ts - pd.DateOffset(years=3)
    if start_ts > end_ts:
        start_ts = end_ts - pd.DateOffset(years=3)
    max_start = end_ts - pd.DateOffset(years=MAX_BACKCAST_YEARS)
    if start_ts < max_start:
        start_ts = max_start
    start_str = str(start_ts.date())

    empty = {
        "as_of": None,
        "tickers": len(tickers),
        "clients": client_count,
        "skipped": True,
        "data_source": "",
        "window": {"start": start_str, "end": end_str},
    }
    if not tickers:
        empty["reason"] = "no_tickers"
        return empty

    latest_path = client_perf_latest_path()
    cached = load_client_perf_latest()
    if (
        cached is not None
        and not cached.empty
        and cache_file_written_today(latest_path)
        and all(t in cached.columns for t in tickers)
        and panel_covers_end(cached, end_str)
    ):
        as_of = str(pd.Timestamp(cached.index.max()).date())
        return {
            "as_of": as_of,
            "tickers": len(tickers),
            "clients": client_count,
            "skipped": True,
            "data_source": "cache",
            "window": {"start": start_str, "end": end_str},
        }

    bundled = _load_bundled_prices_panel()
    bundled_slice = (
        _slice_price_panel(bundled, start_str, end_str, tickers)
        if bundled is not None
        else pd.DataFrame()
    )
    # yfinance ``end`` is exclusive; +1 day so today's bar is included when available.
    yf_end = str((end_ts + pd.Timedelta(days=1)).date())
    yf_prices = _download_yfinance_closes(tickers, start_str, yf_end)
    panel = _extend_with_latest(bundled_slice, yf_prices)
    if panel.empty:
        raise ValueError("no price data from bundled panel or yfinance")
    panel = panel.replace([np.inf, -np.inf], np.nan).sort_index()
    panel = panel.dropna(how="all")
    _save_cached_prices(latest_path, panel)

    as_of = str(pd.Timestamp(panel.index.max()).date())
    if yf_prices.empty:
        source = "bundled_parquet"
    elif bundled_slice.empty:
        source = "yfinance"
    else:
        source = "bundled_parquet+yfinance"
    return {
        "as_of": as_of,
        "tickers": len(tickers),
        "clients": client_count,
        "skipped": False,
        "data_source": source,
        "window": {"start": start_str, "end": end_str},
    }
