"""Anchor-drift and overlay must-include helpers for customized portfolios."""

from __future__ import annotations

from typing import Any

import numpy as np

from app.engine.weights import WEIGHT_EPS, project_max_weight


def derive_must_include_tickers(
    tradable: list[str] | tuple[str, ...],
    anchor_weights: dict[str, float] | None,
    *,
    explicit: list[str] | None = None,
) -> list[str]:
    """Overlay adds that must stay eligible / preferably held.

    Prefer an explicit list when provided. Otherwise, when an anchor book is
    present, every tradable name with ~0 anchor weight is treated as a confirmed
    overlay add (locked universe = holdings ∪ adds).

    Returned tickers use the casing from ``tradable``.
    """
    tradable_list = [str(t) for t in tradable]
    by_upper = {t.upper(): t for t in tradable_list}
    if explicit:
        out: list[str] = []
        seen: set[str] = set()
        for t in explicit:
            key = str(t).upper()
            if key in by_upper and key not in seen:
                out.append(by_upper[key])
                seen.add(key)
        return out
    if not anchor_weights:
        return []
    anchor_pos = {
        str(k).upper()
        for k, v in anchor_weights.items()
        if float(v or 0.0) > WEIGHT_EPS
    }
    return [
        t
        for t in tradable_list
        if t.upper() not in anchor_pos and t.upper() != "CASH"
    ]


def l1_turnover_distance(weights: np.ndarray, anchor: np.ndarray) -> float:
    """One-way L1 distance (0.5 * ||w - a||_1) between two portfolios."""
    w = np.asarray(weights, dtype=float).ravel()
    a = np.asarray(anchor, dtype=float).ravel()
    if w.shape != a.shape:
        return float("inf")
    return float(np.sum(np.abs(w - a))) / 2.0


def min_holdings_for_customization(
    *,
    n_must_include: int,
    max_weight: float,
    customization_drift: float | None,
    n_assets: int,
) -> int:
    """Lower bound on holdings so must-includes and drift can both be feasible."""
    from app.engine.weights import min_holdings_for_cap

    cap = float(max(max_weight, 1e-9))
    drift = (
        float(customization_drift)
        if customization_drift is not None
        else 1.0
    )
    drift = float(np.clip(drift, 0.0, 1.0))
    required_anchor_mass = max(0.0, 1.0 - drift)
    min_anchor_slots = (
        int(np.ceil(required_anchor_mass / cap - 1e-9))
        if required_anchor_mass > 1e-12
        else 0
    )
    need = int(n_must_include) + int(min_anchor_slots)
    need = max(need, min_holdings_for_cap(cap, floor=2))
    return int(max(2, min(need, max(int(n_assets), 1))))


def pin_must_include_into_chosen(
    chosen: list[str],
    must_include: list[str],
    scores: Any,
    *,
    max_holdings: int | None,
    n_assets: int,
) -> list[str]:
    """Ensure confirmed overlay adds stay in the Top-N investable set."""
    if not must_include:
        return list(chosen)
    hold_cap = int(max_holdings) if max_holdings is not None else int(n_assets)
    hold_cap = max(hold_cap, len(must_include), 1)
    hold_cap = min(hold_cap, max(int(n_assets), 1))

    must = [t for t in must_include if t not in set(chosen)]
    out = list(chosen)
    # Prefer dropping lowest-scoring non-must names before must-includes.
    must_set = set(must_include)
    while must and len(out) >= hold_cap:
        drop_candidates = [t for t in out if t not in must_set]
        if not drop_candidates:
            break
        victim = min(drop_candidates, key=lambda t: float(scores.get(t, 0.0)))
        out.remove(victim)
    for t in must:
        if t not in out:
            out.append(t)
    if len(out) > hold_cap:
        # Keep all must-includes; trim lowest-scoring others.
        keep_must = [t for t in out if t in must_set]
        rest = [t for t in out if t not in must_set]
        rest_sorted = sorted(rest, key=lambda t: float(scores.get(t, 0.0)), reverse=True)
        slots = max(0, hold_cap - len(keep_must))
        out = keep_must + rest_sorted[:slots]
    return out


def project_anchor_l1_drift(
    w: np.ndarray,
    anchor: np.ndarray,
    drift: float,
    max_weight: float,
    *,
    max_iter: int = 24,
) -> np.ndarray:
    """Hard-project onto full-portfolio L1 ball around the anchor.

    Uses one-way turnover distance 0.5 * ||w - a||_1. Unlike subset solves that
    renormalize a sparse anchor slice to sum 1 (silently allowing large
    full-book drift), this measures against the true anchor vector.

    Must run as the **last** weight transform on each rebalance so later steps
    (class budgets, max-holdings, etc.) cannot reopen the drift budget.
    """
    w = np.asarray(w, dtype=float).copy()
    a = np.asarray(anchor, dtype=float).ravel()
    if a.shape != w.shape:
        return project_max_weight(np.maximum(w, 0.0), max_weight)
    drift_f = float(drift)
    if not (0.0 < drift_f < 1.0):
        if drift_f <= 0.0:
            a_ref = project_max_weight(np.maximum(a, 0.0), max_weight)
            return a_ref
        return project_max_weight(np.maximum(w, 0.0), max_weight)

    a_ref = np.maximum(a, 0.0)
    a_sum = float(a_ref.sum())
    if a_sum <= 1e-12:
        return project_max_weight(np.maximum(w, 0.0), max_weight)
    # Keep sparse zeros for overlay adds — do not redistribute anchor mass onto them.
    if abs(a_sum - 1.0) > 1e-9:
        a_ref = a_ref / a_sum
    a_ref = project_max_weight(a_ref, max_weight)

    w = project_max_weight(np.maximum(w, 0.0), max_weight)
    for _ in range(int(max_iter)):
        dev = l1_turnover_distance(w, a_ref)
        if dev <= drift_f + 1e-6:
            return w
        scale = drift_f / max(dev, 1e-12)
        w = a_ref + (w - a_ref) * scale
        w = project_max_weight(np.maximum(w, 0.0), max_weight)
    # Final force: if cap projection reopened the ball, shrink again once from a_ref.
    dev = l1_turnover_distance(w, a_ref)
    if dev > drift_f + 1e-6:
        scale = drift_f / max(dev, 1e-12)
        w = a_ref + (w - a_ref) * scale
        w = project_max_weight(np.maximum(w, 0.0), max_weight)
        # If still over (rare numerical / infeasible max_weight), stay on the ray
        # toward anchor without re-expanding via a second soft clip loop.
        dev = l1_turnover_distance(w, a_ref)
        if dev > drift_f + 1e-5:
            scale = drift_f / max(dev, 1e-12)
            w = a_ref + (w - a_ref) * scale
            w = np.maximum(w, 0.0)
            s = float(w.sum())
            if s > 1e-12:
                w = w / s
    return w


def apply_must_include_floor(
    w: np.ndarray,
    must_indices: list[int],
    *,
    floor: float,
    max_weight: float,
) -> np.ndarray:
    """Give each must-include a tiny positive weight when the sleeve is empty."""
    if not must_indices or floor <= 0.0:
        return w
    w = np.asarray(w, dtype=float).copy()
    w = np.maximum(w, 0.0)
    need = [i for i in must_indices if float(w[i]) < floor - 1e-12]
    if not need:
        return w
    add_total = float(len(need)) * float(floor)
    donors = [i for i in range(len(w)) if i not in set(need) and w[i] > floor]
    donor_mass = float(sum(w[i] for i in donors))
    if donor_mass <= add_total + 1e-12:
        # Not enough donor mass — equal-split residual among must names only.
        for i in need:
            w[i] = max(float(w[i]), float(floor))
        return project_max_weight(w, max_weight)
    scale = (donor_mass - add_total) / donor_mass
    for i in donors:
        w[i] *= scale
    for i in need:
        w[i] = float(floor)
    return project_max_weight(w, max_weight)
