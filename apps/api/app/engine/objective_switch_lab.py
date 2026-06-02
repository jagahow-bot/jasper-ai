"""Standalone Objective Switch Lab — evaluation only, no full backtest jobs."""

from __future__ import annotations

from typing import Any, Callable

import pandas as pd

from app.engine.allocator import AllocatorParams
from app.engine.data import fetch_prices
from app.engine.factors import FactorParams
from app.engine.objectives import metrics_snapshot
from app.engine.portfolio import (
    _normalize_rebalance_rule,
    simulate_dynamic_portfolio,
    split_train_validation,
)
from app.engine.regime_policy import (
    current_regime_snapshot,
    objective_for_regime,
    resolve_regime_signal,
    walk_forward_regime_timeline,
)
from app.engine.spec import BacktestSpec
from app.profiles import get_universe, get_universe_meta
from app.models import ObjectiveSwitchLabRequest, ObjectiveSwitchLabResult

LAB_TOP_N = 30
LAB_MAX_WEIGHT = 0.5
LAB_REBALANCE = "QE"
LAB_FEE_BPS = 10.0

LIMITATION_NOTE = (
    "Lab v1 uses fixed top-N factor screen + allocator presets per objective "
    "(no Optuna search). Arms differ by objective→allocator mapping at each rebalance; "
    "not comparable to a fully optimized Jasper backtest."
)


def allocator_preset_for_objective(objective: str) -> AllocatorParams:
    if objective == "max_return":
        return AllocatorParams(mode="mean_variance", lookback_days=63, risk_aversion=1.5)
    if objective == "min_max_drawdown":
        return AllocatorParams(mode="min_var", lookback_days=252, shrinkage=0.25)
    return AllocatorParams(mode="mean_variance", lookback_days=126, risk_aversion=3.5)


def _build_allocator_resolver(
    bench_ret: pd.Series,
    requested_mode: str,
    *,
    lookback_days: int = 63,
    cooldown_steps: int = 2,
    confirm_steps: int = 1,
    fixed_objective: str | None = None,
) -> tuple[Callable[[pd.Timestamp], AllocatorParams], list[dict[str, Any]], int]:
    """Resolver for switch arm; fixed arm passes fixed_objective."""
    switch_count, timeline = walk_forward_regime_timeline(
        bench_ret,
        requested_mode,
        cooldown_steps=cooldown_steps,
        confirm_steps=confirm_steps,
    )
    by_date = {row["date"]: row for row in timeline}
    dates_sorted = sorted(by_date.keys())
    active_objective = fixed_objective or (
        timeline[-1]["objective"] if timeline else "max_sharpe"
    )
    last_switch_idx = -cooldown_steps

    def resolver(dt: pd.Timestamp) -> AllocatorParams:
        nonlocal active_objective, last_switch_idx
        if fixed_objective is not None:
            return allocator_preset_for_objective(fixed_objective)
        key = dt.strftime("%Y-%m-%d")
        # Nearest prior walk-forward label
        prior = [d for d in dates_sorted if d <= key]
        if prior:
            row = by_date[prior[-1]]
            raw_regime = resolve_regime_signal(
                bench_ret.loc[: dt].tail(lookback_days),
                requested_mode,
            )
            candidate = objective_for_regime(raw_regime)
            idx = dates_sorted.index(prior[-1])
            if candidate != active_objective and idx - last_switch_idx >= cooldown_steps:
                active_objective = candidate
                last_switch_idx = idx
            elif row.get("switched"):
                active_objective = str(row["objective"])
        return allocator_preset_for_objective(active_objective)

    return resolver, timeline, switch_count


def _arm_metrics(metrics: dict[str, Any], objective: str) -> dict[str, Any]:
    snap = metrics_snapshot(metrics, objective_mode=objective)
    return {
        **snap,
        "return_pct": round(float(metrics.get("cagr", 0.0)) * 100.0, 2),
    }


def _simulate_arm(
    prices: pd.DataFrame,
    *,
    spec: BacktestSpec,
    bench_ret: pd.Series,
    regime_mode: str,
    objective: str | None,
    fixed_objective: str | None,
    cooldown_steps: int,
    confirm_steps: int,
    universe_by_ticker: dict[str, dict[str, Any]],
) -> tuple[dict[str, Any], list[dict[str, Any]], int]:
    resolver, timeline, switch_count = _build_allocator_resolver(
        bench_ret,
        regime_mode,
        fixed_objective=fixed_objective,
        cooldown_steps=cooldown_steps,
        confirm_steps=confirm_steps,
    )
    factor_lb = resolver(prices.index[-1]).lookback_days
    metrics = simulate_dynamic_portfolio(
        prices,
        spec=spec,
        max_weight=LAB_MAX_WEIGHT,
        allocator=resolver(prices.index[0]),
        allocator_resolver=resolver,
        top_n=min(LAB_TOP_N, len(prices.columns)),
        factor_params=FactorParams(lookback_days=int(factor_lb)),
        universe_by_ticker=universe_by_ticker,
    )
    label_objective = fixed_objective or objective or "max_sharpe"
    return _arm_metrics(metrics, label_objective), timeline, switch_count


def _recommendation(
    *,
    fixed_oos_sharpe: float | None,
    switch_oos_sharpe: float | None,
    switch_count: int,
    timeline_len: int,
) -> str:
    if fixed_oos_sharpe is None or switch_oos_sharpe is None:
        return "NEED_MORE_DATA"
    if timeline_len < 4:
        return "NEED_MORE_DATA"
    delta = float(switch_oos_sharpe) - float(fixed_oos_sharpe)
    if delta >= 0.05 and switch_count >= 1:
        return "APPLY"
    if delta <= -0.05:
        return "NOT_YET"
    return "NEED_MORE_DATA"


def evaluate_objective_switch_lab(
    req: ObjectiveSwitchLabRequest,
) -> ObjectiveSwitchLabResult:
    bench = (req.benchmark_ticker or "SPY").upper()
    regime_mode = str(req.regime_mode).lower()
    fixed_objective = req.fixed_objective.value

    universe = get_universe(req.asset_classes)
    universe_meta = get_universe_meta()
    if len(universe) < 5:
        raise ValueError(
            f"Too few tickers after filter ({len(universe)}); widen asset classes or dates"
        )

    tickers = [u["ticker"] for u in universe]
    rebalance_rule = _normalize_rebalance_rule(LAB_REBALANCE)
    spec = BacktestSpec(
        benchmark_ticker=bench,
        fee_bps=LAB_FEE_BPS,
        rebalance_rule=rebalance_rule,
    )

    prices, data_meta = fetch_prices(tickers, req.start_date, req.end_date, bench)
    tickers = [t for t in tickers if t in prices.columns]
    if bench not in prices.columns:
        raise ValueError(f"Benchmark {bench} missing from price panel")
    if len(tickers) < 5:
        raise ValueError("Too few tradable tickers after price load")

    port_cols = [t for t in tickers if t in prices.columns]
    prices_port = prices[port_cols].copy()
    bench_ret = prices[bench].pct_change().dropna()
    universe_by_ticker = {u["ticker"]: u for u in universe if u["ticker"] in port_cols}

    train_ratio = float(req.train_ratio)
    if req.enable_oos:
        prices_train, prices_val, train_end, val_start = split_train_validation(
            prices_port, train_ratio
        )
    else:
        prices_train, prices_val = prices_port, prices_port.iloc[0:0]
        train_end = str(prices.index[-1].date())
        val_start = train_end

    cooldown = int(req.cooldown_steps)
    confirm = int(req.confirm_steps)

    fixed_is, _, _ = _simulate_arm(
        prices_train,
        spec=spec,
        bench_ret=bench_ret.loc[prices_train.index[0] : prices_train.index[-1]],
        regime_mode=regime_mode,
        objective=fixed_objective,
        fixed_objective=fixed_objective,
        cooldown_steps=cooldown,
        confirm_steps=confirm,
        universe_by_ticker=universe_by_ticker,
    )
    switch_is, timeline, switch_count = _simulate_arm(
        prices_train,
        spec=spec,
        bench_ret=bench_ret.loc[prices_train.index[0] : prices_train.index[-1]],
        regime_mode=regime_mode,
        objective=None,
        fixed_objective=None,
        cooldown_steps=cooldown,
        confirm_steps=confirm,
        universe_by_ticker=universe_by_ticker,
    )

    fixed_oos: dict[str, Any] | None = None
    switch_oos: dict[str, Any] | None = None
    if req.enable_oos and len(prices_val) > 60:
        fixed_oos, _, _ = _simulate_arm(
            prices_val,
            spec=spec,
            bench_ret=bench_ret.loc[prices_val.index[0] : prices_val.index[-1]],
            regime_mode=regime_mode,
            objective=fixed_objective,
            fixed_objective=fixed_objective,
            cooldown_steps=cooldown,
            confirm_steps=confirm,
            universe_by_ticker=universe_by_ticker,
        )
        switch_oos, _, _ = _simulate_arm(
            prices_val,
            spec=spec,
            bench_ret=bench_ret.loc[prices_val.index[0] : prices_val.index[-1]],
            regime_mode=regime_mode,
            objective=None,
            fixed_objective=None,
            cooldown_steps=cooldown,
            confirm_steps=confirm,
            universe_by_ticker=universe_by_ticker,
        )

    oos_delta: float | None = None
    headline = "Insufficient OOS window for comparison."
    if fixed_oos and switch_oos:
        oos_delta = float(switch_oos["sharpe"]) - float(fixed_oos["sharpe"])
        if oos_delta > 0:
            headline = (
                f"Switch policy beat fixed by {oos_delta:+.3f} Sharpe on OOS "
                f"({switch_oos['sharpe']:.3f} vs {fixed_oos['sharpe']:.3f})."
            )
        elif oos_delta < 0:
            headline = (
                f"Fixed objective beat switch by {-oos_delta:.3f} Sharpe on OOS "
                f"({fixed_oos['sharpe']:.3f} vs {switch_oos['sharpe']:.3f})."
            )
        else:
            headline = "Switch and fixed tied on OOS Sharpe."

    rec = _recommendation(
        fixed_oos_sharpe=fixed_oos["sharpe"] if fixed_oos else None,
        switch_oos_sharpe=switch_oos["sharpe"] if switch_oos else None,
        switch_count=switch_count,
        timeline_len=len(timeline),
    )

    snapshot = current_regime_snapshot(bench_ret, regime_mode)

    return ObjectiveSwitchLabResult(
        disclaimer=LIMITATION_NOTE,
        limitation=LIMITATION_NOTE,
        recommendation=rec,  # type: ignore[arg-type]
        headline=headline,
        oos_sharpe_delta_switch_minus_fixed=oos_delta,
        fixed_arm={
            "label": "Fixed objective",
            "objective": fixed_objective,
            "in_sample": fixed_is,
            "out_of_sample": fixed_oos,
            "switch_count": 0,
        },
        switch_arm={
            "label": "Regime switch policy",
            "objective": "regime_dynamic",
            "in_sample": switch_is,
            "out_of_sample": switch_oos,
            "switch_count": switch_count,
        },
        regime_timeline=timeline,
        current_regime=snapshot,
        periods={
            "full": {"start": req.start_date, "end": req.end_date},
            "in_sample": {
                "start": str(prices_train.index[0].date()),
                "end": train_end,
            },
            "out_of_sample": (
                {"start": val_start, "end": str(prices.index[-1].date())}
                if req.enable_oos and len(prices_val) > 0
                else None
            ),
        },
        benchmark_ticker=bench,
        regime_mode=regime_mode,
        universe_stats={
            "pool_count": len(universe),
            "tradable_count": len(tickers),
            "asset_classes": req.asset_classes,
            "meta_count": universe_meta.get("count"),
        },
        data_meta=data_meta,
    )
