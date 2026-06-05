"""Align universe filter, class budgets, and Optuna search with selected asset classes."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pandas as pd

_REGIME_KEYS: tuple[str, ...] = ("risk_off", "neutral", "risk_on")

# Top-level sleeve weights used in dynamic Top-N screening.
CLASS_BUDGET_KEYS: dict[str, tuple[str, ...]] = {
    "equity": ("w_equity",),
    "bond": ("w_bond",),
    "commodity": ("w_commodity",),
    "real_estate": ("w_real_estate",),
    "alternative": ("w_alternative",),
}

# Regional sub-weights (optional; not separate Top-N buckets).
REGIONAL_WEIGHT_KEYS: dict[str, tuple[str, ...]] = {
    "equity:us": ("w_equity_us",),
    "equity:intl": ("w_equity_intl",),
    "equity:em": ("w_equity_em",),
    "bond:us": ("w_bond_us",),
    "bond:intl": ("w_bond_intl",),
    "bond:credit": ("w_bond_credit",),
    "commodity:precious": ("w_commodity_precious",),
    "commodity:broad": ("w_commodity_broad",),
    "real_estate:us": ("w_reit_us",),
    "real_estate:intl": ("w_reit_intl",),
}

ALL_ALLOC_WEIGHT_KEYS: tuple[str, ...] = tuple(
    k for keys in (*CLASS_BUDGET_KEYS.values(), *REGIONAL_WEIGHT_KEYS.values()) for k in keys
)

# Top-level sleeve param keys only (equity, bond, …).
TOP_LEVEL_QUOTA_KEYS: tuple[str, ...] = tuple(
    k for keys in CLASS_BUDGET_KEYS.values() for k in keys
)


def normalized_allowed_classes(asset_classes: list[str] | None) -> set[str] | None:
    """None = all classes allowed."""
    if not asset_classes:
        return None
    allowed = {str(c).strip() for c in asset_classes if str(c).strip()}
    return allowed or None


def enforce_param_controls_for_asset_classes(
    param_controls: dict[str, dict] | None,
    asset_classes: list[str] | None,
) -> dict[str, dict]:
    """Force disallowed class allocation weights to 0 (fixed)."""
    base = dict(param_controls or {})
    allowed = normalized_allowed_classes(asset_classes)
    if allowed is None:
        return base
    for ac, keys in CLASS_BUDGET_KEYS.items():
        for key in keys:
            if ac in allowed:
                continue
            base[key] = {
                "mode": "fixed",
                "fixed": 0.0,
                "min": 0.0,
                "max": 0.0,
            }
    for region, keys in REGIONAL_WEIGHT_KEYS.items():
        parent = region.split(":", 1)[0]
        for key in keys:
            if parent in allowed:
                continue
            base[key] = {
                "mode": "fixed",
                "fixed": 0.0,
                "min": 0.0,
                "max": 0.0,
            }
    return base


def class_budget_from_params(
    params: dict[str, Any],
    *,
    asset_classes: list[str] | None = None,
) -> dict[str, float]:
    """Build Top-N class budget using only allowed top-level sleeves."""
    allowed = normalized_allowed_classes(asset_classes)
    raw: dict[str, float] = {}
    for ac, keys in CLASS_BUDGET_KEYS.items():
        if allowed is not None and ac not in allowed:
            continue
        total = 0.0
        for key in keys:
            total += float(max(params.get(key, 0.0), 0.0))
        if total > 0:
            raw[ac] = total
    if not raw and allowed is not None and len(allowed) == 1:
        only = next(iter(allowed))
        raw[only] = 1.0
    s = float(sum(raw.values()))
    if s < 1e-12:
        return {}
    return {k: v / s for k, v in raw.items()}


def regime_class_quota_param_key(regime: str, quota_key: str) -> str:
    """Optuna / trial flat key for per-regime class quotas (e.g. risk_off__w_equity)."""
    return f"{regime}__{quota_key}"


def parse_regime_class_quota_param_key(key: str) -> tuple[str, str] | None:
    for regime in _REGIME_KEYS:
        prefix = f"{regime}__"
        if key.startswith(prefix):
            tail = key[len(prefix) :]
            if tail in TOP_LEVEL_QUOTA_KEYS:
                return regime, tail
    return None


def has_regime_class_quotas(regime_class_quotas: dict[str, Any] | None) -> bool:
    if not isinstance(regime_class_quotas, dict) or not regime_class_quotas:
        return False
    return any(
        isinstance(regime_class_quotas.get(r), dict) and regime_class_quotas[r]
        for r in _REGIME_KEYS
    )


def _slice_to_class_budget(
    slice_params: dict[str, Any],
    *,
    asset_classes: list[str] | None = None,
) -> dict[str, float]:
    """Accept w_* param keys or already-normalized class names (equity, bond, …)."""
    allowed = normalized_allowed_classes(asset_classes)
    direct: dict[str, float] = {}
    for ac in CLASS_BUDGET_KEYS:
        if allowed is not None and ac not in allowed:
            continue
        if ac in slice_params:
            val = float(max(slice_params.get(ac, 0.0), 0.0))
            if val > 0:
                direct[ac] = val
    if direct:
        s = float(sum(direct.values()))
        if s > 1e-12:
            return {k: v / s for k, v in direct.items()}
    return class_budget_from_params(slice_params, asset_classes=asset_classes)


def normalize_regime_class_quotas(
    raw: dict[str, Any] | None,
    *,
    shared_setup: dict[str, Any] | None = None,
    asset_classes: list[str] | None = None,
) -> dict[str, dict[str, float]]:
    """Ensure risk_off / neutral / risk_on top-level class budgets; fill gaps from shared_setup."""
    out: dict[str, dict[str, float]] = {}
    shared = dict(shared_setup or {})
    raw_map = raw if isinstance(raw, dict) else {}
    for regime in _REGIME_KEYS:
        per = raw_map.get(regime) if isinstance(raw_map.get(regime), dict) else {}
        merged = dict(shared)
        merged.update(per)
        budget = _slice_to_class_budget(merged, asset_classes=asset_classes)
        if budget:
            out[regime] = budget
    if not out and shared:
        fallback = _slice_to_class_budget(shared, asset_classes=asset_classes)
        if fallback:
            for regime in _REGIME_KEYS:
                out[regime] = dict(fallback)
    return out


def class_budget_by_regime_from_trial_params(
    params: dict[str, Any],
    *,
    asset_classes: list[str] | None = None,
) -> dict[str, dict[str, float]] | None:
    """Rebuild per-regime class budgets from flat Optuna keys (risk_off__w_equity, …)."""
    if not params.get("regime_class_quota_matrix"):
        return None
    slices: dict[str, dict[str, Any]] = {r: {} for r in _REGIME_KEYS}
    for key, val in params.items():
        parsed = parse_regime_class_quota_param_key(key)
        if not parsed:
            continue
        regime, quota_key = parsed
        slices[regime][quota_key] = val
    out: dict[str, dict[str, float]] = {}
    for regime in _REGIME_KEYS:
        if not slices[regime]:
            continue
        budget = _slice_to_class_budget(slices[regime], asset_classes=asset_classes)
        if budget:
            out[regime] = budget
    return out or None


def build_class_budget_resolver(
    active_regime_resolver: Callable[[pd.Timestamp], str],
    budget_by_regime: dict[str, dict[str, float]],
) -> Callable[[pd.Timestamp], dict[str, float]]:
    """Per-rebalance Top-N class budget from active regime."""
    neutral = budget_by_regime.get("neutral") or {}
    fallback = neutral or next(iter(budget_by_regime.values()), {})

    def resolver(dt: pd.Timestamp) -> dict[str, float]:
        regime = active_regime_resolver(dt)
        return budget_by_regime.get(regime) or fallback

    return resolver


def zero_disallowed_class_params(
    params: dict[str, Any],
    asset_classes: list[str] | None,
) -> dict[str, Any]:
    """Zero w_* for classes outside the user's universe filter."""
    allowed = normalized_allowed_classes(asset_classes)
    if allowed is None:
        return params
    out = dict(params)
    for ac, keys in CLASS_BUDGET_KEYS.items():
        if ac in allowed:
            continue
        for key in keys:
            out[key] = 0.0
    for region, keys in REGIONAL_WEIGHT_KEYS.items():
        parent = region.split(":", 1)[0]
        if parent in allowed:
            continue
        for key in keys:
            out[key] = 0.0
    return out
