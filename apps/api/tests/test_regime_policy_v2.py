from __future__ import annotations

import pytest
import numpy as np
import pandas as pd

from app.engine.regime_policy_v2 import (
    RISK_OFF_WEIGHTS,
    arbitrate_regime,
    compute_regime_scores,
    resolve_regime_signal_v2,
    walk_forward_regime_timeline_v2,
)


def test_compute_regime_scores_bounded() -> None:
    idx = pd.bdate_range("2020-01-01", periods=80)
    rng = np.random.default_rng(1)
    ret = pd.Series(rng.normal(0.0002, 0.01, len(idx)), index=idx)
    scores = compute_regime_scores(ret)
    assert 0.0 <= scores["risk_off_score"] <= 1.0
    assert 0.0 <= scores["risk_on_score"] <= 1.0
    assert 0.0 <= scores["neutral_score"] <= 1.0


def test_arbitration_picks_highest_above_confidence() -> None:
    assert arbitrate_regime(
        {"risk_off_score": 0.7, "risk_on_score": 0.3}, "auto", min_confidence=0.42
    ) == "risk_off"
    assert arbitrate_regime(
        {"risk_off_score": 0.3, "risk_on_score": 0.65}, "auto", min_confidence=0.42
    ) == "risk_on"
    assert arbitrate_regime(
        {"risk_off_score": 0.35, "risk_on_score": 0.38}, "auto", min_confidence=0.42
    ) == "neutral"


def test_forced_mode_overrides_arbitration() -> None:
    regime, _ = resolve_regime_signal_v2(
        pd.Series([0.01] * 63), "risk_off", min_confidence=0.42
    )
    assert regime == "risk_off"


def test_walk_forward_includes_scores() -> None:
    idx = pd.bdate_range("2018-01-01", periods=520)
    rng = np.random.default_rng(9)
    bench_ret = pd.Series(rng.normal(0.0003, 0.012, len(idx)), index=idx)
    _, timeline = walk_forward_regime_timeline_v2(bench_ret, "auto")
    assert len(timeline) > 0
    row = timeline[0]
    assert "risk_off_score" in row
    assert "risk_on_score" in row
    assert row["regime"] in ("risk_off", "neutral", "risk_on")


def test_risk_off_weights_vol_primary() -> None:
    assert RISK_OFF_WEIGHTS == {
        "vol_level": 0.60,
        "drawdown_stress": 0.25,
        "negative_return_streak": 0.15,
    }
    assert sum(RISK_OFF_WEIGHTS.values()) == pytest.approx(1.0)


def test_high_vol_window_scores_higher_risk_off_than_low_vol() -> None:
    idx = pd.bdate_range("2020-01-01", periods=63)
    rng = np.random.default_rng(42)
    low_vol = pd.Series(rng.normal(0.0001, 0.003, len(idx)), index=idx)
    high_vol = pd.Series(rng.normal(0.0001, 0.035, len(idx)), index=idx)
    low_scores = compute_regime_scores(low_vol)
    high_scores = compute_regime_scores(high_vol)
    assert high_scores["risk_off_score"] > low_scores["risk_off_score"]


def test_stress_window_elevates_risk_off_score() -> None:
    idx = pd.bdate_range("2020-03-01", periods=63)
    crash = pd.Series(np.linspace(0.0, -0.02, 63), index=idx)
    calm = pd.Series([0.001] * 63, index=pd.bdate_range("2019-01-01", periods=63))
    stress_scores = compute_regime_scores(crash)
    calm_scores = compute_regime_scores(calm)
    assert stress_scores["risk_off_score"] > calm_scores["risk_off_score"]


def _synthetic_v_rebound_series() -> pd.Series:
    """Crash then sharp V-rebound: 63d lookback lags exit without fast release."""
    idx = pd.bdate_range("2019-01-01", periods=420)
    crash = np.concatenate(
        [
            np.linspace(0.0, -0.035, 42),
            np.full(21, -0.012),
        ]
    )
    rebound = np.concatenate(
        [
            np.linspace(0.018, 0.004, 21),
            np.full(63, 0.0035),
            np.full(63, 0.0025),
        ]
    )
    tail = np.full(len(idx) - len(crash) - len(rebound), 0.0012)
    ret = np.concatenate([crash, rebound, tail])
    return pd.Series(ret[: len(idx)], index=idx)


def _risk_off_steps(timeline: list[dict]) -> int:
    return sum(1 for row in timeline if row["regime"] == "risk_off")


def test_v_rebound_exits_risk_off_faster_with_fast_exit() -> None:
    bench_ret = _synthetic_v_rebound_series()
    _, slow = walk_forward_regime_timeline_v2(
        bench_ret,
        "auto",
        cooldown_steps=2,
        confirm_steps=1,
        fast_risk_off_exit=False,
    )
    _, fast = walk_forward_regime_timeline_v2(
        bench_ret,
        "auto",
        cooldown_steps=2,
        confirm_steps=1,
        fast_risk_off_exit=True,
    )
    assert len(slow) > 0 and len(fast) > 0
    assert _risk_off_steps(fast) < _risk_off_steps(slow)


def test_vol_peak_decay_lowers_risk_off_score_on_easing_vol() -> None:
    idx = pd.bdate_range("2020-01-01", periods=63)
    high = pd.Series(np.random.default_rng(1).normal(0.0, 0.04, 42), index=idx[:42])
    calm = pd.Series(np.random.default_rng(2).normal(0.002, 0.008, 21), index=idx[42:])
    window = pd.concat([high, calm])
    base = compute_regime_scores(window, apply_vol_peak_decay=False)
    decayed = compute_regime_scores(window, apply_vol_peak_decay=True)
    assert decayed["risk_off_score"] <= base["risk_off_score"]
