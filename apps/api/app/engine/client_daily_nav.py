"""Daily client-book NAV from REAL daily closes (no interpolation, no noise).

Backs the client dashboard "Performance trend" chart: given the client's book
(holdings with initial weights and invested_at dates), reconstruct the daily
capital-adjusted NAV index from actual price history, reusing the
``goal_backcast`` data plumbing (cache → bundled parquet → yfinance) and its
same-category peer-fill fallback for late listings.

Assumptions (documented per the agreed design):
- Daily grid: the trading days of the fetched close panel inside the window.
  yfinance closes are auto-adjusted (dividends included); bundled closes are
  used as shipped — the same closes-only convention as ``goal_backcast``.
- Buy at close: a position is bought at the close of the first trading day
  on/after its ``invested_at`` (its anchor). Growth is 1.0 at the anchor.
- Capital-adjusted index: a holding contributes only from its invested date;
  value(t) = initial_weight × (1 + total-return-since-invested) and
  nav(t) = Σ value(t) / Σ capital-deployed-to-date, so external contributions
  at cost never look like performance. The series is rebased to 1.0 at the
  first emitted day.
- Late listings: when a ticker's first valid close is after its invested
  date, the gap compounds a same-category peer's daily returns (deterministic
  pick: earliest first-valid day, then ticker alpha; then same asset class;
  then 0.0 flat — the same fallback chain as ``peer_fill_missing_months``).
- Holdings without ``invested_at`` are treated as invested at the window
  start; holdings with no usable close on/after their invested date are
  dropped and reported in ``meta.dropped_tickers``.
- Cash (ticker CASH) earns 0% and is always deployed, consistent with the
  web-side holdings math. An all-cash book returns a flat 1.0 index.
- ``meta.per_ticker`` reports each priced holding's real close-to-close
  cumulative return over its priced life (anchor → panel end) from the same
  spliced series used for the NAV (peer-filled gaps included), so the
  holdings table reconciles with the NAV chart. Dividends follow the panel:
  yfinance closes are auto-adjusted; bundled closes are as shipped
  (closes-only). Cash and dropped tickers are omitted.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

from app.engine.goal_backcast import (
    CASH_TICKERS,
    MAX_BACKCAST_YEARS,
    _load_close_panel,
    _peer_candidate_tickers,
    _universe_meta_by_ticker,
)

# Default lookback when no holding reports invested_at (matches the web
# CLIENT_PERF_HISTORY_MONTHS = 36 fallback).
DEFAULT_DAILY_NAV_YEARS = 3


@dataclass
class DailyNavBuild:
    daily: list[dict[str, Any]]
    meta: dict[str, Any]


@dataclass
class _BookEntry:
    ticker: str
    capital: float
    invested_at: pd.Timestamp | None
    is_cash: bool


@dataclass
class _GapFill:
    proxy: str | None = None
    days_filled: int = 0
    zero_filled_days: int = 0


def _parse_date(value: Any, *, field_name: str) -> pd.Timestamp | None:
    if value is None or str(value).strip() == "":
        return None
    try:
        ts = pd.Timestamp(str(value).strip())
    except (ValueError, TypeError) as exc:
        raise ValueError(f"invalid {field_name}: {value!r}") from exc
    if pd.isna(ts):
        raise ValueError(f"invalid {field_name}: {value!r}")
    return ts.normalize()


def _parse_holdings(holdings: list[dict[str, Any]]) -> list[_BookEntry]:
    out: list[_BookEntry] = []
    for h in holdings or []:
        ticker = str(h.get("ticker", "")).strip().upper()
        if not ticker:
            raise ValueError("holding ticker is required")
        try:
            cap = float(h.get("weight", 0.0))
        except (TypeError, ValueError) as exc:
            raise ValueError(f"invalid weight for {ticker}") from exc
        if not np.isfinite(cap) or cap <= 0:
            continue
        invested = _parse_date(h.get("invested_at"), field_name="invested_at")
        out.append(
            _BookEntry(
                ticker=ticker,
                capital=cap,
                invested_at=invested,
                is_cash=ticker in CASH_TICKERS,
            )
        )
    if not out:
        raise ValueError("holdings must contain at least one positive weight")
    return out


def _first_valid_days(panel: pd.DataFrame) -> dict[str, pd.Timestamp]:
    out: dict[str, pd.Timestamp] = {}
    for c in panel.columns:
        s = panel[c].dropna()
        if not s.empty:
            out[c] = s.index[0]
    return out


def _pick_gap_peer(
    ticker: str,
    gap_start_day: pd.Timestamp,
    columns: list[str],
    meta_by_ticker: dict[str, dict[str, str]],
    first_valid_day: dict[str, pd.Timestamp],
    *,
    level: str,
) -> str | None:
    """Same-category (then asset-class) peer covering the whole gap.

    Deterministic: earliest first-valid day, then ticker alpha — mirrors the
    monthly ``_pick_peer`` preference rule on the daily grid.
    """
    want = meta_by_ticker.get(ticker, {}).get(level, "")
    if not want:
        return None
    best: str | None = None
    for other in columns:
        if other == ticker:
            continue
        if meta_by_ticker.get(other, {}).get(level, "") != want:
            continue
        fvd = first_valid_day.get(other)
        if fvd is None or fvd > gap_start_day:
            continue
        if best is None or (fvd, other) < (first_valid_day[best], best):
            best = other
    return best


def _holding_growth(
    closes_ff: pd.Series,
    invested: pd.Timestamp,
    *,
    peer_closes_ff: pd.Series | None = None,
) -> tuple[pd.Series, _GapFill]:
    """Growth index (1.0 at anchor) on the frame grid, NaN before the anchor.

    ``closes_ff`` is ffilled (leading NaN before listing preserved). When the
    first valid close is after ``invested``, gap days compound peer daily
    returns (0.0 when no peer covers the gap), and the ticker's own returns
    take over the day after its first valid close.
    """
    grid = closes_ff.index
    anchor_pos = int(grid.searchsorted(invested))
    if anchor_pos >= len(grid):
        raise ValueError("invested after the window end")
    raw_valid = closes_ff.dropna()
    # ffill preserved leading NaN, so this is the true listing day.
    fv_day = raw_valid.index[0]
    fv_pos = int(grid.searchsorted(fv_day))

    g = np.full(len(grid), np.nan)
    g[anchor_pos] = 1.0
    fill = _GapFill()

    prices = closes_ff.to_numpy(dtype=float)
    if fv_pos <= anchor_pos:
        # Normal case: real closes cover the position from its anchor.
        g[anchor_pos:] = prices[anchor_pos:] / prices[anchor_pos]
        return pd.Series(g, index=grid), fill

    # Late listing: peer-fill the gap (anchor day .. listing day inclusive).
    peer_ret: np.ndarray | None = None
    if peer_closes_ff is not None:
        pr = peer_closes_ff.reindex(grid).ffill().pct_change().to_numpy(dtype=float)
        peer_ret = np.nan_to_num(pr, nan=0.0)
        fill.proxy = str(peer_closes_ff.name)
    gap_end = fv_pos  # own returns start the day after the first valid close
    gap_days = gap_end - anchor_pos
    if gap_days > 0:
        rets = peer_ret[anchor_pos + 1 : gap_end + 1] if peer_ret is not None else None
        if rets is None:
            rets = np.zeros(gap_days)
            fill.zero_filled_days += gap_days
        fill.days_filled += gap_days
        g[anchor_pos + 1 : gap_end + 1] = np.cumprod(1.0 + rets)
    # Own closes from the listing day onward.
    if fv_pos + 1 <= len(grid) - 1:
        g[fv_pos + 1 :] = g[fv_pos] * prices[fv_pos + 1 :] / prices[fv_pos]
    return pd.Series(g, index=grid), fill


def build_client_daily_nav(
    holdings: list[dict[str, Any]],
    *,
    start: str | None = None,
    end: str | None = None,
) -> DailyNavBuild:
    """Top-level builder: client book → daily capital-adjusted NAV index."""
    entries = _parse_holdings(holdings)
    end_ts = _parse_date(end, field_name="end") or pd.Timestamp.utcnow().tz_localize(
        None
    ).normalize()
    start_ts = _parse_date(start, field_name="start")

    invested_dates = [e.invested_at for e in entries if e.invested_at is not None]
    if start_ts is None:
        start_ts = (
            min(invested_dates)
            if invested_dates
            else end_ts - pd.DateOffset(years=DEFAULT_DAILY_NAV_YEARS)
        )
    if start_ts > end_ts:
        raise ValueError("start must be on or before end")
    clamped = start_ts < end_ts - pd.DateOffset(years=MAX_BACKCAST_YEARS)
    if clamped:
        start_ts = end_ts - pd.DateOffset(years=MAX_BACKCAST_YEARS)

    cash_capital = sum(e.capital for e in entries if e.is_cash)
    non_cash = [e for e in entries if not e.is_cash]

    meta: dict[str, Any] = {
        "cash_weight": round(
            cash_capital / (sum(e.capital for e in entries) or 1.0), 6
        ),
        "clamped_to_max_years": clamped,
        "assumptions": [
            "daily closes (yfinance auto-adjusted; bundled as shipped)",
            "position buys at the first close on/after invested_at (growth 1.0 there)",
            "nav = value / capital-deployed-to-date, rebased to 1.0 at the first day",
            "late listings filled by same-category peer, else same asset class, else 0",
            "cash sleeve earns 0% and is always deployed",
        ],
    }

    if not non_cash:
        grid = pd.bdate_range(start_ts, end_ts)
        if grid.empty:
            raise ValueError("no business days inside the requested window")
        meta.update(
            {
                "window": {
                    "start": str(grid[0].date()),
                    "end": str(grid[-1].date()),
                    "days": len(grid),
                },
                "data_source": "cash_only",
                "holdings": [],
                "dropped_tickers": [],
                "proxy_fills": {},
                "per_ticker": [],
            }
        )
        return DailyNavBuild(
            daily=[{"date": str(d.date()), "nav": 1.0} for d in grid],
            meta=meta,
        )

    # Fetch from the earliest invested date so pre-window anchors stay real.
    fetch_start = min([start_ts, *invested_dates])
    tickers = sorted({e.ticker for e in non_cash})
    closes_raw, data_source = _load_close_panel(
        tickers, str(fetch_start.date()), str(end_ts.date())
    )
    closes_raw = closes_raw.dropna(how="all")
    if closes_raw.empty:
        raise ValueError("no price data inside the requested window")
    first_valid_day = _first_valid_days(closes_raw)
    closes = closes_raw.ffill()
    grid = closes.index

    meta_by_ticker = _universe_meta_by_ticker()

    # Effective invested date: holdings without one anchor at the window start.
    def _eff_invested(e: _BookEntry) -> pd.Timestamp:
        return e.invested_at if e.invested_at is not None else start_ts

    # Which tickers list after their invested date (need gap fill)?
    late: dict[str, pd.Timestamp] = {}
    for e in non_cash:
        fv = first_valid_day.get(e.ticker)
        if fv is None:
            continue
        anchor_pos = int(grid.searchsorted(_eff_invested(e)))
        if anchor_pos < len(grid) and fv > grid[anchor_pos]:
            prev = late.get(e.ticker)
            if prev is None or grid[anchor_pos] < prev:
                late[e.ticker] = grid[anchor_pos]

    peer_closes = pd.DataFrame()
    peers_loaded: list[str] = []
    if late:
        candidates = _peer_candidate_tickers(
            sorted(late), set(closes.columns), meta_by_ticker
        )
        if candidates:
            peer_panel, peer_source = _load_close_panel(
                candidates, str(fetch_start.date()), str(end_ts.date())
            )
            peer_panel = peer_panel.dropna(how="all")
            if not peer_panel.empty:
                first_valid_day.update(_first_valid_days(peer_panel))
                peer_closes = peer_panel.ffill()
                peers_loaded = list(peer_closes.columns)
                if peer_source not in data_source:
                    data_source = f"{data_source}|peers:{peer_source}"

    # Per-entry growth: duplicate tickers with different invested dates anchor
    # independently, so growth is tracked per book entry, not per ticker.
    growths: list[tuple[_BookEntry, pd.Series]] = []
    fills: dict[str, _GapFill] = {}
    dropped: set[str] = set()
    holdings_meta: list[dict[str, Any]] = []
    per_ticker: list[dict[str, Any]] = []
    for e in non_cash:
        if e.ticker in dropped:
            continue
        eff = _eff_invested(e)
        fv = first_valid_day.get(e.ticker)
        if fv is None or fv > grid[-1] or eff > grid[-1]:
            dropped.add(e.ticker)
            continue
        peer_series: pd.Series | None = None
        anchor_day = grid[int(grid.searchsorted(eff))]
        if fv > anchor_day:
            columns = list(closes.columns) + list(peer_closes.columns)
            peer = _pick_gap_peer(
                e.ticker,
                anchor_day,
                columns,
                meta_by_ticker,
                first_valid_day,
                level="category",
            ) or _pick_gap_peer(
                e.ticker,
                anchor_day,
                columns,
                meta_by_ticker,
                first_valid_day,
                level="asset_class",
            )
            if peer is not None:
                src = closes if peer in closes.columns else peer_closes
                peer_series = src[peer]
        growth, fill = _holding_growth(
            closes[e.ticker], eff, peer_closes_ff=peer_series
        )
        growths.append((e, growth))
        if fill.days_filled:
            prev = fills.get(e.ticker)
            if prev is None:
                fills[e.ticker] = fill
            else:
                prev.days_filled += fill.days_filled
                prev.zero_filled_days += fill.zero_filled_days
        holdings_meta.append(
            {
                "ticker": e.ticker,
                "invested_at": str(eff.date()),
                "anchor_date": str(anchor_day.date()),
                "first_valid_date": str(fv.date()),
            }
        )
        # Real close-to-close cumulative return over the holding's priced
        # life (anchor → panel end). Uses the same spliced growth series as
        # the NAV path, so peer-filled gap performance is included.
        per_ticker.append(
            {
                "ticker": e.ticker,
                "invested_at": (
                    str(e.invested_at.date()) if e.invested_at is not None else None
                ),
                "first_date": str(anchor_day.date()),
                "last_date": str(grid[-1].date()),
                "cumulative_return": round(float(growth.iloc[-1] - 1.0), 8),
            }
        )

    if not growths:
        raise ValueError("no holding has usable price history in the window")

    window_mask = grid >= start_ts
    window_grid = grid[window_mask]
    if window_grid.empty:
        raise ValueError("no trading days inside the requested window")

    n = len(window_grid)
    value = np.full(n, float(cash_capital))
    capital = np.full(n, float(cash_capital))
    for e, growth in growths:
        eff = _eff_invested(e)
        deployed = window_grid >= eff
        if not deployed.any():
            continue
        g = growth.loc[window_grid].to_numpy(dtype=float)
        g = np.where(deployed, np.nan_to_num(g, nan=1.0), 0.0)
        value += e.capital * g
        capital += np.where(deployed, e.capital, 0.0)

    valid = capital > 0
    nav_raw = value[valid] / capital[valid]
    nav = nav_raw / nav_raw[0]  # rebase to 1.0 at the first emitted day
    days = window_grid[valid]
    daily = [
        {"date": str(d.date()), "nav": round(float(v), 6)}
        for d, v in zip(days, nav)
    ]

    meta.update(
        {
            "window": {
                "start": str(days[0].date()),
                "end": str(days[-1].date()),
                "days": len(daily),
            },
            "data_source": data_source,
            "holdings": holdings_meta,
            "dropped_tickers": sorted(dropped),
            "proxy_fills": {
                t: {
                    "proxies": [f.proxy] if f.proxy else [],
                    "days_filled": f.days_filled,
                    "zero_filled_days": f.zero_filled_days,
                }
                for t, f in sorted(fills.items())
            },
            "peer_tickers_loaded": peers_loaded,
            "per_ticker": per_ticker,
        }
    )
    return DailyNavBuild(daily=daily, meta=meta)
