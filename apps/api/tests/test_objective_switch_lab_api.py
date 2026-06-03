from __future__ import annotations

from unittest.mock import patch

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def _synthetic_prices(n: int = 520, n_assets: int = 8) -> pd.DataFrame:
    idx = pd.bdate_range("2018-01-01", periods=n)
    rng = np.random.default_rng(42)
    cols = {f"E{i}": 100 * np.cumprod(1 + rng.normal(0.0003, 0.01, n)) for i in range(n_assets)}
    cols["SPY"] = 100 * np.cumprod(1 + rng.normal(0.0004, 0.012, n))
    return pd.DataFrame(cols, index=idx)


@patch("app.engine.objective_switch_lab.get_universe")
@patch("app.engine.objective_switch_lab.fetch_prices")
def test_lab_evaluate_endpoint(mock_fetch: object, mock_universe: object) -> None:
    prices = _synthetic_prices()
    mock_fetch.return_value = (prices, {"data_source": "test"})
    tickers = [c for c in prices.columns if c != "SPY"]
    mock_universe.return_value = [
        {"ticker": t, "asset_class": "equity"} for t in tickers
    ]

    res = client.post(
        "/lab/objective-switch/evaluate",
        json={
            "start_date": "2018-01-01",
            "end_date": "2020-06-01",
            "benchmark_ticker": "SPY",
            "regime_mode": "auto",
            "fixed_objective": "max_sharpe",
            "asset_classes": ["equity", "bond"],
            "enable_oos": True,
            "train_ratio": 0.7,
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["recommendation"] in ("APPLY", "NOT_YET", "NEED_MORE_DATA")
    assert "fixed_arm" in body
    assert "switch_arm" in body
    assert body["fixed_arm"]["objective"] == "max_sharpe"
    assert isinstance(body["regime_timeline"], list)
    assert body["limitation"]
    assert "regime_prediction_quality" in body
    pq = body["regime_prediction_quality"]
    assert "regime_quality" in pq
    assert "overall_alignment_score" in pq
    assert pq.get("evaluation_mode") == "episode_segments"
    assert "forward_21d_diagnostic" in pq
    assert isinstance(pq.get("explanations"), list)
    assert isinstance(body["benchmark_series"], list)
    if body["benchmark_series"]:
        pt = body["benchmark_series"][0]
        assert "date" in pt
        assert "cumulative_return_pct" in pt
    if body["regime_timeline"]:
        assert "active_regime" in body["regime_timeline"][0]
    assert body.get("detector_version") == "v2"
    assert isinstance(body.get("regime_score_timeline"), list)


@patch("app.engine.objective_switch_lab.get_universe")
@patch("app.engine.objective_switch_lab.fetch_prices")
def test_lab_evaluate_v2_score_timeline(mock_fetch: object, mock_universe: object) -> None:
    prices = _synthetic_prices()
    mock_fetch.return_value = (prices, {"data_source": "test"})
    tickers = [c for c in prices.columns if c != "SPY"]
    mock_universe.return_value = [
        {"ticker": t, "asset_class": "equity"} for t in tickers
    ]

    res = client.post(
        "/lab/objective-switch/evaluate",
        json={
            "start_date": "2018-01-01",
            "end_date": "2020-06-01",
            "regime_detector_version": "v2",
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["detector_version"] == "v2"
    timeline = body["regime_score_timeline"]
    assert isinstance(timeline, list)
    if timeline:
        pt = timeline[0]
        assert "risk_off_score" in pt
        assert "risk_on_score" in pt
        assert "active_regime" in pt


@patch("app.engine.objective_switch_lab.get_universe")
@patch("app.engine.objective_switch_lab.fetch_prices")
def test_lab_evaluate_v1_detector(mock_fetch: object, mock_universe: object) -> None:
    prices = _synthetic_prices()
    mock_fetch.return_value = (prices, {"data_source": "test"})
    tickers = [c for c in prices.columns if c != "SPY"]
    mock_universe.return_value = [
        {"ticker": t, "asset_class": "equity"} for t in tickers
    ]

    res = client.post(
        "/lab/objective-switch/evaluate",
        json={
            "start_date": "2018-01-01",
            "end_date": "2020-06-01",
            "regime_detector_version": "v1",
        },
    )
    assert res.status_code == 200, res.text
    assert res.json()["detector_version"] == "v1"


@patch("app.engine.objective_switch_lab.get_universe")
@patch("app.engine.objective_switch_lab.fetch_prices")
def test_lab_evaluate_validation_error(mock_fetch: object, mock_universe: object) -> None:
    prices = _synthetic_prices(n=40, n_assets=3)
    mock_fetch.return_value = (prices, {"data_source": "test"})
    mock_universe.return_value = [
        {"ticker": "E0", "asset_class": "equity"},
        {"ticker": "E1", "asset_class": "equity"},
    ]

    res = client.post(
        "/lab/objective-switch/evaluate",
        json={
            "start_date": "2024-01-01",
            "end_date": "2024-03-01",
            "benchmark_ticker": "SPY",
            "asset_classes": ["equity"],
        },
    )
    assert res.status_code == 400


def test_regime_prediction_quality_structure() -> None:
    from app.engine.objective_switch_lab import (
        compute_regime_prediction_quality,
        parse_regime_episode_segments,
    )
    from app.engine.regime_policy import walk_forward_regime_timeline

    idx = pd.bdate_range("2018-01-01", periods=520)
    rng = np.random.default_rng(7)
    bench_ret = pd.Series(rng.normal(0.0003, 0.01, len(idx)), index=idx)
    _, timeline = walk_forward_regime_timeline(bench_ret, "auto")
    quality = compute_regime_prediction_quality(bench_ret, timeline)
    assert quality["evaluation_mode"] == "episode_segments"
    assert isinstance(quality["regime_quality"], dict)
    assert "risk_off" in quality["regime_quality"]
    assert isinstance(quality.get("segment_episodes"), list)
    assert "forward_21d_diagnostic" in quality
    fwd = quality["forward_21d_diagnostic"]
    assert fwd.get("forward_horizon_days") == 21
    segments = parse_regime_episode_segments(timeline)
    assert len(segments) >= 1
    if quality["overall_alignment_score"] is not None:
        assert 0 <= quality["overall_alignment_score"] <= 100
        assert quality["alignment_grade"] in ("A", "B", "C", "D")


def test_episode_segments_cover_full_regime_span() -> None:
    from app.engine.objective_switch_lab import (
        _build_episode_segments,
        compute_regime_prediction_quality,
        parse_regime_episode_segments,
    )
    from app.engine.regime_policy import walk_forward_regime_timeline

    idx = pd.bdate_range("2020-01-01", periods=300)
    bench_ret = pd.Series(0.001, index=idx)
    _, timeline = walk_forward_regime_timeline(bench_ret, "auto", cooldown_steps=2)
    raw = parse_regime_episode_segments(timeline)
    episodes = _build_episode_segments(bench_ret, timeline)
    assert len(episodes) == len(raw)
    for ep in episodes:
        assert ep["length_days"] >= 3
        assert ep["start_date"] <= ep["end_date"]
        assert "segment_return" in ep
    quality = compute_regime_prediction_quality(bench_ret, timeline)
    if quality["segment_episodes"]:
        assert "aligned_with_regime" in quality["segment_episodes"][0]


def test_regime_expectation_hit_rules() -> None:
    from app.engine.objective_switch_lab import (
        NEUTRAL_RETURN_BAND,
        RISK_OFF_VOL_ELEVATION_RATIO,
        _regime_expectation_hit,
        _regime_expectation_miss_reason,
    )

    vol_median = 0.15
    assert _regime_expectation_hit("risk_on", 0.2187, 0.28, vol_median)
    assert _regime_expectation_hit("risk_on", 0.0752, 0.22, vol_median)
    assert not _regime_expectation_hit("risk_on", -0.05, 0.10, vol_median)
    assert _regime_expectation_miss_reason("risk_on", -0.05) == "benchmark return not positive"

    elevated_vol = vol_median * RISK_OFF_VOL_ELEVATION_RATIO
    assert _regime_expectation_hit("risk_off", -0.12, elevated_vol, vol_median)
    assert _regime_expectation_hit("risk_off", 0.08, elevated_vol + 0.01, vol_median)
    assert not _regime_expectation_hit("risk_off", -0.12, 0.05, vol_median)
    assert not _regime_expectation_hit("risk_off", 0.08, 0.10, vol_median)
    assert (
        _regime_expectation_miss_reason("risk_off", 0.08, 0.10, vol_median)
        == "vol not elevated vs baseline"
    )

    assert _regime_expectation_hit("neutral", 0.01, 0.25, vol_median)
    assert _regime_expectation_hit("neutral", -NEUTRAL_RETURN_BAND, 0.40, vol_median)
    assert not _regime_expectation_hit("neutral", 0.05, 0.10, vol_median)
    assert _regime_expectation_miss_reason("neutral", 0.05) is not None


def test_largest_misses_rank_wrong_sign_not_high_positive_return() -> None:
    from app.engine.objective_switch_lab import (
        _episode_miss_severity,
        compute_regime_prediction_quality,
    )

    idx = pd.bdate_range("2020-01-01", periods=120)
    rng = np.random.default_rng(99)
    bench_ret = pd.Series(rng.normal(0.0005, 0.02, len(idx)), index=idx)
    timeline = [
        {
            "date": d.strftime("%Y-%m-%d"),
            "regime": "risk_on",
            "active_regime": "risk_on",
            "switched": i == 0,
            "objective": "max_sharpe",
        }
        for i, d in enumerate(idx)
    ]
    quality = compute_regime_prediction_quality(bench_ret, timeline)
    failed = quality.get("notable_segments", {}).get("failed") or []
    for ep in failed:
        if ep["regime"] == "risk_on" and ep["segment_return"] > 0:
            pytest.fail(
                "risk_on episode with positive return should not appear in largest misses"
            )
    if len(failed) >= 2:
        severities = [_episode_miss_severity(ep) for ep in failed]
        assert severities == sorted(severities, reverse=True)


def test_regime_timeline_cooldown() -> None:
    from app.engine.regime_policy import walk_forward_regime_timeline

    idx = pd.bdate_range("2020-01-01", periods=400)
    rng = pd.Series(np.linspace(-0.002, 0.003, 400), index=idx)
    bench_ret = rng
    switches, timeline = walk_forward_regime_timeline(
        bench_ret, "auto", cooldown_steps=3, confirm_steps=1
    )
    assert isinstance(switches, int)
    assert len(timeline) > 0
    assert "objective" in timeline[0]
