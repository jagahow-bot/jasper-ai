"""Align universe filter, class budgets, and Optuna search with selected asset classes."""

from __future__ import annotations

from typing import Any

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
