from __future__ import annotations

import numpy as np
import pandas as pd

from app.engine.regime_policy_v2 import (
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


def test_stress_window_elevates_risk_off_score() -> None:
    idx = pd.bdate_range("2020-03-01", periods=63)
    crash = pd.Series(np.linspace(0.0, -0.02, 63), index=idx)
    calm = pd.Series([0.001] * 63, index=pd.bdate_range("2019-01-01", periods=63))
    stress_scores = compute_regime_scores(crash)
    calm_scores = compute_regime_scores(calm)
    assert stress_scores["risk_off_score"] > calm_scores["risk_off_score"]
