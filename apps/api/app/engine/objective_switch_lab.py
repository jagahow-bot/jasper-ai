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
    trim_prices_to_report_window,
)
from app.engine.regime_policy import (
    RegimeSignal,
    current_regime_snapshot,
    objective_for_regime,
    resolve_regime_signal,
    walk_forward_regime_timeline,
)
from app.engine.regime_policy_v2 import (
    current_regime_snapshot_v2,
    resolve_regime_signal_v2,
    walk_forward_regime_timeline_v2,
)
from app.engine.spec import BacktestSpec
from app.profiles import get_universe, get_universe_meta
from app.models import ObjectiveSwitchLabRequest, ObjectiveSwitchLabResult

LAB_TOP_N = 30
LAB_MAX_WEIGHT = 0.5
LAB_REBALANCE = "QE"
LAB_FEE_BPS = 10.0

LIMITATION_NOTE = (
    "Lab uses fixed top-N factor screen + allocator presets per objective "
    "(no Optuna search). Arms differ by objective→allocator mapping at each rebalance; "
    "not comparable to a fully optimized Jasper backtest. "
    "Regime detector v2 scores risk-on/risk-off indicators and arbitrates; v1 uses legacy thresholds."
)


def _normalize_detector_version(version: str | None) -> str:
    v = (version or "v2").strip().lower()
    return v if v in ("v1", "v2") else "v2"


def walk_forward_timeline_for_detector(
    bench_ret: pd.Series,
    requested_mode: str,
    *,
    detector_version: str,
    cooldown_steps: int,
    confirm_steps: int,
    fast_risk_off_exit: bool = True,
) -> tuple[int, list[dict[str, Any]]]:
    if detector_version == "v1":
        return walk_forward_regime_timeline(
            bench_ret,
            requested_mode,
            cooldown_steps=cooldown_steps,
            confirm_steps=confirm_steps,
        )
    return walk_forward_regime_timeline_v2(
        bench_ret,
        requested_mode,
        cooldown_steps=cooldown_steps,
        confirm_steps=confirm_steps,
        fast_risk_off_exit=fast_risk_off_exit,
    )


def resolve_raw_regime_for_detector(
    window: pd.Series,
    requested_mode: str,
    *,
    detector_version: str,
    vol_history: pd.Series | None = None,
) -> RegimeSignal:
    if detector_version == "v1":
        return resolve_regime_signal(window, requested_mode)
    regime, _ = resolve_regime_signal_v2(
        window, requested_mode, vol_history=vol_history
    )
    return regime


def current_snapshot_for_detector(
    bench_ret: pd.Series,
    requested_mode: str,
    *,
    detector_version: str,
) -> dict[str, Any]:
    if detector_version == "v1":
        snap = current_regime_snapshot(bench_ret, requested_mode)
        snap["detector_version"] = "v1"
        return snap
    return current_regime_snapshot_v2(bench_ret, requested_mode)


def build_regime_score_timeline(
    timeline: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for step in timeline:
        row: dict[str, Any] = {
            "date": step["date"],
            "active_regime": step.get("active_regime") or step["regime"],
            "switched": bool(step.get("switched")),
        }
        if "risk_off_score" in step:
            row["risk_off_score"] = step["risk_off_score"]
            row["risk_on_score"] = step["risk_on_score"]
            row["neutral_score"] = step.get("neutral_score")
        if step.get("raw_regime"):
            row["raw_regime"] = step["raw_regime"]
        if step.get("score_winner"):
            row["score_winner"] = step["score_winner"]
        rows.append(row)
    return rows

FORWARD_HORIZON_DAYS = 21
REGIME_LABELS = ("risk_off", "neutral", "risk_on")
MIN_SEGMENT_TRADING_DAYS = 3
MAX_SEGMENT_EPISODES_LISTED = 80
# Neutral hit: |segment return| within this band (range-bound / low-conviction moves).
NEUTRAL_RETURN_BAND = 0.03
# risk_off hit: segment annualized vol vs baseline (median ann vol of all episodes in this lab run).
RISK_OFF_VOL_ELEVATION_RATIO = 1.15


def _regime_expectation_text(regime: str) -> str:
    if regime == "risk_off":
        return (
            f"segment ann. vol ≥ {RISK_OFF_VOL_ELEVATION_RATIO:.0%} of episode-vol median "
            "(elevated vs lab baseline)"
        )
    if regime == "risk_on":
        return "positive benchmark return over the episode"
    return (
        "after risk_on: return ≤ 0 or below prior risk_on segment return; "
        "after risk_off: segment ann. vol below prior risk_off segment; "
        f"else |return| ≤ {NEUTRAL_RETURN_BAND:.0%}"
    )


def _neutral_expectation_hit(
    period_return: float,
    period_vol: float,
    *,
    prior_regime: str | None,
    prior_segment_return: float | None,
    prior_segment_vol: float | None,
) -> bool:
    """Neutral episodes are scored relative to the immediately preceding episode."""
    if prior_regime == "risk_on" and prior_segment_return is not None:
        return period_return <= 0.0 or period_return < prior_segment_return
    if prior_regime == "risk_off" and prior_segment_vol is not None:
        return period_vol < prior_segment_vol
    return abs(period_return) <= NEUTRAL_RETURN_BAND


def _active_regime_label(step: dict[str, Any]) -> str:
    return str(step.get("active_regime") or step["regime"])


def parse_regime_episode_segments(
    timeline: list[dict[str, Any]],
) -> list[dict[str, str]]:
    """Contiguous active-regime episodes from walk-forward timeline."""
    if not timeline:
        return []
    segments: list[dict[str, str]] = []
    current = _active_regime_label(timeline[0])
    start_date = str(timeline[0]["date"])
    for step in timeline[1:]:
        regime = _active_regime_label(step)
        if regime != current:
            segments.append({"regime": current, "start_date": start_date})
            current = regime
            start_date = str(step["date"])
    segments.append({"regime": current, "start_date": start_date})
    return segments


def _segment_benchmark_stats(
    bench_ret: pd.Series, start_idx: int, end_idx: int
) -> dict[str, float] | None:
    if start_idx is None or end_idx is None or end_idx < start_idx:
        return None
    seg_ret = bench_ret.iloc[start_idx : end_idx + 1]
    if len(seg_ret) < MIN_SEGMENT_TRADING_DAYS:
        return None
    compound = float((1.0 + seg_ret).prod() - 1.0)
    vol = float(seg_ret.std(ddof=0) * np.sqrt(252.0)) if len(seg_ret) > 1 else 0.0
    cum = (1.0 + seg_ret).cumprod()
    peak = cum.cummax()
    max_dd = float((cum / peak - 1.0).min())
    return {
        "segment_return": round(compound, 6),
        "segment_vol": round(vol, 6),
        "segment_max_drawdown": round(max_dd, 6),
        "length_days": len(seg_ret),
    }


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


def _risk_off_vol_hit(period_vol: float, vol_median: float) -> bool:
    if vol_median <= 0.0:
        return period_vol > 0.0
    return period_vol >= vol_median * RISK_OFF_VOL_ELEVATION_RATIO


def _regime_expectation_hit(
    regime: str,
    period_return: float,
    period_vol: float = 0.0,
    vol_median: float = 0.0,
    *,
    prior_regime: str | None = None,
    prior_segment_return: float | None = None,
    prior_segment_vol: float | None = None,
) -> bool:
    """risk_on: positive return; risk_off: elevated vol; neutral: relative to prior episode."""
    if regime == "risk_off":
        return _risk_off_vol_hit(period_vol, vol_median)
    if regime == "risk_on":
        return period_return > 0.0
    return _neutral_expectation_hit(
        period_return,
        period_vol,
        prior_regime=prior_regime,
        prior_segment_return=prior_segment_return,
        prior_segment_vol=prior_segment_vol,
    )


def _regime_expectation_miss_reason(
    regime: str,
    period_return: float,
    period_vol: float = 0.0,
    vol_median: float = 0.0,
    *,
    prior_regime: str | None = None,
    prior_segment_return: float | None = None,
    prior_segment_vol: float | None = None,
) -> str | None:
    if _regime_expectation_hit(
        regime,
        period_return,
        period_vol,
        vol_median,
        prior_regime=prior_regime,
        prior_segment_return=prior_segment_return,
        prior_segment_vol=prior_segment_vol,
    ):
        return None
    if regime == "risk_on":
        return "benchmark return not positive"
    if regime == "risk_off":
        return "vol not elevated vs baseline"
    if prior_regime == "risk_on":
        return "return did not weaken vs prior risk_on segment"
    if prior_regime == "risk_off":
        return "segment vol did not decrease vs prior risk_off segment"
    return (
        f"benchmark |return| above {NEUTRAL_RETURN_BAND:.0%} neutral band "
        "(no prior risk_on/risk_off episode)"
    )


def _episode_miss_severity(ep: dict[str, Any]) -> float:
    """Rank misses: wrong sign for risk_on; vol shortfall for risk_off; neutral vs prior."""
    regime = str(ep["regime"])
    ret = float(ep["segment_return"])
    if regime == "risk_on":
        return max(0.0, -ret)
    if regime == "risk_off":
        baseline = float(ep.get("vol_baseline", 0.0))
        vol = float(ep.get("segment_vol", 0.0))
        if baseline <= 0.0:
            return max(0.0, -vol)
        threshold = baseline * RISK_OFF_VOL_ELEVATION_RATIO
        return max(0.0, threshold - vol)
    prior_regime = ep.get("prior_regime")
    if prior_regime == "risk_on" and ep.get("prior_segment_return") is not None:
        prior_ret = float(ep["prior_segment_return"])
        return max(0.0, ret) + max(0.0, ret - prior_ret)
    if prior_regime == "risk_off" and ep.get("prior_segment_vol") is not None:
        prior_vol = float(ep["prior_segment_vol"])
        vol = float(ep.get("segment_vol", 0.0))
        return max(0.0, vol - prior_vol)
    return max(0.0, abs(ret) - NEUTRAL_RETURN_BAND)


def _alignment_grade(score: float) -> str:
    if score >= 70:
        return "A"
    if score >= 55:
        return "B"
    if score >= 40:
        return "C"
    return "D"


def _compute_forward_21d_diagnostic(
    bench_ret: pd.Series,
    timeline: list[dict[str, Any]],
    *,
    forward_days: int = FORWARD_HORIZON_DAYS,
) -> dict[str, Any]:
    """Legacy per-step 21d forward windows (secondary diagnostic only)."""
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
            "forward_horizon_days": forward_days,
            "explanations": ["No overlapping forward windows for 21d diagnostic."],
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
                "expectation": _regime_expectation_text(regime),
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
            "expectation": _regime_expectation_text(regime),
        }
        weighted_hits += sum(hits)
        weighted_total += len(hits)

    overall_score: float | None = None
    if weighted_total > 0:
        overall_score = round(100.0 * weighted_hits / weighted_total, 1)

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

    diag_explanations: list[str] = []
    if overall_score is not None:
        diag_explanations.append(
            f"21d-step diagnostic alignment: {overall_score:.0f}/100 over "
            f"{int(weighted_total)} walk-forward steps."
        )

    return {
        "regime_quality": regime_quality,
        "switch_timing": switch_timing,
        "switch_timing_summary": switch_summary,
        "overall_alignment_score": overall_score,
        "forward_horizon_days": forward_days,
        "forward_vol_median": round(vol_median, 6),
        "explanations": diag_explanations,
    }


def _build_episode_segments(
    bench_ret: pd.Series,
    timeline: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Full benchmark stats per contiguous active-regime episode."""
    raw_segments = parse_regime_episode_segments(timeline)
    if not raw_segments:
        return []

    date_to_idx = {d.strftime("%Y-%m-%d"): i for i, d in enumerate(bench_ret.index)}
    switch_dates = [
        date_to_idx[str(step["date"])]
        for step in timeline
        if step.get("switched") and str(step["date"]) in date_to_idx
    ]

    episodes: list[dict[str, Any]] = []
    for i, seg in enumerate(raw_segments):
        start_idx = date_to_idx.get(seg["start_date"])
        if start_idx is None:
            continue
        if i + 1 < len(raw_segments):
            next_start = date_to_idx.get(raw_segments[i + 1]["start_date"])
            end_idx = (next_start - 1) if next_start is not None else len(bench_ret) - 1
        else:
            end_idx = len(bench_ret) - 1

        stats = _segment_benchmark_stats(bench_ret, start_idx, end_idx)
        if stats is None:
            continue

        start_date = bench_ret.index[start_idx].strftime("%Y-%m-%d")
        end_date = bench_ret.index[end_idx].strftime("%Y-%m-%d")
        episodes.append(
            {
                "regime": seg["regime"],
                "start_date": start_date,
                "end_date": end_date,
                "length_days": stats["length_days"],
                "segment_return": stats["segment_return"],
                "segment_vol": stats["segment_vol"],
                "segment_max_drawdown": stats["segment_max_drawdown"],
                "switched_in": start_idx in switch_dates,
            }
        )
    return episodes


def compute_regime_prediction_quality(
    bench_ret: pd.Series,
    timeline: list[dict[str, Any]],
    *,
    forward_days: int = FORWARD_HORIZON_DAYS,
) -> dict[str, Any]:
    """Episode-based regime–benchmark alignment; 21d windows kept as secondary diagnostic."""
    empty = {
        "regime_quality": {},
        "segment_episodes": [],
        "notable_segments": {"longest": [], "failed": []},
        "overall_alignment_score": None,
        "alignment_grade": None,
        "explanations": [],
        "evaluation_mode": "episode_segments",
        "segment_vol_median": None,
        "forward_21d_diagnostic": {},
    }
    if not timeline:
        empty["explanations"] = ["Insufficient walk-forward steps for regime quality."]
        return empty

    forward_21d = _compute_forward_21d_diagnostic(
        bench_ret, timeline, forward_days=forward_days
    )
    episodes = _build_episode_segments(bench_ret, timeline)

    if not episodes:
        empty["forward_21d_diagnostic"] = forward_21d
        empty["explanations"] = [
            "No benchmark episodes long enough to score (need contiguous active-regime spans)."
        ]
        return empty

    vol_median = float(np.median([e["segment_vol"] for e in episodes]))
    for i, ep in enumerate(episodes):
        prior = episodes[i - 1] if i > 0 else None
        prior_regime = str(prior["regime"]) if prior else None
        prior_return = float(prior["segment_return"]) if prior else None
        prior_vol = float(prior["segment_vol"]) if prior else None
        ep["vol_baseline"] = vol_median
        ep["prior_regime"] = prior_regime
        ep["prior_segment_return"] = prior_return
        ep["prior_segment_vol"] = prior_vol
        ep["aligned_with_regime"] = _regime_expectation_hit(
            ep["regime"],
            ep["segment_return"],
            ep["segment_vol"],
            vol_median,
            prior_regime=prior_regime,
            prior_segment_return=prior_return,
            prior_segment_vol=prior_vol,
        )
        ep["miss_reason"] = _regime_expectation_miss_reason(
            ep["regime"],
            ep["segment_return"],
            ep["segment_vol"],
            vol_median,
            prior_regime=prior_regime,
            prior_segment_return=prior_return,
            prior_segment_vol=prior_vol,
        )

    by_regime: dict[str, list[dict[str, Any]]] = {k: [] for k in REGIME_LABELS}
    for ep in episodes:
        regime = ep["regime"]
        if regime not in by_regime:
            by_regime[regime] = []
        by_regime[regime].append(ep)

    regime_quality: dict[str, Any] = {}
    weighted_hits = 0.0
    weighted_total = 0.0
    for regime in REGIME_LABELS:
        bucket = by_regime.get(regime) or []
        if not bucket:
            regime_quality[regime] = {
                "segment_count": 0,
                "avg_segment_return": None,
                "avg_segment_vol": None,
                "hit_rate": None,
                "median_length_days": None,
                "expectation": _regime_expectation_text(regime),
            }
            continue
        hits = [b["aligned_with_regime"] for b in bucket]
        lengths = [b["length_days"] for b in bucket]
        hit_rate = float(sum(hits)) / len(hits)
        regime_quality[regime] = {
            "segment_count": len(bucket),
            "avg_segment_return": round(
                float(np.mean([b["segment_return"] for b in bucket])), 6
            ),
            "avg_segment_vol": round(float(np.mean([b["segment_vol"] for b in bucket])), 6),
            "hit_rate": round(hit_rate, 4),
            "median_length_days": int(np.median(lengths)),
            "expectation": _regime_expectation_text(regime),
        }
        weighted_hits += sum(hits)
        weighted_total += len(hits)

    overall_score: float | None = None
    grade: str | None = None
    if weighted_total > 0:
        overall_score = round(100.0 * weighted_hits / weighted_total, 1)
        grade = _alignment_grade(overall_score)

    failed = [e for e in episodes if not e["aligned_with_regime"]]
    longest = sorted(episodes, key=lambda e: e["length_days"], reverse=True)[:5]
    failed_sorted = sorted(failed, key=_episode_miss_severity, reverse=True)[:5]

    def _episode_row(e: dict[str, Any]) -> dict[str, Any]:
        row = {
            "regime": e["regime"],
            "start_date": e["start_date"],
            "end_date": e["end_date"],
            "length_days": e["length_days"],
            "segment_return": e["segment_return"],
            "segment_vol": e["segment_vol"],
            "segment_max_drawdown": e["segment_max_drawdown"],
            "aligned_with_regime": e["aligned_with_regime"],
        }
        if e.get("miss_reason"):
            row["miss_reason"] = e["miss_reason"]
        return row

    explanations: list[str] = []
    if overall_score is not None:
        explanations.append(
            f"Episode alignment: {overall_score:.0f}/100 (grade {grade}). "
            f"Scores {int(weighted_total)} contiguous active-regime span(s) on full benchmark "
            f"behavior from switch-in until the label changes."
        )
    for regime in REGIME_LABELS:
        q = regime_quality.get(regime, {})
        if not q.get("segment_count"):
            continue
        hr = q.get("hit_rate")
        med_len = q.get("median_length_days")
        explanations.append(
            f"{regime}: {q['segment_count']} episode(s), median {med_len}d, "
            f"avg return {q['avg_segment_return']:+.2%}, hit rate {hr:.0%} "
            f"({q['expectation']})."
        )
    fwd_score = forward_21d.get("overall_alignment_score")
    if fwd_score is not None:
        explanations.append(
            f"Secondary 21d-forward diagnostic (per walk-forward step): {fwd_score:.0f}/100 — "
            "see forward_21d_diagnostic for step-level detail."
        )

    listed_episodes = episodes[:MAX_SEGMENT_EPISODES_LISTED]

    return {
        "regime_quality": regime_quality,
        "segment_episodes": [_episode_row(e) for e in listed_episodes],
        "notable_segments": {
            "longest": [_episode_row(e) for e in longest],
            "failed": [_episode_row(e) for e in failed_sorted],
        },
        "overall_alignment_score": overall_score,
        "alignment_grade": grade,
        "explanations": explanations,
        "evaluation_mode": "episode_segments",
        "segment_vol_median": round(vol_median, 6),
        "forward_21d_diagnostic": forward_21d,
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
    detector_version: str = "v2",
    fast_risk_off_exit: bool = True,
    precomputed_timeline: list[dict[str, Any]] | None = None,
    precomputed_switch_count: int | None = None,
) -> tuple[Callable[[pd.Timestamp], AllocatorParams], list[dict[str, Any]], int]:
    """Resolver for switch arm; fixed arm passes fixed_objective."""
    if precomputed_timeline is not None:
        timeline = list(precomputed_timeline)
        switch_count = int(
            precomputed_switch_count
            if precomputed_switch_count is not None
            else sum(1 for row in timeline if row.get("switched"))
        )
        by_date = {row["date"]: row for row in timeline}
        dates_sorted = sorted(by_date.keys())
        default_objective = fixed_objective or (
            str(timeline[-1]["objective"]) if timeline else "max_sharpe"
        )

        def cached_resolver(dt: pd.Timestamp) -> AllocatorParams:
            if fixed_objective is not None:
                return allocator_preset_for_objective(fixed_objective)
            key = dt.strftime("%Y-%m-%d")
            prior = [d for d in dates_sorted if d <= key]
            if not prior:
                return allocator_preset_for_objective(default_objective)
            row = by_date[prior[-1]]
            objective = str(row.get("objective") or default_objective)
            return allocator_preset_for_objective(objective)

        return cached_resolver, timeline, switch_count

    switch_count, timeline = walk_forward_timeline_for_detector(
        bench_ret,
        requested_mode,
        detector_version=detector_version,
        cooldown_steps=cooldown_steps,
        confirm_steps=confirm_steps,
        fast_risk_off_exit=fast_risk_off_exit,
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
            window = bench_ret.loc[:dt].tail(lookback_days)
            raw_regime = resolve_raw_regime_for_detector(
                window,
                requested_mode,
                detector_version=detector_version,
                vol_history=bench_ret.loc[:dt],
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
    prices_sim_panel: pd.DataFrame,
    report_start: str,
    spec: BacktestSpec,
    bench_ret: pd.Series,
    regime_mode: str,
    objective: str | None,
    fixed_objective: str | None,
    cooldown_steps: int,
    confirm_steps: int,
    universe_by_ticker: dict[str, dict[str, Any]],
    detector_version: str = "v2",
    fast_risk_off_exit: bool = True,
) -> tuple[dict[str, Any], list[dict[str, Any]], int]:
    resolver, timeline, switch_count = _build_allocator_resolver(
        bench_ret,
        regime_mode,
        fixed_objective=fixed_objective,
        cooldown_steps=cooldown_steps,
        confirm_steps=confirm_steps,
        detector_version=detector_version,
        fast_risk_off_exit=fast_risk_off_exit,
    )
    factor_lb = resolver(prices.index[-1]).lookback_days
    metrics = simulate_dynamic_portfolio(
        prices_sim_panel,
        spec=spec,
        max_weight=LAB_MAX_WEIGHT,
        allocator=resolver(prices.index[0]),
        allocator_resolver=resolver,
        top_n=min(LAB_TOP_N, len(prices.columns)),
        factor_params=FactorParams(lookback_days=int(factor_lb)),
        universe_by_ticker=universe_by_ticker,
        report_start=report_start,
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
    detector_version = _normalize_detector_version(req.regime_detector_version)

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
    prices_sim_panel = prices[port_cols].copy()
    prices_port = trim_prices_to_report_window(prices_sim_panel, req.start_date)
    bench_ret = prices[bench].pct_change().dropna()
    universe_by_ticker = {u["ticker"]: u for u in universe if u["ticker"] in port_cols}

    train_ratio = float(req.train_ratio)
    if req.enable_oos:
        prices_train, prices_val, train_end, val_start = split_train_validation(
            prices_port, train_ratio
        )
    else:
        prices_train, prices_val = prices_port, prices_port.iloc[0:0]
        train_end = str(prices_port.index[-1].date())
        val_start = train_end

    cooldown = int(req.cooldown_steps)
    confirm = int(req.confirm_steps)
    fast_risk_off_exit = bool(req.fast_risk_off_exit) and detector_version == "v2"

    train_bench_slice = bench_ret.loc[prices_train.index[0] : prices_train.index[-1]]
    train_report = str(prices_train.index[0].date())
    fixed_is, _, _ = _simulate_arm(
        prices_train,
        prices_sim_panel=prices_sim_panel,
        report_start=train_report,
        spec=spec,
        bench_ret=train_bench_slice,
        regime_mode=regime_mode,
        objective=fixed_objective,
        fixed_objective=fixed_objective,
        cooldown_steps=cooldown,
        confirm_steps=confirm,
        universe_by_ticker=universe_by_ticker,
        detector_version=detector_version,
        fast_risk_off_exit=fast_risk_off_exit,
    )
    switch_is, timeline, switch_count = _simulate_arm(
        prices_train,
        prices_sim_panel=prices_sim_panel,
        report_start=train_report,
        spec=spec,
        bench_ret=train_bench_slice,
        regime_mode=regime_mode,
        objective=None,
        fixed_objective=None,
        cooldown_steps=cooldown,
        confirm_steps=confirm,
        universe_by_ticker=universe_by_ticker,
        detector_version=detector_version,
        fast_risk_off_exit=fast_risk_off_exit,
    )

    fixed_oos: dict[str, Any] | None = None
    switch_oos: dict[str, Any] | None = None
    if req.enable_oos and len(prices_val) > 60:
        val_bench = bench_ret.loc[prices_val.index[0] : prices_val.index[-1]]
        val_report = str(prices_val.index[0].date())
        fixed_oos, _, _ = _simulate_arm(
            prices_val,
            prices_sim_panel=prices_sim_panel,
            report_start=val_report,
            spec=spec,
            bench_ret=val_bench,
            regime_mode=regime_mode,
            objective=fixed_objective,
            fixed_objective=fixed_objective,
            cooldown_steps=cooldown,
            confirm_steps=confirm,
            universe_by_ticker=universe_by_ticker,
            detector_version=detector_version,
            fast_risk_off_exit=fast_risk_off_exit,
        )
        switch_oos, _, _ = _simulate_arm(
            prices_val,
            prices_sim_panel=prices_sim_panel,
            report_start=val_report,
            spec=spec,
            bench_ret=val_bench,
            regime_mode=regime_mode,
            objective=None,
            fixed_objective=None,
            cooldown_steps=cooldown,
            confirm_steps=confirm,
            universe_by_ticker=universe_by_ticker,
            detector_version=detector_version,
            fast_risk_off_exit=fast_risk_off_exit,
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

    snapshot = current_snapshot_for_detector(
        bench_ret, regime_mode, detector_version=detector_version
    )

    train_bench = train_bench_slice
    prediction_quality = compute_regime_prediction_quality(train_bench, timeline)
    benchmark_series, regime_timeline_enhanced = build_benchmark_series(
        train_bench, timeline
    )
    score_timeline = build_regime_score_timeline(regime_timeline_enhanced)

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
        detector_version=detector_version,
        fast_risk_off_exit=fast_risk_off_exit if detector_version == "v2" else None,
        regime_score_timeline=score_timeline,
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
