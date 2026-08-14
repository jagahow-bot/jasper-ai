"""Backcast (回推) monthly return series for a fixed target-weight portfolio.

Used by financial-goal planning: instead of the dynamic backtest equity curve,
construct how the *selected* portfolio would have performed historically by
weighting constituent monthly total returns, with periodic rebalance back to
the target mix.

Assumptions (documented per the agreed design):
- Monthly grid: month-end closes → simple monthly returns. yfinance closes are
  auto-adjusted (dividends included); bundled closes are used as shipped, the
  same closes-only convention as ``engine.portfolio._safe_returns``.
- Late listings: months before a ticker's first valid close are filled from a
  same-``category`` peer (shared/etf-universe.json metadata). Peer choice is
  deterministic: among peers with a valid return that month, prefer the one
  with the earliest first-valid month, then ticker alpha. Fallback chain when
  no category peer covers the month: same ``asset_class`` peer → 0.0.
- Rebalance-to-target: weights drift with constituent returns between
  rebalances and reset to target at rebalance boundaries. The rule uses the
  project convention (``_normalize_rebalance_rule``); on a monthly grid
  ME → every month, QE → quarter-end months, YE → December, W-FRI → monthly
  (weekly collapses onto the coarser grid). Default QE matches BacktestSpec.
- Fees: ``fee_bps`` charged on L1 turnover (assets + cash sleeve) at each
  rebalance, matching ``_simulate_buy_and_hold_path`` fee accounting.
  Constituent expense ratios are not in the universe metadata, so none are
  deducted beyond this turnover fee.
- Cash sleeve (ticker CASH) earns 0% monthly, consistent with the web-side
  holdings math (cash dilutes at 0).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from app.engine.data import (
    _download_yfinance_closes,
    _load_bundled_prices_panel,
    _load_cached_prices,
    _merge_price_panels,
    _save_cached_prices,
    _cache_path,
    _slice_price_panel,
    load_client_perf_latest,
    panel_covers_end,
)
from app.engine.portfolio import _normalize_rebalance_rule
from app.profiles import load_universe_file

CASH_TICKERS = frozenset({"CASH"})
DEFAULT_BACKCAST_YEARS = 10
MAX_BACKCAST_YEARS = 20
# Need the prior month-end close to form the first monthly return.
MONTH_START_WARMUP_DAYS = 45
# A column with fewer valid closes than this is treated as unusable.
MIN_VALID_CLOSES = 24


@dataclass
class BackcastBuild:
    monthly: list[dict[str, Any]]
    meta: dict[str, Any]


@dataclass
class _PeerFill:
    proxy_by_month: dict[str, str] = field(default_factory=dict)

    @property
    def months_filled(self) -> int:
        return len(self.proxy_by_month)

    @property
    def proxies(self) -> list[str]:
        return sorted(set(self.proxy_by_month.values()))


def _backcast_cache_key(tickers: list[str], start: str, end: str) -> str:
    payload = {
        "kind": "goal_backcast_closes",
        "tickers": sorted({str(t).upper() for t in tickers}),
        "start": start,
        "end": end,
    }
    return hashlib.sha1(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


def _load_close_panel(tickers: list[str], start: str, end: str) -> tuple[pd.DataFrame, str]:
    """Close panel for backcast: cache → latest client panel → bundled → yfinance.

    Unlike ``fetch_prices`` this keeps late listings (NaN before listing) and
    has no minimum-ticker floor — the caller peer-fills missing months.

    The opportunistic ``client_perf_latest`` panel (warmed when the website is
    open) is preferred over bundled for overlapping tickers so daily-NAV can
    extend past the shipped parquet without a second Yahoo round-trip.
    """
    want = [str(t).upper() for t in tickers]
    cpath = _cache_path(_backcast_cache_key(want, start, end))
    cached = _load_cached_prices(cpath)
    if cached is not None and not cached.empty:
        cols = [c for c in want if c in cached.columns]
        if cols:
            return cached[cols].copy(), "backcast_cache"

    from_latest = pd.DataFrame()
    latest = load_client_perf_latest()
    if latest is not None and not latest.empty and panel_covers_end(latest, end):
        have_latest = [t for t in want if t in latest.columns]
        if have_latest:
            from_latest = _slice_price_panel(latest, start, end, have_latest)
            if len(have_latest) == len(want) and not from_latest.empty:
                return from_latest.copy(), "client_perf_latest"

    bundled = _load_bundled_prices_panel()
    bundled_cols = (
        [c for c in want if c in bundled.columns] if bundled is not None else []
    )
    bundled_slice = pd.DataFrame()
    if bundled is not None and bundled_cols:
        s = bundled.loc[:, bundled_cols].copy()
        s = s.loc[(s.index >= pd.Timestamp(start)) & (s.index <= pd.Timestamp(end))]
        bundled_slice = s

    have = set(from_latest.columns) | set(bundled_slice.columns)
    need = [t for t in want if t not in have]
    yf = _download_yfinance_closes(need, start, end) if need else pd.DataFrame()
    # Latest panel first so its more-recent dates win over bundled duplicates.
    panel = _merge_price_panels(from_latest, bundled_slice, yf)
    if panel.empty:
        raise ValueError("no price data from bundled panel or yfinance")
    panel = panel.replace([np.inf, -np.inf], np.nan).sort_index()
    _save_cached_prices(cpath, panel)
    if not from_latest.empty and yf.empty:
        source = "client_perf_latest"
        if bundled_cols:
            source = "client_perf_latest+bundled_parquet"
    elif yf.empty:
        source = "bundled_parquet"
    elif bundled_cols or not from_latest.empty:
        source = "bundled_parquet+yfinance"
    else:
        source = "yfinance"
    return panel, source


def monthly_returns_from_closes(closes: pd.DataFrame) -> pd.DataFrame:
    """Month-end last close → simple monthly returns, indexed by Period[M]."""
    if closes.empty:
        return pd.DataFrame()
    month_end = closes.resample("ME").last()
    rets = month_end.pct_change()
    # pct_change row 0 is NaN for every column — drop it so peer fill never
    # treats the structurally-empty first month as a listing gap.
    rets = rets.iloc[1:]
    rets.index = rets.index.to_period("M")
    return rets


def _universe_meta_by_ticker() -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    for item in load_universe_file().get("universe", []):
        t = str(item.get("ticker", "")).strip().upper()
        if t:
            out[t] = {
                "category": str(item.get("category") or ""),
                "asset_class": str(item.get("asset_class") or ""),
            }
    return out


def _pick_peer(
    ticker: str,
    month: pd.Period,
    rets: pd.DataFrame,
    meta_by_ticker: dict[str, dict[str, str]],
    first_valid: dict[str, pd.Period],
    *,
    level: str,
) -> str | None:
    """Same-category (then asset-class) peer with a valid return in ``month``."""
    want = meta_by_ticker.get(ticker, {}).get(level, "")
    if not want:
        return None
    best: str | None = None
    for other in rets.columns:
        if other == ticker:
            continue
        if meta_by_ticker.get(other, {}).get(level, "") != want:
            continue
        v = rets.at[month, other] if month in rets.index else np.nan
        if not np.isfinite(v):
            continue
        if best is None or (first_valid[other], other) < (first_valid[best], best):
            best = other
    return best


def peer_fill_missing_months(
    rets: pd.DataFrame,
    *,
    meta_by_ticker: dict[str, dict[str, str]] | None = None,
) -> tuple[pd.DataFrame, dict[str, _PeerFill]]:
    """Fill pre-listing months from same-category peers (see module docstring)."""
    meta_by_ticker = meta_by_ticker or _universe_meta_by_ticker()
    if rets.empty:
        return rets, {}
    filled = rets.copy()
    first_valid: dict[str, pd.Period] = {}
    for col in rets.columns:
        s = rets[col].dropna()
        first_valid[col] = s.index[0] if not s.empty else pd.Period("9999-12", freq="M")

    window_start = rets.index[0]
    fills: dict[str, _PeerFill] = {}
    for col in rets.columns:
        fv = first_valid[col]
        if fv <= window_start:
            continue
        fill = _PeerFill()
        for month in rets.index:
            if month >= fv:
                break
            peer = _pick_peer(
                col, month, rets, meta_by_ticker, first_valid, level="category"
            ) or _pick_peer(
                col, month, rets, meta_by_ticker, first_valid, level="asset_class"
            )
            if peer is not None:
                filled.loc[month, col] = rets.at[month, peer]
                fill.proxy_by_month[str(month)] = peer
            else:
                # No peer covers this month — documented 0.0 fallback.
                filled.loc[month, col] = 0.0
                fill.proxy_by_month[str(month)] = "ZERO_FILL"
        if fill.months_filled:
            fills[col] = fill
    return filled, fills


def rebalance_stride_months(rule: str) -> int:
    """Monthly-grid rebalance stride for the project rebalance convention."""
    r = _normalize_rebalance_rule(rule)
    if r == "ME":
        return 1
    if r == "YE":
        return 12
    if r == "W-FRI":
        # Weekly has no meaning on a monthly grid — collapse to monthly.
        return 1
    return 3  # QE default


def simulate_monthly_backcast(
    rets: pd.DataFrame,
    target_weights: dict[str, float],
    *,
    rebalance_stride: int = 3,
    fee_rate: float = 0.001,
) -> list[dict[str, Any]]:
    """Monthly portfolio returns with drift between rebalances and turnover fees.

    ``target_weights`` are normalized here; CASH earns 0% and dilutes.
    """
    if rets.empty:
        return []
    tickers = list(rets.columns)
    total_w = sum(max(0.0, float(w)) for w in target_weights.values()) or 1.0
    target = np.array(
        [max(0.0, float(target_weights.get(t, 0.0))) / total_w for t in tickers]
    )
    cash_target = max(0.0, float(target_weights.get("CASH", 0.0))) / total_w
    invested = float(target.sum())
    if invested > 0:
        scale = max(0.0, 1.0 - cash_target) / invested
        target = target * scale
    else:
        cash_target = 1.0

    w = target.copy()
    cash_w = cash_target
    out: list[dict[str, Any]] = []
    n = len(rets.index)
    r_mat = np.nan_to_num(rets.to_numpy(dtype=float), nan=0.0)
    for i in range(n):
        r = r_mat[i]
        port_ret = float(np.dot(w, r))  # cash return is 0
        month = rets.index[i]

        v = w * (1.0 + r)
        total = float(v.sum() + cash_w)
        w_drifted = v / total if total > 0 else w.copy()
        cash_drifted = cash_w / total if total > 0 else cash_w

        fee = 0.0
        is_last = i == n - 1
        boundary = (month.month % max(1, int(rebalance_stride))) == 0
        if not is_last and boundary:
            turnover = float(
                np.abs(w_drifted - target).sum() + abs(cash_drifted - cash_target)
            )
            fee = float(fee_rate) * turnover
            port_ret -= fee
            w = target.copy()
            cash_w = cash_target
        else:
            w = w_drifted
            cash_w = cash_drifted

        out.append(
            {
                "month": str(month),
                "return": round(port_ret, 8),
                "rebalanced": bool(not is_last and boundary),
                "fee": round(fee, 10),
            }
        )
    return out


def _peer_candidate_tickers(
    late_tickers: list[str],
    already_loaded: set[str],
    meta_by_ticker: dict[str, dict[str, str]],
    *,
    per_ticker: int = 4,
) -> list[str]:
    """Universe tickers sharing category/asset class with late-listed holdings.

    These are fetched purely as proxy history for the missing months; they
    never receive portfolio weight. Capped to keep downloads bounded.
    """
    out: list[str] = []
    for t in late_tickers:
        meta = meta_by_ticker.get(t, {})
        picks: list[str] = []
        for level in ("category", "asset_class"):
            want = meta.get(level, "")
            if not want:
                continue
            same = sorted(
                o
                for o, m in meta_by_ticker.items()
                if o != t
                and m.get(level, "") == want
                and o not in already_loaded
                and o not in out
                and o not in picks
            )
            picks.extend(same[: 2 if level == "asset_class" else per_ticker])
            if len(picks) >= per_ticker:
                break
        out.extend(picks[:per_ticker])
    return out


def build_backcast_monthly_returns(
    weights: dict[str, float],
    *,
    years: int = DEFAULT_BACKCAST_YEARS,
    rebalance_rule: str = "QE",
    fee_bps: float = 10.0,
    end: str | None = None,
) -> BackcastBuild:
    """Top-level builder: closes → peer-filled monthly rebalanced series."""
    clean = {
        str(t).strip().upper(): max(0.0, float(w))
        for t, w in (weights or {}).items()
        if str(t).strip() and float(w) > 0
    }
    if not clean:
        raise ValueError("weights must contain at least one positive entry")
    tickers = [t for t in clean if t not in CASH_TICKERS]
    if not tickers:
        raise ValueError("weights are cash-only — nothing to backcast")

    years = int(max(3, min(MAX_BACKCAST_YEARS, int(years))))
    end_ts = pd.Timestamp(end) if end else pd.Timestamp.utcnow().normalize()
    start_ts = end_ts - pd.DateOffset(years=years)
    fetch_start = str((start_ts - pd.Timedelta(days=MONTH_START_WARMUP_DAYS)).date())
    end_str = str(end_ts.date())

    closes, data_source = _load_close_panel(tickers, fetch_start, end_str)
    closes = closes.dropna(how="all").ffill()
    usable = [
        c for c in closes.columns if closes[c].dropna().shape[0] >= MIN_VALID_CLOSES
    ]
    if not usable:
        raise ValueError("no constituent has enough price history to backcast")
    dropped = [t for t in tickers if t not in usable]
    closes = closes[usable]

    rets = monthly_returns_from_closes(closes)
    # Keep only months inside the requested window (warmup rows only feed pct_change).
    rets = rets.loc[rets.index >= start_ts.to_period("M")]
    rets = rets.dropna(how="all")
    if rets.empty:
        raise ValueError("no monthly returns inside the backcast window")

    meta_by_ticker = _universe_meta_by_ticker()
    window_start = rets.index[0]
    late = [
        c
        for c in rets.columns
        if (s := rets[c].dropna()).empty or s.index[0] > window_start
    ]
    peer_rets = pd.DataFrame()
    peers_loaded: list[str] = []
    if late:
        candidates = _peer_candidate_tickers(
            late, set(rets.columns), meta_by_ticker
        )
        if candidates:
            peer_closes, peer_source = _load_close_panel(
                candidates, fetch_start, end_str
            )
            peer_closes = peer_closes.dropna(how="all").ffill()
            if not peer_closes.empty:
                peer_rets = monthly_returns_from_closes(peer_closes)
                peer_rets = peer_rets.reindex(rets.index)
                peers_loaded = list(peer_rets.columns)
                if peer_source not in data_source:
                    data_source = f"{data_source}|peers:{peer_source}"

    combined = rets.join(peer_rets, how="left") if not peer_rets.empty else rets
    filled_all, fills = peer_fill_missing_months(
        combined, meta_by_ticker=meta_by_ticker
    )
    filled = filled_all[list(rets.columns)]
    fills = {t: f for t, f in fills.items() if t in set(rets.columns)}
    # A fill can only reference months a peer traded; residual NaNs → 0.
    residual_na = int(filled.isna().sum().sum())
    filled = filled.fillna(0.0)

    monthly = simulate_monthly_backcast(
        filled,
        {t: clean.get(t, 0.0) for t in list(filled.columns) + ["CASH"]},
        rebalance_stride=rebalance_stride_months(rebalance_rule),
        fee_rate=max(0.0, float(fee_bps)) / 10_000.0,
    )

    first_valid_month = {}
    for c in closes.columns:
        s = closes[c].dropna()
        first_valid_month[c] = (
            str(s.index[0].to_period("M")) if not s.empty else None
        )
    meta: dict[str, Any] = {
        "window": {"start": str(rets.index[0]), "end": str(rets.index[-1]), "months": len(rets)},
        "data_source": data_source,
        "rebalance_rule": _normalize_rebalance_rule(rebalance_rule),
        "fee_bps": float(fee_bps),
        "cash_weight": round(
            sum(w for t, w in clean.items() if t in CASH_TICKERS)
            / (sum(clean.values()) or 1.0),
            6,
        ),
        "first_valid_month": first_valid_month,
        "dropped_tickers": dropped,
        "proxy_fills": {
            t: {"proxies": f.proxies, "months_filled": f.months_filled}
            for t, f in fills.items()
        },
        "peer_tickers_loaded": peers_loaded,
        "residual_zero_filled_cells": residual_na,
        "assumptions": [
            "monthly total returns from month-end closes (yfinance auto-adjusted)",
            "late listings filled by same-category peer, else same asset class, else 0",
            "weights drift intra-period; reset to target per rebalance rule",
            "fee_bps charged on L1 turnover at rebalance (no expense-ratio data)",
            "cash sleeve earns 0% monthly",
        ],
    }
    return BackcastBuild(monthly=monthly, meta=meta)
