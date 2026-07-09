"""Canonical scenario fingerprint for cross-run champion reuse."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from app.models import BacktestRequest

# Search effort, notifications, and output preferences — not the market problem.
_SCENARIO_IDENTITY_EXCLUDES = frozenset(
    {
        "trials",
        "top_models",
        "optimization_mode",
        "enable_iterative_refinement",
        "refinement_batch_size",
        "refinement_challengers_per_round",
        "refinement_max_rounds",
        "refinement_patience",
        "refinement_min_improvement",
        "report_language",
        "notify_email",
        "continue_from_job_id",
        "extra_refinement_rounds",
        "extra_trials_per_round",
        "extra_trials",
    }
)


def _sorted_str_list(values: list[str] | None) -> list[str] | None:
    if not values:
        return None
    return sorted(str(v) for v in values)


def _canonical_param_controls(
    param_controls: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if not param_controls:
        return None
    out: dict[str, Any] = {}
    for key in sorted(param_controls):
        raw = param_controls[key]
        if hasattr(raw, "model_dump"):
            out[key] = raw.model_dump(mode="json")
        elif isinstance(raw, dict):
            out[key] = raw
        else:
            out[key] = raw
    return out


def scenario_payload(
    req: BacktestRequest,
    *,
    include_end_date: bool = True,
) -> dict[str, Any]:
    """Build a canonical dict of fields that define an equivalent backtest scenario."""
    objective = req.objective.value if hasattr(req.objective, "value") else str(req.objective)
    backtest_mode = (
        req.backtest_mode.value if hasattr(req.backtest_mode, "value") else str(req.backtest_mode)
    )
    payload: dict[str, Any] = {
        "scenario_id": req.scenario_id,
        "max_weight": req.max_weight,
        "min_weight": req.min_weight,
        "objective": objective,
        "objective_custom_text": (req.objective_custom_text or "").strip() or None,
        "regime_adaptive": bool(req.regime_adaptive),
        "backtest_mode": backtest_mode,
        "start_date": req.start_date,
        "asset_classes": _sorted_str_list(req.asset_classes),
        "enforce_class_weights": bool(req.enforce_class_weights),
        "universe_categories": _sorted_str_list(req.universe_categories),
        "universe_tickers": _sorted_str_list(req.universe_tickers),
        "universe_supplement_tickers": _sorted_str_list(req.universe_supplement_tickers),
        "universe_filter_prompts": req.resolved_universe_filter_prompts(),
        "enable_oos": bool(req.enable_oos),
        "train_ratio": float(req.train_ratio),
        "fee_bps": float(req.fee_bps),
        "rebalance_freq": req.rebalance_freq,
        "top_n": req.top_n,
        "max_holdings": int(req.max_holdings),
        "max_turnover": float(req.max_turnover),
        "param_controls": _canonical_param_controls(req.param_controls),
        "static_replay_holdings": (
            {str(k).upper(): round(float(v), 6) for k, v in sorted(req.static_replay_holdings.items())}
            if req.static_replay_holdings
            else None
        ),
    }
    if include_end_date:
        payload["end_date"] = req.end_date
    if req.experiment and req.experiment.enabled:
        payload["experiment"] = req.experiment.model_dump(mode="json", exclude_none=True)
    return payload


def compute_scenario_fingerprint(
    req: BacktestRequest,
    *,
    include_end_date: bool = True,
) -> str:
    """SHA-256 hex digest of the canonical scenario payload."""
    payload = scenario_payload(req, include_end_date=include_end_date)
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def scenario_identity_field_names() -> frozenset[str]:
    """Fields excluded from scenario identity (for tests/docs)."""
    return _SCENARIO_IDENTITY_EXCLUDES
