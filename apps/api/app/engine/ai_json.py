"""Sanitize floats in Gemini prompts / AI-facing JSON (not Optuna trial precision)."""

from __future__ import annotations

import json
from typing import Any

# Half-up rounding for AI param / Pro round seed numerics (四捨五入到小數第 4 位).
PARAM_NUMERIC_DECIMALS = 4

_INT_KEYS = frozenset(
    {
        "top_n_actual",
        "lookback_days",
        "factor_lookback_days",
        "reversal_lookback_days",
        "value_lookback_days",
    }
)

_WEIGHT_NUMERIC_KEYS = frozenset(
    {
        "shrinkage",
        "risk_aversion",
        "max_weight_actual",
        "max_turnover_actual",
        "no_trade_tol",
        "turnover_penalty_mult",
    }
)

_METRIC_KEYS = frozenset(
    {
        "adjusted_score",
        "raw_score",
        "objective_value",
        "objective_value_is",
        "in_sample_objective",
        "out_of_sample_objective",
        "gap_objective",
        "gap_sharpe",
        "sharpe",
        "cagr",
        "max_drawdown",
        "volatility",
        "sortino",
        "turnover_avg",
        "alpha",
        "beta",
        "information_ratio",
        "tracking_error",
        "up_capture",
        "down_capture",
        "train_sharpe",
        "validation_sharpe",
        "gap_to_beat",
        "target_at_trial",
        "champion_score",
        "target_adjusted_score",
        "overfitting_penalty",
        "end_equity_index",
        "portfolio_cagr",
        "portfolio_sharpe",
        "portfolio_max_drawdown",
        "max_weight_cap",
        "max_turnover_cap",
        "benchmark_alpha",
        "round_best_adjusted_score",
        "champion_adjusted_score",
    }
)


def _is_int_key(key: str | None) -> bool:
    if not key:
        return False
    return key in _INT_KEYS or key.endswith("_days")


def _decimals_for_key(key: str | None) -> int:
    if not key:
        return PARAM_NUMERIC_DECIMALS
    if _is_int_key(key):
        return 0
    if key.startswith("w_") or key in _WEIGHT_NUMERIC_KEYS:
        return PARAM_NUMERIC_DECIMALS
    kl = key.lower()
    if "pct" in kl or key == "weight_pct":
        return 2
    if key in _METRIC_KEYS:
        return 4
    return PARAM_NUMERIC_DECIMALS


def round_ai_float(value: float, *, key: str | None = None) -> int | float:
    """Round one float for AI payloads; preserves Optuna-only paths when unused."""
    if _is_int_key(key):
        return int(round(value))
    decimals = _decimals_for_key(key)
    if decimals <= 0:
        return int(round(value))
    return round(float(value), decimals)


def sanitize_for_ai(value: Any, *, _key: str | None = None) -> Any:
    """Recursively round floats in dicts/lists destined for Gemini prompts."""
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    if isinstance(value, float):
        return round_ai_float(value, key=_key)
    if isinstance(value, dict):
        return {str(k): sanitize_for_ai(v, _key=str(k)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [sanitize_for_ai(v, _key=_key) for v in value]
    return value


def dumps_for_ai(
    obj: Any,
    *,
    max_len: int | None = None,
    ensure_ascii: bool = False,
) -> str:
    """Compact JSON for prompts with sanitized numerics."""
    text = json.dumps(
        sanitize_for_ai(obj),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=ensure_ascii,
        default=str,
    )
    if max_len is not None and len(text) > max_len:
        return text[: max_len - 3] + "..."
    return text
