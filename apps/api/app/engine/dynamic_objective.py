"""Regime-based dynamic objective helpers for main Jasper backtest."""

from __future__ import annotations

from typing import Any, Callable

import pandas as pd

from app.engine.allocator import AllocatorParams
from app.engine.objective_switch_lab import (
    _build_allocator_resolver,
    allocator_preset_for_objective,
    current_snapshot_for_detector,
    resolve_raw_regime_for_detector,
    walk_forward_timeline_for_detector,
)
from app.engine.factors import FactorParams, factor_params_from_dict
from app.engine.ai_json import round_ai_float
from app.engine.objectives import DYNAMIC_COMPREHENSIVE_SCORING
from app.engine.regime_detection_cache import (
    RegimeDetectionBundle,
    bundle_active_regime_resolver,
    compute_regime_detection_bundle,
    get_or_compute_regime_bundle,
)
from app.engine.asset_class_policy import (
    build_class_budget_resolver,
    class_budget_by_regime_from_trial_params,
    class_budget_from_params,
    has_regime_class_quotas,
    normalize_regime_class_quotas,
)
from app.engine.regime_policy import (
    REGIME_OBJECTIVE_MAP,
    RegimeSignal,
    objective_for_regime,
)

DYNAMIC_OBJECTIVE = "dynamic"
DEFAULT_REGIME_MODE = "auto"
DEFAULT_DETECTOR_VERSION = "v2"
REGIME_KEYS: tuple[RegimeSignal, ...] = ("risk_off", "neutral", "risk_on")
REGIME_ALLOCATOR_KEYS: tuple[str, ...] = (
    "mode",
    "lookback_days",
    "shrinkage",
    "risk_aversion",
)


def is_dynamic_objective(objective: str) -> bool:
    return objective == DYNAMIC_OBJECTIVE


def trial_scoring_objective(objective_effective: str) -> str:
    """Scalar used for Optuna + Pro champion ranking (``objective_value_is``).

    Dynamic mode still switches allocator objective per rebalance (regime map), but
    trials and champions are compared on one in-sample comprehensive score on the
    full dynamic backtest (see ``compute_dynamic_comprehensive_score``)—not max Sharpe
    alone and not a per-step blend of regime objectives.
    """
    if is_dynamic_objective(objective_effective):
        return DYNAMIC_COMPREHENSIVE_SCORING
    return objective_effective


def resolve_regime_mode(req_regime_mode: str | None) -> str:
    mode = (req_regime_mode or DEFAULT_REGIME_MODE).strip().lower()
    if mode in ("auto", "risk_off", "neutral", "risk_on"):
        return mode
    return DEFAULT_REGIME_MODE


def allocator_params_from_setup(setup: dict[str, Any]) -> AllocatorParams:
    """Build allocator from a setup dict (round_setup or per-regime slice)."""
    return AllocatorParams(
        mode=str(setup.get("mode", "mean_variance")),
        lookback_days=int(setup.get("lookback_days", 252)),
        shrinkage=float(setup.get("shrinkage", 0.1)),
        risk_aversion=float(setup.get("risk_aversion", 4.0)),
    )


def _default_regime_allocator_setup(regime: RegimeSignal) -> dict[str, Any]:
    preset = allocator_preset_for_objective(objective_for_regime(regime))
    return {
        "mode": preset.mode,
        "lookback_days": int(preset.lookback_days),
        "shrinkage": float(preset.shrinkage),
        "risk_aversion": float(preset.risk_aversion),
    }


def _round_regime_setup_value(key: str, val: Any) -> Any:
    if key == "mode":
        return str(val)
    if key == "lookback_days":
        return int(round(float(val)))
    if key in ("shrinkage", "risk_aversion"):
        return round_ai_float(float(val), key=key)
    return val


def normalize_regime_setups(
    raw: dict[str, Any] | None,
    *,
    shared_setup: dict[str, Any] | None = None,
) -> dict[str, dict[str, Any]]:
    """Ensure risk_off / neutral / risk_on allocator slices; fill gaps from REGIME_OBJECTIVE_MAP."""
    out: dict[str, dict[str, Any]] = {}
    shared = dict(shared_setup or {})
    raw_map = raw if isinstance(raw, dict) else {}
    for regime in REGIME_KEYS:
        per = raw_map.get(regime) if isinstance(raw_map.get(regime), dict) else {}
        merged = dict(shared)
        merged.update(per)
        for key in REGIME_ALLOCATOR_KEYS:
            if key not in merged or merged[key] is None:
                merged[key] = _default_regime_allocator_setup(regime)[key]
        out[regime] = {
            k: _round_regime_setup_value(k, merged[k]) for k in REGIME_ALLOCATOR_KEYS
        }
    return out


def has_regime_matrix(regime_setups: dict[str, Any] | None) -> bool:
    if not isinstance(regime_setups, dict) or not regime_setups:
        return False
    return any(isinstance(regime_setups.get(r), dict) for r in REGIME_KEYS)


def build_active_regime_resolver(
    bench_ret: pd.Series,
    *,
    regime_mode: str = DEFAULT_REGIME_MODE,
    lookback_days: int = 63,
    cooldown_steps: int = 2,
    confirm_steps: int = 1,
    detector_version: str = DEFAULT_DETECTOR_VERSION,
    fast_risk_off_exit: bool = True,
    regime_bundle: RegimeDetectionBundle | None = None,
) -> tuple[Callable[[pd.Timestamp], RegimeSignal], list[dict[str, Any]], int]:
    """Walk-forward active regime at each rebalance date (V2 detector + cooldown)."""
    if regime_bundle is not None:
        timeline = list(regime_bundle.timeline)
        switch_count = int(regime_bundle.switch_count)
        return bundle_active_regime_resolver(regime_bundle), timeline, switch_count
    switch_count, timeline = walk_forward_timeline_for_detector(
        bench_ret,
        regime_mode,
        detector_version=detector_version,
        cooldown_steps=cooldown_steps,
        confirm_steps=confirm_steps,
        fast_risk_off_exit=fast_risk_off_exit,
    )
    by_date = {row["date"]: row for row in timeline}
    dates_sorted = sorted(by_date.keys())
    active_regime: RegimeSignal = (
        str(timeline[-1].get("regime") or timeline[-1].get("active_regime") or "neutral")
        if timeline
        else "neutral"
    )
    last_switch_idx = -cooldown_steps

    def resolver(dt: pd.Timestamp) -> RegimeSignal:
        nonlocal active_regime, last_switch_idx
        key = dt.strftime("%Y-%m-%d")
        prior = [d for d in dates_sorted if d <= key]
        if prior:
            row = by_date[prior[-1]]
            window = bench_ret.loc[:dt].tail(lookback_days)
            raw_regime = resolve_raw_regime_for_detector(
                window,
                regime_mode,
                detector_version=detector_version,
                vol_history=bench_ret.loc[:dt],
            )
            candidate: RegimeSignal = raw_regime
            idx = dates_sorted.index(prior[-1])
            if candidate != active_regime and idx - last_switch_idx >= cooldown_steps:
                active_regime = candidate
                last_switch_idx = idx
            elif row.get("switched"):
                active_regime = str(
                    row.get("active_regime") or row.get("regime") or active_regime
                )
        return active_regime

    return resolver, timeline, switch_count


def build_regime_matrix_allocator_resolver(
    bench_ret: pd.Series,
    regime_setups: dict[str, dict[str, Any]],
    *,
    regime_mode: str = DEFAULT_REGIME_MODE,
    lookback_days: int = 63,
    cooldown_steps: int = 2,
    confirm_steps: int = 1,
    detector_version: str = DEFAULT_DETECTOR_VERSION,
    fast_risk_off_exit: bool = True,
    regime_bundle: RegimeDetectionBundle | None = None,
) -> tuple[Callable[[pd.Timestamp], AllocatorParams], list[dict[str, Any]], int]:
    """Per-rebalance allocator from AI regime matrix (not hard-coded REGIME_OBJECTIVE_MAP presets)."""
    matrix = normalize_regime_setups(regime_setups)
    regime_resolver, timeline, switch_count = build_active_regime_resolver(
        bench_ret,
        regime_mode=regime_mode,
        lookback_days=lookback_days,
        cooldown_steps=cooldown_steps,
        confirm_steps=confirm_steps,
        detector_version=detector_version,
        fast_risk_off_exit=fast_risk_off_exit,
        regime_bundle=regime_bundle,
    )

    def resolver(dt: pd.Timestamp) -> AllocatorParams:
        regime = regime_resolver(dt)
        return allocator_params_from_setup(matrix.get(regime, matrix["neutral"]))

    return resolver, timeline, switch_count


def build_regime_factor_params_resolver(
    active_regime_resolver: Callable[[pd.Timestamp], RegimeSignal],
    factor_by_regime: dict[str, FactorParams],
) -> Callable[[pd.Timestamp], FactorParams]:
    """Per-rebalance factor params keyed by active regime (Optuna samples per regime)."""
    neutral = factor_by_regime.get("neutral") or FactorParams()
    fallback = neutral

    def resolver(dt: pd.Timestamp) -> FactorParams:
        regime = active_regime_resolver(dt)
        return factor_by_regime.get(regime) or fallback

    return resolver


def factor_by_regime_from_trial_params(
    params: dict[str, Any],
    *,
    default_lookback: int = 252,
) -> dict[str, FactorParams] | None:
    """Rebuild per-regime factor params from Optuna trial dict (``risk_off__w_mom``, …)."""
    if not params.get("regime_factor_matrix"):
        return None
    from app.engine.param_taxonomy import (
        FACTOR_CATEGORICAL_KEYS,
        is_factor_numeric_key,
        parse_regime_factor_param_key,
    )

    slices: dict[str, dict[str, Any]] = {r: {} for r in REGIME_KEYS}
    for key, val in params.items():
        parsed = parse_regime_factor_param_key(key)
        if not parsed:
            continue
        regime, factor_key = parsed
        if is_factor_numeric_key(factor_key):
            slices[regime][factor_key] = val
    for cat in FACTOR_CATEGORICAL_KEYS:
        if cat in params:
            for regime in REGIME_KEYS:
                slices[regime][cat] = params[cat]
    out: dict[str, FactorParams] = {}
    for regime in REGIME_KEYS:
        if not any(is_factor_numeric_key(k) for k in slices[regime]):
            continue
        out[regime] = factor_params_from_dict(
            slices[regime], default_lookback=default_lookback
        )
    return out or None


def factor_params_resolver_from_trial_params(
    params: dict[str, Any],
    active_regime_resolver: Callable[[pd.Timestamp], RegimeSignal] | None,
    *,
    default_lookback: int = 252,
) -> Callable[[pd.Timestamp], FactorParams] | None:
    """Match Optuna trial scoring when report assembly re-runs simulates."""
    factor_by_regime = factor_by_regime_from_trial_params(
        params, default_lookback=default_lookback
    )
    if not factor_by_regime or active_regime_resolver is None:
        return None
    return build_regime_factor_params_resolver(active_regime_resolver, factor_by_regime)


def build_dynamic_objective_context(
    prices_with_benchmark: pd.DataFrame,
    benchmark_ticker: str,
    *,
    regime_mode: str = DEFAULT_REGIME_MODE,
    fast_risk_off_exit: bool = True,
    regime_setups: dict[str, Any] | None = None,
    shared_round_setup: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Walk-forward regime timeline + per-rebalance allocator resolver (V2)."""
    bench = (
        benchmark_ticker
        if benchmark_ticker in prices_with_benchmark.columns
        else prices_with_benchmark.columns[0]
    )
    bench_ret = prices_with_benchmark[bench].pct_change().dropna()
    regime_bundle = compute_regime_detection_bundle(
        bench_ret,
        benchmark_ticker=bench,
        regime_mode=regime_mode,
        detector_version=DEFAULT_DETECTOR_VERSION,
        fast_risk_off_exit=fast_risk_off_exit,
    )
    timeline = list(regime_bundle.timeline)
    switch_count = int(regime_bundle.switch_count)
    active_regime_resolver = None
    if has_regime_matrix(regime_setups):
        active_regime_resolver = bundle_active_regime_resolver(regime_bundle)
        resolver, _, _ = build_regime_matrix_allocator_resolver(
            bench_ret,
            normalize_regime_setups(regime_setups, shared_setup=shared_round_setup),
            regime_mode=regime_mode,
            detector_version=DEFAULT_DETECTOR_VERSION,
            fast_risk_off_exit=fast_risk_off_exit,
            regime_bundle=regime_bundle,
        )
        objectives_used = sorted(
            {
                str(REGIME_OBJECTIVE_MAP.get(r, ""))
                for r in REGIME_KEYS
                if r in (regime_setups or {})
            }
        ) or sorted(
            {str(row.get("objective", "")) for row in timeline if row.get("objective")}
        )
    else:
        resolver, _, _ = _build_allocator_resolver(
            bench_ret,
            regime_mode,
            fixed_objective=None,
            detector_version=DEFAULT_DETECTOR_VERSION,
            fast_risk_off_exit=fast_risk_off_exit,
            precomputed_timeline=timeline,
            precomputed_switch_count=switch_count,
        )
        objectives_used = sorted(
            {str(row.get("objective", "")) for row in timeline if row.get("objective")}
        )
    snap = current_snapshot_for_detector(
        bench_ret, regime_mode, detector_version=DEFAULT_DETECTOR_VERSION
    )
    return {
        "allocator_resolver": resolver,
        "regime_timeline": timeline,
        "regime_switch_count": switch_count,
        "current_regime": snap,
        "benchmark_ticker": bench,
        "bench_ret": bench_ret,
        "regime_mode": regime_mode,
        "detector_version": DEFAULT_DETECTOR_VERSION,
        "fast_risk_off_exit": fast_risk_off_exit,
        "objectives_used": objectives_used,
        "regime_setups": (
            normalize_regime_setups(regime_setups, shared_setup=shared_round_setup)
            if has_regime_matrix(regime_setups)
            else None
        ),
        "active_regime_resolver": active_regime_resolver,
        "regime_bundle": regime_bundle,
    }


def refresh_dynamic_allocator_resolver(
    dynamic_ctx: dict[str, Any],
    *,
    regime_setups: dict[str, Any] | None,
    shared_round_setup: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Update resolver in an existing dynamic_ctx after a Pro round AI seed."""
    bench_ret = dynamic_ctx.get("bench_ret")
    if bench_ret is None or not isinstance(bench_ret, pd.Series):
        return dynamic_ctx
    regime_mode = str(dynamic_ctx.get("regime_mode") or DEFAULT_REGIME_MODE)
    fast_exit = bool(dynamic_ctx.get("fast_risk_off_exit", True))
    if has_regime_matrix(regime_setups):
        matrix = normalize_regime_setups(regime_setups, shared_setup=shared_round_setup)
        detector_version = str(
            dynamic_ctx.get("detector_version") or DEFAULT_DETECTOR_VERSION
        )
        bench = str(dynamic_ctx.get("benchmark_ticker") or "")
        regime_bundle = get_or_compute_regime_bundle(
            dynamic_ctx,
            bench_ret,
            benchmark_ticker=bench,
            regime_mode=regime_mode,
            detector_version=detector_version,
            fast_risk_off_exit=fast_exit,
        )
        regime_resolver = bundle_active_regime_resolver(regime_bundle)
        allocator_resolver, _, _ = build_regime_matrix_allocator_resolver(
            bench_ret,
            matrix,
            regime_mode=regime_mode,
            detector_version=detector_version,
            fast_risk_off_exit=fast_exit,
            regime_bundle=regime_bundle,
        )
        out = dict(dynamic_ctx)
        out["allocator_resolver"] = allocator_resolver
        out["active_regime_resolver"] = regime_resolver
        out["regime_timeline"] = list(regime_bundle.timeline)
        out["regime_switch_count"] = int(regime_bundle.switch_count)
        out["regime_setups"] = matrix
        out["regime_bundle"] = regime_bundle
        return out
    return dynamic_ctx


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


def build_regime_class_budget_resolver(
    active_regime_resolver: Callable[[pd.Timestamp], RegimeSignal],
    regime_class_quotas: dict[str, Any],
    *,
    shared_setup: dict[str, Any] | None = None,
    asset_classes: list[str] | None = None,
) -> Callable[[pd.Timestamp], dict[str, float]] | None:
    """Per-rebalance class budget from AI regime_class_quotas matrix."""
    if not has_regime_class_quotas(regime_class_quotas):
        return None
    budget_by_regime = normalize_regime_class_quotas(
        regime_class_quotas,
        shared_setup=shared_setup,
        asset_classes=asset_classes,
    )
    if not budget_by_regime:
        return None
    return build_class_budget_resolver(active_regime_resolver, budget_by_regime)


def class_budget_resolver_from_trial_params(
    params: dict[str, Any],
    active_regime_resolver: Callable[[pd.Timestamp], RegimeSignal] | None,
    *,
    asset_classes: list[str] | None = None,
) -> Callable[[pd.Timestamp], dict[str, float]] | None:
    """Match Optuna trial flat keys when report assembly re-runs simulates."""
    budget_by_regime = class_budget_by_regime_from_trial_params(
        params, asset_classes=asset_classes
    )
    if not budget_by_regime or active_regime_resolver is None:
        return None
    return build_class_budget_resolver(active_regime_resolver, budget_by_regime)


def refresh_dynamic_class_budget_resolver(
    dynamic_ctx: dict[str, Any],
    *,
    regime_class_quotas: dict[str, Any] | None,
    shared_round_setup: dict[str, Any] | None = None,
    asset_classes: list[str] | None = None,
) -> dict[str, Any]:
    """Update class_budget_resolver after a Pro round AI seed."""
    active = dynamic_ctx.get("active_regime_resolver")
    if active is None or not has_regime_class_quotas(regime_class_quotas):
        out = dict(dynamic_ctx)
        out.pop("class_budget_resolver", None)
        out.pop("regime_class_quotas", None)
        return out
    resolver = build_regime_class_budget_resolver(
        active,
        regime_class_quotas or {},
        shared_setup=shared_round_setup,
        asset_classes=asset_classes,
    )
    matrix = normalize_regime_class_quotas(
        regime_class_quotas,
        shared_setup=shared_round_setup,
        asset_classes=asset_classes,
    )
    out = dict(dynamic_ctx)
    out["class_budget_resolver"] = resolver
    out["regime_class_quotas"] = matrix
    return out


def apply_class_budget_resolver(
    sim_kw: dict[str, Any],
    prices: pd.DataFrame,
    resolver: Callable[[pd.Timestamp], dict[str, float]] | None,
    *,
    fallback_params: dict[str, Any] | None = None,
    asset_classes: list[str] | None = None,
) -> dict[str, Any]:
    if resolver is None:
        return sim_kw
    first_dt = prices.index[0]
    out = dict(sim_kw)
    out["class_budget"] = resolver(first_dt)
    out["class_budget_resolver"] = resolver
    return out


def default_class_budget_from_setup(
    setup: dict[str, Any] | None,
    *,
    asset_classes: list[str] | None = None,
) -> dict[str, float]:
    return class_budget_from_params(setup or {}, asset_classes=asset_classes)
