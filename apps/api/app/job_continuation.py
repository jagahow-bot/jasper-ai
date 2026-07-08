"""Carry prior job state into a continuation backtest (below-benchmark refinement)."""

from __future__ import annotations

from typing import Any

from app.champion_metrics import champion_display_metrics
from app.engine.refinement import params_for_champion_seed
from app.models import BacktestRequest, BacktestResult, OptimizationMode


def _is_pro_mode(req: BacktestRequest) -> bool:
    return (
        req.optimization_mode == OptimizationMode.pro_auto
        or bool(req.enable_iterative_refinement)
    )


def _champion_candidate(result: BacktestResult) -> Any | None:
    candidates = result.candidates or []
    facts = result.narrative_facts or {}

    def _code(c: Any) -> str:
        return str(getattr(c, "model_code", None) or "").strip().upper()

    preferred: str | None = None
    for key in ("ai_champion_model_code", "champion_model_code"):
        raw = facts.get(key)
        if isinstance(raw, str) and raw.strip():
            preferred = raw.strip().upper()
            break
    if preferred:
        match = next((c for c in candidates if _code(c) == preferred), None)
        if match is not None:
            return match
    match = next((c for c in candidates if getattr(c, "is_champion", False)), None)
    if match is not None:
        return match
    return candidates[0] if candidates else None


def build_continuation_snapshot_from_meta(
    meta: dict[str, Any],
    *,
    champion_record: tuple[float, dict, dict] | None,
    learning_trials: list[dict[str, Any]],
    convergence_history: list[dict[str, Any]],
    carry_champion_model_code: str | None,
    next_model_no: int,
    prior_challenger_signatures: set[str],
    prior_round_setup: dict[str, Any] | None,
    prior_regime_setups: dict[str, Any] | None,
    prior_regime_factor_ranges: dict[str, Any] | None,
    prior_regime_class_quotas: dict[str, Any] | None,
    prior_factor_ranges: dict[str, Any] | None,
    prior_factor_choices: dict[str, Any] | None,
    rounds_without_gain: int,
    all_records: list[tuple[float, dict, dict]],
) -> dict[str, Any]:
    """Serializable payload stored on completed jobs for later continuation."""
    champ: dict[str, Any] | None = None
    if champion_record is not None:
        score, params, metrics = champion_record
        champ = {
            "score": float(score),
            "params": dict(params),
            "metrics": dict(metrics),
        }
    top_records: list[dict[str, Any]] = []
    for score, params, metrics in all_records[-40:]:
        top_records.append(
            {
                "score": float(score),
                "params": dict(params),
                "metrics": dict(metrics),
            }
        )
    return {
        "mode": "pro",
        "rounds_completed": int(meta.get("rounds_completed") or 0),
        "trials_total": int(meta.get("trials_total") or 0),
        "champion_record": champ,
        "carry_champion_model_code": carry_champion_model_code,
        "next_model_no": int(next_model_no),
        "retired_model_codes": list(meta.get("retired_model_codes") or []),
        "prior_challenger_signatures": sorted(prior_challenger_signatures),
        "learning_trials": list(learning_trials[-300:]),
        "convergence_history": list(convergence_history[-120:]),
        "ai_rationales": list(meta.get("ai_rationales") or [])[:12],
        "prior_round_setup": prior_round_setup,
        "prior_regime_setups": prior_regime_setups,
        "prior_regime_factor_ranges": prior_regime_factor_ranges,
        "prior_regime_class_quotas": prior_regime_class_quotas,
        "prior_factor_ranges": prior_factor_ranges,
        "prior_factor_choices": prior_factor_choices,
        "rounds_without_gain": int(rounds_without_gain),
        "champion_adjusted_score": meta.get("champion_adjusted_score"),
        "final_champion_params": meta.get("final_champion_params"),
        "top_records": top_records,
    }


def build_standard_continuation_snapshot(
    result: BacktestResult,
    *,
    champion_record: tuple[float, dict, dict] | None,
) -> dict[str, Any] | None:
    facts = result.narrative_facts or {}
    champ = _champion_candidate(result)
    if champ is None and champion_record is None:
        return None
    params: dict[str, Any]
    metrics: dict[str, Any]
    score: float
    if champion_record is not None:
        score, params, metrics = champion_record
    else:
        params = dict(champ.params or {})
        disp = champion_display_metrics(champ)
        metrics = {
            "sharpe": float(disp.sharpe or champ.sharpe or 0.0),
            "cagr": float(disp.cagr or champ.cagr or 0.0),
            "max_drawdown": float(disp.max_drawdown or champ.max_drawdown or 0.0),
            "raw_score": float(params.get("adjusted_score") or champ.sharpe or 0.0),
        }
        score = float(params.get("adjusted_score") or metrics["raw_score"])
    return {
        "mode": "standard",
        "trials_total": int(facts.get("trials_completed") or 0),
        "champion_record": {
            "score": score,
            "params": params,
            "metrics": metrics,
        },
        "champion_seed": params_for_champion_seed(params),
    }


def build_standard_snapshot_from_champion(
    champion_record: tuple[float, dict, dict] | None,
    *,
    trials_total: int,
) -> dict[str, Any] | None:
    if champion_record is None:
        return None
    score, params, metrics = champion_record
    return {
        "mode": "standard",
        "trials_total": int(trials_total),
        "champion_record": {
            "score": float(score),
            "params": dict(params),
            "metrics": dict(metrics),
        },
        "champion_seed": params_for_champion_seed(params),
    }


def extract_continuation_snapshot(result: BacktestResult) -> dict[str, Any] | None:
    """Load continuation payload from a completed job result."""
    facts = result.narrative_facts or {}
    snap = facts.get("continuation_snapshot")
    if isinstance(snap, dict) and snap:
        return snap
    pro = facts.get("pro_refinement")
    if isinstance(pro, dict):
        nested = pro.get("continuation_snapshot")
        if isinstance(nested, dict) and nested:
            return nested
    if isinstance(pro, dict) and pro.get("rounds_completed"):
        champ_params = pro.get("final_champion_params")
        champ = _champion_candidate(result)
        record: dict[str, Any] | None = None
        if isinstance(champ_params, dict):
            record = {
                "score": float(pro.get("champion_adjusted_score") or 0.0),
                "params": dict(champ_params),
                "metrics": {
                    "sharpe": float(getattr(champ, "sharpe", 0.0) or 0.0) if champ else 0.0,
                    "cagr": float(getattr(champ, "cagr", 0.0) or 0.0) if champ else 0.0,
                    "max_drawdown": float(getattr(champ, "max_drawdown", 0.0) or 0.0)
                    if champ
                    else 0.0,
                    "raw_score": float(pro.get("champion_adjusted_score") or 0.0),
                },
            }
        return {
            "mode": "pro",
            "rounds_completed": int(pro.get("rounds_completed") or 0),
            "trials_total": int(pro.get("trials_total") or 0),
            "champion_record": record,
            "carry_champion_model_code": facts.get("ai_champion_model_code")
            or facts.get("champion_model_code"),
            "next_model_no": int(pro.get("rounds_completed") or 0) + 1,
            "retired_model_codes": list(pro.get("retired_model_codes") or []),
            "prior_challenger_signatures": [],
            "learning_trials": [],
            "convergence_history": list(pro.get("convergence_history") or [])[-120:],
            "ai_rationales": list(pro.get("ai_rationales") or [])[:12],
            "prior_round_setup": None,
            "prior_regime_setups": None,
            "prior_regime_factor_ranges": None,
            "prior_regime_class_quotas": None,
            "prior_factor_ranges": None,
            "prior_factor_choices": None,
            "rounds_without_gain": 0,
            "champion_adjusted_score": pro.get("champion_adjusted_score"),
            "final_champion_params": champ_params,
            "top_records": [],
        }
    return build_standard_continuation_snapshot(result, champion_record=None)


def apply_continuation_request(
    base: BacktestRequest,
    snapshot: dict[str, Any],
    *,
    extra_refinement_rounds: int,
    extra_trials_per_round: int | None = None,
    extra_trials: int | None = None,
    prior_job_id: str,
) -> BacktestRequest:
    """Clone prior request with bumped search budget and continuation linkage."""
    req = base.model_copy(deep=True)
    req.continue_from_job_id = prior_job_id
    req.extra_refinement_rounds = extra_refinement_rounds
    if extra_trials_per_round is not None:
        req.extra_trials_per_round = extra_trials_per_round
    if extra_trials is not None:
        req.extra_trials = extra_trials

    if _is_pro_mode(req) and snapshot.get("mode") == "pro":
        done = int(snapshot.get("rounds_completed") or 0)
        req.refinement_max_rounds = done + max(1, int(extra_refinement_rounds))
        if extra_trials_per_round is not None:
            req.refinement_challengers_per_round = extra_trials_per_round
    elif not _is_pro_mode(req):
        add = int(extra_trials or extra_refinement_rounds * 10)
        req.trials = min(200, int(base.trials) + max(5, add))
    return req


def continuation_runtime_state(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Engine kwargs derived from a stored continuation snapshot."""
    if snapshot.get("mode") == "standard":
        champ = snapshot.get("champion_record") or {}
        params = champ.get("params") or {}
        metrics = champ.get("metrics") or {}
        score = float(champ.get("score") or 0.0)
        initial: tuple[float, dict, dict] | None = None
        if params:
            initial = (score, dict(params), dict(metrics))
        return {
            "mode": "standard",
            "prior_job_id": snapshot.get("prior_job_id"),
            "champion_seed": snapshot.get("champion_seed")
            or params_for_champion_seed(params),
            "initial_champion_record": initial,
        }

    champ = snapshot.get("champion_record") or {}
    params = dict(champ.get("params") or {})
    metrics = dict(champ.get("metrics") or {})
    score = float(champ.get("score") or snapshot.get("champion_adjusted_score") or 0.0)
    initial: tuple[float, dict, dict] | None = None
    if params:
        initial = (score, params, metrics)

    return {
        "mode": "pro",
        "prior_job_id": snapshot.get("prior_job_id"),
        "start_round_idx": int(snapshot.get("rounds_completed") or 0),
        "global_trial": int(snapshot.get("trials_total") or 0),
        "initial_champion_record": initial,
        "learning_trials": list(snapshot.get("learning_trials") or []),
        "convergence_history": list(snapshot.get("convergence_history") or []),
        "ai_rationales": list(snapshot.get("ai_rationales") or []),
        "retired_model_codes": set(snapshot.get("retired_model_codes") or []),
        "prior_challenger_signatures": set(snapshot.get("prior_challenger_signatures") or []),
        "next_model_no": int(snapshot.get("next_model_no") or 1),
        "carry_champion_model_code": snapshot.get("carry_champion_model_code"),
        "prior_round_setup": snapshot.get("prior_round_setup"),
        "prior_regime_setups": snapshot.get("prior_regime_setups"),
        "prior_regime_factor_ranges": snapshot.get("prior_regime_factor_ranges"),
        "prior_regime_class_quotas": snapshot.get("prior_regime_class_quotas"),
        "prior_factor_ranges": snapshot.get("prior_factor_ranges"),
        "prior_factor_choices": snapshot.get("prior_factor_choices"),
        "rounds_without_gain": int(snapshot.get("rounds_without_gain") or 0),
        "top_records": [
            (float(r["score"]), dict(r["params"]), dict(r["metrics"]))
            for r in (snapshot.get("top_records") or [])
            if isinstance(r, dict) and r.get("params")
        ],
    }
