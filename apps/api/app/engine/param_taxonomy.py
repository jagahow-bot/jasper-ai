"""Parameter taxonomy: setup (fixed per Pro round) vs factor (Optuna search)."""

from __future__ import annotations

from typing import Any

from app.engine.asset_class_policy import ALL_ALLOC_WEIGHT_KEYS
from app.engine.param_bounds import (
    RunBlueprint,
    cap_search_high,
    cap_search_low,
    normalize_param_controls,
)
from app.engine.dynamic_objective import (
    REGIME_ALLOCATOR_KEYS,
    REGIME_KEYS,
    has_regime_matrix,
    normalize_regime_setups,
)
from app.models import Objective

# Run-level optimization objectives (not allocator modes).
RUN_OBJECTIVE_MODE_VALUES: frozenset[str] = frozenset(m.value for m in Objective)

# Half-up rounding for AI param / Pro round seed numerics (四捨五入到小數第 4 位).
PARAM_NUMERIC_DECIMALS = 4

ALLOCATOR_MODE_KEY = "mode"

# Fixed for every trial in a Pro round (model / portfolio setup).
SETUP_PARAM_KEYS: tuple[str, ...] = (
    ALLOCATOR_MODE_KEY,
    "lookback_days",
    "shrinkage",
    "risk_aversion",
    "max_weight_actual",
    "top_n_actual",
    "no_trade_tol",
    "turnover_penalty_mult",
    "max_turnover_actual",
    *ALL_ALLOC_WEIGHT_KEYS,
)

# Factor layer: numeric keys Optuna samples within AI factor_ranges.
FACTOR_NUMERIC_KEYS: tuple[str, ...] = (
    "factor_lookback_days",
    "reversal_lookback_days",
    "value_lookback_days",
    "w_mom",
    "w_reversal",
    "w_value",
    "w_lowvol",
    "w_trend",
    "w_drawdown",
)

# Factor layer: categorical indicators fixed for the round.
FACTOR_CATEGORICAL_KEYS: tuple[str, ...] = (
    "mom_indicator",
    "reversal_indicator",
    "value_indicator",
    "lowvol_indicator",
    "trend_indicator",
    "drawdown_indicator",
)

FACTOR_PARAM_KEYS: tuple[str, ...] = FACTOR_NUMERIC_KEYS + FACTOR_CATEGORICAL_KEYS

# Run-level immutable (not in round_setup from AI).
RUN_LEVEL_FIXED_KEYS: frozenset[str] = frozenset({"objective_mode", "rebalance_freq"})

# Default Optuna search bounds for factor numerics (before AI range intersection).
DEFAULT_FACTOR_BOUNDS: dict[str, tuple[float | int, float | int, int]] = {
    "factor_lookback_days": (126, 504, 21),
    "reversal_lookback_days": (63, 252, 21),
    "value_lookback_days": (63, 252, 21),
    "w_mom": (0.0, 2.0, 1),
    "w_reversal": (0.0, 2.0, 1),
    "w_value": (0.0, 2.0, 1),
    "w_lowvol": (0.0, 2.0, 1),
    "w_trend": (0.0, 1.5, 1),
    "w_drawdown": (0.0, 1.5, 1),
}

_ALL_KNOWN: frozenset[str] = frozenset(
    (*SETUP_PARAM_KEYS, *FACTOR_PARAM_KEYS, *RUN_LEVEL_FIXED_KEYS)
)


def is_setup_key(key: str) -> bool:
    return key in SETUP_PARAM_KEYS


def is_factor_key(key: str) -> bool:
    return key in FACTOR_PARAM_KEYS


def is_factor_numeric_key(key: str) -> bool:
    return key in FACTOR_NUMERIC_KEYS


def is_factor_categorical_key(key: str) -> bool:
    return key in FACTOR_CATEGORICAL_KEYS


def _parse_range_pair(raw: Any) -> tuple[float, float] | None:
    if not isinstance(raw, (list, tuple)) or len(raw) < 2:
        return None
    try:
        lo, hi = float(raw[0]), float(raw[1])
    except (TypeError, ValueError):
        return None
    if lo > hi:
        lo, hi = hi, lo
    return lo, hi


def intersect_factor_range(
    key: str,
    ai_range: Any,
    *,
    blueprint: RunBlueprint,
    param_controls: dict[str, dict],
) -> tuple[float | int, float | int] | None:
    """Intersect AI [low, high] with user param_controls and default bounds."""
    pair = _parse_range_pair(ai_range)
    if pair is None:
        return None
    defaults = DEFAULT_FACTOR_BOUNDS.get(key)
    if defaults is None:
        return pair
    default_lo, default_hi, _step = defaults
    c = param_controls.get(key)
    lo = float(
        max(pair[0], float(cap_search_low(key, default_lo, c)))
    )
    hi = float(
        min(pair[1], float(cap_search_high(key, default_hi, blueprint, c)))
    )
    if lo > hi:
        mid = (lo + hi) / 2.0
        lo, hi = mid, mid
    if key.endswith("_days"):
        return int(lo), int(hi)
    return lo, hi


def _normalize_regime_setups_seed(
    raw: Any,
    *,
    shared_setup: dict[str, Any] | None,
) -> dict[str, dict[str, Any]]:
    if not isinstance(raw, dict):
        return {}
    return normalize_regime_setups(raw, shared_setup=shared_setup)


def complete_factor_ranges(
    factor_ranges: dict[str, Any] | None,
    *,
    blueprint: RunBlueprint,
    param_controls: dict[str, dict] | None,
) -> dict[str, list[float | int]]:
    """Ensure every factor numeric has an Optuna range (AI sparse output → global defaults)."""
    controls = normalize_param_controls(param_controls, blueprint)
    out: dict[str, list[float | int]] = {}
    for key in FACTOR_NUMERIC_KEYS:
        raw = (factor_ranges or {}).get(key)
        if raw is not None:
            intersected = intersect_factor_range(
                key, raw, blueprint=blueprint, param_controls=controls
            )
            if intersected is not None:
                lo, hi = intersected
                if key.endswith("_days"):
                    out[key] = [int(lo), int(hi)]
                else:
                    out[key] = [_round_seed_numeric(lo), _round_seed_numeric(hi)]
                continue
        defaults = DEFAULT_FACTOR_BOUNDS.get(key)
        if defaults is None:
            continue
        default_lo, default_hi, _step = defaults
        lo = cap_search_low(key, default_lo, controls.get(key))
        hi = cap_search_high(key, default_hi, blueprint, controls.get(key))
        if lo > hi:
            mid = (float(lo) + float(hi)) / 2.0
            lo, hi = mid, mid
        if key.endswith("_days"):
            out[key] = [int(lo), int(hi)]
        else:
            out[key] = [_round_seed_numeric(lo), _round_seed_numeric(hi)]
    return out


def build_pro_round_param_controls(
    base_controls: dict[str, dict] | None,
    *,
    blueprint: RunBlueprint,
    round_setup: dict[str, Any] | None,
    factor_ranges: dict[str, Any] | None,
    factor_choices: dict[str, Any] | None,
    regime_setups: dict[str, Any] | None = None,
) -> dict[str, dict]:
    """Force setup fixed; factor numerics search within AI ranges; categoricals fixed."""
    controls = normalize_param_controls(base_controls, blueprint)
    factor_ranges = complete_factor_ranges(
        factor_ranges,
        blueprint=blueprint,
        param_controls=controls,
    )
    setup = dict(round_setup or {})
    if ALLOCATOR_MODE_KEY not in setup and setup.get("allocator_mode"):
        setup[ALLOCATOR_MODE_KEY] = setup["allocator_mode"]
    matrix_active = has_regime_matrix(regime_setups)
    skip_allocator_keys = matrix_active

    for key in SETUP_PARAM_KEYS:
        if skip_allocator_keys and key in REGIME_ALLOCATOR_KEYS:
            continue
        if key in setup and setup[key] is not None:
            fixed = setup[key]
            if key == "top_n_actual":
                fixed = int(fixed)
            elif key != ALLOCATOR_MODE_KEY:
                try:
                    fixed = float(fixed)
                except (TypeError, ValueError):
                    pass
            controls[key] = {"mode": "fixed", "fixed": fixed}
    if (
        not skip_allocator_keys
        and ALLOCATOR_MODE_KEY in setup
        and setup[ALLOCATOR_MODE_KEY] is not None
    ):
        controls["allocator_mode"] = {
            "mode": "fixed",
            "fixed": str(setup[ALLOCATOR_MODE_KEY]),
        }
    elif matrix_active:
        matrix = normalize_regime_setups(regime_setups, shared_setup=setup)
        neutral = matrix.get("neutral") or {}
        for key in REGIME_ALLOCATOR_KEYS:
            if key in neutral:
                val = neutral[key]
                if key == "top_n_actual":
                    continue
                if key == ALLOCATOR_MODE_KEY:
                    controls["allocator_mode"] = {
                        "mode": "fixed",
                        "fixed": str(val),
                    }
                else:
                    controls[key] = {"mode": "fixed", "fixed": val}

    for key, raw_range in (factor_ranges or {}).items():
        if not is_factor_numeric_key(key):
            continue
        intersected = intersect_factor_range(
            key, raw_range, blueprint=blueprint, param_controls=controls
        )
        if intersected is None:
            continue
        lo, hi = intersected
        entry: dict[str, Any] = {"mode": "search", "min": lo, "max": hi}
        defaults = DEFAULT_FACTOR_BOUNDS.get(key)
        if defaults and defaults[2] > 1:
            entry["step"] = defaults[2]
        controls[key] = entry

    for key, choice in (factor_choices or {}).items():
        if not is_factor_categorical_key(key):
            continue
        if choice is None:
            continue
        controls[key] = {"mode": "fixed", "fixed": str(choice)}

    return controls


def _round_seed_numeric(value: Any) -> Any:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return round(float(value), PARAM_NUMERIC_DECIMALS)
    return value


def _allocator_mode_from_params(params: dict[str, Any] | None) -> str | None:
    if not params:
        return None
    mode = params.get("mode")
    if mode is not None and str(mode) not in RUN_OBJECTIVE_MODE_VALUES:
        return str(mode)
    alloc = params.get("allocator_mode")
    if alloc is not None and str(alloc) not in RUN_OBJECTIVE_MODE_VALUES:
        return str(alloc)
    if mode is not None:
        return str(mode)
    return str(alloc) if alloc is not None else None


def summarize_prior_round_seed(
    seed_dict: dict[str, Any] | None,
    *,
    champion_params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Normalize prior Pro-round AI seed for round-2+ learning (allocator mode, not objective)."""
    if not seed_dict:
        return {}
    setup = dict(seed_dict.get("round_setup") or seed_dict.get("setup") or {})
    if ALLOCATOR_MODE_KEY not in setup and setup.get("allocator_mode"):
        setup[ALLOCATOR_MODE_KEY] = setup["allocator_mode"]
    alloc_mode = _allocator_mode_from_params(champion_params)
    setup_mode = setup.get(ALLOCATOR_MODE_KEY)
    if alloc_mode and (
        not setup_mode or str(setup_mode) in RUN_OBJECTIVE_MODE_VALUES
    ):
        setup[ALLOCATOR_MODE_KEY] = alloc_mode
    for key, val in list(setup.items()):
        if key == "top_n_actual":
            setup[key] = int(val)
        elif key != ALLOCATOR_MODE_KEY and isinstance(val, (int, float)) and not isinstance(
            val, bool
        ):
            setup[key] = _round_seed_numeric(val)
    ranges = dict(seed_dict.get("factor_ranges") or {})
    choices = dict(seed_dict.get("factor_choices") or {})
    for key, val in list(choices.items()):
        if isinstance(val, str) and len(val) > 120:
            choices[key] = val[:117] + "..."
    regime_setups = _normalize_regime_setups_seed(
        seed_dict.get("regime_setups"),
        shared_setup=setup,
    )
    out: dict[str, Any] = {
        "round_setup": setup,
        "factor_ranges": ranges,
        "factor_choices": choices,
    }
    if regime_setups:
        out["regime_setups"] = regime_setups
    return out


def normalize_round_seed(
    seed: dict[str, Any],
    *,
    blueprint: RunBlueprint,
    param_controls: dict[str, dict] | None,
) -> dict[str, Any]:
    """Validate and clip round_setup / factor_ranges from AI."""
    controls = normalize_param_controls(param_controls, blueprint)
    out: dict[str, Any] = {
        "rationale": str(seed.get("rationale") or "").strip(),
        "optimization_strategy": str(seed.get("optimization_strategy") or "").strip(),
        "performance_assessment": str(seed.get("performance_assessment") or "").strip(),
        "round_setup": {},
        "factor_ranges": {},
        "factor_choices": {},
        "regime_setups": {},
    }
    raw_setup = seed.get("round_setup") or {}
    if isinstance(raw_setup, dict):
        for key in SETUP_PARAM_KEYS:
            if key in raw_setup and raw_setup[key] is not None:
                val = raw_setup[key]
                if key == "top_n_actual":
                    out["round_setup"][key] = int(val)
                elif key == ALLOCATOR_MODE_KEY:
                    out["round_setup"][key] = str(val)
                else:
                    out["round_setup"][key] = _round_seed_numeric(val)

    raw_ranges = seed.get("factor_ranges") or {}
    if isinstance(raw_ranges, dict):
        out["factor_ranges"] = complete_factor_ranges(
            raw_ranges,
            blueprint=blueprint,
            param_controls=controls,
        )

    raw_choices = seed.get("factor_choices") or {}
    if isinstance(raw_choices, dict):
        for key in FACTOR_CATEGORICAL_KEYS:
            if key in raw_choices and raw_choices[key] is not None:
                out["factor_choices"][key] = str(raw_choices[key])

    regime_raw = seed.get("regime_setups")
    if isinstance(regime_raw, dict) and regime_raw:
        normalized = _normalize_regime_setups_seed(
            regime_raw, shared_setup=out["round_setup"]
        )
        if normalized:
            out["regime_setups"] = normalized

    return out
