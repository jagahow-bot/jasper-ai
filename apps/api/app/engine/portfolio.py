"""Portfolio simulation (pandas-based, rebalance-aware)."""

from __future__ import annotations

import logging
from typing import Any, Callable

import numpy as np
import pandas as pd

from app.engine.spec import BacktestSpec, DEFAULT_SPEC, effective_top_n, resolve_candidate_top_n
from app.engine.allocator import AllocatorParams, solve_weights
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
    project_max_weight,
)

logger = logging.getLogger(__name__)
from app.engine.factors import FactorParams, pick_top_n, score_assets_with_details


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
# Rebalance snapshot rows sent to the holdings chart (ME ≈ 1 row/month).
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
    """Pick tickers so Other = 1 - sum(shown) stays below WEIGHT_CHART_OTHER_MAX on every date.

    Seed with per-date top holdings (cumulative weight until 1 - OTHER_MAX), then greedily add
    the candidate that most reduces the worst-date Other until the cap is met.
    """
    del top_n  # chart picks for Other≤10%; not the run max_holdings cap

    candidates: set[str] = set()
    keep_set: set[str] = set()
    target_shown = 1.0 - WEIGHT_CHART_OTHER_MAX

    for dt in hist_dates:
        if dt not in schedule.index:
            continue
        w_row = schedule.loc[dt]
        cum = 0.0
        for t, fw in _sorted_weights_on_date(w_row):
            candidates.add(t)
            keep_set.add(t)
            cum += fw
            if cum >= target_shown - WEIGHT_EPS:
                break

    if not keep_set:
        return []

    other_limit = WEIGHT_CHART_OTHER_MAX + 1e-9
    while _max_other_weight_for_tickers(schedule, hist_dates, keep_set) > other_limit:
        remaining = candidates - keep_set
        if not remaining:
            break
        best_t: str | None = None
        best_other = float("inf")
        for t in remaining:
            trial = keep_set | {t}
            trial_other = _max_other_weight_for_tickers(schedule, hist_dates, trial)
            if trial_other < best_other:
                best_other = trial_other
                best_t = t
        if best_t is None or best_other >= _max_other_weight_for_tickers(
            schedule, hist_dates, keep_set
        ):
            break
        keep_set.add(best_t)

    max_s = schedule.max(axis=0).sort_values(ascending=False)
    return [
        str(t)
        for t in max_s.index
        if str(t) in keep_set and float(max_s[t]) >= WEIGHT_CHART_MIN_PCT
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
    row["OTHER"] = max(0.0, float(1.0 - keep_sum))
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
    eq_base = float(equity_full.loc[anchor])
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
            scores, factor_detail = score_assets_with_details(px_w, rt_w, factor_step)
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
            w_sub_prev = np.atleast_1d(
                w[np.asarray([col_index[t] for t in chosen], dtype=int)]
            )
            w_sub = solve_weights(
                mu_annual=mu,
                cov_annual=cov,
                max_weight=max_weight,
                params=alloc_step,
                w0=w_sub_prev,
            )
            w_sub_flat = np.asarray(w_sub, dtype=float).ravel()
            w = np.zeros(n, dtype=float)
            for i, t in enumerate(chosen):
                w[col_index[t]] = float(w_sub_flat[i])
            w = project_max_weight(w, max_weight)
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
    eq0 = float(equity.iloc[start])
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
        )
    else:
        schedule = _rebalance_schedule(prices, weights, spec.rebalance_rule)
        last_w = schedule.iloc[-1].to_numpy(dtype=float)
        avg_w = schedule.mean(axis=0).to_numpy(dtype=float)
        rebalance_dates = _trading_day_rebalance_dates(prices.index, spec.rebalance_rule)
        applied_rebalance_dates = list(rebalance_dates)
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
