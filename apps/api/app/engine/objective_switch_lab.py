"""Standalone Objective Switch Lab — evaluation only, no full backtest jobs."""

from __future__ import annotations

from typing import Any, Callable

import numpy as np
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

FORWARD_HORIZON_DAYS = 21
REGIME_LABELS = ("risk_off", "neutral", "risk_on")


def _forward_stats(bench_ret: pd.Series, end_idx: int, horizon: int) -> dict[str, float] | None:
    fwd = bench_ret.iloc[end_idx + 1 : end_idx + 1 + horizon]
    if len(fwd) < max(5, horizon // 3):
        return None
    compound = float((1.0 + fwd).prod() - 1.0)
    vol = float(fwd.std(ddof=0) * np.sqrt(252.0)) if len(fwd) > 1 else 0.0
    return {
        "forward_return": round(compound, 6),
        "forward_vol": round(vol, 6),
        "forward_days": len(fwd),
    }


def _regime_expectation_hit(
    regime: str,
    forward_return: float,
    forward_vol: float,
    vol_median: float,
) -> bool:
    if regime == "risk_off":
        return forward_return < 0.0 or forward_vol >= vol_median
    if regime == "risk_on":
        return forward_return > 0.0 and forward_vol < vol_median
    neutral_band = 0.03
    vol_lo, vol_hi = vol_median * 0.85, vol_median * 1.15
    return abs(forward_return) <= neutral_band or (vol_lo <= forward_vol <= vol_hi)


def _alignment_grade(score: float) -> str:
    if score >= 70:
        return "A"
    if score >= 55:
        return "B"
    if score >= 40:
        return "C"
    return "D"


def compute_regime_prediction_quality(
    bench_ret: pd.Series,
    timeline: list[dict[str, Any]],
    *,
    forward_days: int = FORWARD_HORIZON_DAYS,
) -> dict[str, Any]:
    """Forward-looking benchmark diagnostic per walk-forward regime label."""
    if not timeline:
        return {
            "regime_quality": {},
            "switch_timing": [],
            "switch_timing_summary": {},
            "overall_alignment_score": None,
            "alignment_grade": None,
            "explanations": ["Insufficient walk-forward steps for regime quality."],
            "forward_horizon_days": forward_days,
        }

    date_to_idx = {d.strftime("%Y-%m-%d"): i for i, d in enumerate(bench_ret.index)}
    rows: list[dict[str, Any]] = []
    for step in timeline:
        idx = date_to_idx.get(step["date"])
        if idx is None:
            continue
        stats = _forward_stats(bench_ret, idx, forward_days)
        if stats is None:
            continue
        rows.append(
            {
                "date": step["date"],
                "regime": str(step["regime"]),
                "switched": bool(step.get("switched")),
                **stats,
            }
        )

    if not rows:
        return {
            "regime_quality": {},
            "switch_timing": [],
            "switch_timing_summary": {},
            "overall_alignment_score": None,
            "alignment_grade": None,
            "explanations": ["No overlapping forward windows for regime quality."],
            "forward_horizon_days": forward_days,
        }

    vol_median = float(np.median([r["forward_vol"] for r in rows]))
    by_regime: dict[str, list[dict[str, Any]]] = {k: [] for k in REGIME_LABELS}
    for r in rows:
        regime = r["regime"]
        if regime not in by_regime:
            by_regime[regime] = []
        by_regime[regime].append(r)

    regime_quality: dict[str, Any] = {}
    weighted_hits = 0.0
    weighted_total = 0.0
    for regime in REGIME_LABELS:
        bucket = by_regime.get(regime) or []
        if not bucket:
            regime_quality[regime] = {
                "sample_count": 0,
                "avg_forward_return": None,
                "avg_forward_vol": None,
                "hit_rate": None,
                "expectation": (
                    "lower/negative return or elevated vol"
                    if regime == "risk_off"
                    else "positive return with subdued vol"
                    if regime == "risk_on"
                    else "moderate return or mid-range vol"
                ),
            }
            continue
        hits = [
            _regime_expectation_hit(regime, b["forward_return"], b["forward_vol"], vol_median)
            for b in bucket
        ]
        hit_rate = float(sum(hits)) / len(hits)
        regime_quality[regime] = {
            "sample_count": len(bucket),
            "avg_forward_return": round(
                float(np.mean([b["forward_return"] for b in bucket])), 6
            ),
            "avg_forward_vol": round(float(np.mean([b["forward_vol"] for b in bucket])), 6),
            "hit_rate": round(hit_rate, 4),
            "expectation": (
                "lower/negative return or elevated vol"
                if regime == "risk_off"
                else "positive return with subdued vol"
                if regime == "risk_on"
                else "moderate return or mid-range vol"
            ),
        }
        weighted_hits += sum(hits)
        weighted_total += len(hits)

    overall_score: float | None = None
    grade: str | None = None
    if weighted_total > 0:
        overall_score = round(100.0 * weighted_hits / weighted_total, 1)
        grade = _alignment_grade(overall_score)

    switch_timing: list[dict[str, Any]] = []
    for i, step in enumerate(timeline):
        if not step.get("switched"):
            continue
        idx = date_to_idx.get(step["date"])
        if idx is None:
            continue
        stats = _forward_stats(bench_ret, idx, forward_days)
        if stats is None:
            continue
        prev_regime = str(timeline[i - 1]["regime"]) if i > 0 else str(step["regime"])
        new_regime = str(step["regime"])
        hit = _regime_expectation_hit(
            new_regime,
            stats["forward_return"],
            stats["forward_vol"],
            vol_median,
        )
        switch_timing.append(
            {
                "date": step["date"],
                "from_regime": prev_regime,
                "to_regime": new_regime,
                "forward_return": stats["forward_return"],
                "forward_vol": stats["forward_vol"],
                "aligned_with_new_regime": hit,
                "note": (
                    f"21d forward return {stats['forward_return']:+.2%} "
                    f"{'matched' if hit else 'did not match'} {new_regime} expectation."
                ),
            }
        )

    switch_hits = [s["aligned_with_new_regime"] for s in switch_timing]
    switch_summary = {
        "switch_events": len(switch_timing),
        "hit_rate": round(float(sum(switch_hits)) / len(switch_hits), 4) if switch_hits else None,
        "avg_forward_return": round(
            float(np.mean([s["forward_return"] for s in switch_timing])), 6
        )
        if switch_timing
        else None,
    }

    explanations: list[str] = []
    if overall_score is not None:
        explanations.append(
            f"Overall regime–forward benchmark alignment: {overall_score:.0f}/100 (grade {grade}). "
            f"Based on {int(weighted_total)} walk-forward steps with {forward_days}d forward windows."
        )
    for regime in REGIME_LABELS:
        q = regime_quality.get(regime, {})
        if not q.get("sample_count"):
            continue
        hr = q.get("hit_rate")
        explanations.append(
            f"{regime}: {q['sample_count']} steps, avg forward return "
            f"{q['avg_forward_return']:+.2%}, hit rate {hr:.0%} vs expectation ({q['expectation']})."
        )
    if switch_timing:
        hr = switch_summary.get("hit_rate")
        explanations.append(
            f"After {len(switch_timing)} regime switch(es), forward {forward_days}d aligned with "
            f"new label {hr:.0%} of the time."
        )
    elif timeline:
        explanations.append("No regime switches in walk-forward window for switch-timing quality.")

    return {
        "regime_quality": regime_quality,
        "switch_timing": switch_timing,
        "switch_timing_summary": switch_summary,
        "overall_alignment_score": overall_score,
        "alignment_grade": grade,
        "explanations": explanations,
        "forward_horizon_days": forward_days,
        "forward_vol_median": round(vol_median, 6),
    }


def build_benchmark_series(
    bench_ret: pd.Series,
    timeline: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Cumulative benchmark path and timeline rows enriched for charting."""
    if bench_ret.empty:
        return [], timeline

    cum = (1.0 + bench_ret).cumprod()
    base = float(cum.iloc[0])
    series = [
        {
            "date": d.strftime("%Y-%m-%d"),
            "cumulative_return_pct": round((float(cum.loc[d]) / base - 1.0) * 100.0, 4),
            "price_index": round(float(cum.loc[d]) / base * 100.0, 4),
        }
        for d in cum.index
    ]

    enhanced: list[dict[str, Any]] = []
    active_regime: str | None = None
    for row in timeline:
        active_regime = str(row["regime"])
        enhanced.append(
            {
                **row,
                "active_regime": active_regime,
            }
        )

    # Downsample series for UI if very long (keep all timeline points)
    max_points = 400
    if len(series) > max_points:
        stride = max(1, len(series) // max_points)
        series = series[::stride]
        if series[-1]["date"] != cum.index[-1].strftime("%Y-%m-%d"):
            last_d = cum.index[-1]
            series.append(
                {
                    "date": last_d.strftime("%Y-%m-%d"),
                    "cumulative_return_pct": round(
                        (float(cum.iloc[-1]) / base - 1.0) * 100.0, 4
                    ),
                    "price_index": round(float(cum.iloc[-1]) / base * 100.0, 4),
                }
            )

    return series, enhanced


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

    train_bench = bench_ret.loc[prices_train.index[0] : prices_train.index[-1]]
    prediction_quality = compute_regime_prediction_quality(train_bench, timeline)
    benchmark_series, regime_timeline_enhanced = build_benchmark_series(
        train_bench, timeline
    )

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
        regime_timeline=regime_timeline_enhanced,
        regime_prediction_quality=prediction_quality,
        benchmark_series=benchmark_series,
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
