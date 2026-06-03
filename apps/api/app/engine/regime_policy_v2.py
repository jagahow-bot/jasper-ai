"""Regime detection V2: per-regime indicator scores + arbitration (lab / experiments)."""

from __future__ import annotations

import os
from typing import Any

import numpy as np
import pandas as pd

from app.engine.regime_policy import (
    REGIME_OBJECTIVE_MAP,
    RegimeSignal,
    objective_for_regime,
)

DEFAULT_MIN_CONFIDENCE = 0.42
DEFAULT_STEP_DAYS = 21
DEFAULT_LOOKBACK_DAYS = 63


def default_detector_version() -> str:
    return os.environ.get("REGIME_DETECTOR_VERSION", "v2").strip().lower() or "v2"


def _clamp01(x: float) -> float:
    return float(max(0.0, min(1.0, x)))


def _negative_return_streak_score(returns: pd.Series) -> float:
    if returns.empty:
        return 0.0
    streak = 0
    max_streak = 0
    for r in returns:
        if float(r) < 0.0:
            streak += 1
            max_streak = max(max_streak, streak)
        else:
            streak = 0
    # 5+ consecutive down days in lookback → saturated score
    return _clamp01(max_streak / 8.0)


def _trailing_max_drawdown(returns: pd.Series) -> float:
    if returns.empty:
        return 0.0
    cum = (1.0 + returns).cumprod()
    peak = cum.cummax()
    dd = float((cum / peak - 1.0).min())
    return dd


def _trend_slope_score(returns: pd.Series) -> float:
    if len(returns) < 10:
        return 0.0
    cum = (1.0 + returns).cumprod()
    y = np.log(cum.values.astype(float))
    x = np.arange(len(y), dtype=float)
    slope = float(np.polyfit(x, y, 1)[0])
    # ~0.0003 daily log slope ≈ strong uptrend over 63d
    return _clamp01(slope / 0.00035)


def _vol_level_score(annualized_vol: float) -> float:
    return _clamp01((annualized_vol - 0.14) / 0.14)


def _vol_calm_score(annualized_vol: float) -> float:
    return _clamp01((0.22 - annualized_vol) / 0.10)


def _return_momentum_score(trailing_return: float) -> float:
    return _clamp01((trailing_return - 0.008) / 0.035)


def _drawdown_stress_score(max_dd: float) -> float:
    return _clamp01((-max_dd - 0.025) / 0.12)


RISK_OFF_WEIGHTS = {
    "vol_level": 0.60,
    "drawdown_stress": 0.25,
    "negative_return_streak": 0.15,
}


def compute_regime_scores(
    window: pd.Series,
    *,
    vol_history: pd.Series | None = None,
) -> dict[str, float]:
    """
    Independent risk-off and risk-on scores in [0, 1].
    Neutral is implied when arbitration cannot pick a confident winner.

    risk_off_score weights (vol-primary): 60% vol_level, 25% drawdown_stress,
    15% negative_return_streak.
    """
    if len(window) == 0:
        return {
            "risk_off_score": 0.0,
            "risk_on_score": 0.0,
            "neutral_score": 1.0,
        }

    trailing_return = float(window.sum())
    annualized_vol = (
        float(window.std(ddof=0) * np.sqrt(252.0)) if len(window) > 1 else 0.0
    )
    max_dd = _trailing_max_drawdown(window)

    vol_level = _vol_level_score(annualized_vol)
    if vol_history is not None and len(vol_history) > 20:
        hist_vols = vol_history.rolling(21, min_periods=10).std(ddof=0) * np.sqrt(252.0)
        hist_vols = hist_vols.dropna()
        if len(hist_vols) > 0 and not np.isnan(annualized_vol):
            pct = float((hist_vols <= annualized_vol).mean())
            vol_level = max(vol_level, _clamp01((pct - 0.55) / 0.35))

    risk_off_score = _clamp01(
        RISK_OFF_WEIGHTS["vol_level"] * vol_level
        + RISK_OFF_WEIGHTS["drawdown_stress"] * _drawdown_stress_score(max_dd)
        + RISK_OFF_WEIGHTS["negative_return_streak"]
        * _negative_return_streak_score(window)
    )

    risk_on_score = _clamp01(
        0.34 * _return_momentum_score(trailing_return)
        + 0.33 * _vol_calm_score(annualized_vol)
        + 0.33 * _trend_slope_score(window)
    )

    neutral_score = _clamp01(1.0 - max(risk_off_score, risk_on_score))

    return {
        "risk_off_score": round(risk_off_score, 4),
        "risk_on_score": round(risk_on_score, 4),
        "neutral_score": round(neutral_score, 4),
    }


def arbitrate_regime(
    scores: dict[str, float],
    requested_mode: str,
    *,
    min_confidence: float = DEFAULT_MIN_CONFIDENCE,
) -> RegimeSignal:
    if requested_mode == "risk_off":
        return "risk_off"
    if requested_mode == "risk_on":
        return "risk_on"
    if requested_mode == "neutral":
        return "neutral"

    off = float(scores.get("risk_off_score", 0.0))
    on = float(scores.get("risk_on_score", 0.0))
    if off >= on and off >= min_confidence:
        return "risk_off"
    if on > off and on >= min_confidence:
        return "risk_on"
    return "neutral"


def resolve_regime_signal_v2(
    window: pd.Series,
    requested_mode: str,
    *,
    vol_history: pd.Series | None = None,
    min_confidence: float = DEFAULT_MIN_CONFIDENCE,
) -> tuple[RegimeSignal, dict[str, float]]:
    scores = compute_regime_scores(window, vol_history=vol_history)
    regime = arbitrate_regime(scores, requested_mode, min_confidence=min_confidence)
    return regime, scores


def walk_forward_regime_timeline_v2(
    bench_ret: pd.Series,
    requested_mode: str,
    *,
    step_days: int = DEFAULT_STEP_DAYS,
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
    cooldown_steps: int = 2,
    confirm_steps: int = 1,
    min_confidence: float = DEFAULT_MIN_CONFIDENCE,
) -> tuple[int, list[dict[str, Any]]]:
    """Walk-forward V2 labels with score timeline and hysteresis on active regime."""
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
        vol_history = bench_ret.iloc[:end]
        raw, scores = resolve_regime_signal_v2(
            window,
            requested_mode,
            vol_history=vol_history,
            min_confidence=min_confidence,
        )
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
        trailing_return = float(window.sum()) if len(window) else 0.0
        annualized_vol = (
            float(window.std(ddof=0) * np.sqrt(252.0)) if len(window) > 1 else 0.0
        )
        timeline.append(
            {
                "date": end_date.strftime("%Y-%m-%d"),
                "regime": active,
                "objective": objective_for_regime(active),
                "raw_regime": raw,
                "switched": switched,
                "risk_off_score": scores["risk_off_score"],
                "risk_on_score": scores["risk_on_score"],
                "neutral_score": scores["neutral_score"],
                "trailing_return": round(trailing_return, 6),
                "annualized_vol": round(annualized_vol, 6),
            }
        )

    return switch_count, timeline


def current_regime_snapshot_v2(
    bench_ret: pd.Series,
    requested_mode: str,
    *,
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
    min_confidence: float = DEFAULT_MIN_CONFIDENCE,
) -> dict[str, Any]:
    lookback = int(min(max(len(bench_ret), 1), lookback_days))
    window = bench_ret.tail(lookback)
    regime, scores = resolve_regime_signal_v2(
        window,
        requested_mode,
        vol_history=bench_ret,
        min_confidence=min_confidence,
    )
    trailing_return = float(window.sum()) if len(window) else 0.0
    annualized_vol = (
        float(window.std(ddof=0) * np.sqrt(252.0)) if len(window) > 1 else 0.0
    )
    return {
        "regime": regime,
        "objective": objective_for_regime(regime),
        "trailing_return": trailing_return,
        "annualized_vol": annualized_vol,
        "lookback_days": lookback,
        "risk_off_score": scores["risk_off_score"],
        "risk_on_score": scores["risk_on_score"],
        "neutral_score": scores["neutral_score"],
        "detector_version": "v2",
        "objective_map": REGIME_OBJECTIVE_MAP,
    }
