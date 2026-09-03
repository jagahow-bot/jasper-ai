"""Portfolio simulation (pandas-based, rebalance-aware)."""

from __future__ import annotations

import logging
from typing import Any, Callable

import numpy as np
import pandas as pd

from app.engine.spec import BacktestSpec, DEFAULT_SPEC, effective_top_n, resolve_candidate_top_n
from app.engine.allocator import AllocatorParams
from app.engine.asset_class_policy import (
    CLASS_BUDGET_KEYS,
    enforce_class_weight_budget,
    normalize_class_budget,
    pick_top_n_by_class_slots,
    plan_class_slots,
)
from app.engine.weights import (
    apply_max_holdings,
    apply_min_holding_weight,
    audit_weight_cap,
    max_weight_violation_amount,
    min_holdings_for_cap,
    scale_invested_weights,
)
from app.engine.customization import (
    pin_must_include_into_chosen,
)
from app.engine.group_weights import GroupWeightBand, apply_group_weight_bands
from app.engine.stages.accessors import (
    apply_must_include_floor,
    deployment_fraction as stage_deployment_fraction,
    derive_must_include_tickers,
    min_holdings_for_customization,
    project_anchor_l1_drift,
    project_max_weight,
    score_assets_with_details,
    solve_weights,
    apply_max_turnover as stage_apply_max_turnover,
    trading_day_rebalance_dates as stage_trading_day_rebalance_dates,
)

logger = logging.getLogger(__name__)
from app.engine.factors import FactorParams, pick_top_n


def deployment_fraction(
    dt: pd.Timestamp,
    start: pd.Timestamp,
    months: int | None,
    tranches: int | None,
) -> float:
    """Fraction of the *target invested book* deployed by ``dt`` (0??).

    Lump-sum (months is None) returns 1.0. With DCA, day-0 is undeployed (0);
    equal tranches step up across ``months`` calendar months.

    Pure primitive ??orchestrators should prefer
    ``stages.accessors.deployment_fraction`` so the cash_schedule stage can swap.
    """
    if months is None or int(months) <= 0:
        return 1.0
    n_months = int(months)
    n_tranches = int(tranches) if tranches and int(tranches) > 0 else n_months
    n_tranches = max(1, n_tranches)
    elapsed = (int(dt.year) - int(start.year)) * 12 + (int(dt.month) - int(start.month))
    if elapsed < 0:
        return 0.0
    step = max(float(n_months) / float(n_tranches), 1e-9)
    k = int(elapsed // step)
    return float(min(1.0, max(0.0, k / float(n_tranches))))


def _apply_execution_overlay(
    schedule: pd.DataFrame, spec: BacktestSpec
) -> pd.DataFrame:
    """Scale fully-invested schedule rows by cash reserve ? DCA deployment fraction.

    Allocator still solves on sum(w)=1; this is the execution overlay so residual
    weight is true uninvested cash.
    """
    target = float(getattr(spec, "target_invested_frac", 1.0))
    months = getattr(spec, "deployment_months", None)
    if target >= 1.0 - 1e-12 and not months:
        return schedule
    start = pd.Timestamp(schedule.index[0])
    tranches = getattr(spec, "deployment_tranches", None)
    out = schedule.copy()
    for dt in out.index:
        dep = stage_deployment_fraction(pd.Timestamp(dt), start, months, tranches)
        frac = float(np.clip(dep * target, 0.0, 1.0))
        row = np.asarray(out.loc[dt].to_numpy(dtype=float), dtype=float)
        out.loc[dt] = scale_invested_weights(row, frac)
    return out


def scalar_float(value: Any) -> float:
    """Coerce numpy/pandas scalar-like values to float (never pass Series to float())."""
    if isinstance(value, pd.Series):
        if value.empty:
            return float("nan")
        return float(value.iloc[0])
    if isinstance(value, pd.DataFrame):
        if value.empty:
            return float("nan")
        return float(value.iloc[0, 0])
    if isinstance(value, np.ndarray):
        flat = value.ravel()
        return float(flat[0]) if flat.size else float("nan")
    if hasattr(value, "item"):
        try:
            return float(value.item())
        except (ValueError, TypeError):
            pass
    return float(value)


def _downsample_keep_endpoints(items: list[Any], cap: int) -> list[Any]:
    n = len(items)
    if n <= cap or cap <= 0:
        return list(items)
    if cap == 1:
        return [items[-1]]
    indices = {int(round(i * (n - 1) / (cap - 1))) for i in range(cap)}
    return [items[i] for i in sorted(indices)]

WEIGHT_EPS = 1e-6
MAX_DAILY_RETURN = 0.25
MIN_ANNUAL_VOL = 0.03
MAX_REPORTED_SHARPE = 6.0

# Stacked weight chart: cap Other at every rebalance snapshot (dynamic sleeve pick).
WEIGHT_CHART_OTHER_MAX = 0.10
WEIGHT_CHART_MIN_PCT = 0.001
WEIGHT_CHART_DEFAULT_TOP_N = 15
# Soft legend budget for UI perf; selection is not truncated below Other cap.
WEIGHT_CHART_TICKER_CAP = 40
# Rebalance snapshot rows sent to the holdings chart (ME ??1 row/month).
WEIGHT_HISTORY_SNAPSHOT_CAP = 72


def _max_other_weight_for_tickers(
    schedule: pd.DataFrame,
    hist_dates: list[pd.Timestamp],
    tickers: list[str] | set[str],
) -> float:
    keep = list(tickers)
    worst = 0.0
    for dt in hist_dates:
        if dt not in schedule.index:
            continue
        w_row = schedule.loc[dt]
        total = float(w_row.sum())
        if total < 1e-6:
            continue
        keep_sum = sum(float(w_row.get(t, 0.0)) for t in keep)
        worst = max(worst, max(0.0, total - keep_sum))
    return worst


def _sorted_weights_on_date(w_row: pd.Series) -> list[tuple[str, float]]:
    pairs = [
        (str(t), float(w))
        for t, w in w_row.items()
        if float(w) > WEIGHT_EPS and float(w) >= WEIGHT_CHART_MIN_PCT
    ]
    pairs.sort(key=lambda x: x[1], reverse=True)
    return pairs


def select_weight_chart_tickers(
    schedule: pd.DataFrame,
    hist_dates: list[pd.Timestamp],
    *,
    top_n: int = WEIGHT_CHART_DEFAULT_TOP_N,
) -> list[str]:
    """Return ALL tickers that ever had a meaningful weight ??no Other grouping."""
    del top_n

    keep_set: set[str] = set()
    for dt in hist_dates:
        if dt not in schedule.index:
            continue
        w_row = schedule.loc[dt]
        for t, fw in _sorted_weights_on_date(w_row):
            if fw >= WEIGHT_CHART_MIN_PCT:
                keep_set.add(t)

    if not keep_set:
        return []

    max_s = schedule.max(axis=0).sort_values(ascending=False)
    return [
        str(t)
        for t in max_s.index
        if str(t) in keep_set
    ]


def first_trading_day_on_or_after(index: pd.DatetimeIndex, start: str) -> pd.Timestamp:
    ts = pd.Timestamp(start)
    sub = index[index >= ts]
    if len(sub) == 0:
        raise ValueError(f"report_start {start} is after the last price row")
    return pd.Timestamp(sub[0])


def _schedule_weight_row(
    schedule: pd.DataFrame,
    dt: pd.Timestamp,
    keep_tickers: list[str],
    *,
    date_label: str | None = None,
) -> dict[str, Any]:
    """Build one weight-history snapshot from the rebalance schedule (as-of dt)."""
    idx = schedule.index
    snap_dt = pd.Timestamp(dt)
    if snap_dt not in idx:
        prior = idx[idx <= snap_dt]
        snap_dt = pd.Timestamp(prior[-1]) if len(prior) else pd.Timestamp(idx[0])
    w_row = schedule.loc[snap_dt]
    row = {"date": date_label or snap_dt.strftime("%Y-%m-%d")}
    keep_sum = 0.0
    for t in keep_tickers:
        v = float(w_row.get(t, 0.0))
        row[t] = v
        keep_sum += v
    row["CASH"] = max(0.0, float(1.0 - keep_sum))
    if "OTHER" in row:
        del row["OTHER"]
    return row


def ensure_weight_history_anchor(
    weight_history: list[dict[str, Any]] | None,
    schedule: pd.DataFrame,
    anchor: pd.Timestamp,
    keep_tickers: list[str],
    *,
    applied_on_or_after: list[pd.Timestamp] | None = None,
) -> list[dict[str, Any]]:
    """Prepend report-start weights when day-1 rebalance ran and snapshots start later."""
    wh = list(weight_history or [])
    anchor_str = anchor.strftime("%Y-%m-%d")
    if wh and str(wh[0].get("date", "")) <= anchor_str:
        return wh
    if not wh:
        return wh
    if applied_on_or_after is not None:
        anchor_ts = pd.Timestamp(anchor)
        if not any(
            pd.Timestamp(d) == anchor_ts
            for d in applied_on_or_after
            if pd.Timestamp(d) >= anchor_ts
        ):
            # Avoid warmup ffill placeholders (e.g. 100% benchmark sleeve) before first
            # report-window rebalance; UI forward-fills from the first real snapshot.
            return wh
    anchor_row = _schedule_weight_row(
        schedule, anchor, keep_tickers, date_label=anchor_str
    )
    if wh and str(wh[0].get("date", "")) == anchor_str:
        return wh
    return [anchor_row, *wh]


def anchor_weight_history_to_date(
    weight_history: list[dict[str, Any]] | None,
    anchor_date: str,
) -> list[dict[str, Any]]:
    """Forward-fill first snapshot to equity curve start (API response trim)."""
    wh = list(weight_history or [])
    if not anchor_date or not wh:
        return wh
    if str(wh[0].get("date", "")) <= anchor_date:
        return wh
    row = dict(wh[0])
    row["date"] = anchor_date
    return [row, *wh]


def trim_prices_to_report_window(prices: pd.DataFrame, report_start: str) -> pd.DataFrame:
    """Rows on/after the user's backtest start (metrics/UI window)."""
    anchor = first_trading_day_on_or_after(prices.index, report_start)
    return prices.loc[anchor:].copy()


def _cap_audit_rows_on_or_after_report(
    rows: list[dict[str, Any]], report_start: str | None
) -> list[dict[str, Any]]:
    """Drop warmup / prep-history audit rows before the user's report window."""
    if not report_start:
        return rows
    start = str(report_start)
    return [r for r in rows if str(r.get("date", "")) >= start]


def _summarize_weight_cap_audit(
    cap_audit_rows: list[dict[str, Any]],
    *,
    max_weight: float,
    min_weight: float,
    tradable_count: int,
    last_w: np.ndarray,
) -> dict[str, Any]:
    max_observed = float(last_w.max()) if len(last_w) else 0.0
    worst_row = max(
        cap_audit_rows,
        key=lambda r: float(r.get("max_observed_weight", 0.0)),
        default={},
    )
    violations = [r for r in cap_audit_rows if r.get("violation")]
    return {
        "max_weight_param": round(float(max_weight), 6),
        "max_observed_weight": round(max_observed, 6),
        "worst_date": worst_row.get("date"),
        "worst_observed_weight": worst_row.get("max_observed_weight"),
        "violation_count": len(violations),
        "first_violation_date": violations[0].get("date") if violations else None,
        "feasible": len(violations) == 0 and not worst_row.get("violation", False),
        "min_holdings_for_cap": min_holdings_for_cap(max_weight, floor=2),
        "min_weight_param": round(float(min_weight), 6),
        "tradable_count": tradable_count,
        "rebalance_snapshots": cap_audit_rows[-24:],
    }


def _apply_report_start_window(
    metrics: dict[str, Any],
    prices: pd.DataFrame,
    spec: BacktestSpec,
    report_start: str | None,
) -> dict[str, Any]:
    if not report_start:
        return metrics
    anchor = first_trading_day_on_or_after(prices.index, report_start)
    start_str = anchor.strftime("%Y-%m-%d")
    wh = [
        row
        for row in (metrics.get("weight_history") or [])
        if str(row.get("date", "")) >= start_str
    ]
    if anchor <= prices.index[0]:
        out = dict(metrics)
        out["weight_history"] = wh
        return out

    port_ret = metrics["port_ret"].loc[anchor:]
    equity_full = metrics["equity"]
    eq_base = scalar_float(equity_full.loc[anchor])
    if not np.isfinite(eq_base) or eq_base <= 0:
        eq_base = 1.0
    equity = equity_full.loc[anchor:] / eq_base

    sliced = _compute_metrics(port_ret, equity, spec)
    out = dict(metrics)
    out.update(sliced)
    out["equity"] = equity
    out["port_ret"] = port_ret
    out["weight_history"] = wh
    return out


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


def _rebalance_counts_for_scope(
    rebalance_dates: list[pd.Timestamp],
    applied_rebalance_dates: list[pd.Timestamp],
    *,
    report_start: str | None,
    prices: pd.DataFrame,
) -> tuple[int, int, int]:
    """Scheduled/applied/skipped within the user's report window when report_start is set."""
    if not report_start:
        n_sched = len(rebalance_dates)
        n_applied = len(applied_rebalance_dates)
        return n_sched, n_applied, max(n_sched - n_applied, 0)
    anchor = first_trading_day_on_or_after(prices.index, report_start)
    sched = [d for d in rebalance_dates if d >= anchor]
    applied = [d for d in applied_rebalance_dates if d >= anchor]
    return len(sched), len(applied), max(len(sched) - len(applied), 0)


def _inject_report_start_rebalance_dates(
    rebalance_dates: list[pd.Timestamp],
    index: pd.DatetimeIndex,
    report_start: str | None,
) -> list[pd.Timestamp]:
    """Rebalance on the first trading day on/after the user's report window."""
    if not report_start:
        return rebalance_dates
    try:
        anchor = first_trading_day_on_or_after(index, report_start)
    except ValueError:
        return rebalance_dates
    return sorted(list(dict.fromkeys([*rebalance_dates, anchor])))


def _trading_day_rebalance_dates(index: pd.DatetimeIndex, rule: str) -> list[pd.Timestamp]:
    """Map calendar period-ends to actual trading days in the price index."""
    rule = _normalize_rebalance_rule(rule)
    if len(index) == 0:
        return []

    anchors = index.to_series().resample(rule).last().index
    dates: list[pd.Timestamp] = []
    for dt in anchors:
        loc = int(np.atleast_1d(index.get_indexer([dt], method="ffill"))[0])
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

    for dt in stage_trading_day_rebalance_dates(prices.index, rule):
        if dt in schedule.index:
            schedule.loc[dt] = w

    return schedule.ffill()


def _safe_returns(prices: pd.DataFrame) -> pd.DataFrame:
    rets = prices.pct_change().fillna(0.0)
    return rets.clip(-MAX_DAILY_RETURN, MAX_DAILY_RETURN)


def _simulate_buy_and_hold_path(
    rets: pd.DataFrame,
    target_schedule: pd.DataFrame,
    *,
    daily_rf: float,
    cash_mode: str,
    fee_rate: float,
    turnover_penalty_mult: float = 1.0,
    rebalance_dates: list[pd.Timestamp] | None = None,
) -> tuple[pd.Series, pd.Series]:
    """Portfolio path with true buy-and-hold drift between target changes.

    ``target_schedule`` holds *target* invested weights (ffill between rebalances /
    DCA steps). Between trades, asset weights and the cash sleeve drift with
    returns. A trade occurs on an explicit rebalance date and/or when the target
    row changes (e.g. DCA deployment step). That day's return still uses
    start-of-day (drifted) weights; after prices move, holdings are traded to the
    new target and a fee is charged on L1 turnover from drifted ??target
    (assets + cash), matching the prior fee accounting shape.
    """
    if len(rets) != len(target_schedule) or not rets.index.equals(target_schedule.index):
        raise ValueError("rets and target_schedule must share the same index")
    if list(rets.columns) != list(target_schedule.columns):
        raise ValueError("rets and target_schedule columns must match")

    asset_rets = rets.to_numpy(dtype=float)
    targets = target_schedule.to_numpy(dtype=float)
    n_days, n_assets = asset_rets.shape
    port = np.zeros(n_days, dtype=float)
    turnover = np.zeros(n_days, dtype=float)
    cash_r = float(daily_rf) if str(cash_mode) == "risk_free" else 0.0
    fee_mult = float(fee_rate) * float(turnover_penalty_mult)
    eps = 1e-12

    reb_set: set[pd.Timestamp] = set()
    if rebalance_dates:
        reb_set = {pd.Timestamp(d) for d in rebalance_dates}

    w = np.asarray(targets[0], dtype=float).copy()
    cash_w = float(np.clip(1.0 - float(np.sum(w)), 0.0, 1.0))

    for t in range(n_days):
        r_assets = asset_rets[t]
        risky = float(np.dot(w, r_assets))
        day_ret = risky + cash_w * cash_r

        # Drift shares / cash after the day's returns (buy-and-hold).
        v = w * (1.0 + r_assets)
        c = cash_w * (1.0 + cash_r)
        total = float(np.sum(v) + c)
        if total > eps:
            w = v / total
            cash_w = float(c / total)
        else:
            w = np.zeros(n_assets, dtype=float)
            cash_w = 1.0

        # End-of-day trade: scheduled rebalance and/or target step (DCA / new book).
        target_step = t > 0 and (
            float(np.max(np.abs(targets[t] - targets[t - 1]))) > eps
        )
        scheduled = t > 0 and pd.Timestamp(rets.index[t]) in reb_set
        turn = 0.0
        if target_step or scheduled:
            new_w = np.asarray(targets[t], dtype=float)
            new_cash = float(np.clip(1.0 - float(np.sum(new_w)), 0.0, 1.0))
            asset_turn = float(np.abs(new_w - w).sum())
            cash_turn = abs(new_cash - cash_w)
            turn = asset_turn + cash_turn
            w = new_w.copy()
            cash_w = new_cash

        turnover[t] = turn
        port[t] = day_ret - turn * fee_mult

    idx = rets.index
    return pd.Series(port, index=idx, dtype=float), pd.Series(
        turnover, index=idx, dtype=float
    )


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
        w = stage_apply_max_turnover(w, w_prev, max_turnover)
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
    return normalize_class_budget(class_budget)


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

    top_level = set(CLASS_BUDGET_KEYS.keys())
    budget = _normalize_class_budget(
        {k: v for k, v in (class_budget or {}).items() if k in top_level and float(v) > 0}
    )
    if not budget:
        return pick_top_n(scores, n)

    return pick_top_n_by_class_slots(
        scores,
        max_holdings=n,
        tickers=tickers,
        universe_by_ticker=universe_by_ticker,
        class_budget=budget,
        class_slots=plan_class_slots(n, budget),
    )


def _ensure_chosen_respects_cap(
    scores: pd.Series,
    chosen: list[str],
    *,
    max_weight: float,
    top_n: int,
    tickers: list[str],
    max_holdings: int | None = None,
) -> list[str]:
    """Ensure enough names for a feasible cap (sum=1, each <= max_weight)."""
    min_names = min(min_holdings_for_cap(max_weight, floor=2), len(tickers))
    min_names = max(min_names, 2)
    if max_holdings is not None:
        min_names = min(min_names, int(max_holdings))
    if len(chosen) >= min_names:
        out = chosen
        if max_holdings is not None:
            return out[: int(max_holdings)]
        return out
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
    limit = max(int(top_n), min_names)
    if max_holdings is not None:
        limit = min(limit, int(max_holdings))
    if len(out) < 2 and len(tickers) >= 2:
        return list(tickers)[:limit]
    return out[:limit]


def _rebalance_schedule_dynamic(
    prices: pd.DataFrame,
    *,
    rule: str,
    max_weight: float,
    min_weight: float = 0.0,
    allocator: AllocatorParams,
    top_n: int | None,
    factor_params: FactorParams,
    no_trade_tol: float,
    max_turnover: float | None = None,
    universe_by_ticker: dict[str, dict[str, Any]] | None = None,
    class_budget: dict[str, float] | None = None,
    class_budget_resolver: Callable[[pd.Timestamp], dict[str, float]] | None = None,
    enforce_class_weights: bool = True,
    allocator_resolver: Callable[[pd.Timestamp], AllocatorParams] | None = None,
    factor_params_resolver: Callable[[pd.Timestamp], FactorParams] | None = None,
    max_holdings: int | None = None,
    report_start: str | None = None,
    anchor_weights: dict[str, float] | None = None,
    customization_drift: float | None = None,
    must_include_tickers: list[str] | None = None,
    group_weight_bands: list[GroupWeightBand] | None = None,
    dividend_panel: pd.DataFrame | None = None,
) -> tuple[
    pd.DataFrame,
    np.ndarray,
    np.ndarray,
    list[pd.Timestamp],
    int,
    list[pd.Timestamp],
    dict[str, Any],
]:
    rets = _safe_returns(prices)
    n = len(prices.columns)
    cap_audit_rows: list[dict[str, Any]] = []

    # Align anchor weights with simulation columns for the drift constraint.
    anchor_w = np.zeros(n, dtype=float)
    if anchor_weights:
        for i, ticker in enumerate(prices.columns):
            anchor_w[i] = float(anchor_weights.get(str(ticker), 0.0))
        total = float(np.sum(anchor_w))
        if total > 0:
            anchor_w /= total
    drift = float(customization_drift) if customization_drift is not None else None
    must_include = derive_must_include_tickers(
        list(prices.columns),
        anchor_weights,
        explicit=must_include_tickers,
    )
    must_set = {str(t).upper() for t in must_include}
    if must_include or (drift is not None and anchor_weights):
        need_h = min_holdings_for_customization(
            n_must_include=len(must_include),
            max_weight=max_weight,
            customization_drift=drift,
            n_assets=n,
        )
        if max_holdings is None or int(max_holdings) < need_h:
            max_holdings = need_h

    schedule = pd.DataFrame(
        index=prices.index, columns=prices.columns, dtype=float
    )
    # Start at the (capped) anchor when present so skipped early rebalances
    # cannot leave an equal-weight book that already violates customization_drift.
    if anchor_weights and float(np.sum(anchor_w)) > 1e-12:
        w = project_max_weight(anchor_w.copy(), max_weight)
        if drift is not None:
            w = project_anchor_l1_drift(w, anchor_w, float(drift), max_weight)
    else:
        w = project_max_weight(np.ones(n) / max(n, 1), max_weight)
    w = apply_min_holding_weight(w, min_weight, max_weight=max_weight)
    if drift is not None and anchor_weights:
        # min-weight pass can reopen L1 slightly ??re-close before day-0.
        w = project_anchor_l1_drift(w, anchor_w, float(drift), max_weight)
    schedule.iloc[0] = w
    cap_audit_rows.append(
        audit_weight_cap(
            w,
            max_weight,
            date=str(prices.index[0].date()),
            tradable_count=n,
        )
    )

    rebalance_dates = stage_trading_day_rebalance_dates(prices.index, rule)
    rebalance_dates = _inject_report_start_rebalance_dates(
        rebalance_dates, prices.index, report_start
    )
    col_index = {t: i for i, t in enumerate(prices.columns)}
    w_prev = w.copy()
    applied_rebalances = 0
    applied_rebalance_dates: list[pd.Timestamp] = []
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
        budget_step = (
            class_budget_resolver(dt) if class_budget_resolver else class_budget
        )
        f_lb = int(
            max(
                factor_step.lookback_days,
                factor_step.reversal_lookback_days,
                factor_step.value_lookback_days,
                60,
            )
        )
        min_ready_loc = max(60, f_lb, int(alloc_step.lookback_days))
        if end_loc < min_ready_loc:
            logger.info(
                "Dynamic rebalance skipped on %s: insufficient lookback "
                "(%s trading days before rebalance, need %s)",
                dt.date() if hasattr(dt, "date") else dt,
                end_loc,
                min_ready_loc,
            )
            schedule.loc[dt] = w_prev
            continue
        updated = False
        try:
            # Factor selection (cross-sectional) over factor lookback.
            f_start = max(0, end_loc - f_lb)
            px_w = prices.iloc[f_start:end_loc]
            rt_w = rets.iloc[f_start:end_loc]
            div_w = None
            if dividend_panel is not None and not dividend_panel.empty:
                div_w = dividend_panel.iloc[f_start:end_loc]
            scores, factor_detail = score_assets_with_details(
                px_w, rt_w, factor_step, dividend_panel=div_w
            )
            factor_logic = factor_detail.get("indicator_logic", {}) or factor_logic
            sleeve_n = resolve_candidate_top_n(top_n, len(scores))
            chosen = _pick_top_n_with_budget(
                scores,
                top_n=sleeve_n,
                tickers=list(prices.columns),
                universe_by_ticker=universe_by_ticker,
                class_budget=budget_step,
            )
            chosen = _ensure_chosen_respects_cap(
                scores,
                chosen,
                max_weight=max_weight,
                top_n=sleeve_n,
                tickers=list(prices.columns),
                max_holdings=max_holdings,
            )
            # Confirmed overlay adds must remain in the investable set (not
            # silently dropped by Top-N / drift-floor swaps). Skip names that
            # still lack a finite price on this rebalance (late IPO / warmup).
            active_must = [
                t
                for t in must_include
                if t in col_index
                and np.isfinite(float(prices.iloc[max(end_loc - 1, 0), col_index[t]]))
            ]
            if active_must:
                sleeve_n = max(int(sleeve_n), len(active_must))
                if max_holdings is not None:
                    sleeve_n = max(sleeve_n, int(max_holdings))
                chosen = pin_must_include_into_chosen(
                    chosen,
                    active_must,
                    scores,
                    max_holdings=max_holdings,
                    n_assets=n,
                )
            # Anchor-drift floor: when a drift budget is active, the Top-N subset
            # must keep enough anchor names for the L1 drift constraint to be
            # attainable. Otherwise factor selection can drop every anchor
            # holding and no allocator output can stay within the agreed drift.
            if drift is not None and 0.0 < drift < 1.0 and anchor_weights:
                cap = float(max_weight)
                col_of = {t: col_index[t] for t in chosen if t in col_index}
                anchor_mass = (
                    float(sum(anchor_w[col_of[t]] for t in col_of)) if col_of else 0.0
                )
                # Under a per-name cap, each anchor ticker can contribute at most
                # `cap` to the final book; the subset must cover enough anchor
                # mass for (1 - drift) to remain attainable.
                required_anchor_mass = 1.0 - float(drift)
                non_chosen_anchor = [
                    (i, float(anchor_w[i]))
                    for i in range(n)
                    if str(prices.columns[i]) not in set(chosen) and anchor_w[i] > 0.0
                ]
                non_chosen_anchor.sort(key=lambda x: -x[1])
                # Never evict confirmed overlay adds to make room for anchors ??
                # expand holdings instead when possible.
                replaceable = sorted(
                    [
                        t
                        for t in chosen
                        if anchor_w[col_index[t]] <= 0.0
                        and str(t).upper() not in must_set
                    ],
                    key=lambda x: float(scores.get(x, 0.0)),
                )
                add: list[str] = []
                hold_cap = int(max_holdings) if max_holdings is not None else n
                if anchor_mass + 1e-9 < required_anchor_mass and len(chosen) < n:
                    need = required_anchor_mass - anchor_mass
                    for i, w_anchor in non_chosen_anchor:
                        if need <= 1e-9:
                            break
                        can_replace = len(add) < len(replaceable)
                        can_expand = len(chosen) + len(add) < hold_cap
                        if not can_replace and not can_expand:
                            break
                        add.append(str(prices.columns[i]))
                        need -= min(float(w_anchor), cap)
                # Even when raw anchor mass is sufficient, a cap can make the
                # drift floor unattainable if the subset holds too few anchor
                # names (each capped at `cap`). Ensure enough anchor slots.
                anchor_names_in_chosen = sum(
                    1 for t in chosen if anchor_w[col_index[t]] > 0.0
                )
                min_anchor_slots = int(np.ceil(required_anchor_mass / cap - 1e-9))
                while (
                    anchor_names_in_chosen < min_anchor_slots
                    and non_chosen_anchor
                    and len(add) < len(non_chosen_anchor)
                ):
                    can_replace = len(add) < len(replaceable)
                    can_expand = len(chosen) + len(add) < hold_cap
                    if not can_replace and not can_expand:
                        break
                    nxt = non_chosen_anchor[len(add)]
                    add.append(str(prices.columns[nxt[0]]))
                    anchor_names_in_chosen += 1
                if add:
                    n_drop = min(len(add), len(replaceable))
                    drop = set(replaceable[:n_drop])
                    # Extra adds beyond replaceable slots expand the book.
                    chosen = [t for t in chosen if t not in drop] + add

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
            chosen_indices = np.asarray([col_index[t] for t in chosen], dtype=int)
            w_sub_prev = np.atleast_1d(w[chosen_indices])
            w_sub_anchor = np.atleast_1d(anchor_w[chosen_indices])
            w_sub = solve_weights(
                mu_annual=mu,
                cov_annual=cov,
                max_weight=max_weight,
                params=alloc_step,
                w0=w_sub_prev,
                anchor_weights=w_sub_anchor,
                customization_drift=drift,
            )
            w_sub_flat = np.asarray(w_sub, dtype=float).ravel()
            w = np.zeros(n, dtype=float)
            for i, t in enumerate(chosen):
                w[col_index[t]] = float(w_sub_flat[i])
            w = project_max_weight(w, max_weight)
            active_must_indices = [
                col_index[t] for t in active_must if t in col_index
            ]
            # Soft must-hold: share the drift budget across overlay adds so they stay visible.
            if active_must_indices and drift is not None and drift > 0.0:
                floor = min(
                    float(max_weight),
                    float(drift) / max(len(active_must_indices), 1),
                )
                if min_weight > 0:
                    floor = max(floor, float(min_weight))
                w = apply_must_include_floor(
                    w,
                    active_must_indices,
                    floor=floor,
                    max_weight=max_weight,
                )
            w = _finalize_rebalance_weights(
                w,
                w_prev,
                max_weight=max_weight,
                no_trade_tol=no_trade_tol,
                max_turnover=max_turnover,
            )
            w = apply_min_holding_weight(w, min_weight, max_weight=max_weight)
            w = apply_max_holdings(
                w,
                max_holdings,
                max_weight=max_weight,
                prefer_keep=active_must_indices,
            )
            if active_must_indices and drift is not None and drift > 0.0:
                floor = min(
                    float(max_weight),
                    float(drift) / max(len(active_must_indices), 1),
                )
                if min_weight > 0:
                    floor = max(floor, float(min_weight))
                w = apply_must_include_floor(
                    w,
                    active_must_indices,
                    floor=floor,
                    max_weight=max_weight,
                )
            if (
                enforce_class_weights
                and budget_step
                and normalize_class_budget(budget_step)
            ):
                w = enforce_class_weight_budget(
                    w,
                    list(prices.columns),
                    universe_by_ticker,
                    budget_step,
                    active_tickers=chosen,
                    max_weight=max_weight,
                )
            if group_weight_bands:
                w = apply_group_weight_bands(
                    w,
                    list(prices.columns),
                    group_weight_bands,
                    max_weight=max_weight,
                )
            # Hard customization_drift last ??nothing after this may expand L1 vs anchor.
            if drift is not None and anchor_weights:
                w = project_anchor_l1_drift(w, anchor_w, float(drift), max_weight)
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
        except Exception as exc:
            logger.warning(
                "Dynamic rebalance skipped on %s: %s",
                dt.date() if hasattr(dt, "date") else dt,
                exc,
                exc_info=True,
            )
        schedule.loc[dt] = w
        w_prev = w.copy()
        if updated:
            applied_rebalances += 1
            applied_rebalance_dates.append(dt)

    schedule = schedule.ffill()
    last_w = schedule.iloc[-1].to_numpy(dtype=float)
    avg_w = schedule.mean(axis=0).to_numpy(dtype=float)
    attribution = {}
    total_abs = float(sum(max(v, 0.0) for v in factor_abs_sum.values()))
    if total_abs > 1e-12:
        attribution = {k: float(v / total_abs) for k, v in factor_abs_sum.items()}
    report_audit_rows = _cap_audit_rows_on_or_after_report(
        cap_audit_rows, report_start
    )
    summary = {
        "factor_contribution": attribution,
        "factor_indicator_logic": factor_logic,
        "factor_observations": int(factor_obs),
        "weight_cap_audit": _summarize_weight_cap_audit(
            report_audit_rows,
            max_weight=max_weight,
            min_weight=min_weight,
            tradable_count=n,
            last_w=last_w,
        ),
    }
    return (
        schedule,
        last_w,
        avg_w,
        rebalance_dates,
        applied_rebalances,
        applied_rebalance_dates,
        summary,
    )


def _port_ret_len(sim: dict[str, Any] | None) -> int:
    if sim is None:
        return 0
    port_ret = sim.get("port_ret")
    if port_ret is None:
        return 0
    if isinstance(port_ret, pd.Series):
        return len(port_ret)
    return len(pd.Series(port_ret, dtype=float))


def cached_full_path_needs_stitch(
    train_m: dict[str, Any] | None,
    val_m: dict[str, Any] | None,
    full_m: dict[str, Any] | None,
) -> bool:
    """True when cached full_m port_ret is shorter than IS+OOS (e.g. OOS-only stash)."""
    train_len = _port_ret_len(train_m)
    val_len = _port_ret_len(val_m)
    full_len = _port_ret_len(full_m)
    if train_len <= 0 or val_len <= 0 or full_len <= 0:
        return False
    return full_len < train_len + val_len


def stitch_full_path_from_slices(
    train_m: dict[str, Any] | None,
    val_m: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Chain IS + OOS port_ret into one continuous path for horizon metrics."""
    if train_m is None or val_m is None:
        return None
    train_ret = train_m.get("port_ret")
    val_ret = val_m.get("port_ret")
    if train_ret is None or val_ret is None:
        return None
    train_series = (
        train_ret if isinstance(train_ret, pd.Series) else pd.Series(train_ret, dtype=float)
    )
    val_series = (
        val_ret if isinstance(val_ret, pd.Series) else pd.Series(val_ret, dtype=float)
    )
    # Train simulates often run on the full panel from IS start, so trim overlap
    # before chaining; otherwise duplicate calendar dates break .loc scalar reads.
    val_start = val_series.index[0]
    last_train_day = train_series.index[-1]
    if train_series.index[0] < val_start <= last_train_day:
        train_only = train_series.loc[train_series.index < val_start]
    else:
        train_only = train_series
    port_ret = pd.concat([train_only.astype(float), val_series.astype(float)])
    equity = (1.0 + port_ret).cumprod()
    out: dict[str, Any] = {}
    for key in (
        "rebalance_count",
        "rebalance_applied",
        "rebalance_skipped",
        "rebalance_freq",
        "rebalance_dates",
        "factor_summary",
        "weight_cap_audit",
    ):
        if key in val_m:
            out[key] = val_m[key]
        elif key in train_m:
            out[key] = train_m[key]
    out["port_ret"] = port_ret
    out["equity"] = equity
    if val_m.get("last_weights") is not None:
        out["last_weights"] = val_m["last_weights"]
    elif train_m.get("last_weights") is not None:
        out["last_weights"] = train_m["last_weights"]
    # Prefer holdout terminal history so chart sync matches OOS last_weights.
    if val_m.get("weight_history"):
        out["weight_history"] = val_m.get("weight_history")
        if val_m.get("weight_history_tickers"):
            out["weight_history_tickers"] = val_m.get("weight_history_tickers")
    elif train_m.get("weight_history"):
        out["weight_history"] = train_m.get("weight_history")
        if train_m.get("weight_history_tickers"):
            out["weight_history_tickers"] = train_m.get("weight_history_tickers")
    return out


def metrics_for_horizon_window(
    sim: dict[str, Any],
    spec: BacktestSpec,
    start: int,
    end: int,
) -> dict[str, Any]:
    """Metrics on a slice of one simulate() path (equity re-based to 1 at window start).

    Used for IS/OOS horizon rows so they match the continuous full backtest, unlike
    separate fresh-start holdout simulates used only for trial ranking.
    """
    port_ret = sim["port_ret"]
    equity = sim["equity"]
    n = len(port_ret)
    if start < 0 or end > n or end <= start:
        raise ValueError("Invalid horizon window bounds")
    pr = port_ret.iloc[start:end]
    eq0 = scalar_float(equity.iloc[start])
    if eq0 <= 0 or not np.isfinite(eq0):
        raise ValueError("Invalid equity at horizon window start")
    eq = equity.iloc[start:end] / eq0
    return _compute_metrics(pr, eq, spec)


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
    cagr = scalar_float(equity.iloc[-1] ** (1.0 / years) - 1.0)

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
    top_n: int | None = 30,
    factor_params: FactorParams | None = None,
    factor_params_resolver: Callable[[pd.Timestamp], FactorParams] | None = None,
    no_trade_tol: float = 0.0,
    turnover_penalty_mult: float = 1.0,
    max_turnover: float | None = None,
    universe_by_ticker: dict[str, dict[str, Any]] | None = None,
    class_budget: dict[str, float] | None = None,
    class_budget_resolver: Callable[[pd.Timestamp], dict[str, float]] | None = None,
    enforce_class_weights: bool = True,
    report_start: str | None = None,
    anchor_weights: dict[str, float] | None = None,
    customization_drift: float | None = None,
    must_include_tickers: list[str] | None = None,
    group_weight_bands: list[GroupWeightBand] | None = None,
    dividend_panel: pd.DataFrame | None = None,
) -> dict[str, Any]:
    holdings_top_n = effective_top_n(top_n, spec, n_assets=len(prices.columns))
    if dynamic:
        alloc = allocator or AllocatorParams(mode="min_var")
        f_params = factor_params or FactorParams(lookback_days=alloc.lookback_days)
        (
            schedule,
            last_w,
            avg_w,
            rebalance_dates,
            applied_rebalances,
            applied_rebalance_dates,
            factor_summary,
        ) = _rebalance_schedule_dynamic(
            prices,
            rule=spec.rebalance_rule,
            max_weight=max_weight,
            min_weight=min_weight,
            allocator=alloc,
            allocator_resolver=allocator_resolver,
            top_n=holdings_top_n,
            max_holdings=int(spec.max_holdings),
            factor_params=f_params,
            factor_params_resolver=factor_params_resolver,
            no_trade_tol=no_trade_tol,
            max_turnover=max_turnover,
            universe_by_ticker=universe_by_ticker,
            class_budget=class_budget,
            class_budget_resolver=class_budget_resolver,
            enforce_class_weights=enforce_class_weights,
            report_start=report_start,
            anchor_weights=anchor_weights,
            customization_drift=customization_drift,
            must_include_tickers=must_include_tickers,
            group_weight_bands=group_weight_bands,
            dividend_panel=dividend_panel,
        )
    else:
        schedule = _rebalance_schedule(prices, weights, spec.rebalance_rule)
        last_w = schedule.iloc[-1].to_numpy(dtype=float)
        avg_w = schedule.mean(axis=0).to_numpy(dtype=float)
        rebalance_dates = stage_trading_day_rebalance_dates(prices.index, spec.rebalance_rule)
        applied_rebalance_dates = list(rebalance_dates)
        applied_rebalances = len(rebalance_dates)
        factor_summary = {}

    # Execution overlay: permanent cash sleeve + optional DCA deployment path.
    schedule = _apply_execution_overlay(schedule, spec)
    last_w = schedule.iloc[-1].to_numpy(dtype=float)
    avg_w = schedule.mean(axis=0).to_numpy(dtype=float)

    rets = _safe_returns(prices)
    daily_rf = (1.0 + float(spec.risk_free_rate)) ** (1.0 / 252.0) - 1.0
    cash_mode = str(getattr(spec, "cash_return_mode", "risk_free") or "risk_free")
    # Buy-and-hold drift between rebalance / DCA target steps (not constant-mix).
    # Use applied rebalance dates so skipped dynamic rebalances do not force a trade.
    port_ret, turnover = _simulate_buy_and_hold_path(
        rets,
        schedule,
        daily_rf=daily_rf,
        cash_mode=cash_mode,
        fee_rate=float(spec.fee_rate),
        turnover_penalty_mult=float(turnover_penalty_mult),
        rebalance_dates=applied_rebalance_dates,
    )
    port_ret = port_ret.clip(-MAX_DAILY_RETURN, MAX_DAILY_RETURN)

    equity = (1.0 + port_ret).cumprod()
    if not np.isfinite(equity.iloc[-1]) or equity.iloc[-1] <= 0:
        raise ValueError("Invalid equity curve (check price data)")

    metrics = _compute_metrics(port_ret, equity, spec)
    metrics["equity"] = equity
    metrics["last_weights"] = last_w
    metrics["avg_weights"] = avg_w
    metrics["cash_weight"] = float(max(0.0, 1.0 - float(np.sum(last_w))))
    metrics["turnover_avg"] = float(turnover.mean())
    metrics["turnover_median"] = float(turnover.median())
    metrics["turnover_total"] = float(turnover.sum())
    metrics["turnover_max"] = float(turnover.max())
    metrics["port_ret"] = port_ret
    metrics["deployment_months"] = getattr(spec, "deployment_months", None)
    metrics["cash_reserve_pct"] = float(getattr(spec, "cash_reserve_pct", 0.0) or 0.0)
    reb_count, reb_applied, reb_skipped = _rebalance_counts_for_scope(
        rebalance_dates,
        applied_rebalance_dates,
        report_start=report_start,
        prices=prices,
    )
    metrics["rebalance_count"] = int(reb_count)
    metrics["rebalance_applied"] = int(reb_applied)
    metrics["rebalance_skipped"] = int(reb_skipped)
    metrics["rebalance_freq"] = _normalize_rebalance_rule(spec.rebalance_rule)
    if report_start:
        anchor = first_trading_day_on_or_after(prices.index, report_start)
        scoped_dates = [d for d in rebalance_dates if d >= anchor]
    else:
        scoped_dates = rebalance_dates
    metrics["rebalance_dates"] = [d.strftime("%Y-%m-%d") for d in scoped_dates]
    metrics["factor_summary"] = factor_summary
    # Historical weights for UI: rebalance snapshots; dynamic sleeves (Other capped at 10%).
    sch = schedule.fillna(0.0)
    hist_anchor = (
        first_trading_day_on_or_after(prices.index, report_start)
        if report_start
        else prices.index[0]
    )
    # UI snapshots: only applied rebalances on/after report start (skip lookback placeholders).
    hist_dates = [d for d in applied_rebalance_dates if d >= hist_anchor]
    hist_unique = sorted(list(dict.fromkeys(hist_dates)))
    hist_total = len(hist_unique)
    if hist_total > WEIGHT_HISTORY_SNAPSHOT_CAP:
        hist_unique = _downsample_keep_endpoints(hist_unique, WEIGHT_HISTORY_SNAPSHOT_CAP)
    metrics["rebalance_snapshots_total"] = int(hist_total)
    metrics["rebalance_snapshots_shown"] = int(len(hist_unique))
    ticker_dates = sorted(list(dict.fromkeys([hist_anchor, *hist_unique])))
    keep_tickers = select_weight_chart_tickers(
        sch, ticker_dates, top_n=min(holdings_top_n, len(prices.columns))
    )
    weight_history: list[dict[str, Any]] = []
    for dt in hist_unique:
        if dt not in schedule.index:
            continue
        weight_history.append(
            _schedule_weight_row(sch, dt, keep_tickers)
        )
    weight_history = ensure_weight_history_anchor(
        weight_history,
        sch,
        hist_anchor,
        keep_tickers,
        applied_on_or_after=applied_rebalance_dates,
    )
    metrics["weight_history"] = weight_history
    if weight_history:
        max_cash = max(float(r.get("CASH", 0.0) or 0.0) for r in weight_history)
        if max_cash >= WEIGHT_CHART_MIN_PCT and "CASH" not in keep_tickers:
            keep_tickers = [*keep_tickers, "CASH"]
    metrics["weight_history_tickers"] = keep_tickers
    cap_audit = (factor_summary or {}).get("weight_cap_audit")
    if cap_audit:
        metrics["weight_cap_audit"] = cap_audit
    return _apply_report_start_window(metrics, prices, spec, report_start)


def simulate_portfolio(
    prices: pd.DataFrame,
    weights: np.ndarray,
    spec: BacktestSpec = DEFAULT_SPEC,
    *,
    report_start: str | None = None,
) -> dict[str, Any]:
    return _simulate_pandas(
        prices, weights, spec, report_start=report_start
    )


def simulate_dynamic_portfolio(
    prices: pd.DataFrame,
    *,
    spec: BacktestSpec = DEFAULT_SPEC,
    max_weight: float,
    min_weight: float = 0.0,
    allocator: AllocatorParams,
    top_n: int | None,
    factor_params: FactorParams | None = None,
    allocator_resolver: Callable[[pd.Timestamp], AllocatorParams] | None = None,
    factor_params_resolver: Callable[[pd.Timestamp], FactorParams] | None = None,
    no_trade_tol: float = 0.0,
    turnover_penalty_mult: float = 1.0,
    max_turnover: float | None = None,
    universe_by_ticker: dict[str, dict[str, Any]] | None = None,
    class_budget: dict[str, float] | None = None,
    class_budget_resolver: Callable[[pd.Timestamp], dict[str, float]] | None = None,
    enforce_class_weights: bool = True,
    report_start: str | None = None,
    anchor_weights: dict[str, float] | None = None,
    customization_drift: float | None = None,
    must_include_tickers: list[str] | None = None,
    group_weight_bands: list[GroupWeightBand] | None = None,
    dividend_panel: pd.DataFrame | None = None,
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
        class_budget_resolver=class_budget_resolver,
        enforce_class_weights=enforce_class_weights,
        report_start=report_start,
        anchor_weights=anchor_weights,
        customization_drift=customization_drift,
        must_include_tickers=must_include_tickers,
        group_weight_bands=group_weight_bands,
        dividend_panel=dividend_panel,
    )


def equity_curve_series(equity: pd.Series) -> list[dict[str, float | str]]:
    base = scalar_float(equity.iloc[0])
    if not np.isfinite(base) or base <= 0:
        base = 1.0
    normalized = equity / base * 100.0
    return [
        {"date": d.strftime("%Y-%m-%d"), "value": round(scalar_float(v), 4)}
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
