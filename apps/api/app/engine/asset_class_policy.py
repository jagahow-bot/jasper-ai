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


def _class_weight_slice(weights: np.ndarray, indices: list[int]) -> np.ndarray:
    """Fancy-index class holdings as a 1-D vector (never a 0-d numpy scalar)."""
    if not indices:
        return np.zeros(0, dtype=float)
    idx = np.atleast_1d(np.asarray(indices, dtype=int))
    return np.atleast_1d(np.asarray(weights, dtype=float)[idx])


def _assign_class_weight_slice(
    target: np.ndarray, indices: list[int], values: np.ndarray
) -> None:
    """Write sleeve weights back; values are normalized to 1-D first."""
    if not indices:
        return
    idx = np.atleast_1d(np.asarray(indices, dtype=int))
    target[idx] = np.atleast_1d(np.asarray(values, dtype=float))


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

    from app.engine.weights import WEIGHT_EPS, project_max_weight

    n_active = int((out > WEIGHT_EPS).sum()) or len(active_set) or 1
    requested_cap = float(max_weight) if max_weight is not None else None
    # When the active book cannot satisfy the per-name cap (n*cap < 1), hard
    # clipping every name to `cap` then renormalizing collapses to exact 1/N.
    # Prefer sleeve-budget scaling that preserves allocator relatives.
    cap_infeasible = (
        requested_cap is not None
        and requested_cap < 1.0 - 1e-12
        and float(n_active) * float(requested_cap) < 1.0 - 1e-9
    )
    cap = None if cap_infeasible else requested_cap

    # Clamp sleeve targets to capacity under a feasible per-name cap.
    feasible_budget: dict[str, float] = {}
    for ac, target in budget.items():
        idxs = class_indices.get(ac) or []
        if not idxs:
            continue
        if cap is None:
            feasible_budget[ac] = float(target)
        else:
            feasible_budget[ac] = min(float(target), float(len(idxs)) * float(cap))
    fb_sum = float(sum(feasible_budget.values()))
    if fb_sum <= 1e-12 and cap is not None:
        feasible_budget = {
            ac: float(len(idxs)) * float(cap)
            for ac, idxs in class_indices.items()
            if idxs
        }
        fb_sum = float(sum(feasible_budget.values()))
    if fb_sum > 1e-12:
        budget = {ac: v / fb_sum for ac, v in feasible_budget.items()}

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
            slice_w = np.maximum(_class_weight_slice(weights, indices), 0.0)
            slice_sum = float(slice_w.sum())
            if slice_sum > 1e-12:
                _assign_class_weight_slice(
                    projected,
                    indices,
                    slice_w * (sleeve_target / slice_sum),
                )
            else:
                _assign_class_weight_slice(
                    projected,
                    indices,
                    np.full(len(indices), sleeve_target / len(indices)),
                )
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
            sleeve = float(_class_weight_slice(weights, indices).sum())
            if sleeve <= 1e-12:
                continue
            slice_w = np.atleast_1d(_class_weight_slice(weights, indices).copy())
            over = slice_w > cap + 1e-12
            if not over.any():
                _assign_class_weight_slice(capped, indices, slice_w)
                continue
            slice_w[over] = cap
            surplus = sleeve - float(slice_w.sum())
            under = ~over
            if under.any() and float(slice_w[under].sum()) > 1e-12:
                under_w = slice_w[under]
                slice_w[under] += surplus * (under_w / float(under_w.sum()))
            elif under.any():
                slice_w[under] = surplus / float(under.sum())
            # else: whole sleeve already at the per-name cap; surplus is
            # unplaceable inside this class — leave names at `cap` (feasible
            # budgets above should have kept sleeve <= n_i * cap).
            _assign_class_weight_slice(capped, indices, slice_w)
        total = float(capped.sum())
        if total > 1e-12:
            capped /= total
        return capped

    out = _project_to_budget(out)
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
                out = next_out
                break
            out = next_out
        for _ in range(max_iter):
            if float(np.max(out)) <= cap + 1e-5:
                break
            out = project_max_weight(out, cap)
            out = _project_to_budget(_cap_within_classes(out))
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


def plan_class_slots(
    max_holdings: int,
    class_budget: dict[str, float] | None,
    *,
    per_class_available: dict[str, int] | None = None,
) -> dict[str, int]:
    """Integer slot counts per active class from weights (largest-remainder), sum <= max_holdings."""
    n = int(max(1, max_holdings))
    budget = normalize_class_budget(class_budget)
    if not budget:
        return {}

    ordered = sorted(budget.items(), key=lambda x: (-x[1], x[0]))
    floors: dict[str, int] = {}
    remainders: list[tuple[float, str]] = []
    for ac, w in ordered:
        exact = n * w
        floor = int(np.floor(exact))
        if per_class_available is not None:
            floor = min(floor, max(0, int(per_class_available.get(ac, 0))))
        floors[ac] = floor
        remainders.append((exact - np.floor(exact), ac))

    assigned = sum(floors.values())
    slots = dict(floors)
    if assigned < n:
        remainders.sort(key=lambda x: (-x[0], x[1]))
        for frac, ac in remainders:
            if assigned >= n:
                break
            cap = None
            if per_class_available is not None:
                cap = int(per_class_available.get(ac, 0))
                if slots.get(ac, 0) >= cap:
                    continue
            slots[ac] = slots.get(ac, 0) + 1
            assigned += 1

    return {ac: k for ac, k in slots.items() if k > 0}


def pick_top_n_by_class_slots(
    scores: pd.Series,
    *,
    max_holdings: int,
    tickers: list[str],
    universe_by_ticker: dict[str, dict[str, Any]] | None,
    class_budget: dict[str, float] | None,
    class_slots: dict[str, int] | None = None,
) -> list[str]:
    """Strict per-class top-k selection; classes processed by weight descending."""
    from app.engine.factors import pick_top_n

    n = int(max(1, max_holdings))
    if not universe_by_ticker or not class_budget:
        return pick_top_n(scores, n)

    budget = normalize_class_budget(class_budget)
    if not budget:
        return pick_top_n(scores, n)

    allowed_classes = set(budget.keys())
    per_class: dict[str, list[str]] = {}
    for t in tickers:
        ac = _ticker_asset_class(t, universe_by_ticker)
        if ac not in allowed_classes:
            continue
        per_class.setdefault(ac, []).append(t)

    available = {ac: len(members) for ac, members in per_class.items()}
    targets = class_slots or plan_class_slots(n, budget, per_class_available=available)
    if not targets:
        return pick_top_n(scores, n)

    ordered_classes = sorted(
        targets.keys(),
        key=lambda ac: (-budget.get(ac, 0.0), ac),
    )
    chosen: list[str] = []
    chosen_set: set[str] = set()
    shortfall = 0

    for ac in ordered_classes:
        k = int(targets.get(ac, 0))
        members = sorted(
            per_class.get(ac, []),
            key=lambda t: float(scores.get(t, -np.inf)),
            reverse=True,
        )
        take = min(k, len(members))
        for t in members[:take]:
            if t not in chosen_set:
                chosen.append(t)
                chosen_set.add(t)
        shortfall += k - take

    if shortfall > 0 and len(chosen) < n:
        pool: list[str] = []
        for ac in sorted(budget.keys(), key=lambda c: (-budget.get(c, 0.0), c)):
            for t in sorted(
                per_class.get(ac, []),
                key=lambda tk: float(scores.get(tk, -np.inf)),
                reverse=True,
            ):
                if t not in chosen_set:
                    pool.append(t)
        for t in pool:
            if shortfall <= 0 or len(chosen) >= n:
                break
            chosen.append(t)
            chosen_set.add(t)
            shortfall -= 1

    if len(chosen) < n:
        ordered = scores.sort_values(ascending=False)
        for t in ordered.index:
            if len(chosen) >= n:
                break
            if t not in tickers:
                continue
            ac = _ticker_asset_class(str(t), universe_by_ticker)
            if ac not in allowed_classes or t in chosen_set:
                continue
            chosen.append(str(t))
            chosen_set.add(str(t))

    return chosen[:n]


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
