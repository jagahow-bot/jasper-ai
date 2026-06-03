"""Portfolio simulation (pandas-based, rebalance-aware)."""

from __future__ import annotations

import logging
from typing import Any, Callable

import numpy as np
import pandas as pd

from app.engine.spec import BacktestSpec, DEFAULT_SPEC
from app.engine.allocator import AllocatorParams, solve_weights
from app.engine.weights import (
    apply_min_holding_weight,
    audit_weight_cap,
    max_weight_violation_amount,
    min_holdings_for_cap,
    project_max_weight,
)

logger = logging.getLogger(__name__)
from app.engine.factors import FactorParams, pick_top_n, score_assets_with_details

WEIGHT_EPS = 1e-6
MAX_DAILY_RETURN = 0.25
MIN_ANNUAL_VOL = 0.03
MAX_REPORTED_SHARPE = 6.0


def split_train_validation(
    prices: pd.DataFrame, train_ratio: float
) -> tuple[pd.DataFrame, pd.DataFrame, str, str]:
    if train_ratio <= 0 or train_ratio >= 1:
        return prices, prices.iloc[0:0], str(prices.index[0].date()), str(prices.index[0].date())

    split_idx = max(int(len(prices) * train_ratio), 252)
    split_idx = min(split_idx, len(prices) - 126)
    train = prices.iloc[:split_idx]
    val = prices.iloc[split_idx:]
    train_end = str(train.index[-1].date())
    val_start = str(val.index[0].date())
    return train, val, train_end, val_start


def _align_weights(prices: pd.DataFrame, weights: np.ndarray) -> np.ndarray:
    w = np.asarray(weights, dtype=float)
    if len(w) != len(prices.columns):
        raise ValueError("Weights length does not match price columns")
    s = w.sum()
    if s < 1e-12:
        w = np.ones(len(w)) / len(w)
    else:
        w = w / s
    return w


def _normalize_rebalance_rule(rule: str) -> str:
    """Map UI aliases to pandas offset aliases."""
    r = (rule or "QE").strip().upper()
    aliases = {
        "M": "ME",
        "MONTHLY": "ME",
        "W": "W-FRI",
        "WEEKLY": "W-FRI",
        "WE": "W-FRI",
        "Q": "QE",
        "QUARTERLY": "QE",
        "Y": "YE",
        "YEARLY": "YE",
    }
    return aliases.get(r, r)


def _trading_day_rebalance_dates(index: pd.DatetimeIndex, rule: str) -> list[pd.Timestamp]:
    """Map calendar period-ends to actual trading days in the price index."""
    rule = _normalize_rebalance_rule(rule)
    if len(index) == 0:
        return []

    anchors = index.to_series().resample(rule).last().index
    dates: list[pd.Timestamp] = []
    for dt in anchors:
        loc = int(index.get_indexer([dt], method="ffill")[0])
        if loc < 0:
            continue
        dates.append(index[loc])

    # Unique, sorted; skip duplicate of first day (initial allocation handled separately)
    out: list[pd.Timestamp] = []
    seen: set[pd.Timestamp] = set()
    for dt in sorted(dates):
        if dt in seen:
            continue
        seen.add(dt)
        if dt == index[0]:
            continue
        out.append(dt)
    return out


def _rebalance_schedule(
    prices: pd.DataFrame, weights: np.ndarray, rule: str
) -> pd.DataFrame:
    w = _align_weights(prices, weights)
    schedule = pd.DataFrame(index=prices.index, columns=prices.columns, dtype=float)
    schedule.iloc[0] = w

    for dt in _trading_day_rebalance_dates(prices.index, rule):
        if dt in schedule.index:
            schedule.loc[dt] = w

    return schedule.ffill()


def _safe_returns(prices: pd.DataFrame) -> pd.DataFrame:
    rets = prices.pct_change().fillna(0.0)
    return rets.clip(-MAX_DAILY_RETURN, MAX_DAILY_RETURN)


def _estimate_mu_sigma(
    rets: pd.DataFrame, *, lookback_days: int, end_loc: int
) -> tuple[np.ndarray, np.ndarray]:
    ann = 252.0
    start = max(0, end_loc - int(lookback_days))
    window = rets.iloc[start:end_loc]
    if len(window) < 60:
        raise ValueError("Not enough lookback data")
    mu = window.mean(axis=0).to_numpy(dtype=float) * ann
    cov = window.cov(ddof=1).to_numpy(dtype=float) * ann
    return mu, cov


def _finalize_rebalance_weights(
    w: np.ndarray,
    w_prev: np.ndarray,
    *,
    max_weight: float,
    no_trade_tol: float,
    max_turnover: float | None,
) -> np.ndarray:
    """Apply no-trade band, turnover cap, then cap projection until stable."""
    tol = float(max(no_trade_tol, 0.0))
    if tol > 0.0:
        diff = np.abs(w - w_prev)
        w = np.where(diff < tol, w_prev, w)
    if max_turnover is not None and max_turnover > 0:
        w = _apply_max_turnover(w, w_prev, max_turnover)
    for _ in range(8):
        w_next = project_max_weight(w, max_weight)
        if max_weight_violation_amount(w_next, max_weight) <= 1e-6:
            return w_next
        if float(np.max(np.abs(w_next - w))) < 1e-8:
            return w_next
        w = w_next
    return project_max_weight(w, max_weight)


def _apply_max_turnover(w_new: np.ndarray, w_prev: np.ndarray, max_turnover: float) -> np.ndarray:
    """Hard cap on one-way turnover at a rebalance (L1 distance)."""
    cap = float(max(max_turnover, 0.0))
    if cap <= 0.0:
        return w_prev.copy()
    delta = w_new - w_prev
    turnover = float(np.abs(delta).sum())
    if turnover <= cap + 1e-12:
        return w_new
    scale = cap / turnover
    w = np.maximum(w_prev + delta * scale, 0.0)
    s = float(w.sum())
    return w / s if s > 1e-12 else w_prev.copy()


def _normalize_class_budget(class_budget: dict[str, float] | None) -> dict[str, float]:
    if not class_budget:
        return {}
    clean: dict[str, float] = {}
    for k, v in class_budget.items():
        vv = float(max(v, 0.0))
        if vv > 0:
            clean[str(k)] = vv
    s = float(sum(clean.values()))
    if s < 1e-12:
        return {}
    return {k: v / s for k, v in clean.items()}


def _pick_top_n_with_budget(
    scores: pd.Series,
    *,
    top_n: int,
    tickers: list[str],
    universe_by_ticker: dict[str, dict[str, Any]] | None,
    class_budget: dict[str, float] | None,
) -> list[str]:
    n = int(max(1, top_n))
    if not universe_by_ticker or not class_budget:
        return pick_top_n(scores, n)

    # Only top-level sleeves (equity, bond, …) — not regional sub-keys.
    top_level = ("equity", "bond", "commodity", "real_estate", "alternative")
    budget = _normalize_class_budget(
        {k: v for k, v in (class_budget or {}).items() if k in top_level and float(v) > 0}
    )
    if not budget:
        return pick_top_n(scores, n)

    allowed_classes = set(budget.keys())

    per_class: dict[str, list[str]] = {}
    for t in tickers:
        meta = universe_by_ticker.get(t, {}) or {}
        ac = str(meta.get("asset_class", "other"))
        if ac not in allowed_classes:
            continue
        per_class.setdefault(ac, []).append(t)

    ordered = scores.sort_values(ascending=False)
    # Restrict candidate pool to allowed asset classes only.
    eligible = [t for t in ordered.index if t in tickers and str(
        (universe_by_ticker.get(t, {}) or {}).get("asset_class", "other")
    ) in allowed_classes]
    if not eligible:
        return pick_top_n(scores, n)

    chosen: list[str] = []
    chosen_set: set[str] = set()

    targets: dict[str, int] = {}
    for ac, w in budget.items():
        cap = len(per_class.get(ac, []))
        if cap <= 0:
            continue
        targets[ac] = min(cap, int(np.floor(n * w)))
    assigned = sum(targets.values())

    while assigned < n:
        candidates = sorted(
            ((ac, w) for ac, w in budget.items() if len(per_class.get(ac, [])) > targets.get(ac, 0)),
            key=lambda x: x[1],
            reverse=True,
        )
        if not candidates:
            break
        ac = candidates[0][0]
        targets[ac] = targets.get(ac, 0) + 1
        assigned += 1

    for ac, k in targets.items():
        if k <= 0:
            continue
        members = [t for t in eligible if t in set(per_class.get(ac, []))]
        for t in members:
            if len(chosen) >= n:
                break
            if t not in chosen_set:
                chosen.append(t)
                chosen_set.add(t)

    # Fill remainder only within allowed classes (never spill to filtered-out sleeves).
    for t in eligible:
        if len(chosen) >= n:
            break
        if t not in chosen_set:
            chosen.append(t)
            chosen_set.add(t)
    return chosen[:n]


def _ensure_chosen_respects_cap(
    scores: pd.Series,
    chosen: list[str],
    *,
    max_weight: float,
    top_n: int,
    tickers: list[str],
) -> list[str]:
    """Ensure enough names for a feasible cap (sum=1, each <= max_weight)."""
    min_names = min(min_holdings_for_cap(max_weight, floor=2), len(tickers))
    min_names = max(min_names, 2)
    if len(chosen) >= min_names:
        return chosen
    ordered = scores.sort_values(ascending=False)
    pool = [t for t in ordered.index if t in tickers]
    if not pool:
        pool = list(tickers)
    out: list[str] = []
    seen: set[str] = set()
    for t in chosen:
        if t not in seen:
            out.append(t)
            seen.add(t)
    for t in pool:
        if len(out) >= max(int(top_n), min_names):
            break
        if t not in seen:
            out.append(t)
            seen.add(t)
    if len(out) < 2 and len(tickers) >= 2:
        return list(tickers)[: max(int(top_n), min_names)]
    return out[: max(int(top_n), min_names)]


def _rebalance_schedule_dynamic(
    prices: pd.DataFrame,
    *,
    rule: str,
    max_weight: float,
    min_weight: float = 0.0,
    allocator: AllocatorParams,
    top_n: int,
    factor_params: FactorParams,
    no_trade_tol: float,
    max_turnover: float | None = None,
    universe_by_ticker: dict[str, dict[str, Any]] | None = None,
    class_budget: dict[str, float] | None = None,
    allocator_resolver: Callable[[pd.Timestamp], AllocatorParams] | None = None,
    factor_params_resolver: Callable[[pd.Timestamp], FactorParams] | None = None,
) -> tuple[pd.DataFrame, np.ndarray, np.ndarray, list[pd.Timestamp], int, dict[str, Any]]:
    rets = _safe_returns(prices)
    n = len(prices.columns)
    cap_audit_rows: list[dict[str, Any]] = []

    schedule = pd.DataFrame(
        index=prices.index, columns=prices.columns, dtype=float
    )
    w = project_max_weight(np.ones(n) / max(n, 1), max_weight)
    w = apply_min_holding_weight(w, min_weight, max_weight=max_weight)
    schedule.iloc[0] = w
    cap_audit_rows.append(
        audit_weight_cap(
            w,
            max_weight,
            date=str(prices.index[0].date()),
            tradable_count=n,
        )
    )

    rebalance_dates = _trading_day_rebalance_dates(prices.index, rule)
    col_index = {t: i for i, t in enumerate(prices.columns)}
    w_prev = w.copy()
    applied_rebalances = 0
    factor_abs_sum = {
        "momentum": 0.0,
        "reversal": 0.0,
        "value": 0.0,
        "lowvol": 0.0,
        "trend": 0.0,
        "drawdown": 0.0,
    }
    factor_obs = 0
    factor_logic: dict[str, str] = {}
    for dt in rebalance_dates:
        if dt not in schedule.index:
            continue
        loc = int(prices.index.get_loc(dt))
        end_loc = max(loc, 1)  # exclude rebalance day
        alloc_step = allocator_resolver(dt) if allocator_resolver else allocator
        factor_step = (
            factor_params_resolver(dt) if factor_params_resolver else factor_params
        )
        updated = False
        try:
            # Factor selection (cross-sectional) over factor lookback.
            f_lb = int(
                max(
                    factor_step.lookback_days,
                    factor_step.reversal_lookback_days,
                    factor_step.value_lookback_days,
                    60,
                )
            )
            f_start = max(0, end_loc - f_lb)
            px_w = prices.iloc[f_start:end_loc]
            rt_w = rets.iloc[f_start:end_loc]
            scores, factor_detail = score_assets_with_details(px_w, rt_w, factor_step)
            factor_logic = factor_detail.get("indicator_logic", {}) or factor_logic
            chosen = _pick_top_n_with_budget(
                scores,
                top_n=min(int(top_n), len(scores)),
                tickers=list(prices.columns),
                universe_by_ticker=universe_by_ticker,
                class_budget=class_budget,
            )
            chosen = _ensure_chosen_respects_cap(
                scores,
                chosen,
                max_weight=max_weight,
                top_n=min(int(top_n), len(scores)),
                tickers=list(prices.columns),
            )
            for fk, s in factor_detail.get("contrib", {}).items():
                try:
                    sv = s.reindex(chosen).astype(float)
                    factor_abs_sum[fk] = factor_abs_sum.get(fk, 0.0) + float(np.mean(np.abs(sv.to_numpy())))
                except Exception:
                    continue
            factor_obs += 1

            # Allocation solve on the chosen subset using allocator lookback.
            mu, cov = _estimate_mu_sigma(
                rets[chosen], lookback_days=alloc_step.lookback_days, end_loc=end_loc
            )
            w_sub_prev = w[[col_index[t] for t in chosen]]
            w_sub = solve_weights(
                mu_annual=mu,
                cov_annual=cov,
                max_weight=max_weight,
                params=alloc_step,
                w0=w_sub_prev,
            )
            w = np.zeros(n, dtype=float)
            for i, t in enumerate(chosen):
                w[col_index[t]] = float(w_sub[i])
            w = project_max_weight(w, max_weight)
            w = _finalize_rebalance_weights(
                w,
                w_prev,
                max_weight=max_weight,
                no_trade_tol=no_trade_tol,
                max_turnover=max_turnover,
            )
            w = apply_min_holding_weight(w, min_weight, max_weight=max_weight)
            row_audit = audit_weight_cap(
                w,
                max_weight,
                date=str(dt.date()),
                tradable_count=n,
            )
            cap_audit_rows.append(row_audit)
            if row_audit.get("violation"):
                logger.warning(
                    "max_weight cap violated after rebalance on %s: observed=%.4f cap=%.4f "
                    "(top_n=%s tradable=%s)",
                    row_audit.get("date"),
                    row_audit.get("max_observed_weight"),
                    row_audit.get("max_weight_param"),
                    top_n,
                    n,
                )
            updated = True
        except Exception:
            pass
        schedule.loc[dt] = w
        w_prev = w.copy()
        if updated:
            applied_rebalances += 1

    schedule = schedule.ffill()
    last_w = schedule.iloc[-1].to_numpy(dtype=float)
    avg_w = schedule.mean(axis=0).to_numpy(dtype=float)
    attribution = {}
    total_abs = float(sum(max(v, 0.0) for v in factor_abs_sum.values()))
    if total_abs > 1e-12:
        attribution = {k: float(v / total_abs) for k, v in factor_abs_sum.items()}
    max_observed = float(last_w.max()) if len(last_w) else 0.0
    worst_row = max(
        cap_audit_rows,
        key=lambda r: float(r.get("max_observed_weight", 0.0)),
        default={},
    )
    violations = [r for r in cap_audit_rows if r.get("violation")]
    summary = {
        "factor_contribution": attribution,
        "factor_indicator_logic": factor_logic,
        "factor_observations": int(factor_obs),
        "weight_cap_audit": {
            "max_weight_param": round(float(max_weight), 6),
            "max_observed_weight": round(max_observed, 6),
            "worst_date": worst_row.get("date"),
            "worst_observed_weight": worst_row.get("max_observed_weight"),
            "violation_count": len(violations),
            "first_violation_date": violations[0].get("date") if violations else None,
            "feasible": len(violations) == 0 and not worst_row.get("violation", False),
            "min_holdings_for_cap": min_holdings_for_cap(max_weight, floor=2),
            "min_weight_param": round(float(min_weight), 6),
            "tradable_count": n,
            "rebalance_snapshots": cap_audit_rows[-24:],
        },
    }
    return schedule, last_w, avg_w, rebalance_dates, applied_rebalances, summary


def _compute_metrics(port_ret: pd.Series, equity: pd.Series, spec: BacktestSpec) -> dict[str, Any]:
    port_ret = port_ret.dropna()
    if len(port_ret) < 60:
        raise ValueError("Backtest window too short for reliable metrics")

    ann = 252
    daily_rf = (1.0 + spec.risk_free_rate) ** (1.0 / ann) - 1.0
    excess = port_ret - daily_rf

    vol = float(excess.std(ddof=1) * np.sqrt(ann))
    vol = max(vol, MIN_ANNUAL_VOL)

    sharpe_raw = float(np.sqrt(ann) * excess.mean() / excess.std(ddof=1)) if excess.std(ddof=1) > 1e-10 else 0.0
    sharpe = float(np.clip(sharpe_raw, -MAX_REPORTED_SHARPE, MAX_REPORTED_SHARPE))

    dd = float((equity / equity.cummax() - 1.0).min())
    years = max(len(equity) / ann, 1e-6)
    cagr = float(equity.iloc[-1] ** (1.0 / years) - 1.0)

    # Downside risk / Sortino
    downside = excess[excess < 0]
    downside_std = float(downside.std(ddof=1)) if len(downside) > 1 else 0.0
    sortino_raw = float(np.sqrt(ann) * excess.mean() / downside_std) if downside_std > 1e-10 else 0.0
    sortino = float(np.clip(sortino_raw, -20.0, 20.0))

    # Calmar
    calmar = float(cagr / abs(dd)) if abs(dd) > 1e-12 else 0.0
    calmar = float(np.clip(calmar, -50.0, 50.0))

    # VaR / CVaR (historical)
    q = float(excess.quantile(0.05))
    var_95 = q
    cvar_95 = float(excess[excess <= q].mean()) if (excess <= q).any() else q

    # Win rate and best/worst day
    win_rate = float((port_ret > 0).mean())
    best_day = float(port_ret.max())
    worst_day = float(port_ret.min())

    # Max drawdown duration (in days)
    peak = equity.cummax()
    underwater = equity / peak - 1.0
    in_dd = underwater < 0
    max_dd_dur = 0
    cur = 0
    for v in in_dd.to_numpy(dtype=bool):
        if v:
            cur += 1
            if cur > max_dd_dur:
                max_dd_dur = cur
        else:
            cur = 0

    suspect = bool(
        abs(sharpe_raw) > MAX_REPORTED_SHARPE
        or abs(dd) < 0.001
        or vol < MIN_ANNUAL_VOL + 0.01
    )

    return {
        "sharpe": sharpe,
        "sharpe_raw": sharpe_raw,
        "max_drawdown": dd,
        "cagr": cagr,
        "volatility": vol,
        "sortino": sortino,
        "sortino_raw": sortino_raw,
        "calmar": calmar,
        "var_95": float(var_95),
        "cvar_95": float(cvar_95),
        "win_rate": float(win_rate),
        "best_day": float(best_day),
        "worst_day": float(worst_day),
        "max_drawdown_duration_days": int(max_dd_dur),
        "metrics_suspect": suspect,
    }


def _simulate_pandas(
    prices: pd.DataFrame,
    weights: np.ndarray,
    spec: BacktestSpec,
    *,
    dynamic: bool = False,
    max_weight: float = 0.1,
    min_weight: float = 0.0,
    allocator: AllocatorParams | None = None,
    allocator_resolver: Callable[[pd.Timestamp], AllocatorParams] | None = None,
    top_n: int = 30,
    factor_params: FactorParams | None = None,
    factor_params_resolver: Callable[[pd.Timestamp], FactorParams] | None = None,
    no_trade_tol: float = 0.0,
    turnover_penalty_mult: float = 1.0,
    max_turnover: float | None = None,
    universe_by_ticker: dict[str, dict[str, Any]] | None = None,
    class_budget: dict[str, float] | None = None,
) -> dict[str, Any]:
    if dynamic:
        alloc = allocator or AllocatorParams(mode="min_var")
        f_params = factor_params or FactorParams(lookback_days=alloc.lookback_days)
        schedule, last_w, avg_w, rebalance_dates, applied_rebalances, factor_summary = _rebalance_schedule_dynamic(
            prices,
            rule=spec.rebalance_rule,
            max_weight=max_weight,
            min_weight=min_weight,
            allocator=alloc,
            allocator_resolver=allocator_resolver,
            top_n=min(int(top_n), len(prices.columns)),
            factor_params=f_params,
            factor_params_resolver=factor_params_resolver,
            no_trade_tol=no_trade_tol,
            max_turnover=max_turnover,
            universe_by_ticker=universe_by_ticker,
            class_budget=class_budget,
        )
    else:
        schedule = _rebalance_schedule(prices, weights, spec.rebalance_rule)
        last_w = schedule.iloc[-1].to_numpy(dtype=float)
        avg_w = schedule.mean(axis=0).to_numpy(dtype=float)
        rebalance_dates = _trading_day_rebalance_dates(prices.index, spec.rebalance_rule)
        applied_rebalances = len(rebalance_dates)
        factor_summary = {}

    rets = _safe_returns(prices)

    lagged = schedule.shift(1)
    lagged.iloc[0] = schedule.iloc[0]

    port_ret = (rets * lagged).sum(axis=1)
    turnover = schedule.diff().abs().sum(axis=1).fillna(0.0)
    port_ret = port_ret - turnover * spec.fee_rate * float(turnover_penalty_mult)
    port_ret = port_ret.clip(-MAX_DAILY_RETURN, MAX_DAILY_RETURN)

    equity = (1.0 + port_ret).cumprod()
    if not np.isfinite(equity.iloc[-1]) or equity.iloc[-1] <= 0:
        raise ValueError("Invalid equity curve (check price data)")

    metrics = _compute_metrics(port_ret, equity, spec)
    metrics["equity"] = equity
    metrics["last_weights"] = last_w
    metrics["avg_weights"] = avg_w
    metrics["turnover_avg"] = float(turnover.mean())
    metrics["turnover_median"] = float(turnover.median())
    metrics["turnover_total"] = float(turnover.sum())
    metrics["turnover_max"] = float(turnover.max())
    metrics["port_ret"] = port_ret
    metrics["rebalance_count"] = int(len(rebalance_dates))
    metrics["rebalance_applied"] = int(applied_rebalances)
    metrics["rebalance_skipped"] = int(max(len(rebalance_dates) - applied_rebalances, 0))
    metrics["rebalance_freq"] = _normalize_rebalance_rule(spec.rebalance_rule)
    metrics["rebalance_dates"] = [d.strftime("%Y-%m-%d") for d in rebalance_dates]
    metrics["factor_summary"] = factor_summary
    # Historical weights for UI: keep rebalance snapshots, focus on top sleeves.
    sch = schedule.fillna(0.0)
    max_s = sch.max(axis=0).sort_values(ascending=False)
    # Keep names that were ever meaningful sleeves, not only current holdings.
    # Chart sleeves: stable 2% peak-weight floor (not min_weight — that only affects allocation).
    hist_floor = 0.02
    keep_tickers = [t for t, v in max_s.items() if float(v) >= hist_floor]
    if len(keep_tickers) < 8:
        keep_tickers = list(max_s.head(min(12, len(max_s))).index)
    else:
        keep_tickers = keep_tickers[:14]
    hist_dates = [prices.index[0], *rebalance_dates]
    hist_unique = sorted(list(dict.fromkeys(hist_dates)))
    if len(hist_unique) > 36:
        step = max(1, len(hist_unique) // 36)
        hist_unique = hist_unique[::step]
    weight_history: list[dict[str, Any]] = []
    for dt in hist_unique:
        if dt not in schedule.index:
            continue
        row = {"date": dt.strftime("%Y-%m-%d")}
        w_row = schedule.loc[dt]
        keep_sum = 0.0
        for t in keep_tickers:
            v = float(w_row.get(t, 0.0))
            row[t] = v
            keep_sum += v
        row["OTHER"] = max(0.0, float(1.0 - keep_sum))
        weight_history.append(row)
    metrics["weight_history"] = weight_history
    metrics["weight_history_tickers"] = keep_tickers
    cap_audit = (factor_summary or {}).get("weight_cap_audit")
    if cap_audit:
        metrics["weight_cap_audit"] = cap_audit
    return metrics


def simulate_portfolio(
    prices: pd.DataFrame, weights: np.ndarray, spec: BacktestSpec = DEFAULT_SPEC
) -> dict[str, Any]:
    return _simulate_pandas(prices, weights, spec)


def simulate_dynamic_portfolio(
    prices: pd.DataFrame,
    *,
    spec: BacktestSpec = DEFAULT_SPEC,
    max_weight: float,
    min_weight: float = 0.0,
    allocator: AllocatorParams,
    top_n: int,
    factor_params: FactorParams | None = None,
    allocator_resolver: Callable[[pd.Timestamp], AllocatorParams] | None = None,
    factor_params_resolver: Callable[[pd.Timestamp], FactorParams] | None = None,
    no_trade_tol: float = 0.0,
    turnover_penalty_mult: float = 1.0,
    max_turnover: float | None = None,
    universe_by_ticker: dict[str, dict[str, Any]] | None = None,
    class_budget: dict[str, float] | None = None,
) -> dict[str, Any]:
    w0 = np.ones(len(prices.columns), dtype=float) / max(len(prices.columns), 1)
    return _simulate_pandas(
        prices,
        w0,
        spec,
        dynamic=True,
        max_weight=max_weight,
        min_weight=min_weight,
        allocator=allocator,
        allocator_resolver=allocator_resolver,
        top_n=top_n,
        factor_params=factor_params,
        factor_params_resolver=factor_params_resolver,
        no_trade_tol=no_trade_tol,
        turnover_penalty_mult=turnover_penalty_mult,
        max_turnover=max_turnover,
        universe_by_ticker=universe_by_ticker,
        class_budget=class_budget,
    )


def equity_curve_series(equity: pd.Series) -> list[dict[str, float | str]]:
    base = float(equity.iloc[0])
    if not np.isfinite(base) or base <= 0:
        base = 1.0
    normalized = equity / base * 100.0
    return [
        {"date": d.strftime("%Y-%m-%d"), "value": round(float(v), 4)}
        for d, v in normalized.items()
    ]


def benchmark_metrics(
    prices: pd.DataFrame, benchmark: str, spec: BacktestSpec = DEFAULT_SPEC
) -> dict[str, float] | None:
    if benchmark not in prices.columns:
        return None
    w = np.zeros(len(prices.columns))
    idx = list(prices.columns).index(benchmark)
    w[idx] = 1.0
    m = simulate_portfolio(prices, w, spec)
    return {
        "sharpe": round(float(m["sharpe"]), 3),
        "max_drawdown": round(float(m["max_drawdown"]), 3),
        "cagr": round(float(m["cagr"]), 3),
    }
