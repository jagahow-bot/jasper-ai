"""Align universe filter, class budgets, and Optuna search with selected asset classes."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
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


def normalize_class_budget(class_budget: dict[str, float] | None) -> dict[str, float]:
    """Normalized top-level sleeve targets (equity, bond, …) summing to 1."""
    if not class_budget:
        return {}
    clean: dict[str, float] = {}
    for k, v in class_budget.items():
        vv = float(max(v, 0.0))
        if vv > 0:
            clean[str(k)] = vv
    s = float(sum(clean.values()))
    if s < 1e-12:
        return {}
    return {k: v / s for k, v in clean.items()}


def _ticker_asset_class(
    ticker: str,
    universe_by_ticker: dict[str, dict[str, Any]] | None,
) -> str:
    if not universe_by_ticker:
        return "other"
    return str((universe_by_ticker.get(ticker, {}) or {}).get("asset_class", "other"))


def class_sleeve_totals(
    w: np.ndarray,
    tickers: list[str],
    universe_by_ticker: dict[str, dict[str, Any]] | None,
) -> dict[str, float]:
    """Aggregate portfolio weight by top-level asset class."""
    totals: dict[str, float] = {}
    w = np.asarray(w, dtype=float)
    for i, ticker in enumerate(tickers):
        if i >= len(w):
            break
        weight = float(max(w[i], 0.0))
        if weight <= 0:
            continue
        ac = _ticker_asset_class(ticker, universe_by_ticker)
        totals[ac] = totals.get(ac, 0.0) + weight
    return totals


def enforce_class_weight_budget(
    w: np.ndarray,
    tickers: list[str],
    universe_by_ticker: dict[str, dict[str, Any]] | None,
    class_budget: dict[str, float] | None,
    *,
    active_tickers: list[str] | None = None,
    max_weight: float | None = None,
    max_iter: int = 8,
) -> np.ndarray:
    """Rescale holdings so sleeve totals match class_budget (hard enforcement)."""
    budget = normalize_class_budget(class_budget)
    if not budget or not universe_by_ticker:
        return np.asarray(w, dtype=float).copy()

    out = np.asarray(w, dtype=float).copy()
    out = np.maximum(out, 0.0)
    n = len(tickers)
    if out.shape[0] != n:
        out = np.resize(out, n)

    active_set = set(active_tickers) if active_tickers else set(tickers)
    out = np.where([t in active_set for t in tickers], out, 0.0)

    class_indices: dict[str, list[int]] = {}
    for i, ticker in enumerate(tickers):
        if ticker not in active_set:
            continue
        ac = _ticker_asset_class(ticker, universe_by_ticker)
        if ac in budget:
            class_indices.setdefault(ac, []).append(i)

    if not class_indices:
        return out

    def _project_to_budget(weights: np.ndarray) -> np.ndarray:
        projected = np.zeros_like(weights)
        active_targets: dict[str, float] = {}
        for ac, target in budget.items():
            if class_indices.get(ac):
                active_targets[ac] = target
        target_sum = float(sum(active_targets.values()))
        if target_sum < 1e-12:
            return weights
        scale = 1.0 / target_sum
        for ac, target in active_targets.items():
            indices = class_indices[ac]
            sleeve_target = target * scale
            slice_w = np.maximum(weights[indices], 0.0)
            slice_sum = float(slice_w.sum())
            if slice_sum > 1e-12:
                projected[indices] = slice_w * (sleeve_target / slice_sum)
            else:
                projected[indices] = sleeve_target / len(indices)
        total = float(projected.sum())
        if total > 1e-12:
            projected /= total
        return projected

    def _cap_within_classes(weights: np.ndarray) -> np.ndarray:
        if cap is None or cap >= 1.0 - 1e-12:
            return weights
        capped = np.zeros_like(weights)
        for ac in active_targets.keys():
            indices = class_indices.get(ac, [])
            if not indices:
                continue
            sleeve = float(weights[indices].sum())
            if sleeve <= 1e-12:
                continue
            slice_w = weights[indices].copy()
            over = slice_w > cap + 1e-12
            if not over.any():
                capped[indices] = slice_w
                continue
            slice_w[over] = cap
            surplus = sleeve - float(slice_w.sum())
            under = ~over
            if under.any() and float(slice_w[under].sum()) > 1e-12:
                slice_w[under] += surplus * (slice_w[under] / float(slice_w[under].sum()))
            elif under.any():
                slice_w[under] = surplus / float(under.sum())
            capped[indices] = slice_w
        total = float(capped.sum())
        if total > 1e-12:
            capped /= total
        return capped

    out = _project_to_budget(out)
    cap = float(max_weight) if max_weight is not None else None
    active_targets = {
        ac: target
        for ac, target in budget.items()
        if class_indices.get(ac)
    }
    if cap is not None and cap < 1.0 - 1e-12:
        out = _cap_within_classes(out)
        for _ in range(max_iter):
            next_out = _project_to_budget(_cap_within_classes(out))
            if float(np.max(np.abs(next_out - out))) < 1e-5:
                return _cap_within_classes(next_out)
            out = next_out
        return _cap_within_classes(out)
    return out


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
