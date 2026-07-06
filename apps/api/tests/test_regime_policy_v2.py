from __future__ import annotations

import pytest
import numpy as np
import pandas as pd

from app.engine.regime_policy_v2 import (
    RISK_OFF_WEIGHTS,
    SCORE_ARBITRATION_MARGIN,
    _allows_fast_exit_to_risk_on,
    _cooldown_for_transition,
    _detect_recovery_signals,
    _drawdown_recovery_ratio,
    _hysteresis_for_active_regime,
    arbitrate_regime,
    compute_regime_scores,
    resolve_regime_signal_v2,
    score_winner_regime,
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


def test_score_winner_requires_margin_not_tie() -> None:
    assert score_winner_regime(
        {"risk_off_score": 0.52, "risk_on_score": 0.50}, margin=SCORE_ARBITRATION_MARGIN
    ) == "neutral"
    assert score_winner_regime(
        {"risk_off_score": 0.8, "risk_on_score": 0.2}, margin=SCORE_ARBITRATION_MARGIN
    ) == "risk_off"


def test_arbitration_no_risk_off_on_near_tie() -> None:
    """Former off>=on tie could pick risk_off; margin keeps neutral."""
    assert arbitrate_regime(
        {"risk_off_score": 0.44, "risk_on_score": 0.42}, "auto", min_confidence=0.42
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


def test_allows_fast_exit_to_risk_on_when_63d_eased() -> None:
    assert _allows_fast_exit_to_risk_on({"risk_off_score": 0.8, "risk_on_score": 0.25}) is False
    assert _allows_fast_exit_to_risk_on({"risk_off_score": 0.48, "risk_on_score": 0.3}) is True
    assert _allows_fast_exit_to_risk_on({"risk_off_score": 0.6, "risk_on_score": 0.65}) is True


def _bear_chop_with_short_rebounds() -> pd.Series:
    """Sustained high vol / stress with brief positive short windows (2022-style chop)."""
    idx = pd.bdate_range("2021-06-01", periods=500)
    rng = np.random.default_rng(77)
    base = rng.normal(-0.0005, 0.028, len(idx))
    for i in range(21, len(idx), 42):
        base[i - 14 : i] += 0.004
    return pd.Series(base, index=idx)


def test_fast_exit_no_risk_on_when_63d_risk_off_dominates() -> None:
    bench_ret = _bear_chop_with_short_rebounds()
    _, timeline = walk_forward_regime_timeline_v2(
        bench_ret,
        "auto",
        cooldown_steps=2,
        confirm_steps=1,
        fast_risk_off_exit=True,
    )
    for row in timeline:
        off = float(row["risk_off_score"])
        on = float(row["risk_on_score"])
        if off > on and off >= 0.55:
            assert row["raw_regime"] != "risk_on"


def test_strong_off_scores_force_active_risk_off(monkeypatch: pytest.MonkeyPatch) -> None:
    """When 63d off dominates on for 3+ steps, active must leave risk_on for risk_off."""
    idx = pd.bdate_range("2020-01-01", periods=200)
    bench_ret = pd.Series(0.001, index=idx)
    dominant = {
        "risk_off_score": 0.8,
        "risk_on_score": 0.2,
        "neutral_score": 0.2,
    }
    mild_on = {
        "risk_off_score": 0.35,
        "risk_on_score": 0.55,
        "neutral_score": 0.45,
    }
    call = {"n": 0}

    def fake_resolve(
        window: pd.Series,
        requested_mode: str,
        **kwargs: object,
    ) -> tuple[str, dict[str, float]]:
        call["n"] += 1
        if call["n"] == 1:
            return "risk_on", mild_on
        return "risk_off", dominant

    monkeypatch.setattr(
        "app.engine.regime_policy_v2.resolve_regime_signal_v2",
        fake_resolve,
    )
    _, timeline = walk_forward_regime_timeline_v2(
        bench_ret,
        "auto",
        cooldown_steps=2,
        confirm_steps=2,
        fast_risk_off_exit=False,
    )
    assert len(timeline) >= 3
    assert timeline[0]["regime"] == "risk_on"
    assert all(row["regime"] == "risk_off" for row in timeline[1:4])
    assert all(row["raw_regime"] == "risk_off" for row in timeline[1:4])


def test_vol_peak_decay_lowers_risk_off_score_on_easing_vol() -> None:
    idx = pd.bdate_range("2020-01-01", periods=63)
    high = pd.Series(np.random.default_rng(1).normal(0.0, 0.04, 42), index=idx[:42])
    calm = pd.Series(np.random.default_rng(2).normal(0.002, 0.008, 21), index=idx[42:])
    window = pd.concat([high, calm])
    base = compute_regime_scores(window, apply_vol_peak_decay=False)
    decayed = compute_regime_scores(window, apply_vol_peak_decay=True)
    assert decayed["risk_off_score"] <= base["risk_off_score"]


def test_drawdown_recovery_ratio_rises_after_rebound() -> None:
    idx = pd.bdate_range("2020-02-01", periods=200)
    crash = np.concatenate([np.linspace(0.0, -0.04, 40), np.full(20, -0.015)])
    rebound = np.linspace(0.025, 0.003, 140)
    ret = np.concatenate([crash, rebound])[: len(idx)]
    series = pd.Series(ret, index=idx)
    at_trough = _drawdown_recovery_ratio(series.iloc[:60])
    after_rebound = _drawdown_recovery_ratio(series)
    assert after_rebound > at_trough


def test_recovery_exit_uses_zero_cooldown_and_confirm() -> None:
    assert _cooldown_for_transition("risk_off", "risk_on", 2, recovery=True) == 0
    assert _cooldown_for_transition("risk_off", "neutral", 2, recovery=True) == 0
    raw, cd, cf = _hysteresis_for_active_regime(
        "risk_off",
        "risk_on",
        {"risk_off_score": 0.52, "risk_on_score": 0.48},
        cooldown_steps=2,
        confirm_steps=2,
        recovery=True,
    )
    assert raw == "risk_on"
    assert cd == 0
    assert cf == 0


def test_covid_style_crash_recovers_faster_than_without_recovery() -> None:
    """V-crash + sustained rebound: recovery path exits risk_off sooner."""
    idx = pd.bdate_range("2019-01-01", periods=500)
    crash = np.concatenate(
        [np.full(120, 0.001), np.linspace(0.0, -0.04, 25), np.full(15, -0.02)]
    )
    rebound = np.concatenate(
        [np.linspace(0.03, 0.005, 30), np.full(200, 0.0025), np.full(110, 0.0015)]
    )
    ret = np.concatenate([crash, rebound])[: len(idx)]
    bench_ret = pd.Series(ret, index=idx)

    def _first_non_risk_off(timeline: list[dict]) -> int | None:
        for i, row in enumerate(timeline):
            if row["regime"] != "risk_off":
                return i
        return None

    _, legacy = walk_forward_regime_timeline_v2(
        bench_ret, "auto", fast_risk_off_exit=False, cooldown_steps=2, confirm_steps=2
    )
    _, optimized = walk_forward_regime_timeline_v2(
        bench_ret, "auto", fast_risk_off_exit=True, cooldown_steps=2, confirm_steps=2
    )
    assert _risk_off_steps(optimized) <= _risk_off_steps(legacy)
    legacy_exit = _first_non_risk_off(legacy)
    opt_exit = _first_non_risk_off(optimized)
    if legacy_exit is not None and opt_exit is not None:
        assert opt_exit <= legacy_exit
