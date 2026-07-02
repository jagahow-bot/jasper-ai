"""Institutional-style performance analytics for backtest results."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from app.engine.spec import BacktestSpec

ANN = 252


def _round(x: float, n: int = 4) -> float:
    return round(float(x), n)


def benchmark_relative(
    port_ret: pd.Series,
    bench_ret: pd.Series,
    spec: BacktestSpec,
) -> dict[str, float]:
    """Alpha/Beta/TE/IR and up/down capture vs benchmark."""
    p, b = port_ret.align(bench_ret, join="inner")
    mask = p.notna() & b.notna()
    p = p[mask]
    b = b[mask]
    if len(p) < 60:
        return {}

    daily_rf = (1.0 + spec.risk_free_rate) ** (1.0 / ANN) - 1.0
    p_ex = p - daily_rf
    b_ex = b - daily_rf

    var_b = float(b_ex.var(ddof=1))
    beta = float(p_ex.cov(b_ex) / var_b) if var_b > 1e-12 else 0.0
    alpha_daily = float(p_ex.mean() - beta * b_ex.mean())
    alpha_ann = float(alpha_daily * ANN)

    active = p - b
    te = float(active.std(ddof=1) * np.sqrt(ANN))
    ir = float(active.mean() / active.std(ddof=1) * np.sqrt(ANN)) if active.std(ddof=1) > 1e-10 else 0.0

    up = b > 0
    down = b < 0
    up_capture = float(p[up].mean() / b[up].mean()) if up.any() and abs(b[up].mean()) > 1e-12 else 0.0
    down_capture = float(p[down].mean() / b[down].mean()) if down.any() and abs(b[down].mean()) > 1e-12 else 0.0

    corr = float(p.corr(b)) if p.std() > 1e-12 and b.std() > 1e-12 else 0.0

    return {
        "beta": _round(beta, 3),
        "alpha": _round(alpha_ann, 4),
        "alpha_annual": _round(alpha_ann, 4),
        "tracking_error": _round(te, 4),
        "information_ratio": _round(ir, 3),
        "up_capture": _round(up_capture, 3),
        "down_capture": _round(down_capture, 3),
        "correlation": _round(corr, 3),
    }


def periodic_returns(equity: pd.Series) -> dict[str, list[dict[str, Any]]]:
    """Monthly and annual compounded returns."""
    eq = equity.dropna()
    if len(eq) < 2:
        return {"monthly": [], "annual": []}

    monthly = eq.resample("ME").last().pct_change().dropna()
    annual = eq.resample("YE").last().pct_change().dropna()

    def _rows(s: pd.Series, fmt: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for dt, r in s.items():
            out.append({"period": dt.strftime(fmt), "return": _round(float(r), 4)})
        return out

    return {
        "monthly": _rows(monthly, "%Y-%m"),
        "annual": _rows(annual, "%Y"),
    }


def rolling_series(port_ret: pd.Series, window: int = ANN) -> dict[str, list[dict[str, Any]]]:
    """Rolling Sharpe and vol (sampled for payload size)."""
    r = port_ret.dropna()
    if len(r) < window + 5:
        return {"rolling_sharpe": [], "rolling_vol": []}

    roll_mean = r.rolling(window).mean()
    roll_std = r.rolling(window).std(ddof=1)
    roll_sharpe = (roll_mean / roll_std) * np.sqrt(ANN)
    roll_vol = roll_std * np.sqrt(ANN)

    def _sample(s: pd.Series) -> list[dict[str, Any]]:
        s = s.dropna()
        step = max(1, len(s) // 120)
        return [
            {"date": d.strftime("%Y-%m-%d"), "value": _round(float(v), 4)}
            for d, v in s.iloc[::step].items()
        ]

    return {
        "rolling_sharpe": _sample(roll_sharpe),
        "rolling_vol": _sample(roll_vol),
    }


def drawdown_table(equity: pd.Series, top_n: int = 10) -> list[dict[str, Any]]:
    """List drawdown episodes (peak -> trough -> recovery)."""
    eq = equity.dropna()
    if len(eq) < 2:
        return []

    peak = eq.cummax()
    dd = eq / peak - 1.0
    underwater = dd < 0

    episodes: list[dict[str, Any]] = []
    in_ep = False
    start = None
    trough_dt = None
    trough_val = 0.0
    peak_dt = None

    for dt, is_uw in underwater.items():
        if is_uw and not in_ep:
            in_ep = True
            start = dt
            peak_dt = peak.loc[:dt].idxmax() if dt in peak.index else dt
            trough_dt = dt
            trough_val = float(dd.loc[dt])
        elif is_uw and in_ep:
            if float(dd.loc[dt]) < trough_val:
                trough_val = float(dd.loc[dt])
                trough_dt = dt
        elif not is_uw and in_ep:
            episodes.append(
                {
                    "start": str(start.date()) if start else "",
                    "trough": str(trough_dt.date()) if trough_dt else "",
                    "end": str(dt.date()),
                    "depth": _round(trough_val, 4),
                    "days": int((dt - start).days) if start else 0,
                }
            )
            in_ep = False

    if in_ep and start is not None:
        episodes.append(
            {
                "start": str(start.date()),
                "trough": str(trough_dt.date()) if trough_dt else "",
                "end": "ongoing",
                "depth": _round(trough_val, 4),
                "days": int((eq.index[-1] - start).days),
            }
        )

    episodes.sort(key=lambda x: x["depth"])
    return episodes[:top_n]


def exposure_breakdown(
    weights: dict[str, float],
    universe_by_ticker: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Asset-class and equity/bond split from holdings."""
    by_class: dict[str, float] = {}
    by_bucket: dict[str, float] = {}
    equity_w = 0.0
    bond_w = 0.0
    other_w = 0.0

    for t, w in weights.items():
        meta = universe_by_ticker.get(t, {})
        ac = str(meta.get("asset_class", "other"))
        region = str(meta.get("region", "other"))
        bucket = f"{ac}:{region}"
        by_class[ac] = by_class.get(ac, 0.0) + float(w)
        by_bucket[bucket] = by_bucket.get(bucket, 0.0) + float(w)
        if ac == "equity":
            equity_w += float(w)
        elif ac == "bond":
            bond_w += float(w)
        else:
            other_w += float(w)

    # Duration proxy: bond weight * 5y equivalent (heuristic for ETF sleeves)
    duration_proxy = bond_w * 5.0

    return {
        "by_asset_class": {k: _round(v, 4) for k, v in sorted(by_class.items(), key=lambda x: -x[1])},
        "by_asset_bucket": {k: _round(v, 4) for k, v in sorted(by_bucket.items(), key=lambda x: -x[1])},
        "equity_pct": _round(equity_w, 4),
        "bond_pct": _round(bond_w, 4),
        "other_pct": _round(other_w, 4),
        "duration_proxy_years": _round(duration_proxy, 2),
    }


_REGIME_EXPOSURE_KEYS: tuple[str, ...] = ("risk_off", "neutral", "risk_on")


def _active_regime_on_date(date_str: str, timeline: list[dict[str, Any]]) -> str | None:
    active: str | None = None
    for row in timeline:
        row_date = str(row.get("date") or "")
        if row_date and row_date > date_str:
            break
        regime = row.get("active_regime") or row.get("regime")
        if regime:
            active = str(regime)
    return active


def exposure_by_regime_from_weight_history(
    weight_history: list[dict[str, Any]] | None,
    universe_by_ticker: dict[str, dict[str, Any]],
    regime_timeline: list[dict[str, Any]] | None,
) -> dict[str, dict[str, float]]:
    """Average asset-class mix on rebalance snapshots grouped by active regime."""
    if not weight_history or not regime_timeline:
        return {}
    buckets: dict[str, list[dict[str, float]]] = {r: [] for r in _REGIME_EXPOSURE_KEYS}
    for row in weight_history:
        date_str = str(row.get("date") or "")
        if not date_str:
            continue
        regime = _active_regime_on_date(date_str, regime_timeline)
        if regime not in buckets:
            continue
        weights = {
            str(k): float(v)
            for k, v in row.items()
            if k not in ("date", "OTHER") and float(v) > 1e-6
        }
        if not weights:
            continue
        by_class = exposure_breakdown(weights, universe_by_ticker).get(
            "by_asset_class", {}
        )
        if by_class:
            buckets[regime].append(by_class)
    out: dict[str, dict[str, float]] = {}
    for regime, snapshots in buckets.items():
        if not snapshots:
            continue
        classes = {cls for snap in snapshots for cls in snap}
        avg = {
            cls: float(sum(snap.get(cls, 0.0) for snap in snapshots) / len(snapshots))
            for cls in classes
        }
        out[regime] = {
            k: _round(v, 4) for k, v in sorted(avg.items(), key=lambda x: -x[1])
        }
    return out


def risk_contribution(
    weights: np.ndarray,
    tickers: list[str],
    cov_annual: np.ndarray,
) -> list[dict[str, Any]]:
    """Marginal risk contribution by holding."""
    w = np.asarray(weights, dtype=float)
    if w.sum() < 1e-12 or cov_annual.shape[0] != len(w):
        return []

    port_var = float(w @ cov_annual @ w)
    if port_var < 1e-12:
        return []

    mrc = cov_annual @ w
    rc = w * mrc / port_var

    rows = [
        {"ticker": tickers[i], "weight": _round(float(w[i]), 4), "risk_contrib": _round(float(rc[i]), 4)}
        for i in range(len(tickers))
        if w[i] > 1e-4
    ]
    rows.sort(key=lambda x: -x["risk_contrib"])
    return rows[:30]


def build_slim_analytics(
    *,
    weights: dict[str, float],
    universe_by_ticker: dict[str, dict[str, Any]],
    factor_summary: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Lightweight analytics for non-champion candidates (no equity curves)."""
    return {
        "exposure": exposure_breakdown(weights, universe_by_ticker),
        "factor_summary": dict(factor_summary or {}),
    }


def build_full_analytics(
    *,
    port_ret: pd.Series,
    equity: pd.Series,
    bench_ret: pd.Series | None,
    spec: BacktestSpec,
    weights: dict[str, float],
    tickers: list[str],
    universe_by_ticker: dict[str, dict[str, Any]],
    prices: pd.DataFrame,
    periodic_equity: pd.Series | None = None,
    holdout_equity: pd.Series | None = None,
) -> dict[str, Any]:
    """Assemble institutional report bundle for one candidate."""
    rets = prices.pct_change().fillna(0.0).clip(-0.25, 0.25)
    window = rets.iloc[-min(252, len(rets)) :]
    cov = window.cov(ddof=1).to_numpy(dtype=float) * ANN
    w_vec = np.zeros(len(tickers))
    for i, t in enumerate(tickers):
        w_vec[i] = float(weights.get(t, 0.0))

    rel = benchmark_relative(port_ret, bench_ret, spec) if bench_ret is not None else {}
    eq_periodic = periodic_equity if periodic_equity is not None else equity
    periodic = periodic_returns(eq_periodic)
    periodic_scope = "in_sample" if periodic_equity is not None else "full_sample"
    rolling = rolling_series(port_ret)
    dd_eps = drawdown_table(equity)
    exposure = exposure_breakdown(weights, universe_by_ticker)
    rc = risk_contribution(w_vec, tickers, cov)

    underwater = equity / equity.cummax() - 1.0
    dd_series = [
        {"date": d.strftime("%Y-%m-%d"), "value": _round(float(v), 4)}
        for d, v in underwater.iloc[:: max(1, len(underwater) // 120)].items()
    ]

    out: dict[str, Any] = {
        "benchmark_relative": rel,
        "periodic_returns": periodic,
        "periodic_returns_scope": periodic_scope,
        "rolling": rolling,
        "drawdown_episodes": dd_eps,
        "drawdown_series": dd_series,
        "exposure": exposure,
        "risk_contribution": rc,
    }
    if holdout_equity is not None and len(holdout_equity.dropna()) >= 2:
        out["periodic_returns_holdout"] = periodic_returns(holdout_equity)
    return out
