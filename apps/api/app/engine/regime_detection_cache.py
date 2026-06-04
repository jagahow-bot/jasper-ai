"""Shared walk-forward regime detection for Optuna / backtest rounds.

Regime transitions depend on benchmark returns and detector policy only—not on
trial factor weights or per-regime allocator knobs—so the timeline is computed
once per compatible benchmark slice and reused across trials.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

import pandas as pd

from app.engine.objective_switch_lab import walk_forward_timeline_for_detector
from app.engine.regime_policy import RegimeSignal

DEFAULT_COOLDOWN_STEPS = 2
DEFAULT_CONFIRM_STEPS = 1


@dataclass(frozen=True)
class RegimeDetectionKey:
    """Cache key: benchmark identity + return index slice + detector policy."""

    benchmark_ticker: str
    index_start: str
    index_end: str
    index_len: int
    regime_mode: str
    detector_version: str
    cooldown_steps: int
    confirm_steps: int
    fast_risk_off_exit: bool


@dataclass(frozen=True)
class RegimeDetectionBundle:
    """Immutable walk-forward artifacts safe to share across Optuna trials."""

    key: RegimeDetectionKey
    timeline: tuple[dict[str, Any], ...]
    switch_count: int


def regime_detection_key(
    benchmark_ticker: str,
    bench_ret: pd.Series,
    *,
    regime_mode: str,
    detector_version: str,
    cooldown_steps: int = DEFAULT_COOLDOWN_STEPS,
    confirm_steps: int = DEFAULT_CONFIRM_STEPS,
    fast_risk_off_exit: bool = True,
) -> RegimeDetectionKey:
    if bench_ret.empty:
        return RegimeDetectionKey(
            benchmark_ticker=benchmark_ticker,
            index_start="",
            index_end="",
            index_len=0,
            regime_mode=regime_mode,
            detector_version=detector_version,
            cooldown_steps=cooldown_steps,
            confirm_steps=confirm_steps,
            fast_risk_off_exit=fast_risk_off_exit,
        )
    return RegimeDetectionKey(
        benchmark_ticker=benchmark_ticker,
        index_start=str(bench_ret.index[0].date()),
        index_end=str(bench_ret.index[-1].date()),
        index_len=int(len(bench_ret)),
        regime_mode=regime_mode,
        detector_version=detector_version,
        cooldown_steps=cooldown_steps,
        confirm_steps=confirm_steps,
        fast_risk_off_exit=fast_risk_off_exit,
    )


def compute_regime_detection_bundle(
    bench_ret: pd.Series,
    *,
    benchmark_ticker: str,
    regime_mode: str,
    detector_version: str,
    cooldown_steps: int = DEFAULT_COOLDOWN_STEPS,
    confirm_steps: int = DEFAULT_CONFIRM_STEPS,
    fast_risk_off_exit: bool = True,
) -> RegimeDetectionBundle:
    """Run walk-forward regime detection once for this benchmark panel."""
    key = regime_detection_key(
        benchmark_ticker,
        bench_ret,
        regime_mode=regime_mode,
        detector_version=detector_version,
        cooldown_steps=cooldown_steps,
        confirm_steps=confirm_steps,
        fast_risk_off_exit=fast_risk_off_exit,
    )
    switch_count, timeline = walk_forward_timeline_for_detector(
        bench_ret,
        regime_mode,
        detector_version=detector_version,
        cooldown_steps=cooldown_steps,
        confirm_steps=confirm_steps,
        fast_risk_off_exit=fast_risk_off_exit,
    )
    return RegimeDetectionBundle(
        key=key,
        timeline=tuple(timeline),
        switch_count=int(switch_count),
    )


def build_timeline_regime_resolver(
    timeline: list[dict[str, Any]] | tuple[dict[str, Any], ...],
) -> Callable[[pd.Timestamp], RegimeSignal]:
    """Map rebalance dates to the nearest prior walk-forward active regime (read-only)."""
    rows = list(timeline)
    by_date = {row["date"]: row for row in rows}
    dates_sorted = sorted(by_date.keys())
    default: RegimeSignal = (
        str(rows[-1].get("active_regime") or rows[-1].get("regime") or "neutral")
        if rows
        else "neutral"
    )

    def resolver(dt: pd.Timestamp) -> RegimeSignal:
        key = dt.strftime("%Y-%m-%d")
        prior = [d for d in dates_sorted if d <= key]
        if not prior:
            return default
        row = by_date[prior[-1]]
        return str(row.get("active_regime") or row.get("regime") or default)

    return resolver


def bundle_active_regime_resolver(
    bundle: RegimeDetectionBundle,
) -> Callable[[pd.Timestamp], RegimeSignal]:
    return build_timeline_regime_resolver(bundle.timeline)


def get_or_compute_regime_bundle(
    dynamic_ctx: dict[str, Any],
    bench_ret: pd.Series,
    *,
    benchmark_ticker: str,
    regime_mode: str,
    detector_version: str,
    fast_risk_off_exit: bool,
    cooldown_steps: int = DEFAULT_COOLDOWN_STEPS,
    confirm_steps: int = DEFAULT_CONFIRM_STEPS,
) -> RegimeDetectionBundle:
    """Return cached bundle when benchmark slice and policy are unchanged."""
    key = regime_detection_key(
        benchmark_ticker,
        bench_ret,
        regime_mode=regime_mode,
        detector_version=detector_version,
        cooldown_steps=cooldown_steps,
        confirm_steps=confirm_steps,
        fast_risk_off_exit=fast_risk_off_exit,
    )
    existing = dynamic_ctx.get("regime_bundle")
    if isinstance(existing, RegimeDetectionBundle) and existing.key == key:
        return existing
    bundle = compute_regime_detection_bundle(
        bench_ret,
        benchmark_ticker=benchmark_ticker,
        regime_mode=regime_mode,
        detector_version=detector_version,
        cooldown_steps=cooldown_steps,
        confirm_steps=confirm_steps,
        fast_risk_off_exit=fast_risk_off_exit,
    )
    dynamic_ctx["regime_bundle"] = bundle
    return bundle
