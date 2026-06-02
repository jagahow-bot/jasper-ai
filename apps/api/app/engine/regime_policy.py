"""3-regime objective switch policy (benchmark heuristics, no AI)."""

from __future__ import annotations

from typing import Any, Literal

import numpy as np
import pandas as pd

RegimeSignal = Literal["risk_off", "neutral", "risk_on"]
RegimeMode = Literal["auto", "risk_off", "neutral", "risk_on"]

REGIME_OBJECTIVE_MAP: dict[RegimeSignal, str] = {
    "risk_off": "min_max_drawdown",
    "neutral": "max_sharpe",
    "risk_on": "max_return",
}


def objective_for_regime(regime: RegimeSignal) -> str:
    return REGIME_OBJECTIVE_MAP[regime]


def resolve_regime_signal(window: pd.Series, requested_mode: str) -> RegimeSignal:
    if requested_mode == "risk_off":
        return "risk_off"
    if requested_mode == "risk_on":
        return "risk_on"
    if requested_mode == "neutral":
        return "neutral"
    trailing_return = float(window.sum()) if len(window) else 0.0
    annualized_vol = float(window.std(ddof=0) * np.sqrt(252.0)) if len(window) > 1 else 0.0
    if trailing_return < -0.01 or annualized_vol > 0.24:
        return "risk_off"
    if trailing_return > 0.015 and annualized_vol < 0.18:
        return "risk_on"
    return "neutral"


def walk_forward_regime_timeline(
    bench_ret: pd.Series,
    requested_mode: str,
    *,
    step_days: int = 21,
    lookback_days: int = 63,
    cooldown_steps: int = 2,
    confirm_steps: int = 1,
) -> tuple[int, list[dict[str, Any]]]:
    """Walk-forward regime labels with cooldown and optional confirmation hysteresis."""
    if len(bench_ret) < lookback_days + step_days:
        return 0, []

    timeline: list[dict[str, Any]] = []
    active: RegimeSignal | None = None
    pending: RegimeSignal | None = None
    pending_count = 0
    steps_since_switch = cooldown_steps
    switch_count = 0

    for end in range(lookback_days, len(bench_ret), step_days):
        window = bench_ret.iloc[end - lookback_days : end]
        raw = resolve_regime_signal(window, requested_mode)
        end_date = bench_ret.index[end]
        switched = False

        if active is None:
            active = raw
            pending = None
            pending_count = 0
            steps_since_switch = cooldown_steps
        elif raw != active:
            if raw == pending:
                pending_count += 1
            else:
                pending = raw
                pending_count = 1
            if pending_count >= confirm_steps and steps_since_switch >= cooldown_steps:
                active = raw
                pending = None
                pending_count = 0
                steps_since_switch = 0
                switch_count += 1
                switched = True
        else:
            pending = None
            pending_count = 0

        steps_since_switch += 1
        timeline.append(
            {
                "date": end_date.strftime("%Y-%m-%d"),
                "regime": active,
                "objective": objective_for_regime(active),
                "raw_regime": raw,
                "switched": switched,
                "trailing_return": round(float(window.sum()), 6),
                "annualized_vol": round(
                    float(window.std(ddof=0) * np.sqrt(252.0)) if len(window) > 1 else 0.0,
                    6,
                ),
            }
        )

    return switch_count, timeline


def current_regime_snapshot(
    bench_ret: pd.Series,
    requested_mode: str,
    *,
    lookback_days: int = 63,
) -> dict[str, Any]:
    lookback = int(min(max(len(bench_ret), 1), lookback_days))
    window = bench_ret.tail(lookback)
    regime = resolve_regime_signal(window, requested_mode)
    trailing_return = float(window.sum()) if len(window) else 0.0
    annualized_vol = float(window.std(ddof=0) * np.sqrt(252.0)) if len(window) > 1 else 0.0
    return {
        "regime": regime,
        "objective": objective_for_regime(regime),
        "trailing_return": trailing_return,
        "annualized_vol": annualized_vol,
        "lookback_days": lookback,
    }
