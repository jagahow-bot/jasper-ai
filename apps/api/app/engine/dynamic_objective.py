"""Regime-based dynamic objective helpers for main Jasper backtest."""

from __future__ import annotations

from typing import Any, Callable

import pandas as pd

from app.engine.allocator import AllocatorParams
from app.engine.objective_switch_lab import (
    _build_allocator_resolver,
    current_snapshot_for_detector,
)

DYNAMIC_OBJECTIVE = "dynamic"
DEFAULT_REGIME_MODE = "auto"
DEFAULT_DETECTOR_VERSION = "v2"


def is_dynamic_objective(objective: str) -> bool:
    return objective == DYNAMIC_OBJECTIVE


def trial_scoring_objective(objective_effective: str) -> str:
    """Optuna ranks trials on a stable score; dynamic mode uses max_sharpe."""
    return "max_sharpe" if is_dynamic_objective(objective_effective) else objective_effective


def resolve_regime_mode(req_regime_mode: str | None) -> str:
    mode = (req_regime_mode or DEFAULT_REGIME_MODE).strip().lower()
    if mode in ("auto", "risk_off", "neutral", "risk_on"):
        return mode
    return DEFAULT_REGIME_MODE


def build_dynamic_objective_context(
    prices_with_benchmark: pd.DataFrame,
    benchmark_ticker: str,
    *,
    regime_mode: str = DEFAULT_REGIME_MODE,
    fast_risk_off_exit: bool = True,
) -> dict[str, Any]:
    """Walk-forward regime timeline + per-rebalance allocator resolver (V2)."""
    bench = (
        benchmark_ticker
        if benchmark_ticker in prices_with_benchmark.columns
        else prices_with_benchmark.columns[0]
    )
    bench_ret = prices_with_benchmark[bench].pct_change().dropna()
    resolver, timeline, switch_count = _build_allocator_resolver(
        bench_ret,
        regime_mode,
        fixed_objective=None,
        detector_version=DEFAULT_DETECTOR_VERSION,
        fast_risk_off_exit=fast_risk_off_exit,
    )
    snap = current_snapshot_for_detector(
        bench_ret, regime_mode, detector_version=DEFAULT_DETECTOR_VERSION
    )
    objectives_used = sorted({str(row.get("objective", "")) for row in timeline if row.get("objective")})
    return {
        "allocator_resolver": resolver,
        "regime_timeline": timeline,
        "regime_switch_count": switch_count,
        "current_regime": snap,
        "benchmark_ticker": bench,
        "regime_mode": regime_mode,
        "detector_version": DEFAULT_DETECTOR_VERSION,
        "fast_risk_off_exit": fast_risk_off_exit,
        "objectives_used": objectives_used,
    }


def build_dynamic_backtest_chart_payload(
    prices_with_benchmark: pd.DataFrame,
    benchmark_ticker: str,
    timeline_raw: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Serialized timeline rows + downsampled benchmark cumulative % for UI."""
    from app.engine.objective_switch_lab import build_benchmark_series

    bench = (
        benchmark_ticker
        if benchmark_ticker in prices_with_benchmark.columns
        else prices_with_benchmark.columns[0]
    )
    bench_ret = prices_with_benchmark[bench].pct_change().dropna()
    series, _enhanced = build_benchmark_series(bench_ret, timeline_raw)
    return serialize_dynamic_timeline(timeline_raw), series


def serialize_dynamic_timeline(timeline: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """JSON-safe timeline rows for narrative_facts."""
    rows: list[dict[str, Any]] = []
    for step in timeline:
        rows.append(
            {
                "date": step.get("date"),
                "regime": step.get("regime") or step.get("active_regime"),
                "objective": step.get("objective"),
                "switched": bool(step.get("switched")),
                "raw_regime": step.get("raw_regime"),
            }
        )
    return rows


def apply_allocator_resolver(
    sim_kw: dict[str, Any],
    prices: pd.DataFrame,
    resolver: Callable[[pd.Timestamp], AllocatorParams] | None,
) -> dict[str, Any]:
    if resolver is None:
        return sim_kw
    first_dt = prices.index[0]
    out = dict(sim_kw)
    out["allocator"] = resolver(first_dt)
    out["allocator_resolver"] = resolver
    return out
