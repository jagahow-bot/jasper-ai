"""Phase A: Optuna search + out-of-sample validation on real market data."""

from __future__ import annotations

import copy
import json
import logging
from typing import Any, Callable

logger = logging.getLogger(__name__)

import numpy as np
import pandas as pd

from app.champion_registry import CachedChampion, lookup_champion, record_champion
from app.job_continuation import (
    build_continuation_snapshot_from_meta,
    build_standard_snapshot_from_champion,
    continuation_runtime_state,
    extract_continuation_snapshot,
)
from app.engine.data import fetch_prices
from app.engine.asset_class_policy import (
    class_budget_from_params,
    enforce_param_controls_for_asset_classes,
    zero_disallowed_class_params,
)
from app.engine.param_bounds import (
    RunBlueprint,
    clamp_param_dict,
    normalize_param_controls,
)
from app.engine.mutable_params import GEMINI_LEARNING_MUTABLE_FIELDS
from app.engine.objectives import metrics_snapshot, objective_label
from app.engine.optimizer import run_optuna_search
from app.engine.portfolio import (
    anchor_weight_history_to_date,
    benchmark_metrics,
    equity_curve_series,
    metrics_for_horizon_window,
    simulate_dynamic_portfolio,
    simulate_portfolio,
    split_train_validation,
    cached_full_path_needs_stitch,
    stitch_full_path_from_slices,
    trim_prices_to_report_window,
)
from app.engine.spec import DEFAULT_SPEC, BacktestSpec
from app.models import (
    BacktestRequest,
    BacktestResult,
    DynamicObjectiveTimelinePoint,
    OptimizationMode,
    PortfolioCandidate,
    ProRoundSnapshot,
)
from app.profiles import get_universe, get_universe_meta, pin_guaranteed_supplements
from app.engine.allocator import AllocatorParams
from app.engine.analytics import (
    build_full_analytics,
    build_slim_analytics,
    exposure_by_regime_from_weight_history,
)
from app.engine.ai_params import (
    generate_ai_param_sets,
    generate_ai_round_champion,
    generate_ai_round_seed,
    _round_champion_fallback_code,
)
from app.engine.factors import FactorParams, factor_params_from_dict
from app.engine.ai_universe import refine_universe_with_ai
from app.engine.refinement import (
    assess_overfitting,
    assign_pro_round_model_codes,
    assign_search_model_codes,
    best_record_in_pool,
    build_round_seed_learning_payload,
    compute_round_benchmark_fields,
    merge_round_seed_budget_fields,
    build_round_champion_ai_payload,
    build_round_competition_pool,
    horizon_snapshots_from_full_path,
    record_for_model_code,
    record_objective_sort_value,
    model_signature as refinement_model_signature,
    model_code_sort_key,
    pool_records_in_trial_order,
    top_records_for_report,
    params_for_champion_seed,
    pro_round_display_allowlist,
    pro_round_report_top_n,
    records_for_pool_model_codes,
    register_prior_challenger_signatures,
    reconcile_pro_round_pool,
    retire_non_winner_model_codes,
    summarize_params_for_ai,
)
from app.engine.memory_budget import (
    cap_trials_for_runtime,
    cap_universe_for_runtime,
    maybe_collect_garbage,
    metrics_with_port_ret_from_cache,
    prune_search_records,
    search_records_cap,
    slim_search_metrics,
    trim_weight_history_for_response,
)
from app.engine.report_sim_cache import TrialReportCache
from app.engine.weights import effective_max_weight_cap
from app.engine.dynamic_objective import (
    DYNAMIC_OBJECTIVE,
    apply_allocator_resolver,
    apply_class_budget_resolver,
    build_dynamic_backtest_chart_payload,
    build_dynamic_objective_context,
    class_budget_resolver_from_trial_params,
    factor_params_resolver_from_trial_params,
    has_regime_matrix,
    is_dynamic_objective,
    ensure_regime_class_budget_resolver,
    refresh_dynamic_allocator_resolver,
    refresh_dynamic_class_budget_resolver,
    resolve_regime_mode,
    serialize_dynamic_timeline,
    trial_scoring_objective,
)
from app.engine.asset_class_policy import has_regime_class_quotas
from app.engine.param_taxonomy import has_regime_factor_ranges

WEIGHT_EPS = 0.001


def _is_pro_mode(req: BacktestRequest) -> bool:
    return (
        req.optimization_mode == OptimizationMode.pro_auto
        or req.enable_iterative_refinement
    )


def _resolve_objective(raw: str, custom_text: str | None) -> str:
    if raw == DYNAMIC_OBJECTIVE:
        return DYNAMIC_OBJECTIVE
    if raw != "custom":
        return raw
    t = (custom_text or "").lower()
    if any(k in t for k in ("回撤", "drawdown", "保守", "下行")):
        return "min_max_drawdown"
    if any(k in t for k in ("報酬", "return", "成長", "cagr")):
        return "max_return"
    if any(k in t for k in ("尾部", "cvar", "極端", "黑天鵝")):
        return "min_cvar"
    if any(k in t for k in ("平價", "風險均衡", "erc", "risk parity")):
        return "risk_parity_erc"
    if any(k in t for k in ("分散", "divers")):
        return "max_diversification"
    if any(k in t for k in ("sortino", "下行波動")):
        return "max_sortino"
    return "max_sharpe"


def _champion_report_horizons(
    candidate: PortfolioCandidate,
    *,
    oos_enabled: bool,
    period: dict[str, str],
    train_period: dict[str, str] | None,
    validation_period: dict[str, str] | None,
) -> dict[str, Any]:
    """IS / OOS / full-sample metrics for report narrative (not trial selection)."""
    sm = (candidate.analytics or {}).get("sample_metrics") or {}
    return {
        "oos_enabled": oos_enabled,
        "selection_basis": sm.get("selection"),
        "periods": {
            "in_sample": train_period,
            "out_of_sample": validation_period,
            "full_sample": period,
        },
        "in_sample": sm.get("in_sample"),
        "out_of_sample": sm.get("out_of_sample"),
        "full_sample": sm.get("full_sample"),
        "gap": sm.get("gap"),
        "train_sharpe": candidate.train_sharpe,
        "validation_sharpe": candidate.validation_sharpe,
        "display_sharpe": candidate.sharpe,
        "display_cagr": candidate.cagr,
        "display_max_drawdown": candidate.max_drawdown,
    }


def _weights_dict(
    tickers: list[str], w: np.ndarray, *, min_weight: float = WEIGHT_EPS
) -> dict[str, float]:
    floor = float(max(min_weight, WEIGHT_EPS))
    w_vec = np.atleast_1d(np.asarray(w, dtype=float)).ravel()
    return {
        tickers[i]: round(float(w_vec[i]), 4)
        for i in range(len(tickers))
        if i < len(w_vec) and w_vec[i] >= floor - 1e-12
    }


def _history_point(
    *,
    global_trial: int,
    round_idx: int,
    is_objective: float,
    oos_objective: float | None,
    gap_objective: float,
    penalty: float,
    risk_level: str,
    is_champion: bool,
    objective_label: str,
) -> dict[str, Any]:
    return {
        "trial": global_trial,
        "round": round_idx,
        "is_objective": round(is_objective, 6),
        "oos_objective": round(oos_objective, 6) if oos_objective is not None else None,
        "gap_objective": round(gap_objective, 6),
        "overfitting_penalty": round(penalty, 4),
        "overfitting_risk": risk_level,
        "is_champion": is_champion,
        "objective_label": objective_label,
    }


def _sort_round_records_for_convergence(
    round_records: list[tuple[float, dict, dict]],
) -> list[tuple[float, dict, dict]]:
    """Stable Optuna trial order for convergence trial ids (not completion order)."""

    def _trial_no(params: dict) -> int:
        try:
            return int(params.get("optuna_trial_number", 10**9))
        except (TypeError, ValueError):
            return 10**9

    return sorted(round_records, key=lambda r: (_trial_no(r[1]), id(r[1])))


def _convergence_global_trial_id(
    round_trial_base: int,
    params: dict,
    *,
    callback_trial_1based: int,
) -> int:
    """Map Optuna trial number to stable global convergence trial id."""
    try:
        optuna_no = int(params.get("optuna_trial_number"))
    except (TypeError, ValueError):
        optuna_no = callback_trial_1based - 1
    return round_trial_base + optuna_no


def _convergence_preview_payload(
    convergence_history: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Snapshot for job progress JSON (avoid later in-place mutation)."""
    return copy.deepcopy(convergence_history[-24:])


def _convergence_metrics_for_record(
    score: float,
    params: dict,
    metrics: dict[str, Any],
    *,
    trial_report_cache: TrialReportCache | None,
    objective_effective: str,
    oos_enabled: bool,
) -> dict[str, Any]:
    """Per-trial IS/OOS objectives; prefer per-trial Optuna stash over shared search blobs."""
    from app.engine.refinement import resolve_trial_metrics_for_reporting

    return resolve_trial_metrics_for_reporting(
        params,
        metrics,
        trial_report_cache=trial_report_cache,
        objective_effective=objective_effective,
        oos_enabled=oos_enabled,
        score=score,
    )


def _upsert_convergence_point(
    convergence_history: list[dict[str, Any]],
    point: dict[str, Any],
    *,
    round_idx: int,
    global_trial: int,
) -> None:
    convergence_history[:] = [
        p
        for p in convergence_history
        if not (p.get("round") == round_idx and p.get("trial") == global_trial)
    ]
    convergence_history.append(point)


def _append_convergence_from_record(
    convergence_history: list[dict[str, Any]],
    *,
    global_trial: int,
    round_idx: int,
    score: float,
    metrics: dict[str, Any],
    objective_effective: str,
    is_champion: bool,
) -> None:
    assess = metrics.get("overfitting_assessment") or {}
    is_obj = float(
        metrics.get(
            "objective_value_is",
            assess.get("in_sample_objective", 0.0),
        )
    )
    oos_raw = metrics.get("objective_value_oos", assess.get("out_of_sample_objective"))
    gap_raw = metrics.get("gap_objective", assess.get("gap_objective", 0.0))
    gap_objective = float(gap_raw)
    if (
        metrics.get("gap_objective") is None
        and oos_raw is not None
        and assess.get("gap_objective") is None
    ):
        gap_objective = is_obj - float(oos_raw)
    _upsert_convergence_point(
        convergence_history,
        _history_point(
            global_trial=global_trial,
            round_idx=round_idx,
            is_objective=is_obj,
            oos_objective=float(oos_raw) if oos_raw is not None else None,
            gap_objective=gap_objective,
            penalty=float(metrics.get("overfitting_penalty_applied", 0.0)),
            risk_level=str(assess.get("risk_level", "unknown")),
            is_champion=is_champion,
            objective_label=objective_label(objective_effective),
        ),
        round_idx=round_idx,
        global_trial=global_trial,
    )


def _resync_round_convergence_from_records(
    convergence_history: list[dict[str, Any]],
    *,
    round_idx: int,
    round_records: list[tuple[float, dict, dict]],
    round_trial_base: int,
    objective_effective: str,
    trial_report_cache: TrialReportCache | None = None,
    oos_enabled: bool = False,
) -> None:
    """Replace live Optuna preview points with per-trial metrics from round_records."""
    convergence_history[:] = [
        p for p in convergence_history if p.get("round") != round_idx
    ]
    ordered = _sort_round_records_for_convergence(round_records)
    for trial_i, (score, params, metrics) in enumerate(ordered):
        conv_metrics = _convergence_metrics_for_record(
            score,
            params,
            metrics,
            trial_report_cache=trial_report_cache,
            objective_effective=objective_effective,
            oos_enabled=oos_enabled,
        )
        _append_convergence_from_record(
            convergence_history,
            global_trial=_convergence_global_trial_id(
                round_trial_base,
                params,
                callback_trial_1based=trial_i + 1,
            ),
            round_idx=round_idx,
            score=score,
            metrics=conv_metrics,
            objective_effective=objective_effective,
            is_champion=False,
        )


def _relabel_round_champion_flags(
    convergence_history: list[dict[str, Any]],
    *,
    round_idx: int,
    champion_objective: float,
    objective_effective: str,
    round_records: list[tuple[float, dict, dict]],
    round_trial_base: int,
) -> None:
    """Mark the round's champion trial after the round winner is known."""
    for point in convergence_history:
        if point.get("round") == round_idx:
            point["is_champion"] = False
    ordered = _sort_round_records_for_convergence(round_records)
    for trial_i, (score, _params, metrics) in enumerate(ordered):
        obj = _record_objective_sort_value(objective_effective, score, metrics)
        if abs(obj - champion_objective) >= 1e-9:
            continue
        target_trial = round_trial_base + trial_i
        for point in convergence_history:
            if point.get("round") == round_idx and point.get("trial") == target_trial:
                point["is_champion"] = True
                return


def _record_objective_sort_value(
    objective_effective: str,
    score: float,
    metrics: dict[str, Any],
) -> float:
    if metrics.get("objective_value_is") is not None:
        return float(metrics["objective_value_is"])
    if objective_effective == "max_return":
        return float(metrics.get("cagr", 0.0))
    if objective_effective == "min_max_drawdown":
        return -abs(float(metrics.get("max_drawdown", 0.0)))
    if objective_effective == "max_sortino":
        return float(metrics.get("sortino", 0.0))
    if objective_effective == "min_cvar":
        return -abs(float(metrics.get("cvar_95", 0.0)))
    if objective_effective == "max_sharpe":
        return float(metrics.get("sharpe", 0.0))
    if objective_effective == "risk_parity_erc":
        return float(metrics.get("sharpe", 0.0)) - 0.25 * abs(
            float(metrics.get("max_drawdown", 0.0))
        )
    if objective_effective == "max_diversification":
        return (
            float(metrics.get("cagr", 0.0))
            - 0.35 * abs(float(metrics.get("max_drawdown", 0.0)))
            - 0.10 * float(metrics.get("turnover_avg", 0.0))
        )
    if objective_effective == "mean_variance_utility":
        return float(metrics.get("sharpe", 0.0)) - 0.15 * float(
            metrics.get("volatility", 0.0)
        )
    if objective_effective == "custom":
        return float(metrics.get("sharpe", 0.0)) - 0.2 * abs(
            float(metrics.get("max_drawdown", 0.0))
        )
    if objective_effective == DYNAMIC_OBJECTIVE:
        return float(metrics.get("sharpe", score))
    return float(score)


def _warm_start_progress_message(lang: str, cached: CachedChampion, req: BacktestRequest) -> str:
    short_job = cached.job_id[:8]
    if lang == "zh":
        base = (
            f"發現相同情境的歷史紀錄（job {short_job}…），"
            f"以先前冠軍 {cached.model_code} 為起點繼續優化"
        )
        if cached.match_type == "fuzzy":
            base += f"（回測終點不同：快取 {cached.end_date}，本次 {req.end_date}）"
        return base
    if lang == "ko":
        base = (
            f"동일 시나리오 기록 발견 (job {short_job}…), "
            f"이전 챔피언 {cached.model_code}에서 최적화 재개"
        )
        if cached.match_type == "fuzzy":
            base += f" (기간 종료일 다름: 캐시 {cached.end_date}, 이번 {req.end_date})"
        return base
    base = (
        f"Found prior run for same scenario (job {short_job}…), "
        f"warm-starting from champion {cached.model_code}"
    )
    if cached.match_type == "fuzzy":
        base += f" (end date differs: cached {cached.end_date}, this run {req.end_date})"
    return base


def _champion_record_from_cache(
    cached: CachedChampion,
) -> tuple[float, dict, dict]:
    params = dict(cached.champion_params)
    params["model_code"] = cached.model_code
    metrics = {
        "sharpe": float(cached.sharpe or 0.0),
        "cagr": float(cached.cagr or 0.0),
        "max_drawdown": float(cached.max_drawdown or 0.0),
        "raw_score": float(cached.objective_score or 0.0),
    }
    score = float(cached.objective_score or 0.0)
    return score, params, metrics


def _warm_start_facts(cached: CachedChampion, req: BacktestRequest) -> dict[str, Any]:
    return {
        "matched": True,
        "match_type": cached.match_type,
        "matched_job_id": cached.job_id,
        "seeded_model_code": cached.model_code,
        "cached_objective_score": cached.objective_score,
        "cached_sharpe": cached.sharpe,
        "cached_end_date": cached.end_date,
        "period_note": (
            "exact period match"
            if cached.match_type == "exact"
            else f"period differs (cached end {cached.end_date}, this run {req.end_date})"
        ),
    }


def _run_iterative_search(
    req: BacktestRequest,
    *,
    prices: pd.DataFrame,
    prices_sim_panel: pd.DataFrame,
    prices_train: pd.DataFrame,
    prices_val: pd.DataFrame,
    oos: bool,
    objective_effective: str,
    rebalance_rule: str,
    spec: BacktestSpec,
    universe_by_ticker: dict[str, dict[str, Any]],
    param_controls_dict: dict[str, dict],
    report_progress,
    trial_report_cache: TrialReportCache | None = None,
    dynamic_ctx: dict[str, Any] | None = None,
    initial_champion_record: tuple[float, dict, dict] | None = None,
    continuation_state: dict[str, Any] | None = None,
) -> tuple[list[tuple[float, dict, dict]], list[dict[str, Any]], dict[str, Any]]:
    """Champion-challenger rounds until plateau or max rounds."""
    trial_objective = trial_scoring_objective(objective_effective)
    allocator_resolver = (
        dynamic_ctx.get("allocator_resolver") if dynamic_ctx else None
    )
    batch0 = int(req.refinement_batch_size)
    challengers = int(req.refinement_challengers_per_round)
    max_rounds = int(req.refinement_max_rounds)
    patience = req.refinement_patience
    min_gain = float(req.refinement_min_improvement)
    start_round_idx = 0
    if continuation_state and continuation_state.get("mode") == "pro":
        start_round_idx = int(continuation_state.get("start_round_idx") or 0)
    remaining_rounds = max(0, max_rounds - start_round_idx)
    if start_round_idx > 0:
        est_trials = int(continuation_state.get("global_trial") or 0) + (
            (challengers + 1) * remaining_rounds
        )
    else:
        est_trials = batch0 + (challengers + 1) * max(0, max_rounds - 1)
    all_records: list[tuple[float, dict, dict]] = []
    convergence_history: list[dict[str, Any]] = []
    learning_trials: list[dict[str, Any]] = []

    if continuation_state and continuation_state.get("mode") == "pro":
        initial_champion_record = (
            continuation_state.get("initial_champion_record") or initial_champion_record
        )
        learning_trials = list(continuation_state.get("learning_trials") or [])
        convergence_history = list(continuation_state.get("convergence_history") or [])
        all_records = list(continuation_state.get("top_records") or [])

    champion_record: tuple[float, dict, dict] | None = initial_champion_record
    champion_score = (
        float(initial_champion_record[0]) if initial_champion_record is not None else float("-inf")
    )
    rounds_without_gain = int(
        (continuation_state or {}).get("rounds_without_gain") or 0
    )
    global_trial = int((continuation_state or {}).get("global_trial") or 0)
    ai_rationales: list[str] = list((continuation_state or {}).get("ai_rationales") or [])
    per_round: list[dict[str, Any]] = []
    prior_challenger_signatures: set[str] = set(
        (continuation_state or {}).get("prior_challenger_signatures") or set()
    )
    next_model_no = [
        int((continuation_state or {}).get("next_model_no") or 1)
    ]
    retired_model_codes: set[str] = set(
        (continuation_state or {}).get("retired_model_codes") or set()
    )
    carry_champion_model_code: str | None = (
        (continuation_state or {}).get("carry_champion_model_code")
        or (
            str(initial_champion_record[1].get("model_code"))
            if initial_champion_record and initial_champion_record[1].get("model_code")
            else None
        )
    )
    prior_round_setup: dict[str, Any] | None = (continuation_state or {}).get(
        "prior_round_setup"
    )
    prior_regime_setups: dict[str, Any] | None = (continuation_state or {}).get(
        "prior_regime_setups"
    )
    prior_regime_factor_ranges: dict[str, Any] | None = (continuation_state or {}).get(
        "prior_regime_factor_ranges"
    )
    prior_regime_class_quotas: dict[str, Any] | None = (continuation_state or {}).get(
        "prior_regime_class_quotas"
    )
    prior_factor_ranges: dict[str, Any] | None = (continuation_state or {}).get(
        "prior_factor_ranges"
    )
    prior_factor_choices: dict[str, Any] | None = (continuation_state or {}).get(
        "prior_factor_choices"
    )
    # dynamic_ctx is present whenever regime-adaptive allocation is on (dynamic objective
    # or the standalone regime_adaptive flag), so the AI per-regime allocator matrix applies
    # to any objective, not just objective=dynamic.
    use_regime_matrix = bool(dynamic_ctx)
    bench_ref_metrics = benchmark_metrics(
        prices_train, spec.benchmark_ticker, spec
    )
    is_period = {
        "start": str(prices_train.index[0].date()),
        "end": str(prices_train.index[-1].date()),
        "rows": int(len(prices_train)),
    }

    for round_idx in range(start_round_idx, max_rounds):
        n_trials = batch0 if round_idx == 0 else challengers
        carry_msg = (
            "incoming champion + new challengers"
            if champion_record is not None
            else "round 1 (challengers only)"
        )
        report_progress(
            global_trial,
            est_trials,
            f"Pro round {round_idx + 1}/{max_rounds}: {carry_msg}, preparing {n_trials} challengers…",
            champion_record[2]["sharpe"] if champion_record else None,
            round_idx + 1,
            max_rounds,
            _convergence_preview_payload(convergence_history),
        )

        incoming_champion_record = champion_record
        incoming_champion_score = (
            float(champion_score) if champion_record is not None else None
        )
        target_to_beat = champion_score + min_gain
        learning_context: dict[str, Any] | None = None
        incoming_champion_params: dict[str, Any] | None = (
            champion_record[1] if champion_record else None
        )
        round_incoming_model_code = carry_champion_model_code
        # For Gemini prompt injection, prefer the actual incumbent champion model_code
        # from this round's champion_record context (not potentially stale carry code).
        if (
            champion_record
            and isinstance(champion_record[1], dict)
            and champion_record[1].get("model_code")
        ):
            round_incoming_model_code = str(champion_record[1]["model_code"])
        if champion_record and round_idx > 0:
            # Learning context uses champion at round start; if the champion is re-run
            # and updated later in this round, the next round's build_gemini_learning_context
            # will pick up fresh metrics (not mid-round — would need an extra rebuild).
            learning_context = build_round_seed_learning_payload(
                champion_record=champion_record,
                champion_score=champion_score,
                min_gain=min_gain,
                learning_trials=learning_trials,
                objective=objective_effective,
                round_index=round_idx + 1,
                prior_round_setup=prior_round_setup,
                prior_regime_setups=prior_regime_setups,
                prior_regime_factor_ranges=prior_regime_factor_ranges,
                prior_regime_class_quotas=prior_regime_class_quotas,
                prior_factor_ranges=prior_factor_ranges,
                prior_factor_choices=prior_factor_choices,
                benchmark_ticker=spec.benchmark_ticker,
                bench_metrics=bench_ref_metrics,
                prices_train=prices_train,
                spec=spec,
                period=is_period,
                total_rounds=max_rounds,
                trials_per_round=n_trials,
                total_trial_budget=est_trials,
            )
            learning_context["global_config"] = {
                "objective": objective_effective,
                "rebalance_freq": rebalance_rule,
                "max_weight_cap": req.max_weight,
                "max_turnover_cap": req.max_turnover,
                "top_n_cap": req.top_n,
                "tradable_count": int(prices_train.shape[1]),
            }
            learning_context["mutable_fields"] = list(GEMINI_LEARNING_MUTABLE_FIELDS)
            if round_incoming_model_code:
                learning_context["narrative_champion_model_code"] = (
                    round_incoming_model_code
                )
                learning_context["final_champion_model_code"] = (
                    round_incoming_model_code
                )
        learning_context = merge_round_seed_budget_fields(
            learning_context,
            round_index=round_idx + 1,
            total_rounds=max_rounds,
            trials_per_round=n_trials,
            total_trial_budget=est_trials,
        )
        if use_regime_matrix:
            learning_context["dynamic_regime_matrix"] = True
        if champion_record and round_idx > 0:
            n_failed = len(learning_context.get("failed_challengers", []))
            report_progress(
                global_trial,
                est_trials,
                f"Round {round_idx + 1}: AI learning from {n_failed} failed challengers, "
                f"target score {target_to_beat:.4f}…",
                champion_record[2]["sharpe"] if champion_record else None,
                round_idx + 1,
                max_rounds,
                _convergence_preview_payload(convergence_history),
            )

        def ai_progress(current: int, total: int, message: str) -> None:
            report_progress(
                global_trial + current,
                est_trials,
                message,
                champion_record[2]["sharpe"] if champion_record else None,
                round_idx + 1,
                max_rounds,
                _convergence_preview_payload(convergence_history),
            )

        ai_generation = generate_ai_round_seed(
            objective=objective_effective,
            rebalance_freq=rebalance_rule,
            max_weight_cap=req.max_weight,
            max_turnover_cap=req.max_turnover,
            top_n_cap=req.top_n,
            tradable_count=int(prices_train.shape[1]),
            param_controls=param_controls_dict,
            progress_cb=ai_progress,
            learning_context=learning_context,
            language=req.report_language,
        )
        round_setup = ai_generation.get("round_setup") or {}
        regime_setups = ai_generation.get("regime_setups") or {}
        regime_factor_ranges = ai_generation.get("regime_factor_ranges") or {}
        regime_class_quotas = ai_generation.get("regime_class_quotas") or {}
        factor_ranges = ai_generation.get("factor_ranges") or {}
        factor_choices = ai_generation.get("factor_choices") or {}
        optimization_strategy = str(
            ai_generation.get("optimization_strategy") or ""
        ).strip()
        performance_assessment = str(
            ai_generation.get("performance_assessment") or ""
        ).strip()
        if not ai_generation.get("enabled", False):
            err = ai_generation.get("error") or "ai_generation_failed"
            if prior_round_setup:
                round_setup = dict(prior_round_setup)
                regime_setups = dict(prior_regime_setups or {})
                regime_factor_ranges = dict(prior_regime_factor_ranges or {})
                regime_class_quotas = dict(prior_regime_class_quotas or {})
                factor_ranges = dict(prior_factor_ranges or {})
                factor_choices = dict(prior_factor_choices or {})
                report_progress(
                    global_trial,
                    est_trials,
                    f"Round {round_idx + 1}: AI round seed failed ({err}); "
                    "reusing prior round setup, continuing Optuna…",
                    champion_record[2]["sharpe"] if champion_record else None,
                    round_idx + 1,
                    max_rounds,
                    _convergence_preview_payload(convergence_history),
                )
            else:
                report_progress(
                    global_trial,
                    est_trials,
                    f"Round {round_idx + 1}: AI round seed failed ({err}); "
                    "standard Optuna search (no round setup)…",
                    champion_record[2]["sharpe"] if champion_record else None,
                    round_idx + 1,
                    max_rounds,
                    _convergence_preview_payload(convergence_history),
                )
        else:
            regime_note = ""
            if has_regime_matrix(regime_setups):
                modes = [
                    f"{r}:{regime_setups[r].get('mode')}"
                    for r in ("risk_off", "neutral", "risk_on")
                    if isinstance(regime_setups.get(r), dict)
                ]
                regime_note = f"regime matrix ({', '.join(modes)}) + "
            factor_note = (
                f"{len(regime_factor_ranges)} regime factor ranges"
                if has_regime_factor_ranges(regime_factor_ranges)
                else f"{len(factor_ranges)} factor ranges"
            )
            report_progress(
                global_trial,
                est_trials,
                f"Round {round_idx + 1}: AI round seed "
                f"({regime_note}"
                f"setup + {factor_note})",
                champion_record[2]["sharpe"] if champion_record else None,
                round_idx + 1,
                max_rounds,
                _convergence_preview_payload(convergence_history),
            )
        if ai_generation.get("rationale"):
            ai_rationales.append(str(ai_generation.get("rationale")).strip())

        round_live_best = float("-inf")
        round_trial_base = global_trial + 1

        def optuna_progress(
            trial: int,
            total: int,
            best_score: float | None,
            latest_record: tuple[float, dict, dict] | None = None,
        ) -> None:
            nonlocal round_live_best
            if latest_record is not None:
                score, params, metrics = latest_record
                conv_metrics = _convergence_metrics_for_record(
                    score,
                    params,
                    metrics,
                    trial_report_cache=trial_report_cache,
                    objective_effective=objective_effective,
                    oos_enabled=bool(oos and len(prices_val) > 60),
                )
                obj = _record_objective_sort_value(
                    objective_effective, score, conv_metrics
                )
                if obj > round_live_best:
                    round_live_best = obj
                    for point in convergence_history:
                        if point.get("round") == round_idx + 1:
                            point["is_champion"] = False
                _append_convergence_from_record(
                    convergence_history,
                    global_trial=_convergence_global_trial_id(
                        round_trial_base,
                        params,
                        callback_trial_1based=trial,
                    ),
                    round_idx=round_idx + 1,
                    score=score,
                    metrics=conv_metrics,
                    objective_effective=objective_effective,
                    is_champion=abs(obj - round_live_best) < 1e-9,
                )
            scope = "in-sample" if oos else "full window"
            msg = f"Round {round_idx + 1} Optuna {trial}/{total} ({scope}, dynamic Top-N each rebalance)"
            if best_score is not None:
                obj_label, obj_text = _objective_progress_label_and_text(
                    objective_effective, best_score
                )
                msg += f", round best {obj_label} {obj_text}"
            report_progress(
                global_trial + trial,
                est_trials,
                msg,
                best_score,
                round_idx + 1,
                max_rounds,
                _convergence_preview_payload(convergence_history),
            )

        if use_regime_matrix and dynamic_ctx is not None:
            dynamic_ctx = refresh_dynamic_allocator_resolver(
                dynamic_ctx,
                regime_setups=regime_setups if has_regime_matrix(regime_setups) else None,
                shared_round_setup=round_setup,
            )
            dynamic_ctx = refresh_dynamic_class_budget_resolver(
                dynamic_ctx,
                regime_class_quotas=(
                    regime_class_quotas if has_regime_class_quotas(regime_class_quotas) else None
                ),
                shared_round_setup=round_setup,
                asset_classes=req.asset_classes,
            )
            allocator_resolver = dynamic_ctx.get("allocator_resolver")
        active_regime_resolver = (
            dynamic_ctx.get("active_regime_resolver") if dynamic_ctx else None
        )

        champion_seed = (
            params_for_champion_seed(champion_record[1]) if champion_record else None
        )
        round_records = run_optuna_search(
            prices_train,
            prices_sim_panel=prices_sim_panel,
            max_weight=req.max_weight,
            min_weight=req.min_weight,
            max_turnover=req.max_turnover,
            top_n=req.top_n,
            objective=trial_objective,
            trials=n_trials,
            round_setup=round_setup,
            regime_setups=regime_setups if has_regime_matrix(regime_setups) else None,
            regime_factor_ranges=(
                regime_factor_ranges
                if has_regime_factor_ranges(regime_factor_ranges)
                else None
            ),
            regime_class_quotas=(
                regime_class_quotas
                if has_regime_class_quotas(regime_class_quotas)
                else None
            ),
            factor_ranges=factor_ranges,
            factor_choices=factor_choices,
            param_controls=param_controls_dict,
            spec=spec,
            progress_cb=optuna_progress,
            universe_by_ticker=universe_by_ticker,
            prices_val=prices_val if oos and len(prices_val) > 60 else None,
            champion_seed=champion_seed,
            select_on_is=bool(oos and len(prices_val) > 60),
            asset_classes=req.asset_classes,
            trial_report_cache=trial_report_cache,
            allocator_resolver=allocator_resolver,
            class_budget_resolver=(
                dynamic_ctx.get("class_budget_resolver") if dynamic_ctx else None
            ),
            active_regime_resolver=active_regime_resolver,
            enforce_class_weights=req.enforce_class_weights,
        )

        tagged_round_records: list[tuple[float, dict, dict]] = []
        for score, params, metrics in round_records:
            tagged_params = dict(params)
            tagged_params["pro_round_index"] = round_idx + 1
            tagged_round_records.append(
                (score, tagged_params, slim_search_metrics(metrics))
            )
        round_records = tagged_round_records

        if trial_report_cache is not None:
            has_holdout_pre = bool(oos and len(prices_val) > 60)
            select_on_is_pre = has_holdout_pre
            for _, params, metrics in round_records:
                trial_report_cache.backfill_from_search_record(
                    params,
                    metrics,
                    has_holdout=has_holdout_pre,
                    select_on_is=select_on_is_pre,
                )

        _resync_round_convergence_from_records(
            convergence_history,
            round_idx=round_idx + 1,
            round_records=round_records,
            round_trial_base=round_trial_base,
            objective_effective=objective_effective,
            trial_report_cache=trial_report_cache,
            oos_enabled=bool(oos and len(prices_val) > 60),
        )

        assign_pro_round_model_codes(
            round_records,
            incoming_champion_record=incoming_champion_record,
            incoming_champion_model_code=round_incoming_model_code,
            next_model_no=next_model_no,
        )
        if trial_report_cache is not None:
            for _, params, metrics in round_records:
                trial_report_cache.register_model_code(params)
                trial_report_cache.refresh_from_record_metrics(params, metrics)

        global_trial += len(round_records)
        round_best_score = float("-inf")
        round_best_obj_value = float("-inf")
        round_best: tuple[float, dict, dict] | None = None
        round_improved = False

        pool_records = build_round_competition_pool(
            round_records,
            incoming_champion_record,
            prior_challenger_signatures=prior_challenger_signatures,
            retired_model_codes=retired_model_codes,
        )
        pool_records, pool_model_codes, round_challenger_model_codes = (
            reconcile_pro_round_pool(
                pool_records,
                incoming_champion_model_code=round_incoming_model_code,
                retired_model_codes=retired_model_codes,
            )
        )

        if trial_report_cache is not None:
            has_holdout = bool(oos and len(prices_val) > 60)
            select_on_is = has_holdout
            for _, params, metrics in pool_records:
                trial_report_cache.register_model_code(params)
                trial_report_cache.refresh_from_record_metrics(params, metrics)
                trial_report_cache.backfill_from_search_record(
                    params,
                    metrics,
                    has_holdout=has_holdout,
                    select_on_is=select_on_is,
                )

        for score, params, metrics in round_records:
            all_records.append((score, params, slim_search_metrics(metrics)))
            assess = metrics.get("overfitting_assessment") or {}
            raw = float(metrics.get("raw_score", score))
            penalty = float(metrics.get("overfitting_penalty_applied", 0.0))
            gap = float(assess.get("gap_sharpe", 0.0))
            risk = str(assess.get("risk_level", "unknown"))
            objective_value = _record_objective_sort_value(
                objective_effective, score, metrics
            )
            surpassed = objective_value >= champion_score + min_gain
            learning_trials.append(
                {
                    "round": round_idx + 1,
                    "adjusted_score": round(score, 4),
                    "objective_value": round(objective_value, 6),
                    "raw_score": round(raw, 4),
                    "overfitting_penalty": round(penalty, 4),
                    "gap_sharpe": round(gap, 4),
                    "gap_objective": round(float(assess.get("gap_objective", 0.0)), 4),
                    "oos_objective": assess.get("out_of_sample_objective"),
                    "risk_level": risk,
                    "params_summary": summarize_params_for_ai(params),
                    "outcome": "surpassed" if surpassed else "failed",
                    "gap_to_beat": round(
                        max(0.0, target_to_beat - objective_value), 4
                    ),
                    "target_at_trial": round(target_to_beat, 4),
                }
            )

        champ_sig = (
            _model_signature(champion_record[1])
            if champion_record is not None
            else None
        )
        prune_search_records(
            all_records,
            max_records=search_records_cap(),
            protect_signatures={champ_sig} if champ_sig else None,
        )

        round_best: tuple[float, dict, dict] | None = None
        round_winner_model_code: str | None = None

        ai_round_champion_code: str | None = None
        ai_champion_rationale = ""
        if pool_records:
            oos_active = bool(oos and len(prices_val) > 60)
            is_split_idx = len(prices_train) if oos_active else None
            _ensure_pool_full_sims_for_champion(
                pool_records,
                req=req,
                prices=prices,
                prices_sim_panel=prices_sim_panel,
                rebalance_rule=rebalance_rule,
                spec=spec,
                universe_by_ticker=universe_by_ticker,
                trial_report_cache=trial_report_cache,
                dynamic_ctx=dynamic_ctx,
            )
            champ_payload = build_round_champion_ai_payload(
                pool_records,
                objective_effective=objective_effective,
                round_index=round_idx + 1,
                incoming_champion_model_code=round_incoming_model_code,
                benchmark_ticker=spec.benchmark_ticker,
                oos_enabled=oos_active,
                trial_report_cache=trial_report_cache,
                spec=spec,
                is_split_idx=is_split_idx,
            )
            deterministic_champion = _round_champion_fallback_code(champ_payload)
            round_best = (
                record_for_model_code(pool_records, deterministic_champion)
                if deterministic_champion
                else best_record_in_pool(pool_records, objective_effective)
            )
            if round_best and round_best[1].get("model_code"):
                round_winner_model_code = str(round_best[1]["model_code"])
            ai_round_champion_code = round_winner_model_code

            def ai_champion_progress(message: str) -> None:
                report_progress(
                    global_trial,
                    est_trials,
                    message,
                    champion_record[2]["sharpe"] if champion_record else None,
                    round_idx + 1,
                    max_rounds,
                    _convergence_preview_payload(convergence_history),
                )

            ai_champ = generate_ai_round_champion(
                payload=champ_payload,
                progress_cb=ai_champion_progress,
                language=req.report_language,
                selected_model_code=deterministic_champion,
            )
            if deterministic_champion:
                ai_round_champion_code = str(deterministic_champion)
            elif ai_champ.get("round_champion_model_code"):
                ai_round_champion_code = str(ai_champ.get("round_champion_model_code"))
            if ai_champ.get("rationale"):
                ai_champion_rationale = str(ai_champ.get("rationale")).strip()
            if ai_round_champion_code:
                synced_best = record_for_model_code(
                    pool_records, ai_round_champion_code
                )
                if synced_best is not None:
                    round_best = synced_best
                    round_winner_model_code = str(ai_round_champion_code)

        ai_champion_record = (
            record_for_model_code(pool_records, ai_round_champion_code)
            if ai_round_champion_code
            else None
        )

        if round_best:
            round_best_score, _round_best_params, _round_best_metrics = round_best
            round_best_obj_value = _record_objective_sort_value(
                objective_effective, round_best_score, _round_best_metrics
            )
            baseline_score = (
                float(incoming_champion_score)
                if incoming_champion_score is not None
                else float("-inf")
            )
            round_improved = round_best_obj_value > baseline_score + min_gain
            carry_record = ai_champion_record or round_best
            champion_score = _record_objective_sort_value(
                objective_effective, carry_record[0], carry_record[2]
            )
            champion_record = carry_record
            if round_improved:
                rounds_without_gain = 0
            else:
                rounds_without_gain += 1

            # Re-label this round's trials vs the reigning champion (for next-round Gemini learning).
            post_target = champion_score + min_gain
            for t in learning_trials:
                if t.get("round") != round_idx + 1:
                    continue
                s = float(t.get("adjusted_score", 0.0))
                ov = float(t.get("objective_value", s))
                if ov < post_target:
                    t["outcome"] = "failed"
                    t["gap_to_beat"] = round(post_target - ov, 4)
                else:
                    t["outcome"] = "surpassed"
                    t["gap_to_beat"] = 0.0
                t["target_at_trial"] = round(post_target, 4)

            _relabel_round_champion_flags(
                convergence_history,
                round_idx=round_idx + 1,
                champion_objective=champion_score,
                objective_effective=objective_effective,
                round_records=round_records,
                round_trial_base=global_trial - len(round_records) + 1,
            )

        trial_order_records = pool_records_in_trial_order(
            round_records,
            pool_records,
            pool_model_codes,
        )
        round_winner_params = round_best[1] if round_best else None
        pool_signatures = [_model_signature(r[1]) for r in trial_order_records]

        record_model_codes = [
            str(r[1].get("model_code", ""))
            for r in trial_order_records
            if r[1].get("model_code")
        ]
        expected_pool_size = challengers + (1 if round_idx > 0 else 0)
        actual_pool_size = len(pool_model_codes)
        logger.info(
            "Pro round %s pool size: expected=%s actual=%s "
            "(incoming=%s challengers=%s pool_codes=%s record_codes=%s)",
            round_idx + 1,
            expected_pool_size,
            actual_pool_size,
            round_incoming_model_code,
            round_challenger_model_codes,
            pool_model_codes,
            record_model_codes,
        )
        if actual_pool_size != expected_pool_size:
            logger.warning(
                "Pro round %s pool size mismatch: expected %s (1 incoming + %s challengers), "
                "got %s codes %s",
                round_idx + 1,
                expected_pool_size,
                challengers if round_idx > 0 else batch0,
                actual_pool_size,
                pool_model_codes,
            )
        if set(pool_model_codes) != set(record_model_codes):
            logger.error(
                "Pro round %s pool_model_codes %s != record model_codes %s",
                round_idx + 1,
                pool_model_codes,
                record_model_codes,
            )

        retire_non_winner_model_codes(
            trial_order_records,
            round_best,
            retired_model_codes,
            prior_signatures=prior_challenger_signatures,
        )
        if trial_report_cache is not None and retired_model_codes:
            trial_report_cache.drop_model_codes(retired_model_codes)
            maybe_collect_garbage(1, round_idx + 1)
        if ai_round_champion_code:
            carry_champion_model_code = ai_round_champion_code
        elif round_winner_model_code:
            carry_champion_model_code = round_winner_model_code
        elif round_incoming_model_code:
            carry_champion_model_code = round_incoming_model_code

        round_bench = compute_round_benchmark_fields(
            metrics_with_port_ret_from_cache(
                round_best[2] if round_best else {},
                round_best[1] if round_best else {},
                trial_report_cache,
            )
            if round_best
            else None,
            prices_train=prices_train,
            benchmark_ticker=spec.benchmark_ticker,
            bench_metrics=bench_ref_metrics,
            spec=spec,
        )

        trial_order_records_slim = [
            (s, dict(p), slim_search_metrics(m)) for s, p, m in trial_order_records
        ]

        per_round.append(
            {
                "round": round_idx + 1,
                "trials_in_round": n_trials,
                "round_setup": round_setup,
                "regime_setups": regime_setups if has_regime_matrix(regime_setups) else {},
                "regime_matrix_enabled": has_regime_matrix(regime_setups),
                "regime_factor_ranges": (
                    regime_factor_ranges
                    if has_regime_factor_ranges(regime_factor_ranges)
                    else {}
                ),
                "regime_factor_matrix_enabled": has_regime_factor_ranges(
                    regime_factor_ranges
                ),
                "regime_class_quotas": (
                    regime_class_quotas
                    if has_regime_class_quotas(regime_class_quotas)
                    else {}
                ),
                "regime_class_quota_matrix_enabled": has_regime_class_quotas(
                    regime_class_quotas
                ),
                "factor_ranges": factor_ranges,
                "factor_choices": factor_choices,
                "optimization_strategy": optimization_strategy,
                "performance_assessment": performance_assessment,
                "exploration_phase": ai_generation.get("exploration_phase"),
                **round_bench,
                "incoming_champion_params": incoming_champion_params,
                "round_winner_params": round_winner_params,
                "pool_signatures": pool_signatures,
                "pool_model_codes": pool_model_codes,
                "incoming_champion_model_code": round_incoming_model_code,
                "round_winner_model_code": round_winner_model_code,
                "ai_champion_model_code": ai_round_champion_code,
                "ai_champion_rationale": ai_champion_rationale,
                "round_challenger_model_codes": round_challenger_model_codes,
                "incoming_champion_score": (
                    round(float(incoming_champion_score), 6)
                    if incoming_champion_score is not None
                    else None
                ),
                "round_best_adjusted_score": (
                    round(round_best_score, 4) if round_best else None
                ),
                "round_best_objective_value": (
                    round(round_best_obj_value, 6) if round_best else None
                ),
                "improved": round_improved,
                "records": trial_order_records_slim,
            }
        )

        register_prior_challenger_signatures(
            round_records,
            incoming_champion=incoming_champion_record,
            round_winner=round_best,
            prior=prior_challenger_signatures,
        )

        prior_round_setup = dict(round_setup)
        prior_regime_setups = (
            dict(regime_setups) if has_regime_matrix(regime_setups) else None
        )
        prior_regime_factor_ranges = (
            dict(regime_factor_ranges)
            if has_regime_factor_ranges(regime_factor_ranges)
            else None
        )
        prior_regime_class_quotas = (
            dict(regime_class_quotas)
            if has_regime_class_quotas(regime_class_quotas)
            else None
        )
        prior_factor_ranges = dict(factor_ranges)
        prior_factor_choices = dict(factor_choices)

        round_done_msg = (
            f"Round {round_idx + 1} done: round best {round_best_score:.4f}, "
            f"champion {champion_score:.4f}"
            + (
                f" (flat streak {rounds_without_gain}/{patience})"
                if patience is not None
                else ""
            )
        )
        if round_bench.get("benchmark_status") == "below":
            alpha_disp = round_bench.get("benchmark_alpha")
            alpha_txt = f"{alpha_disp:.4f}" if alpha_disp is not None else "—"
            round_done_msg += (
                f" · in-sample alpha vs {spec.benchmark_ticker} {alpha_txt} (below benchmark)"
            )
        report_progress(
            global_trial,
            est_trials,
            round_done_msg,
            champion_record[2]["sharpe"] if champion_record else None,
            round_idx + 1,
            max_rounds,
            _convergence_preview_payload(convergence_history),
            round_benchmark_status=round_bench.get("benchmark_status"),
            round_benchmark_alpha=round_bench.get("benchmark_alpha"),
            round_portfolio_vs_benchmark=round_bench.get("portfolio_vs_benchmark"),
        )

        if round_idx > 0 and patience is not None and rounds_without_gain >= patience:
            break

    # all_records already in chronological Optuna trial order across rounds.
    rounds_done = start_round_idx + len(per_round)
    final_ai_champion_code: str | None = None
    for pr in per_round:
        code = pr.get("ai_champion_model_code")
        if code:
            final_ai_champion_code = str(code)
    meta = {
        "rounds_completed": rounds_done,
        "trials_total": global_trial,
        "final_champion_params": (
            champion_record[1] if champion_record is not None else None
        ),
        "ai_champion_model_code": final_ai_champion_code,
        "champion_model_code": final_ai_champion_code,
        "champion_adjusted_score": champion_score if champion_record else None,
        "stopped_reason": (
            "patience"
            if patience is not None
            and rounds_without_gain >= patience
            and rounds_done < max_rounds
            else "max_rounds"
        ),
        "ai_rationales": ai_rationales[:8],
        "per_round": per_round,
        "retired_model_codes": sorted(retired_model_codes),
        "continuation_snapshot": build_continuation_snapshot_from_meta(
            {
                "rounds_completed": rounds_done,
                "trials_total": global_trial,
                "retired_model_codes": sorted(retired_model_codes),
                "ai_rationales": ai_rationales[:12],
                "champion_adjusted_score": champion_score if champion_record else None,
                "final_champion_params": (
                    champion_record[1] if champion_record is not None else None
                ),
            },
            champion_record=champion_record,
            learning_trials=learning_trials,
            convergence_history=convergence_history,
            carry_champion_model_code=carry_champion_model_code,
            next_model_no=next_model_no[0],
            prior_challenger_signatures=prior_challenger_signatures,
            prior_round_setup=prior_round_setup,
            prior_regime_setups=prior_regime_setups,
            prior_regime_factor_ranges=prior_regime_factor_ranges,
            prior_regime_class_quotas=prior_regime_class_quotas,
            prior_factor_ranges=prior_factor_ranges,
            prior_factor_choices=prior_factor_choices,
            rounds_without_gain=rounds_without_gain,
            all_records=all_records,
        ),
    }
    return all_records, convergence_history, meta


def _ensure_pool_full_sims_for_champion(
    pool_records: list[tuple[float, dict, dict]],
    *,
    req: BacktestRequest,
    prices: pd.DataFrame,
    prices_sim_panel: pd.DataFrame,
    rebalance_rule: str,
    spec: BacktestSpec,
    universe_by_ticker: dict[str, dict[str, Any]],
    trial_report_cache: TrialReportCache | None,
    dynamic_ctx: dict[str, Any] | None,
) -> None:
    """Run full-period backtests for champion pool when cache lacks port_ret."""
    if trial_report_cache is None or not pool_records:
        return
    resolver = dynamic_ctx.get("allocator_resolver") if dynamic_ctx else None
    active_regime_resolver = (
        dynamic_ctx.get("active_regime_resolver") if dynamic_ctx else None
    )
    if dynamic_ctx:
        dynamic_ctx = ensure_regime_class_budget_resolver(
            dynamic_ctx,
            asset_classes=req.asset_classes,
        )
    report_full = str(req.start_date)
    for _, params, _ in pool_records:
        params = dict(params)
        trial_report_cache.register_model_code(params)
        bundle = trial_report_cache.get_bundle(params)
        if bundle is not None and bundle.full_m is not None and bundle.full_m.get(
            "port_ret"
        ) is not None and not cached_full_path_needs_stitch(
            bundle.train_m, bundle.val_m, bundle.full_m
        ):
            continue
        trial_spec, alloc, cap, top_n_actual, no_trade_tol, turnover_penalty_mult, max_turnover_actual, class_budget, f_params = (
            _sim_inputs_from_params(params, req, rebalance_rule, spec)
        )
        sim_kw = apply_allocator_resolver(
            dict(
                spec=trial_spec,
                max_weight=cap,
                min_weight=req.min_weight,
                allocator=alloc,
                top_n=top_n_actual,
                factor_params=f_params,
                no_trade_tol=no_trade_tol,
                turnover_penalty_mult=turnover_penalty_mult,
                max_turnover=max_turnover_actual,
                universe_by_ticker=universe_by_ticker,
                class_budget=class_budget,
            ),
            prices,
            resolver,
        )
        class_resolver = (
            class_budget_resolver_from_trial_params(
                params, active_regime_resolver, asset_classes=req.asset_classes
            )
            if dynamic_ctx
            else None
        )
        if class_resolver is None and dynamic_ctx:
            class_resolver = dynamic_ctx.get("class_budget_resolver")
        sim_kw = apply_class_budget_resolver(
            sim_kw,
            prices,
            class_resolver,
            asset_classes=req.asset_classes,
        )
        sim_kw["enforce_class_weights"] = req.enforce_class_weights
        factor_resolver = factor_params_resolver_from_trial_params(
            params,
            active_regime_resolver,
            default_lookback=alloc.lookback_days,
        )
        if factor_resolver is not None:
            sim_kw["factor_params_resolver"] = factor_resolver
        full_m = simulate_dynamic_portfolio(
            prices_sim_panel,
            report_start=report_full,
            **sim_kw,
        )
        train_m = bundle.train_m if bundle else None
        val_m = bundle.val_m if bundle else None
        trial_report_cache.stash_from_trial(
            params,
            train_m=train_m,
            val_m=val_m,
            full_m=full_m,
        )


def _resolve_assembly_full_m(
    *,
    oos: bool,
    train_m: dict[str, Any] | None,
    val_m: dict[str, Any] | None,
    cached_full_m: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Prefer stitched IS+OOS path when cache full_m is missing or OOS-only."""
    if not oos:
        return cached_full_m
    stitched = stitch_full_path_from_slices(train_m, val_m)
    if stitched is None:
        return cached_full_m
    if cached_full_m is None or cached_full_m.get("port_ret") is None:
        return stitched
    if cached_full_path_needs_stitch(train_m, val_m, cached_full_m):
        return stitched
    return cached_full_m


def _build_sample_metrics_block(
    *,
    train_m: dict[str, Any],
    val_m: dict[str, Any] | None,
    full_m: dict[str, Any],
    oos_enabled: bool,
    objective_effective: str,
    train_start: str | None,
    train_end: str | None,
    val_start: str | None,
    train_ratio: float | None,
    is_split_idx: int | None,
    spec: BacktestSpec,
) -> dict[str, Any]:
    is_snap, oos_snap, full_snap = horizon_snapshots_from_full_path(
        full_m,
        spec=spec,
        objective_effective=objective_effective,
        oos_enabled=oos_enabled,
        is_split_idx=is_split_idx,
        train_m=train_m,
        val_m=val_m,
    )
    return {
        "selection": "in_sample" if oos_enabled else "full_sample",
        "horizon_method": (
            "full_path_slices"
            if oos_enabled and is_split_idx is not None and full_m.get("port_ret") is not None
            else "single_simulate"
        ),
        "train_ratio": train_ratio,
        "train_start": train_start,
        "train_end": train_end,
        "val_start": val_start,
        "objective": objective_effective,
        "objective_label": objective_label(objective_effective),
        "in_sample": is_snap,
        "out_of_sample": oos_snap,
        "full_sample": full_snap,
        "gap": {
            "objective": round(
                float(is_snap["objective_value"])
                - float((oos_snap or {}).get("objective_value", 0.0)),
                6,
            )
            if oos_snap
            else None,
            "sharpe": round(
                float(is_snap["sharpe"]) - float((oos_snap or {}).get("sharpe", 0.0)),
                4,
            )
            if oos_snap
            else None,
        },
    }


def _build_candidate(
    rank: int,
    tickers: list[str],
    train_m: dict[str, Any],
    val_m: dict[str, Any] | None,
    oos_enabled: bool,
    params: dict[str, Any],
    full_m: dict[str, Any],
    full_curve: list[dict[str, Any]],
    prices: pd.DataFrame,
    universe_by_ticker: dict[str, dict[str, Any]],
    spec: BacktestSpec,
    *,
    objective_effective: str = "max_sharpe",
    train_start: str | None = None,
    train_end: str | None = None,
    val_start: str | None = None,
    train_ratio: float | None = None,
    min_weight: float = WEIGHT_EPS,
    is_split_idx: int | None = None,
    include_charts: bool = True,
) -> PortfolioCandidate:
    primary = train_m if oos_enabled else full_m
    weights = _weights_dict(
        tickers,
        np.atleast_1d(np.asarray(full_m.get("last_weights"), dtype=float)).ravel(),
        min_weight=min_weight,
    )
    sample_metrics = _build_sample_metrics_block(
        train_m=train_m,
        val_m=val_m,
        full_m=full_m,
        oos_enabled=oos_enabled,
        objective_effective=objective_effective,
        train_start=train_start,
        train_end=train_end,
        val_start=val_start,
        train_ratio=train_ratio,
        is_split_idx=is_split_idx,
        spec=spec,
    )
    response_curve = full_curve if include_charts else None
    rel: dict[str, Any] = {}
    if include_charts:
        port_ret: pd.Series = full_m["port_ret"]
        equity: pd.Series = full_m["equity"]
        bench_t = spec.benchmark_ticker
        bench_ret = (
            prices[bench_t].pct_change().fillna(0.0)
            if bench_t in prices.columns
            else None
        )
        periodic_equity = train_m.get("equity") if oos_enabled else None
        holdout_equity = (
            val_m.get("equity") if oos_enabled and val_m is not None else None
        )
        analytics = build_full_analytics(
            port_ret=port_ret,
            equity=equity,
            bench_ret=bench_ret,
            spec=spec,
            weights=weights,
            tickers=tickers,
            universe_by_ticker=universe_by_ticker,
            prices=prices,
            periodic_equity=periodic_equity,
            holdout_equity=holdout_equity,
        )
        wh_raw = full_m.get("weight_history", [])
        wht_raw = full_m.get("weight_history_tickers", [])
        first_eq = ""
        if response_curve:
            first_eq = str(response_curve[0].get("date", ""))
            if first_eq:
                wh_raw = [
                    row
                    for row in wh_raw
                    if str(row.get("date", "")) >= first_eq
                ]
        wh_raw = anchor_weight_history_to_date(wh_raw, first_eq)
        wh, wht = trim_weight_history_for_response(wh_raw, tickers=wht_raw or tickers)
        analytics["weight_history"] = wh
        analytics["weight_history_tickers"] = wht
        if full_m.get("weight_cap_audit"):
            analytics["weight_cap_audit"] = full_m["weight_cap_audit"]
        analytics["factor_summary"] = full_m.get("factor_summary", {})
        analytics["execution"] = {
            "rebalance_freq": full_m.get("rebalance_freq"),
            "rebalance_count": full_m.get("rebalance_count"),
            "rebalance_applied": full_m.get("rebalance_applied"),
            "rebalance_dates_sample": (full_m.get("rebalance_dates") or [])[:12],
        }
        analytics["sample_metrics"] = sample_metrics
        if bench_ret is not None:
            aligned_bench = bench_ret.reindex(port_ret.index).fillna(0.0)
            bench_equity = (1.0 + aligned_bench).cumprod()
            analytics["benchmark_equity_curve"] = equity_curve_series(bench_equity)
        else:
            analytics["benchmark_equity_curve"] = []
        rel = analytics.get("benchmark_relative", {}) or {}
    else:
        slim_extra = build_slim_analytics(
            weights=weights,
            universe_by_ticker=universe_by_ticker,
            factor_summary=full_m.get("factor_summary"),
        )
        analytics = {"sample_metrics": sample_metrics, **slim_extra}
    is_snap = sample_metrics["in_sample"]
    oos_snap = sample_metrics.get("out_of_sample")
    return PortfolioCandidate(
        rank=rank,
        model_code=str(params.get("model_code")) if params.get("model_code") else None,
        weights=weights,
        sharpe=round(float(primary["sharpe"]), 3),
        max_drawdown=round(float(primary["max_drawdown"]), 3),
        cagr=round(float(primary["cagr"]), 3),
        volatility=round(float(primary["volatility"]), 3),
        sortino=round(float(primary.get("sortino", 0.0)), 3),
        calmar=round(float(primary.get("calmar", 0.0)), 3),
        var_95=round(float(primary.get("var_95", 0.0)), 4),
        cvar_95=round(float(primary.get("cvar_95", 0.0)), 4),
        win_rate=round(float(primary.get("win_rate", 0.0)), 3),
        turnover_avg=round(float(primary.get("turnover_avg", 0.0)), 4),
        turnover_total=round(float(primary.get("turnover_total", 0.0)), 4),
        max_drawdown_duration_days=int(primary.get("max_drawdown_duration_days", 0)),
        equity_curve=response_curve,
        params={
            **params,
            "in_sample_objective": is_snap["objective_value"],
            "out_of_sample_objective": (
                oos_snap["objective_value"] if oos_snap else None
            ),
            "gap_objective": sample_metrics["gap"]["objective"],
        },
        train_sharpe=round(float(train_m["sharpe"]), 3),
        train_max_drawdown=round(float(train_m["max_drawdown"]), 3),
        validation_sharpe=(
            round(float(val_m["sharpe"]), 3) if val_m else None
        ),
        validation_max_drawdown=(
            round(float(val_m["max_drawdown"]), 3) if val_m else None
        ),
        analytics=analytics,
        beta=rel.get("beta"),
        alpha=rel.get("alpha") or rel.get("alpha_annual"),
        alpha_annual=rel.get("alpha_annual") or rel.get("alpha"),
        tracking_error=rel.get("tracking_error"),
        information_ratio=rel.get("information_ratio"),
    )


def _model_signature(params: dict[str, Any]) -> str:
    return refinement_model_signature(params)


def _fallback_model_no_from_records(
    records: list[tuple[float, dict, dict]],
) -> list[int]:
    mx = 0
    for _, params, _ in records:
        code = params.get("model_code")
        if not code:
            continue
        s = str(code)
        if s.startswith("M") and len(s) > 1:
            try:
                mx = max(mx, int(s[1:]))
            except ValueError:
                pass
    return [max(mx + 1, 1)]


def _read_or_assign_model_code(
    params: dict[str, Any],
    *,
    next_model_no: list[int],
    context: str = "",
) -> str:
    """Read model_code from search-assigned params; legacy fallback if missing.

    model_code is immutable after search assignment — this helper must not re-encode
    via signature maps. It only assigns when legacy records lack a code.
    """
    existing = params.get("model_code")
    if existing:
        return str(existing)
    logger.warning(
        "model_code missing on record%s; assigning fallback (search should assign codes)",
        f" ({context})" if context else "",
    )
    code = f"M{next_model_no[0]:04d}"
    next_model_no[0] += 1
    params["model_code"] = code
    return code


def _sim_inputs_from_params(
    params: dict[str, Any],
    req: BacktestRequest,
    rebalance_rule: str,
    spec: BacktestSpec,
) -> tuple[BacktestSpec, AllocatorParams, float, int, float, float, float, dict[str, float], FactorParams]:
    blueprint = RunBlueprint.from_request(req)
    params, bounds_violations = clamp_param_dict(params, blueprint)
    if bounds_violations:
        params["bounds_violations"] = bounds_violations
    params = zero_disallowed_class_params(params, req.asset_classes)
    trial_rebalance = str(params.get("rebalance_freq", rebalance_rule))
    trial_spec = BacktestSpec(
        benchmark_ticker=spec.benchmark_ticker,
        risk_free_rate=spec.risk_free_rate,
        fee_bps=spec.fee_bps,
        rebalance_rule=trial_rebalance,
        min_holdings=spec.min_holdings,
        max_holdings=spec.max_holdings,
    )
    alloc = AllocatorParams(
        mode=params["mode"],
        lookback_days=int(params["lookback_days"]),
        shrinkage=float(params["shrinkage"]),
        risk_aversion=float(params["risk_aversion"]),
    )
    cap = effective_max_weight_cap(params.get("max_weight_actual"), req.max_weight)
    if "top_n_actual" in params:
        top_n_actual = int(params["top_n_actual"])
    elif req.top_n is not None:
        top_n_actual = min(int(req.top_n), int(spec.max_holdings))
    else:
        top_n_actual = int(spec.max_holdings)
    no_trade_tol = float(params.get("no_trade_tol", 0.0))
    turnover_penalty_mult = float(params.get("turnover_penalty_mult", 1.0))
    max_turnover_actual = float(params.get("max_turnover_actual", req.max_turnover))
    class_budget = (
        {}
        if params.get("regime_class_quota_matrix")
        else class_budget_from_params(params, asset_classes=req.asset_classes)
    )
    f_params = factor_params_from_dict(params, default_lookback=alloc.lookback_days)
    return (
        trial_spec,
        alloc,
        cap,
        top_n_actual,
        no_trade_tol,
        turnover_penalty_mult,
        max_turnover_actual,
        class_budget,
        f_params,
    )


def _champion_model_codes_from_records(
    records: list[tuple[float, dict, dict]],
    *,
    explicit_code: str | None = None,
) -> set[str]:
    codes: set[str] = set()
    if explicit_code:
        codes.add(str(explicit_code))
    elif records:
        mc = records[0][1].get("model_code")
        if mc:
            codes.add(str(mc))
    return codes


def _assemble_candidates_from_records(
    records: list[tuple[float, dict, dict]],
    *,
    req: BacktestRequest,
    top_n_models: int,
    tickers: list[str],
    prices: pd.DataFrame,
    prices_sim_panel: pd.DataFrame,
    prices_train: pd.DataFrame,
    prices_val: pd.DataFrame,
    oos: bool,
    rebalance_rule: str,
    spec: BacktestSpec,
    universe_by_ticker: dict[str, dict[str, Any]],
    objective_effective: str,
    train_start: str,
    train_end: str,
    val_start: str,
    train_ratio: float,
    fallback_next_model_no: list[int] | None = None,
    assembly_progress: Callable[[str], None] | None = None,
    trial_report_cache: TrialReportCache | None = None,
    dynamic_ctx: dict[str, Any] | None = None,
    full_payload_codes: set[str] | None = None,
) -> list[PortfolioCandidate]:
    """Build report-ready PortfolioCandidate rows for top trials.

    Uses ``trial_report_cache`` when present (captured during Optuna scoring) to
    avoid repeating in-sample / holdout simulates; may still run one full-period
    backtest when weight history was not cached.
    """
    top = records[:top_n_models]
    n_models = len(top)
    val_required = bool(oos and len(prices_val) > 60)
    fallback_no = fallback_next_model_no or _fallback_model_no_from_records(records)
    resolver = dynamic_ctx.get("allocator_resolver") if dynamic_ctx else None
    metrics_objective = trial_scoring_objective(objective_effective)
    candidates: list[PortfolioCandidate] = []
    for rank, (_, params, _) in enumerate(top, start=1):
        params = dict(params)
        _read_or_assign_model_code(
            params,
            next_model_no=fallback_no,
            context="candidate assembly",
        )
        if trial_report_cache:
            trial_report_cache.register_model_code(params)
        model_code = str(params.get("model_code") or f"#{rank}")
        include_charts = (
            full_payload_codes is None or model_code in full_payload_codes
        )
        trial_spec, alloc, cap, top_n_actual, no_trade_tol, turnover_penalty_mult, max_turnover_actual, class_budget, f_params = (
            _sim_inputs_from_params(params, req, rebalance_rule, spec)
        )
        sim_kw = apply_allocator_resolver(
            dict(
                spec=trial_spec,
                max_weight=cap,
                min_weight=req.min_weight,
                allocator=alloc,
                top_n=top_n_actual,
                factor_params=f_params,
                no_trade_tol=no_trade_tol,
                turnover_penalty_mult=turnover_penalty_mult,
                max_turnover=max_turnover_actual,
                universe_by_ticker=universe_by_ticker,
                class_budget=class_budget,
            ),
            prices,
            resolver,
        )
        active_regime_resolver = (
            dynamic_ctx.get("active_regime_resolver") if dynamic_ctx else None
        )
        if dynamic_ctx:
            dynamic_ctx = ensure_regime_class_budget_resolver(
                dynamic_ctx,
                asset_classes=req.asset_classes,
            )
        class_resolver = (
            class_budget_resolver_from_trial_params(
                params, active_regime_resolver, asset_classes=req.asset_classes
            )
            if dynamic_ctx
            else None
        )
        if class_resolver is None and dynamic_ctx:
            class_resolver = dynamic_ctx.get("class_budget_resolver")
        sim_kw = apply_class_budget_resolver(
            sim_kw,
            prices,
            class_resolver,
            asset_classes=req.asset_classes,
        )
        sim_kw["enforce_class_weights"] = req.enforce_class_weights
        factor_resolver = factor_params_resolver_from_trial_params(
            params,
            active_regime_resolver,
            default_lookback=alloc.lookback_days,
        )
        if factor_resolver is not None:
            sim_kw["factor_params_resolver"] = factor_resolver

        bundle = (
            trial_report_cache.copy_bundle(params) if trial_report_cache else None
        )
        train_m = bundle.train_m if bundle else None
        val_m = bundle.val_m if bundle else None
        full_m_rank = bundle.full_m if bundle else None

        cache_hit = bool(
            bundle
            and (
                bundle.complete_for_oos(oos=oos, val_required=val_required)
                if oos
                else bundle.complete_no_oos()
            )
        )
        need_train = train_m is None or (
            include_charts and oos and train_m.get("equity") is None
        )
        need_val = val_required and (
            val_m is None or (include_charts and val_m.get("equity") is None)
        )
        assembly_full_m = _resolve_assembly_full_m(
            oos=oos,
            train_m=train_m,
            val_m=val_m,
            cached_full_m=full_m_rank,
        )
        need_full_sim = (
            assembly_full_m is None
            or assembly_full_m.get("port_ret") is None
            or (
                include_charts
                and not assembly_full_m.get("weight_history")
            )
        )

        if cache_hit and not (need_train or need_val or need_full_sim):
            if assembly_progress:
                label = "charts" if include_charts else "metrics"
                assembly_progress(
                    f"Packaging {model_code} {label} from search cache ({rank}/{n_models})…"
                )
        else:
            if assembly_progress:
                if not include_charts:
                    assembly_progress(
                        f"Packaging {model_code} metrics only ({rank}/{n_models})…"
                    )
                elif bundle is None:
                    assembly_progress(
                        f"Packaging {model_code} ({rank}/{n_models}): "
                        f"no search cache — running backtest(s) for charts…"
                    )
                elif not need_train and not need_val:
                    assembly_progress(
                        f"Packaging {model_code} ({rank}/{n_models}): "
                        f"search cache IS/OOS — one full-period backtest for weights…"
                    )
                else:
                    missing = []
                    if need_train:
                        missing.append("in-sample")
                    if need_val:
                        missing.append("holdout")
                    assembly_progress(
                        f"Packaging {model_code} ({rank}/{n_models}): "
                        f"cache incomplete ({', '.join(missing)}) — running backtest(s)…"
                    )
            report_full = str(req.start_date)
            if need_train:
                train_kw = apply_allocator_resolver(sim_kw, prices_train, resolver)
                train_m = simulate_dynamic_portfolio(
                    prices_sim_panel,
                    report_start=str(prices_train.index[0].date()),
                    **train_kw,
                )
            if need_val:
                val_kw = apply_allocator_resolver(sim_kw, prices_val, resolver)
                val_m = simulate_dynamic_portfolio(
                    prices_sim_panel,
                    report_start=str(prices_val.index[0].date()),
                    **val_kw,
                )
            assembly_full_m = _resolve_assembly_full_m(
                oos=oos,
                train_m=train_m,
                val_m=val_m,
                cached_full_m=assembly_full_m,
            )
            if oos and assembly_full_m is not None and assembly_full_m.get(
                "port_ret"
            ) is not None:
                need_full_sim = include_charts and not assembly_full_m.get(
                    "weight_history"
                )
            if need_full_sim:
                full_m_rank = simulate_dynamic_portfolio(
                    prices_sim_panel,
                    report_start=report_full,
                    **sim_kw,
                )
                assembly_full_m = full_m_rank
        metrics_m = assembly_full_m or train_m
        if metrics_m is None:
            raise ValueError(
                f"Cannot assemble candidate {model_code}: missing simulation metrics"
            )
        full_curve_rank = (
            equity_curve_series(assembly_full_m["equity"])
            if include_charts and assembly_full_m is not None and assembly_full_m.get("equity") is not None
            else []
        )
        candidates.append(
            _build_candidate(
                rank,
                tickers,
                train_m,
                val_m,
                oos,
                params,
                assembly_full_m,
                full_curve_rank,
                prices,
                universe_by_ticker,
                trial_spec,
                objective_effective=metrics_objective
                if not is_dynamic_objective(objective_effective)
                else objective_effective,
                train_start=train_start,
                train_end=train_end,
                val_start=val_start,
                train_ratio=train_ratio,
                min_weight=req.min_weight,
                is_split_idx=len(prices_train) if oos else None,
                include_charts=include_charts,
            )
        )
        if dynamic_ctx:
            cand = candidates[-1]
            analytics = dict(cand.analytics or {})
            sm = dict(analytics.get("sample_metrics") or {})
            sm["objective"] = objective_effective
            sm["objective_label"] = objective_label(objective_effective)
            sm["trial_scoring_objective"] = metrics_objective
            sm["dynamic_objective_timeline"] = serialize_dynamic_timeline(
                dynamic_ctx.get("regime_timeline") or []
            )
            exp_by_regime = exposure_by_regime_from_weight_history(
                analytics.get("weight_history"),
                universe_by_ticker,
                dynamic_ctx.get("regime_timeline") or [],
            )
            if exp_by_regime:
                analytics["exposure_by_regime"] = exp_by_regime
            analytics["sample_metrics"] = sm
            candidates[-1] = cand.model_copy(update={"analytics": analytics})
    return candidates


def _leaderboard_is_better_row(a: dict[str, Any], b: dict[str, Any]) -> bool:
    return float(a.get("in_sample_objective") or -1e9) > float(
        b.get("in_sample_objective") or -1e9
    )


def _leaderboard_row_from_candidate(
    c: PortfolioCandidate,
    *,
    objective_effective: str,
) -> dict[str, Any] | None:
    sm = (c.analytics or {}).get("sample_metrics") or {}
    is_snap = sm.get("in_sample") or {}
    oos_snap = sm.get("out_of_sample") or {}
    full_snap = sm.get("full_sample") or {}
    if not is_snap and not oos_snap:
        return None
    return {
        "model_code": c.model_code,
        "rank": c.rank,
        "in_sample_objective": is_snap.get("objective_value"),
        "out_of_sample_objective": oos_snap.get("objective_value"),
        "full_sample_objective": full_snap.get("objective_value"),
        "gap_objective": (sm.get("gap") or {}).get("objective"),
        "in_sample_sharpe": is_snap.get("sharpe"),
        "out_of_sample_sharpe": oos_snap.get("sharpe"),
        "objective": objective_effective,
        "objective_label": sm.get("objective_label")
        or objective_label(objective_effective),
        "selection_basis": "in_sample",
    }


def _leaderboard_row_from_record(
    params: dict[str, Any],
    metrics: dict[str, Any],
    *,
    objective_effective: str,
) -> dict[str, Any] | None:
    code = params.get("model_code")
    if not code:
        return None
    is_obj = metrics.get("objective_value_is")
    oos_obj = metrics.get("objective_value_oos")
    train_m = metrics.get("train_metrics") or {}
    val_m = metrics.get("validation_metrics") or {}
    if is_obj is None and isinstance(train_m, dict) and train_m:
        is_obj = train_m.get("objective_value")
    if oos_obj is None and isinstance(val_m, dict) and val_m:
        oos_obj = val_m.get("objective_value")
    if is_obj is None and oos_obj is None:
        return None
    gap = metrics.get("gap_objective")
    if gap is None and is_obj is not None and oos_obj is not None:
        gap = round(float(is_obj) - float(oos_obj), 6)
    rank = params.get("optuna_trial_number")
    if rank is not None:
        try:
            rank = int(rank) + 1
        except (TypeError, ValueError):
            rank = None
    return {
        "model_code": str(code),
        "rank": rank,
        "in_sample_objective": is_obj,
        "out_of_sample_objective": oos_obj,
        "full_sample_objective": metrics.get("objective_value_full"),
        "gap_objective": gap,
        "in_sample_sharpe": (
            train_m.get("sharpe") if isinstance(train_m, dict) else None
        ),
        "out_of_sample_sharpe": (
            val_m.get("sharpe") if isinstance(val_m, dict) else None
        ),
        "objective": objective_effective,
        "objective_label": objective_label(objective_effective),
        "selection_basis": "in_sample",
    }


def _oos_leaderboard(
    candidates: list[PortfolioCandidate],
    *,
    records: list[tuple[float, dict, dict]] | None = None,
    objective_effective: str,
) -> list[dict[str, Any]]:
    """Holdout ranking for all ranked trials (not capped by top_models)."""
    by_code: dict[str, dict[str, Any]] = {}
    for _score, params, metrics in records or []:
        if not isinstance(params, dict) or not isinstance(metrics, dict):
            continue
        row = _leaderboard_row_from_record(
            params,
            metrics,
            objective_effective=objective_effective,
        )
        if row is None or not row.get("model_code"):
            continue
        code = str(row["model_code"])
        existing = by_code.get(code)
        if existing is None or _leaderboard_is_better_row(row, existing):
            by_code[code] = row

    for c in candidates:
        row = _leaderboard_row_from_candidate(
            c,
            objective_effective=objective_effective,
        )
        if row is None or not row.get("model_code"):
            continue
        by_code[str(row["model_code"])] = row

    rows = list(by_code.values())
    rows.sort(
        key=lambda r: float(r.get("in_sample_objective") or -1e9),
        reverse=True,
    )
    return rows


def _build_frontier_from_records(
    records: list[tuple[float, dict, dict]],
    trials_completed: int,
    *,
    exclude_model_codes: set[str] | frozenset[str] | None = None,
) -> list[dict[str, Any]]:
    """Subsample search trials for the efficient-frontier scatter chart.

    Output candidates are built from the same search records; exclude their
    model_codes so the chart does not plot the same model twice (blue sample +
    orange output).
    """
    frontier: list[dict[str, Any]] = []
    step = max(1, trials_completed // 25)
    exclude = exclude_model_codes or frozenset()
    for score, params, metrics in records[::step]:
        code = params.get("model_code")
        if code and str(code) in exclude:
            continue
        frontier.append(
            {
                "name": str(code) if code else "sample",
                "model_code": str(code) if code else None,
                "volatility": round(float(metrics["volatility"]), 4),
                "return": round(float(metrics["cagr"]), 4),
                "sharpe": round(float(metrics["sharpe"]), 4),
                "score": round(float(score), 4),
                "params": params,
            }
        )
        if len(frontier) >= 25:
            break
    return frontier


def _candidate_objective_value(c: PortfolioCandidate, objective_effective: str) -> float:
    sm = (c.analytics or {}).get("sample_metrics") or {}
    is_obj = (sm.get("in_sample") or {}).get("objective_value")
    if is_obj is not None:
        return float(is_obj)
    if objective_effective == "max_sharpe":
        return float(c.sharpe)
    if objective_effective == "max_return":
        return float(c.cagr)
    if objective_effective == "min_max_drawdown":
        return -abs(float(c.max_drawdown))
    if objective_effective == "max_sortino":
        return float(c.sortino or 0.0)
    if objective_effective == "min_cvar":
        return float(c.cvar_95 or -1.0)
    if objective_effective == "risk_parity_erc":
        return float(c.sharpe) - 0.25 * abs(float(c.max_drawdown))
    if objective_effective == "max_diversification":
        return (
            float(c.cagr)
            - 0.35 * abs(float(c.max_drawdown))
            - 0.10 * float(c.turnover_avg or 0.0)
        )
    if objective_effective == "mean_variance_utility":
        return float(c.sharpe) - 0.15 * float(c.volatility)
    if objective_effective == "custom":
        return float(c.sharpe) - 0.2 * abs(float(c.max_drawdown))
    return float(c.sharpe)


def _objective_progress_label_and_text(
    objective_effective: str, value: float | None
) -> tuple[str, str]:
    from app.engine.dynamic_objective import is_dynamic_objective

    label_map = {
        "max_sharpe": "Sharpe",
        "max_return": "CAGR",
        "min_max_drawdown": "max DD",
        "max_sortino": "Sortino",
        "min_cvar": "CVaR",
        "risk_parity_erc": "Sharpe",
        "max_diversification": "Sharpe",
        "mean_variance_utility": "vol",
        "custom": "Sharpe",
        "dynamic_comprehensive": "comprehensive",
    }
    if is_dynamic_objective(objective_effective):
        label = "comprehensive"
    else:
        label = label_map.get(objective_effective, "metric")
    if value is None:
        return label, "—"
    if objective_effective in {"max_return", "min_max_drawdown", "min_cvar", "mean_variance_utility"}:
        return label, f"{value * 100:.2f}%"
    return label, f"{value:.3f}"


def _rerank_candidates_by_objective(
    candidates: list[PortfolioCandidate], objective_effective: str
) -> list[PortfolioCandidate]:
    """Assign objective rank badges without reordering the candidate list."""
    if not candidates:
        return candidates
    ranked_indices = sorted(
        range(len(candidates)),
        key=lambda i: _candidate_objective_value(candidates[i], objective_effective),
        reverse=True,
    )
    for rank, orig_idx in enumerate(ranked_indices, start=1):
        candidates[orig_idx].rank = rank
    return candidates


def _sort_candidates_by_model_code(
    candidates: list[PortfolioCandidate],
) -> list[PortfolioCandidate]:
    """Presentation order by catalog model_code (M0001, M0002, …)."""
    return sorted(candidates, key=lambda c: model_code_sort_key(c.model_code))


def _best_candidate(
    candidates: list[PortfolioCandidate],
) -> PortfolioCandidate | None:
    if not candidates:
        return None
    flagged = next((c for c in candidates if c.is_champion), None)
    if flagged is not None:
        return flagged
    by_rank = next((c for c in candidates if c.rank == 1), None)
    return by_rank or candidates[0]


def _build_portfolio_catalog_from_records(
    source_records: list[tuple[float, dict, dict]],
    *,
    source_label: str,
    fallback_next_model_no: list[int] | None = None,
) -> list[dict[str, Any]]:
    fallback_no = fallback_next_model_no or _fallback_model_no_from_records(
        source_records
    )
    rows: list[dict[str, Any]] = []
    for idx, (score, params, metrics) in enumerate(source_records, start=1):
        params_ref = params if isinstance(params, dict) else {}
        code = _read_or_assign_model_code(
            params_ref,
            next_model_no=fallback_no,
            context=f"catalog ({source_label})",
        )
        rows.append(
            {
                "model_code": code,
                "source": source_label,
                "sequence": idx,
                "adjusted_score": round(float(score), 6),
                "raw_score": round(float(metrics.get("raw_score", score)), 6),
                "sharpe": round(float(metrics.get("sharpe", 0.0)), 6),
                "cagr": round(float(metrics.get("cagr", 0.0)), 6),
                "max_drawdown": round(float(metrics.get("max_drawdown", 0.0)), 6),
            }
        )
    return rows


def _find_record_by_params(
    records: list[tuple[float, dict, dict]], params: dict[str, Any] | None
) -> tuple[float, dict, dict] | None:
    if not isinstance(params, dict):
        return None
    target = _model_signature(params)
    for rec in records:
        if _model_signature(rec[1]) == target:
            return rec
    return None


def _explicit_request_benchmark_ticker(req: BacktestRequest) -> str | None:
    explicit = getattr(req, "benchmark_ticker", None)
    if explicit and str(explicit).strip():
        return str(explicit).strip().upper()
    return None


def _resolve_request_benchmark_ticker(
    req: BacktestRequest,
    *,
    universe_plan: dict[str, Any] | None = None,
    fallback: str = "SPY",
) -> str:
    """Prefer an explicit request benchmark over AI universe suggestion."""
    explicit = getattr(req, "benchmark_ticker", None)
    if explicit and str(explicit).strip():
        return str(explicit).strip().upper()
    if universe_plan:
        return str(universe_plan.get("benchmark_ticker", fallback))
    return fallback


def _run_static_replay_backtest(
    req: BacktestRequest,
    job_id: str,
    progress_cb=None,
) -> BacktestResult:
    """Replay fixed target weights on rebalance dates — skips Optuna entirely."""
    holdings_raw = req.static_replay_holdings or {}
    if not holdings_raw:
        raise ValueError("static_replay_holdings is required for static replay")

    objective_effective = _resolve_objective(req.objective.value, req.objective_custom_text)
    from app.engine.portfolio import _normalize_rebalance_rule

    rebalance_rule = _normalize_rebalance_rule(req.rebalance_freq)
    tickers = [str(t).upper() for t in holdings_raw.keys()]
    weights_map = {str(t).upper(): float(w) for t, w in holdings_raw.items()}
    total_w = sum(weights_map.values())
    if total_w <= 0:
        raise ValueError("static_replay_holdings must sum to a positive weight")
    weights_map = {k: v / total_w for k, v in weights_map.items()}

    bench = _resolve_request_benchmark_ticker(req)
    # Fetch prices for holdings + benchmark
    fetch_tickers = list(dict.fromkeys([*tickers, bench]))
    spec = BacktestSpec(
        benchmark_ticker=bench,
        fee_bps=req.fee_bps,
        rebalance_rule=rebalance_rule,
        max_holdings=max(len(tickers), int(req.max_holdings)),
    )

    def report_progress(trial: int, total: int, message: str) -> None:
        if progress_cb:
            progress_cb(trial=trial, trials_total=total, message=message)

    report_progress(0, 1, "Static replay: fetching market data…")

    try:
        prices, data_meta = fetch_prices(
            fetch_tickers,
            req.start_date,
            req.end_date,
            spec.benchmark_ticker,
            min_valid_tickers=max(1, len(set(fetch_tickers))),
        )
    except Exception as exc:
        logger.error(
            "Static replay price load failed: %s | tickers=%s start=%s end=%s",
            exc,
            fetch_tickers,
            req.start_date,
            req.end_date,
        )
        raise ValueError(
            f"Failed to load prices: {exc}. Check network, date range, and API is running."
        ) from exc

    tradable = [t for t in tickers if t in prices.columns]
    if not tradable:
        raise ValueError("No static replay tickers available in price data")
    missing = [t for t in tickers if t not in prices.columns]
    if missing:
        logger.warning("Static replay tickers missing from prices: %s", missing)
        remapped = {t: w for t, w in weights_map.items() if t in tradable}
        rem_total = sum(remapped.values())
        weights_map = {k: v / rem_total for k, v in remapped.items()}
        tickers = tradable

    if bench not in prices.columns:
        bench = tickers[0]
        spec = BacktestSpec(
            benchmark_ticker=bench,
            fee_bps=req.fee_bps,
            rebalance_rule=rebalance_rule,
            max_holdings=max(len(tickers), int(req.max_holdings)),
        )

    prices_panel = trim_prices_to_report_window(prices[tickers].copy(), req.start_date)
    w_array = np.array([weights_map.get(t, 0.0) for t in tickers], dtype=float)
    w_sum = float(w_array.sum())
    if w_sum <= 0:
        raise ValueError("Static replay weights invalid after ticker alignment")
    w_array = w_array / w_sum

    universe = get_universe(req.asset_classes, None, tickers)
    universe_by_ticker = {u["ticker"]: u for u in universe if u["ticker"] in tickers}

    oos = req.enable_oos
    if oos:
        prices_train, prices_val, train_end, val_start = split_train_validation(
            prices_panel, req.train_ratio
        )
        is_split_idx = len(prices_train)
    else:
        prices_train = prices_panel
        prices_val = prices_panel.iloc[0:0]
        train_end = str(prices_panel.index[-1].date())
        val_start = train_end
        is_split_idx = None

    report_progress(0, 1, "Static replay: simulating fixed-weight portfolio…")

    full_m = simulate_portfolio(
        prices_panel, w_array, spec, report_start=req.start_date
    )
    if oos and is_split_idx is not None and is_split_idx < len(prices_panel):
        train_m = metrics_for_horizon_window(full_m, spec, 0, is_split_idx)
        val_m = metrics_for_horizon_window(
            full_m, spec, is_split_idx, len(prices_panel)
        )
    else:
        train_m = full_m
        val_m = None
        oos = False

    full_curve = equity_curve_series(full_m["equity"])
    params = {
        "model_code": "STATIC",
        "mode": "static_replay",
        "rebalance_freq": rebalance_rule,
        **{f"static_w_{t}": round(float(weights_map.get(t, 0.0)), 6) for t in tickers},
    }
    candidate = _build_candidate(
        1,
        tickers,
        train_m,
        val_m,
        oos,
        params,
        full_m,
        full_curve,
        prices_panel,
        universe_by_ticker,
        spec,
        objective_effective=objective_effective,
        train_start=str(prices_panel.index[0].date()),
        train_end=train_end,
        val_start=val_start if oos else None,
        train_ratio=float(req.train_ratio) if oos else None,
        min_weight=req.min_weight,
        is_split_idx=is_split_idx,
        include_charts=True,
    )
    candidate.is_champion = True

    bench_m = benchmark_metrics(prices_panel, spec.benchmark_ticker, spec)
    report_progress(1, 1, "Backtest complete")

    narrative_facts: dict[str, Any] = {
        "scenario_id": req.scenario_id,
        "static_replay": True,
        "static_replay_holdings": weights_map,
        "trials_completed": 1,
        "optimization_mode": "static_replay",
        "backtest_methodology": (
            "Static replay: fixed target weights rebalanced on schedule "
            f"({rebalance_rule}); no Optuna search."
        ),
        "backtest_spec": {
            "fee_bps": spec.fee_bps,
            "rebalance_freq": spec.rebalance_rule,
            "risk_free_rate": spec.risk_free_rate,
            "benchmark": spec.benchmark_ticker,
            "benchmark_metrics": bench_m,
        },
        "rebalance_freq": rebalance_rule,
        "rebalance_count": full_m.get("rebalance_count"),
        "rebalance_applied": full_m.get("rebalance_applied"),
        "tradable_count": len(tickers),
        "asset_classes_filter": req.asset_classes,
        "universe_tickers_filter": tickers,
        "oos_enabled": oos,
        "metrics_trustworthy": data_meta["data_source"] == "yfinance"
        and not full_m.get("metrics_suspect", False),
        "champion_model_code": "STATIC",
        "ai_champion_model_code": "STATIC",
    }

    return BacktestResult(
        job_id=job_id,
        scenario_id=req.scenario_id,
        benchmark=spec.benchmark_ticker,
        period={"start": req.start_date, "end": req.end_date},
        candidates=[candidate],
        equity_curve=full_curve,
        efficient_frontier=[],
        narrative_facts=narrative_facts,
        pro_rounds=None,
        experimental=None,
        dynamic_objective_timeline=None,
        dynamic_objective_benchmark_series=None,
    )


def run_backtest(req: BacktestRequest, job_id: str, progress_cb=None) -> BacktestResult:
    if req.static_replay_holdings:
        result = _run_static_replay_backtest(req, job_id, progress_cb=progress_cb)
        maybe_collect_garbage(1, 1)
        return result

    pro_mode_early = _is_pro_mode(req)
    capped_trials = cap_trials_for_runtime(req.trials, pro_mode=pro_mode_early)
    if capped_trials < req.trials:
        logger.info(
            "Runtime trials cap applied: %d -> %d (job %s)",
            req.trials,
            capped_trials,
            job_id,
        )
        req = req.model_copy(update={"trials": capped_trials})

    objective_effective = _resolve_objective(req.objective.value, req.objective_custom_text)
    dynamic_mode = is_dynamic_objective(objective_effective)
    # Regime-adaptive allocation can be enabled independently of the composite dynamic
    # objective. objective=dynamic always implies it (backward compatible).
    regime_adaptive = bool(getattr(req, "regime_adaptive", False)) or dynamic_mode
    trial_objective = trial_scoring_objective(objective_effective)
    regime_mode = resolve_regime_mode(
        str(req.experiment.regime_mode)
        if req.experiment and req.experiment.enabled
        else None
    )
    guaranteed_supplements = list(req.universe_supplement_tickers or [])
    universe = get_universe(
        req.asset_classes,
        req.universe_categories,
        req.universe_tickers,
        supplement_tickers=guaranteed_supplements or None,
    )
    explicit_bench = _explicit_request_benchmark_ticker(req)
    universe_plan = refine_universe_with_ai(
        universe=universe,
        objective=trial_objective if dynamic_mode else objective_effective,
        asset_classes=req.asset_classes,
        benchmark_ticker=explicit_bench,
    )
    # Pinned supplements survive category dedupe during refine (保證名單).
    universe = pin_guaranteed_supplements(
        universe_plan["universe"],
        guaranteed_supplements or None,
        asset_classes=req.asset_classes,
    )
    universe = cap_universe_for_runtime(
        universe,
        pinned_tickers=guaranteed_supplements or None,
    )
    universe_pool_count = len(universe)
    universe_meta = get_universe_meta()
    if len(universe) < 5:
        raise ValueError(
            f"Too few tickers after filter ({len(universe)}); need at least 5 or wider asset classes"
        )

    tickers = [u["ticker"] for u in universe]
    from app.engine.portfolio import _normalize_rebalance_rule

    rebalance_rule = _normalize_rebalance_rule(req.rebalance_freq)
    bench = _resolve_request_benchmark_ticker(req, universe_plan=universe_plan)
    spec = BacktestSpec(
        benchmark_ticker=bench,
        fee_bps=req.fee_bps,
        rebalance_rule=rebalance_rule,
        max_holdings=int(req.max_holdings),
    )

    try:
        prices, data_meta = fetch_prices(
            tickers, req.start_date, req.end_date, spec.benchmark_ticker
        )
    except Exception as exc:
        logger.error(
            "Backtest price load failed: %s | universe=%d tickers start=%s end=%s",
            exc,
            len(tickers),
            req.start_date,
            req.end_date,
        )
        raise ValueError(
            f"Failed to load prices: {exc}. Check network, date range, and API is running."
        ) from exc

    tickers = [t for t in tickers if t in prices.columns]
    if len(tickers) < 5:
        raise ValueError("Too few tradable tickers after filter; widen asset classes or extend dates")
    prices_full = prices
    prices_sim_panel = prices_full[tickers]
    prices = trim_prices_to_report_window(prices_full[tickers].copy(), req.start_date)
    universe_by_ticker = {u["ticker"]: u for u in universe if u["ticker"] in tickers}

    dynamic_ctx: dict[str, Any] | None = None
    if regime_adaptive:
        dynamic_ctx = build_dynamic_objective_context(
            prices_full,
            spec.benchmark_ticker,
            regime_mode=regime_mode,
            fast_risk_off_exit=True,
        )
        if len(dynamic_ctx.get("objectives_used") or []) < 1:
            raise ValueError(
                "Regime-adaptive allocation needs enough benchmark history for the regime "
                "walk-forward; extend the date range or change benchmark."
            )

    oos = req.enable_oos
    if oos:
        prices_train, prices_val, train_end, val_start = split_train_validation(
            prices, req.train_ratio
        )
    else:
        prices_train, prices_val = prices, prices.iloc[0:0]
        train_end = str(prices.index[-1].date())
        val_start = train_end

    def report_progress(
        trial: int,
        total: int,
        message: str,
        best_sharpe: float | None = None,
        refinement_round: int = 0,
        refinement_rounds_total: int = 0,
        convergence_preview: list[dict[str, Any]] | None = None,
        round_benchmark_status: str | None = None,
        round_benchmark_alpha: float | None = None,
        round_portfolio_vs_benchmark: dict[str, Any] | None = None,
    ) -> None:
        if progress_cb:
            progress_cb(
                trial=trial,
                trials_total=total,
                message=message,
                best_sharpe=best_sharpe,
                refinement_round=refinement_round,
                refinement_rounds_total=refinement_rounds_total,
                convergence_preview=convergence_preview,
                round_benchmark_status=round_benchmark_status,
                round_benchmark_alpha=round_benchmark_alpha,
                round_portfolio_vs_benchmark=round_portfolio_vs_benchmark,
            )

    blueprint = RunBlueprint.from_request(req)
    param_controls_dict = normalize_param_controls(
        enforce_param_controls_for_asset_classes(
            {k: v.model_dump() for k, v in (req.param_controls or {}).items()},
            req.asset_classes,
        ),
        blueprint,
    )
    # Keep run-level objective/rebalance immutable unless user explicitly fixed differently.
    param_controls_dict["objective_mode"] = {
        "mode": "fixed",
        "fixed": objective_effective,
        "options": [objective_effective],
    }
    if dynamic_mode:
        param_controls_dict["objective_mode"]["options"] = [DYNAMIC_OBJECTIVE]
    param_controls_dict["rebalance_freq"] = {
        "mode": "fixed",
        "fixed": rebalance_rule,
        "options": [rebalance_rule],
    }
    pro_mode = _is_pro_mode(req)
    convergence_history: list[dict[str, Any]] = []
    refinement_meta: dict[str, Any] = {}
    ai_generation: dict[str, Any] = {}
    ai_param_sets: list[dict[str, Any]] = []
    trial_report_cache = TrialReportCache()
    warm_start_info: dict[str, Any] = {"matched": False}
    continuation_info: dict[str, Any] | None = None
    continuation_state: dict[str, Any] | None = None
    cached_champion: CachedChampion | None = None
    initial_champion_record: tuple[float, dict, dict] | None = None
    standard_champion_seed: dict[str, Any] | None = None
    try:
        from app.jobs import pop_continuation_snapshot

        raw_snap = pop_continuation_snapshot(job_id)
        if raw_snap is None and req.continue_from_job_id:
            from app.job_history import load_persisted_job

            loaded = load_persisted_job(req.continue_from_job_id)
            if loaded is not None:
                raw_snap = extract_continuation_snapshot(loaded[1])
                if raw_snap is not None:
                    raw_snap = dict(raw_snap)
                    raw_snap["prior_job_id"] = req.continue_from_job_id
        if raw_snap is not None:
            continuation_state = continuation_runtime_state(raw_snap)
            continuation_info = {
                "continued_from_job_id": raw_snap.get("prior_job_id")
                or req.continue_from_job_id,
                "prior_rounds_completed": int(raw_snap.get("rounds_completed") or 0),
                "prior_trials_total": int(raw_snap.get("trials_total") or 0),
                "mode": continuation_state.get("mode"),
            }
            if continuation_state.get("mode") == "pro":
                initial_champion_record = continuation_state.get("initial_champion_record")
                if initial_champion_record and initial_champion_record[1]:
                    standard_champion_seed = params_for_champion_seed(
                        initial_champion_record[1]
                    )
            elif continuation_state.get("champion_seed"):
                standard_champion_seed = continuation_state.get("champion_seed")
    except Exception:  # noqa: BLE001
        logger.exception("Continuation snapshot load failed; starting fresh")
    if continuation_state is None:
        try:
            cached_champion = lookup_champion(req)
        except Exception:  # noqa: BLE001
            logger.exception("Champion registry lookup failed; continuing without warm start")
        if cached_champion is not None:
            warm_start_info = _warm_start_facts(cached_champion, req)
            initial_champion_record = _champion_record_from_cache(cached_champion)
            standard_champion_seed = params_for_champion_seed(cached_champion.champion_params)

    report_progress(
        0,
        req.trials if not pro_mode else req.refinement_batch_size,
        f"Loaded {len(tickers)} tickers, {data_meta['rows']} trading days. "
        f"Each rebalance: factor Top-N screen + allocator weights (not static weights)."
        + (
            " Regime-adaptive: regime V2 sets allocator preset per rebalance."
            if regime_adaptive
            else ""
        ),
    )
    if cached_champion is not None:
        report_progress(
            0,
            req.trials if not pro_mode else req.refinement_batch_size,
            _warm_start_progress_message(req.report_language, cached_champion, req),
        )
    if continuation_info is not None:
        prior_id = str(continuation_info.get("continued_from_job_id") or "")[:8]
        prior_rounds = int(continuation_info.get("prior_rounds_completed") or 0)
        if req.report_language == "zh":
            cont_msg = (
                f"延續先前回測（job {prior_id}…），"
                f"從第 {prior_rounds + 1} 輪繼續優化（保留冠軍與學習紀錄）"
            )
        elif req.report_language == "ko":
            cont_msg = (
                f"이전 실행 이어하기 (job {prior_id}…), "
                f"{prior_rounds + 1}라운드부터 최적화 재개 (챔피언·학습 기록 유지)"
            )
        else:
            cont_msg = (
                f"Continuing prior run (job {prior_id}…), "
                f"resuming at round {prior_rounds + 1} with champion and learning history"
            )
        report_progress(
            0,
            req.trials if not pro_mode else req.refinement_batch_size,
            cont_msg,
        )

    effective_trials = int(req.trials)
    if pro_mode:
        if not oos:
            report_progress(
                0,
                req.refinement_batch_size,
                "Pro: enable holdout split — trial selection uses in-sample only; OOS for final diagnostics…",
            )
        report_progress(
            0,
            req.refinement_batch_size,
            "Pro: champion-challenger loop (AI learns from history)…",
        )
        records, convergence_history, refinement_meta = _run_iterative_search(
            req,
            prices=prices,
            prices_sim_panel=prices_sim_panel,
            prices_train=prices_train,
            prices_val=prices_val,
            oos=oos,
            objective_effective=objective_effective,
            rebalance_rule=rebalance_rule,
            spec=spec,
            universe_by_ticker=universe_by_ticker,
            param_controls_dict=param_controls_dict,
            report_progress=report_progress,
            trial_report_cache=trial_report_cache,
            dynamic_ctx=dynamic_ctx,
            initial_champion_record=initial_champion_record,
            continuation_state=continuation_state,
        )
        ai_generation = {
            "enabled": True,
            "model": "ai+iterative",
            "seed_sets_requested": refinement_meta.get("trials_total"),
            "seed_sets_used": refinement_meta.get("trials_total"),
            "rationale": " | ".join(refinement_meta.get("ai_rationales", [])),
            "rationales_by_round": refinement_meta.get("ai_rationales", []),
            "error": None,
        }
    else:
        def ai_progress(current: int, total: int, message: str) -> None:
            report_progress(current, total, message)

        report_progress(
            0,
            req.trials,
            f"Starting AI — planning param seeds for {req.trials} trials…",
        )
        ai_generation = generate_ai_param_sets(
            n=req.trials,
            objective=trial_objective,
            rebalance_freq=rebalance_rule,
            max_weight_cap=req.max_weight,
            max_turnover_cap=req.max_turnover,
            top_n_cap=req.top_n,
            tradable_count=len(tickers),
            param_controls=param_controls_dict,
            progress_cb=ai_progress,
            all_ai_seeds=True,
        )
        ai_param_sets = ai_generation.get("param_sets", []) if ai_generation else []
        # Standard mode: evaluate only AI-generated seeds (no Optuna-random filler).
        # If AI fails, fall back to the requested trial count with Optuna search.
        if ai_generation.get("enabled") and ai_param_sets:
            effective_trials = max(1, len(ai_param_sets))
        else:
            effective_trials = req.trials
        ai_used = min(len(ai_param_sets), effective_trials)
        if ai_generation.get("enabled"):
            seed_msg = (
                f"AI done: {ai_used} AI seed sets — evaluating all as trials "
                f"(no Optuna-random filler)"
            )
            if ai_generation.get("seeds_capped"):
                seed_msg += (
                    f" (requested {req.trials}; hard-capped at "
                    f"{ai_generation.get('seeds_target', ai_used)})"
                )
            report_progress(
                ai_used,
                effective_trials,
                f"{seed_msg} — starting backtests…",
            )
        else:
            err = ai_generation.get("error") or "unknown"
            report_progress(
                0,
                effective_trials,
                f"AI off ({err}) — falling back to Optuna random search…",
            )

        def optuna_progress(
            trial: int,
            total: int,
            best_score: float | None,
            _latest_record: tuple[float, dict, dict] | None = None,
        ) -> None:
            scope = "in-sample" if oos else "full window"
            msg = f"Optuna {trial}/{total} ({scope}, dynamic Top-N each rebalance)"
            if best_score is not None:
                obj_label, obj_text = _objective_progress_label_and_text(
                    objective_effective, best_score
                )
                msg += f", best {obj_label} {obj_text}"
            report_progress(trial, total, msg, best_score)

        records = run_optuna_search(
            prices_train,
            prices_sim_panel=prices_sim_panel,
            max_weight=req.max_weight,
            min_weight=req.min_weight,
            max_turnover=req.max_turnover,
            top_n=req.top_n,
            objective=trial_objective,
            trials=effective_trials,
            ai_seed_param_sets=ai_param_sets,
            param_controls=param_controls_dict,
            spec=spec,
            progress_cb=optuna_progress,
            universe_by_ticker=universe_by_ticker,
            prices_val=prices_val if oos and len(prices_val) > 60 else None,
            select_on_is=bool(oos and len(prices_val) > 60),
            asset_classes=req.asset_classes,
            trial_report_cache=trial_report_cache,
            allocator_resolver=(
                dynamic_ctx.get("allocator_resolver") if dynamic_ctx else None
            ),
            class_budget_resolver=(
                dynamic_ctx.get("class_budget_resolver") if dynamic_ctx else None
            ),
            active_regime_resolver=(
                dynamic_ctx.get("active_regime_resolver") if dynamic_ctx else None
            ),
            enforce_class_weights=req.enforce_class_weights,
            champion_seed=standard_champion_seed,
        )
        assign_search_model_codes(records, next_model_no=[1])
        for _, params, _ in records:
            trial_report_cache.register_model_code(params)

    trials_feasible = len(records)
    trials_completed = (
        int(refinement_meta.get("trials_total", 0))
        if pro_mode
        else effective_trials
    )
    top_n_models = min(int(req.top_models), trials_feasible)
    all_record_catalog: list[dict[str, Any]] = []
    if pro_mode and refinement_meta.get("per_round"):
        for pr in refinement_meta.get("per_round", []):
            if not isinstance(pr, dict):
                continue
            pr_records = pr.get("records") or []
            if not isinstance(pr_records, list):
                continue
            all_record_catalog.extend(
                _build_portfolio_catalog_from_records(
                    pr_records,
                    source_label=f"round_{pr.get('round', '?')}",
                )
            )
    else:
        all_record_catalog.extend(
            _build_portfolio_catalog_from_records(
                records,
                source_label="final_search",
            )
        )

    report_progress(
        trials_completed,
        trials_completed,
        f"Search done ({trials_feasible} feasible) — packaging top {top_n_models} "
        f"for report (using search cache when available)…",
    )

    def final_assembly_progress(message: str) -> None:
        report_progress(
            trials_completed,
            trials_completed,
            f"Packaging report: {message}",
        )

    final_champion_code: str | None = None
    if pro_mode:
        ai_code = refinement_meta.get("ai_champion_model_code")
        if ai_code:
            final_champion_code = str(ai_code)
        if not final_champion_code:
            final_champion_params = refinement_meta.get("final_champion_params")
            if isinstance(final_champion_params, dict):
                mc = final_champion_params.get("model_code")
                if mc:
                    final_champion_code = str(mc)
    records_for_report = top_records_for_report(
        list(records),
        objective_effective,
        top_n_models,
    )
    final_full_codes = _champion_model_codes_from_records(
        records_for_report,
        explicit_code=final_champion_code,
    )
    candidates = _assemble_candidates_from_records(
        records_for_report,
        req=req,
        top_n_models=top_n_models,
        tickers=tickers,
        prices=prices,
        prices_sim_panel=prices_sim_panel,
        prices_train=prices_train,
        prices_val=prices_val,
        oos=oos,
        rebalance_rule=rebalance_rule,
        spec=spec,
        universe_by_ticker=universe_by_ticker,
        objective_effective=objective_effective,
        train_start=str(prices_train.index[0].date()),
        train_end=train_end,
        val_start=val_start,
        train_ratio=float(req.train_ratio),
        assembly_progress=final_assembly_progress,
        trial_report_cache=trial_report_cache,
        dynamic_ctx=dynamic_ctx,
        full_payload_codes=final_full_codes,
    )
    candidates = _rerank_candidates_by_objective(
        candidates, trial_objective if dynamic_mode else objective_effective
    )
    candidates = _sort_candidates_by_model_code(candidates)
    for c in candidates:
        c.is_champion = False
    if pro_mode:
        champ_code = final_champion_code
        if champ_code:
            for c in candidates:
                if c.model_code == champ_code:
                    c.is_champion = True
                    break
        if not any(c.is_champion for c in candidates):
            final_champion_params = refinement_meta.get("final_champion_params")
            if isinstance(final_champion_params, dict):
                champ_sig = _model_signature(final_champion_params)
                for c in candidates:
                    if _model_signature(c.params or {}) == champ_sig:
                        c.is_champion = True
                        break
                if not any(c.is_champion for c in candidates):
                    fallback_code = str(final_champion_params.get("model_code", ""))
                    for c in candidates:
                        if fallback_code and c.model_code == fallback_code:
                            c.is_champion = True
                            break
    else:
        for c in candidates:
            if c.rank == 1:
                c.is_champion = True
                break
    top = records[:top_n_models]
    if pro_mode:
        final_champion_params = refinement_meta.get("final_champion_params")
        champion_record = (
            _find_record_by_params(records, final_champion_params)
            if isinstance(final_champion_params, dict)
            else None
        )
        if champion_record is None and refinement_meta.get("per_round"):
            last_pr = refinement_meta["per_round"][-1]
            last_records = last_pr.get("records") or []
            champion_record = best_record_in_pool(last_records, objective_effective)
    else:
        champion_record = best_record_in_pool(records, objective_effective)

    pro_rounds: list[ProRoundSnapshot] | None = None
    if pro_mode and refinement_meta.get("per_round"):
        pro_rounds = []
        for pr in refinement_meta["per_round"]:
            pr_records: list[tuple[float, dict, dict]] = pr.get("records", [])
            if not pr_records:
                continue
            pool_model_codes_meta = list(pr.get("pool_model_codes") or [])
            if pool_model_codes_meta:
                display_records, pool_model_codes_meta = records_for_pool_model_codes(
                    pr_records,
                    pool_model_codes_meta,
                )
            else:
                allow_codes = pro_round_display_allowlist(
                    pool_model_codes=None,
                    incoming_champion_model_code=pr.get("incoming_champion_model_code"),
                    round_winner_model_code=pr.get("round_winner_model_code"),
                    round_challenger_model_codes=pr.get("round_challenger_model_codes"),
                )
                if allow_codes:
                    display_records = [
                        rec
                        for rec in pr_records
                        if str(rec[1].get("model_code", "")) in allow_codes
                    ]
                else:
                    display_records = list(pr_records)
            if not display_records:
                continue
            pool_model_codes = pool_model_codes_meta
            pr_feasible = len(display_records)
            pr_top_n = pro_round_report_top_n(
                pool_model_codes=pool_model_codes_meta,
                req_top_models=int(req.top_models),
                feasible_count=pr_feasible,
            )
            pr_round = int(pr["round"])

            def pro_round_assembly_progress(message: str) -> None:
                report_progress(
                    trials_completed,
                    trials_completed,
                    f"Round {pr_round} report: {message}",
                )

            pro_round_assembly_progress(
                f"top {pr_top_n} of {pr_feasible} pool models "
                f"(using search cache when available)…"
            )
            round_champion_code_pre = (
                pr.get("ai_champion_model_code") or pr.get("round_winner_model_code")
            )
            pr_full_codes = _champion_model_codes_from_records(
                display_records,
                explicit_code=(
                    str(round_champion_code_pre) if round_champion_code_pre else None
                ),
            )
            pr_candidates = _assemble_candidates_from_records(
                display_records,
                req=req,
                top_n_models=pr_top_n,
                tickers=tickers,
                prices=prices,
                prices_sim_panel=prices_sim_panel,
                prices_train=prices_train,
                prices_val=prices_val,
                oos=oos,
                rebalance_rule=rebalance_rule,
                spec=spec,
                universe_by_ticker=universe_by_ticker,
                objective_effective=objective_effective,
                train_start=str(prices_train.index[0].date()),
                train_end=train_end,
                val_start=val_start,
                train_ratio=float(req.train_ratio),
                assembly_progress=pro_round_assembly_progress,
                trial_report_cache=trial_report_cache,
                dynamic_ctx=dynamic_ctx,
                full_payload_codes=pr_full_codes,
            )
            pro_round_assembly_progress("ranking packaged models by objective…")
            pr_candidates = _rerank_candidates_by_objective(
                pr_candidates,
                trial_objective if dynamic_mode else objective_effective,
            )
            pr_candidates = _sort_candidates_by_model_code(pr_candidates)
            cand_codes = {
                str((c.params or {}).get("model_code", ""))
                for c in pr_candidates
                if (c.params or {}).get("model_code")
            }
            pool_code_set = {str(c) for c in pool_model_codes if c}
            if cand_codes != pool_code_set:
                logger.warning(
                    "Pro round %s candidate codes %s != pool_model_codes %s",
                    pr["round"],
                    sorted(cand_codes),
                    sorted(pool_code_set),
                )
                pool_model_codes = sorted(cand_codes)
            winner_params = pr.get("round_winner_params")
            incoming_params = pr.get("incoming_champion_params")
            ai_champion_code = pr.get("ai_champion_model_code")
            champion_params = winner_params
            if ai_champion_code:
                for _s, p, _m in display_records:
                    if str(p.get("model_code", "")) == str(ai_champion_code):
                        champion_params = p
                        break
            champion_sig = (
                _model_signature(champion_params)
                if isinstance(champion_params, dict)
                else None
            )
            winner_sig = (
                _model_signature(winner_params)
                if isinstance(winner_params, dict)
                else None
            )
            incoming_sig = (
                _model_signature(incoming_params)
                if isinstance(incoming_params, dict)
                else None
            )
            incoming_model_code: str | None = pr.get("incoming_champion_model_code")
            round_winner_model_code: str | None = pr.get("round_winner_model_code")
            round_challenger_model_codes: list[str] = list(
                pr.get("round_challenger_model_codes") or []
            )
            for c in pr_candidates:
                c.is_champion = False
            for c in pr_candidates:
                sig = _model_signature(c.params or {})
                if champion_sig and sig == champion_sig:
                    c.is_champion = True
                elif (
                    not champion_sig
                    and winner_sig
                    and sig == winner_sig
                ):
                    c.is_champion = True
                role = "challenger"
                if incoming_sig and sig == incoming_sig:
                    role = "incoming_champion"
                if winner_sig and sig == winner_sig:
                    role = "round_winner"
                existing = dict(c.params or {})
                existing["pro_round_role"] = role
                existing["pro_round_index"] = int(
                    (c.params or {}).get("pro_round_index", pr["round"])
                )
                existing["is_round_challenger"] = role == "challenger"
                c.params = existing
            pr_trials = int(pr.get("trials_in_round", len(pr_records)))
            pro_round_assembly_progress(
                "plotting efficient frontier from trial scores (no extra backtests)…"
            )
            pr_exclude_codes = {
                str(c.model_code)
                for c in pr_candidates
                if c.model_code
            }
            pr_frontier = _build_frontier_from_records(
                display_records,
                pr_trials,
                exclude_model_codes=pr_exclude_codes,
            )
            pr_best = _best_candidate(pr_candidates)
            pr_equity = (pr_best.equity_curve if pr_best else None) or []
            pro_round_assembly_progress("finalizing round snapshot…")
            pro_rounds.append(
                ProRoundSnapshot(
                    round=int(pr["round"]),
                    improved=bool(pr.get("improved", False)),
                    trials_in_round=pr_trials,
                    round_best_adjusted_score=pr.get("round_best_adjusted_score"),
                    incoming_champion_model_code=incoming_model_code,
                    round_winner_model_code=round_winner_model_code,
                    round_challenger_model_codes=round_challenger_model_codes,
                    pool_model_codes=pool_model_codes,
                    round_setup=dict(pr.get("round_setup") or {}),
                    regime_setups=dict(pr.get("regime_setups") or {}),
                    regime_matrix_enabled=bool(pr.get("regime_matrix_enabled")),
                    regime_factor_ranges=dict(pr.get("regime_factor_ranges") or {}),
                    regime_factor_matrix_enabled=bool(
                        pr.get("regime_factor_matrix_enabled")
                    ),
                    factor_ranges=dict(pr.get("factor_ranges") or {}),
                    factor_choices=dict(pr.get("factor_choices") or {}),
                    optimization_strategy=str(pr.get("optimization_strategy") or ""),
                    performance_assessment=str(pr.get("performance_assessment") or ""),
                    benchmark_status=pr.get("benchmark_status"),
                    beats_benchmark=pr.get("beats_benchmark"),
                    benchmark_alpha=pr.get("benchmark_alpha"),
                    portfolio_vs_benchmark=pr.get("portfolio_vs_benchmark"),
                    candidates=pr_candidates,
                    equity_curve=pr_equity or [],
                    efficient_frontier=pr_frontier,
                    narrative_facts={
                        "round": pr["round"],
                        "round_label": f"Round {pr['round']}",
                        "incoming_champion_score": pr.get("incoming_champion_score"),
                        "improved": bool(pr.get("improved", False)),
                        "trials_in_round": pr_trials,
                        "trials_feasible": pr_feasible,
                        "models_returned": len(pr_candidates),
                        "model_codes": [
                            str((c.params or {}).get("model_code", f"M?R{c.rank}"))
                            for c in pr_candidates
                        ],
                        "incoming_champion_model_code": incoming_model_code,
                        "round_winner_model_code": round_winner_model_code,
                        "round_challenger_model_codes": round_challenger_model_codes,
                        "round_best_adjusted_score": pr.get("round_best_adjusted_score"),
                        "round_setup": pr.get("round_setup"),
                        "factor_ranges": pr.get("factor_ranges"),
                        "factor_choices": pr.get("factor_choices"),
                        "optimization_strategy": pr.get("optimization_strategy"),
                        "performance_assessment": pr.get("performance_assessment"),
                        "benchmark_status": pr.get("benchmark_status"),
                        "benchmark_alpha": pr.get("benchmark_alpha"),
                        "top_sharpe": pr_best.sharpe if pr_best else None,
                        "top_max_drawdown": pr_best.max_drawdown if pr_best else None,
                        "top_cagr": pr_best.cagr if pr_best else None,
                        "validation_sharpe": pr_best.validation_sharpe if pr_best else None,
                        "train_sharpe": pr_best.train_sharpe if pr_best else None,
                    },
                )
            )

    best_params = (champion_record or top[0])[1]
    best_alloc = AllocatorParams(
        mode=best_params["mode"],
        lookback_days=int(best_params["lookback_days"]),
        shrinkage=float(best_params["shrinkage"]),
        risk_aversion=float(best_params["risk_aversion"]),
    )
    best_cap = effective_max_weight_cap(
        best_params.get("max_weight_actual"), req.max_weight
    )
    if "top_n_actual" in best_params:
        best_top_n_actual = int(best_params["top_n_actual"])
    elif req.top_n is not None:
        best_top_n_actual = min(int(req.top_n), int(spec.max_holdings))
    else:
        best_top_n_actual = int(spec.max_holdings)
    best_no_trade_tol = float(best_params.get("no_trade_tol", 0.0))
    best_turnover_penalty_mult = float(best_params.get("turnover_penalty_mult", 1.0))
    best_max_turnover = float(best_params.get("max_turnover_actual", req.max_turnover))
    best_class_budget = class_budget_from_params(
        zero_disallowed_class_params(best_params, req.asset_classes),
        asset_classes=req.asset_classes,
    )
    best_f_params = factor_params_from_dict(
        best_params, default_lookback=best_alloc.lookback_days
    )
    champion_sim_kw = apply_allocator_resolver(
        dict(
            spec=BacktestSpec(
                benchmark_ticker=spec.benchmark_ticker,
                risk_free_rate=spec.risk_free_rate,
                fee_bps=spec.fee_bps,
                rebalance_rule=str(best_params.get("rebalance_freq", rebalance_rule)),
                min_holdings=spec.min_holdings,
                max_holdings=spec.max_holdings,
            ),
            max_weight=best_cap,
            min_weight=req.min_weight,
            allocator=best_alloc,
            top_n=best_top_n_actual,
            factor_params=best_f_params,
            no_trade_tol=best_no_trade_tol,
            turnover_penalty_mult=best_turnover_penalty_mult,
            max_turnover=best_max_turnover,
            universe_by_ticker=universe_by_ticker,
            class_budget=best_class_budget,
        ),
        prices,
        dynamic_ctx.get("allocator_resolver") if dynamic_ctx else None,
    )
    if dynamic_ctx:
        dynamic_ctx = ensure_regime_class_budget_resolver(
            dynamic_ctx,
            regime_class_quotas=dynamic_ctx.get("regime_class_quotas"),
            asset_classes=req.asset_classes,
        )
        champ_class_resolver = class_budget_resolver_from_trial_params(
            best_params,
            dynamic_ctx.get("active_regime_resolver"),
            asset_classes=req.asset_classes,
        )
        if champ_class_resolver is None:
            champ_class_resolver = dynamic_ctx.get("class_budget_resolver")
        champion_sim_kw = apply_class_budget_resolver(
            champion_sim_kw,
            prices,
            champ_class_resolver,
            asset_classes=req.asset_classes,
        )
        champion_sim_kw["enforce_class_weights"] = req.enforce_class_weights
        champ_factor_resolver = factor_params_resolver_from_trial_params(
            best_params,
            dynamic_ctx.get("active_regime_resolver"),
            default_lookback=best_alloc.lookback_days,
        )
        if champ_factor_resolver is not None:
            champion_sim_kw["factor_params_resolver"] = champ_factor_resolver
    full_m = simulate_dynamic_portfolio(
        prices_sim_panel,
        report_start=str(req.start_date),
        **champion_sim_kw,
    )
    equity_curve = equity_curve_series(full_m["equity"])

    output_model_codes = {
        str(c.model_code) for c in candidates if c.model_code
    }
    frontier = _build_frontier_from_records(
        records,
        trials_completed,
        exclude_model_codes=output_model_codes,
    )

    best = _best_candidate(candidates) or candidates[0]
    champion_model_code = best.model_code if best else None
    ai_champion_model_code: str | None = None
    if pro_mode:
        ai_pick = refinement_meta.get("ai_champion_model_code")
        if ai_pick:
            ai_champion_model_code = str(ai_pick)
            champion_model_code = ai_champion_model_code
        elif refinement_meta.get("final_champion_params"):
            final_champion_params = refinement_meta.get("final_champion_params")
            if isinstance(final_champion_params, dict):
                pro_code = final_champion_params.get("model_code")
                if pro_code:
                    champion_model_code = str(pro_code)
                    ai_champion_model_code = champion_model_code
    else:
        ai_champion_model_code = champion_model_code
    portfolio_catalog = all_record_catalog
    bench = benchmark_metrics(prices, spec.benchmark_ticker, spec)

    # Labels mirror the web objective selector (OBJECTIVE_LABELS) so the AI summary
    # states the same user-facing objective the user picked (e.g. "Max CAGR").
    objective_map = {
        "max_sharpe": "Max Sharpe",
        "max_return": "Max CAGR",
        "min_max_drawdown": "Min Max DD",
        "max_sortino": "Max Sortino",
        "min_cvar": "Min CVaR",
        "risk_parity_erc": "Risk Parity (ERC)",
        "max_diversification": "Max Diversification",
        "mean_variance_utility": "Mean-Variance Utility",
        "custom": "Custom objective",
        "dynamic": "Dynamic — regime-adaptive (composite score)",
    }
    narrative_facts: dict[str, Any] = {
        "scenario_id": req.scenario_id,
        "period": {"start": req.start_date, "end": req.end_date},
        "train_period": {
            "start": str(prices_train.index[0].date()),
            "end": train_end,
        },
        "validation_period": (
            {"start": val_start, "end": str(prices.index[-1].date())}
            if oos and len(prices_val) > 0
            else None
        ),
        "top_sharpe": best.sharpe,
        "top_max_drawdown": best.max_drawdown,
        "top_cagr": best.cagr,
        "train_sharpe": best.train_sharpe,
        "train_max_drawdown": best.train_max_drawdown,
        "validation_sharpe": best.validation_sharpe,
        "validation_max_drawdown": best.validation_max_drawdown,
        "max_weight_constraint": req.max_weight,
        "min_weight_constraint": req.min_weight,
        "max_turnover_constraint": req.max_turnover,
        "max_holdings_constraint": int(req.max_holdings),
        "objective": objective_effective,
        "objective_input": req.objective.value,
        "objective_custom_text": req.objective_custom_text,
        "objective_label": objective_map.get(objective_effective, objective_effective),
        "trial_scoring_objective": trial_objective if dynamic_mode else objective_effective,
        "dynamic_objective_enabled": dynamic_mode,
        "regime_adaptive": regime_adaptive,
        "data_source": data_meta["data_source"],
        "data_quality": data_meta,
        "engine": "optuna+pandas+pro" if pro_mode else "optuna+pandas",
        "optimization_mode": req.optimization_mode.value,
        "trials_requested": req.trials if not pro_mode else trials_completed,
        "trials_feasible": trials_feasible,
        "models_returned": len(candidates),
        "models_total_catalog": len(portfolio_catalog),
        "portfolio_catalog": portfolio_catalog,
        "top_models_requested": req.top_models,
        "trials_completed": trials_completed,
        "champion_model_code": champion_model_code,
        "ai_champion_model_code": ai_champion_model_code,
        "warm_start": (
            {
                **warm_start_info,
                "improved": (
                    float(champion_record[0]) > float(warm_start_info["cached_objective_score"])
                    if champion_record is not None
                    and warm_start_info.get("cached_objective_score") is not None
                    else None
                ),
            }
            if warm_start_info.get("matched")
            else None
        ),
        "continuation": continuation_info,
        "pro_refinement": (
            {
                **{k: v for k, v in refinement_meta.items() if k != "per_round"},
                "per_round": [
                    {kk: vv for kk, vv in row.items() if kk != "records"}
                    for row in (refinement_meta.get("per_round") or [])
                    if isinstance(row, dict)
                ],
                "convergence_history": convergence_history,
                "refinement_batch_size": req.refinement_batch_size,
                "refinement_challengers_per_round": req.refinement_challengers_per_round,
                "refinement_max_rounds": req.refinement_max_rounds,
                "refinement_patience": req.refinement_patience,
                "continuation_snapshot": refinement_meta.get("continuation_snapshot"),
            }
            if pro_mode
            else None
        ),
        "backtest_methodology": (
            "Dynamic rebalance: each date re-runs factor screen (Top N) then allocator weights. "
            "When holdout is enabled, trial selection and Pro champions use in-sample metrics only; "
            "holdout tail is reported once for generalization (oos_leaderboard), not re-used each Pro round."
        ),
        "trial_scores_select_on_is": bool(oos and len(prices_val) > 60),
        "train_ratio": float(req.train_ratio) if oos else None,
        "oos_leaderboard": (
            _oos_leaderboard(
                candidates,
                records=records,
                objective_effective=trial_objective if dynamic_mode else objective_effective,
            )
            if oos and len(prices_val) > 60
            else None
        ),
        "rebalance_freq": rebalance_rule,
        "rebalance_count": full_m.get("rebalance_count"),
        "rebalance_applied": full_m.get("rebalance_applied"),
        "rebalance_skipped": full_m.get("rebalance_skipped"),
        "rebalance_snapshots_total": full_m.get("rebalance_snapshots_total"),
        "rebalance_snapshots_shown": full_m.get("rebalance_snapshots_shown"),
        "universe_size": universe_pool_count,
        "universe_catalog_size": universe_meta["count"],
        "tradable_count": len(tickers),
        "asset_classes_filter": req.asset_classes,
        "universe_categories_filter": req.universe_categories,
        "universe_tickers_filter": req.universe_tickers,
        "universe_supplement_tickers": req.universe_supplement_tickers,
        "universe_filter_text": req.universe_filter_text,
        "universe_filter_prompts": req.resolved_universe_filter_prompts(),
        "universe_refine": {
            "source": universe_plan.get("source"),
            "benchmark_ticker": spec.benchmark_ticker,
            "selected_count": len(tickers),
            "pool_count": universe_pool_count,
            "asset_classes_filter": universe_plan.get("asset_classes_filter")
            or req.asset_classes,
            "rationale": universe_plan.get("rationale"),
            "grouped_categories": universe_plan.get("grouped_categories"),
            "pick_representatives_per_category": universe_plan.get(
                "pick_representatives_per_category", False
            ),
        },
        "backtest_spec": {
            "fee_bps": spec.fee_bps,
            "rebalance_freq": spec.rebalance_rule,
            "risk_free_rate": spec.risk_free_rate,
            "benchmark": spec.benchmark_ticker,
            "benchmark_metrics": bench,
        },
        "allocator": {
            "type": "dynamic_rebalance",
            "best_params": best_params,
        },
        "ai_param_generation": {
            "enabled": bool(ai_generation.get("enabled", False)),
            "model": ai_generation.get("model"),
            "seed_sets_requested": trials_completed,
            "seed_sets_used": (
                int(refinement_meta.get("trials_total", 0))
                if pro_mode
                else min(len(ai_param_sets), req.trials)
            ),
            "rationale": ai_generation.get("rationale"),
            "rationales_by_round": (
                refinement_meta.get("ai_rationales")
                if pro_mode
                else (
                    [ai_generation.get("rationale")]
                    if ai_generation.get("rationale")
                    else []
                )
            ),
            "error": ai_generation.get("error"),
        },
        "top_holdings_count": (
            int((best.analytics or {}).get("weight_cap_audit", {}).get("active_holdings"))
            if isinstance(best.analytics, dict)
            and (best.analytics or {}).get("weight_cap_audit", {}).get("active_holdings")
            is not None
            else len(best.weights)
        ),
        "max_weight_observed": round(max(best.weights.values()), 4) if best.weights else None,
        "max_weight_trial_param": round(best_cap, 4),
        "max_weight_actual": round(best_cap, 4),
        "max_weight_effective_cap": round(best_cap, 4),
        "weight_cap_audit": (
            (best.analytics or {}).get("weight_cap_audit")
            if isinstance(best.analytics, dict)
            else None
        ),
        "weight_cap_violation": bool(
            isinstance((best.analytics or {}).get("weight_cap_audit"), dict)
            and (
                (best.analytics or {}).get("weight_cap_audit", {}).get("violation_count", 0)
                > 0
                or not (best.analytics or {}).get("weight_cap_audit", {}).get("feasible", True)
            )
        ),
        "param_bounds_clips": (best_params or {}).get("bounds_violations"),
        "report_horizons": _champion_report_horizons(
            best,
            oos_enabled=oos,
            period={"start": req.start_date, "end": req.end_date},
            train_period={
                "start": str(prices_train.index[0].date()),
                "end": train_end,
            },
            validation_period=(
                {"start": val_start, "end": str(prices.index[-1].date())}
                if oos and len(prices_val) > 0
                else None
            ),
        ),
        "report_analysis_note": (
            "Trial selection and Pro champions use in-sample metrics only when holdout is enabled. "
            "Report narrative should compare in-sample, out-of-sample, and full-sample (ttl) horizons."
            if oos and len(prices_val) > 60
            else "Full-sample metrics apply; no holdout split."
        ),
        "oos_enabled": oos,
        "metrics_trustworthy": data_meta["data_source"] == "yfinance"
        and not full_m.get("metrics_suspect", False),
    }
    dynamic_timeline: list[DynamicObjectiveTimelinePoint] | None = None
    dynamic_benchmark_series: list[dict[str, Any]] | None = None
    if dynamic_ctx:
        snap = dynamic_ctx.get("current_regime") or {}
        timeline_rows, benchmark_series = build_dynamic_backtest_chart_payload(
            prices_full,
            spec.benchmark_ticker,
            dynamic_ctx.get("regime_timeline") or [],
        )
        dynamic_timeline = [DynamicObjectiveTimelinePoint(**row) for row in timeline_rows]
        dynamic_benchmark_series = benchmark_series
        narrative_facts["dynamic_objective_mode"] = dynamic_mode
        narrative_facts["regime_adaptive"] = True
        narrative_facts["dynamic_objective_timeline"] = timeline_rows
        narrative_facts["dynamic_objective_benchmark_series"] = benchmark_series
        narrative_facts["dynamic_objectives_used"] = dynamic_ctx.get("objectives_used")
        narrative_facts["regime_switch_count"] = dynamic_ctx.get("regime_switch_count")
        narrative_facts["current_regime"] = {
            "regime": snap.get("regime"),
            "objective": snap.get("objective"),
            "detector_version": dynamic_ctx.get("detector_version"),
            "benchmark_ticker": dynamic_ctx.get("benchmark_ticker"),
            "regime_mode": dynamic_ctx.get("regime_mode"),
            "fast_risk_off_exit": dynamic_ctx.get("fast_risk_off_exit"),
        }
        if dynamic_ctx.get("regime_class_quotas"):
            narrative_facts["regime_class_quotas"] = dynamic_ctx.get("regime_class_quotas")
        ranking_note = (
            "Optuna trial ranking uses the blended dynamic composite score on in-sample."
            if dynamic_mode
            else f"Optuna trial ranking uses {objective_label(objective_effective)} on in-sample."
        )
        narrative_facts["backtest_methodology"] = (
            str(narrative_facts.get("backtest_methodology", ""))
            + " Regime-adaptive allocation: regime detector v2 (walk-forward on benchmark) "
            "maps risk_off→min max drawdown, neutral→max Sharpe, risk_on→max return "
            "allocator presets per rebalance. "
            + ranking_note
        )

    if pro_mode:
        pro_snap = refinement_meta.get("continuation_snapshot")
        if isinstance(pro_snap, dict):
            narrative_facts["continuation_snapshot"] = pro_snap
    else:
        std_snap = build_standard_snapshot_from_champion(
            champion_record,
            trials_total=trials_completed,
        )
        if std_snap is not None:
            narrative_facts["continuation_snapshot"] = std_snap

    result = BacktestResult(
        job_id=job_id,
        scenario_id=req.scenario_id,
        benchmark=spec.benchmark_ticker,
        period={"start": req.start_date, "end": req.end_date},
        candidates=candidates,
        equity_curve=equity_curve,
        efficient_frontier=frontier,
        narrative_facts=narrative_facts,
        pro_rounds=pro_rounds,
        experimental=None,
        dynamic_objective_timeline=dynamic_timeline,
        dynamic_objective_benchmark_series=dynamic_benchmark_series,
    )
    if champion_record is not None and isinstance(champion_record[1], dict):
        try:
            champ_metrics = champion_record[2] if len(champion_record) > 2 else {}
            champ_code = str(
                champion_record[1].get("model_code")
                or narrative_facts.get("ai_champion_model_code")
                or narrative_facts.get("champion_model_code")
                or ""
            )
            record_champion(
                req,
                job_id,
                champion_record[1],
                champ_code or "CHAMPION",
                objective_effective,
                sharpe=champ_metrics.get("sharpe"),
                cagr=champ_metrics.get("cagr"),
                max_drawdown=champ_metrics.get("max_drawdown"),
                objective_score=champion_record[0],
            )
        except Exception:  # noqa: BLE001
            logger.exception("Champion registry write failed")
    try:
        from app.jobs import stash_trial_report_cache

        stash_trial_report_cache(job_id, trial_report_cache)
    except Exception:  # noqa: BLE001
        logger.debug("trial_report_cache not stashed (jobs store unavailable)", exc_info=True)
    maybe_collect_garbage(1, 1)
    import gc

    gc.collect()
    return result
