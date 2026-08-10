"""Feasible portfolio weights with per-asset cap."""



from __future__ import annotations



import logging

from typing import Any



import numpy as np



logger = logging.getLogger(__name__)



WEIGHT_EPS = 1e-4

CAP_EPS = 1e-4





def min_holdings_for_cap(max_weight: float, floor: int = 5) -> int:
    """Minimum names so optimization is not forced to all-at-cap equal weights.

    Requires holdings strictly greater than ``1 / max_weight``:
    ``floor(1/w) + 1``. When ``1/w`` is an integer (e.g. w=0.20 → 5),
    ``ceil(1/w)=5`` admits only the equal-at-cap book; we need ≥6.
    """
    w = float(max(max_weight, 1e-12))
    if w >= 1.0 - 1e-12:
        return max(1, int(floor))
    return max(int(np.floor(1.0 / w)) + 1, int(floor))





def feasible_max_weight(max_weight: float, n_active: int) -> float:

    """Per-name cap that still admits a fully invested book of ``n_active`` names.

    When ``max_weight * n_active < 1``, the capped simplex is empty and naive
    clip-then-renormalize collapses every name to exact ``1/n``. Relaxing the
    effective cap to ``1/n`` makes the simplex non-empty.

    When ``max_weight * n_active == 1`` (e.g. 10 names × 10%), the only
    feasible point is equal weights — relax further to ``1/(n-1)`` so
    allocator-differentiated books can survive projection.
    """

    cap = float(max(max_weight, 1e-12))

    n = int(max(n_active, 1))

    product = n * cap

    if product < 1.0 - 1e-12:

        return float(max(cap, 1.0 / float(n)))

    if product <= 1.0 + 1e-12:

        if n <= 1:

            return 1.0

        return float(min(1.0, max(cap, 1.0 / float(n - 1))))

    return cap





def effective_max_weight_cap(

    max_weight_actual: float | None, req_max_weight: float

) -> float:

    """Trial cap clipped to the run-level ceiling (req.max_weight)."""

    cap = float(max_weight_actual if max_weight_actual is not None else req_max_weight)

    if cap <= 0.0:

        cap = float(req_max_weight)

    return float(min(cap, float(req_max_weight)))





def max_weight_violation_amount(w: np.ndarray, max_weight: float) -> float:

    cap = float(max(max_weight, 1e-12))

    if cap >= 1.0 - 1e-12:

        return 0.0

    return max(0.0, float(np.max(w)) - cap - CAP_EPS)





def audit_weight_cap(

    w: np.ndarray,

    max_weight: float,

    *,

    date: str | None = None,

    tradable_count: int | None = None,

) -> dict[str, Any]:

    w = np.asarray(w, dtype=float)

    cap = float(max(max_weight, 1e-12))

    mx = float(w.max()) if w.size else 0.0

    min_names = min_holdings_for_cap(cap, floor=2) if cap < 1.0 - 1e-12 else 1

    n_active = int((w > WEIGHT_EPS).sum())

    excess = max_weight_violation_amount(w, cap)

    feasible = bool(

        cap >= 1.0 - 1e-12

        or (

            (tradable_count or w.size) >= min_names

            and excess <= CAP_EPS

            and n_active >= min(min_names, tradable_count or w.size)

        )

    )

    return {

        "date": date,

        "max_observed_weight": round(mx, 6),

        "max_weight_param": round(cap, 6),

        "violation": excess > CAP_EPS,

        "excess_over_cap": round(excess, 6),

        "active_holdings": n_active,

        "min_holdings_for_cap": min_names,

        "feasible": feasible,

    }





def project_max_weight(w: np.ndarray, max_weight: float, max_iter: int = 100) -> np.ndarray:

    """Project onto capped simplex: 0 <= w_i <= max_weight, sum(w)=1."""

    cap = float(max(max_weight, 1e-12))

    w = np.asarray(w, dtype=float).copy()

    w = np.maximum(w, 0.0)

    n = len(w)

    if n == 0:

        return w

    if cap >= 1.0 - 1e-12:

        total = w.sum()

        return w / total if total > 1e-12 else np.ones(n) / n



    total = w.sum()

    if total < 1e-12:

        w = np.ones(n) / n

    else:

        w /= total



    # Feasibility depends on ambient universe size. Sparse active books in a
    # large enough universe should expand support; if the universe cannot
    # admit a non-unique capped book (need > 1/cap names), keep relative
    # weights instead of collapsing to equal-at-cap (e.g. 10×10%).
    n_active = int((w > WEIGHT_EPS).sum()) or n
    required_names = min_holdings_for_cap(cap, floor=1)
    if n < required_names:
        logger.warning(
            "max_weight cap %.4f infeasible / unique-equal with %d tradable names "
            "(need >= %d); keeping relative weights instead of equal-weight collapse",
            cap,
            n,
            required_names,
        )
        return w

    min_names = min(required_names, n)

    if n_active < min_names:

        order = np.argsort(-w)

        for i in order[:min_names]:

            w[i] = max(float(w[i]), WEIGHT_EPS)

        w /= w.sum()



    for _ in range(max_iter):

        if w.max() <= cap + 1e-8 and abs(float(w.sum()) - 1.0) < 1e-8:

            break

        over = w > cap

        surplus = float((w[over] - cap).sum())

        w[over] = cap

        if surplus <= 1e-12:

            break

        under = ~over

        if not under.any():

            # Should be rare once the active-count guard above passes; avoid
            # forcing exact 1/k which destroys allocator differentiation.
            logger.warning(
                "max_weight projection stalled at cap=%.4f with no under-weight "
                "names; keeping current relative weights",
                cap,
            )
            break

        under_sum = float(w[under].sum())

        if under_sum < 1e-12:

            w[under] += surplus / float(under.sum())

        else:

            w[under] += surplus * (w[under] / under_sum)



    total = float(w.sum())

    if total < 1e-12:

        w = np.ones(n) / n

        total = float(w.sum())

    w /= total



    if w.max() > cap + 1e-6:

        # Best-effort: do not force equal 1/k (that erases allocator signal).
        # Cap audit reports residual breaches when the book stays infeasible.
        return w

    return w





def build_feasible_weights(

    n: int,

    max_weight: float,

    seed: int,

    *,

    k: int | None = None,

    k_min: int = 5,

    k_max: int = 30,

) -> np.ndarray:

    """Sample k unique assets and weights respecting max_weight."""

    rng = np.random.default_rng(seed)

    min_k = min_holdings_for_cap(max_weight, k_min)

    max_k = min(n, k_max)

    if min_k > max_k:

        min_k = max_k

    holdings = k if k is not None else int(rng.integers(min_k, max_k + 1))



    for attempt in range(200):

        indices = rng.choice(n, size=holdings, replace=False)

        raw = rng.random(holdings)

        w = np.zeros(n)

        w[indices] = raw / raw.sum()

        w = project_max_weight(w, max_weight)



        active = int((w > WEIGHT_EPS).sum())

        if w.max() <= max_weight + 1e-4 and active >= min(min_k, holdings):

            return w



    holdings = min(min_k, n)

    indices = rng.choice(n, size=holdings, replace=False)

    w = np.zeros(n)

    w[indices] = 1.0 / holdings

    return project_max_weight(w, max_weight)





def is_feasible(w: np.ndarray, max_weight: float, min_names: int) -> bool:

    active = int((w > WEIGHT_EPS).sum())

    return bool(w.max() <= max_weight + 1e-4 and active >= min_names)





def apply_max_holdings(
    w: np.ndarray,
    max_holdings: int | None,
    *,
    max_weight: float | None = None,
    prefer_keep: list[int] | None = None,
) -> np.ndarray:
    """Keep at most max_holdings positive weights; zero the rest and renormalize.

    ``prefer_keep`` indices (e.g. overlay must-includes) are retained preferentially
    when trimming excess names.
    """
    if max_holdings is None or int(max_holdings) <= 0:
        return np.asarray(w, dtype=float).copy()
    hold_cap = int(max_holdings)
    w = np.asarray(w, dtype=float).copy()
    w = np.maximum(w, 0.0)
    active = np.where(w > WEIGHT_EPS)[0]
    if len(active) <= hold_cap:
        out = w
    else:
        prefer = {int(i) for i in (prefer_keep or []) if int(i) in set(active.tolist())}
        prefer_list = [i for i in active if i in prefer]
        rest = [i for i in active if i not in prefer]
        rest_sorted = sorted(rest, key=lambda i: float(w[i]), reverse=True)
        slots = max(0, hold_cap - len(prefer_list))
        keep_idx = prefer_list[:hold_cap] + rest_sorted[:slots]
        out = np.zeros_like(w)
        out[keep_idx] = w[keep_idx]
        s = float(out.sum())
        if s > 1e-12:
            out /= s
    if max_weight is not None and float(max_weight) < 1.0 - 1e-12:
        n_keep = int((out > WEIGHT_EPS).sum()) or hold_cap
        # Only re-project when the holdings count can actually satisfy the cap;
        # otherwise project_max_weight would either no-op or (historically)
        # equalize — both wrong for an already-differentiated book.
        if n_keep * float(max_weight) >= 1.0 - 1e-9:
            out = project_max_weight(out, float(max_weight))
    return out


def apply_min_holding_weight(
    w: np.ndarray,
    min_weight: float,
    *,
    max_weight: float | None = None,
) -> np.ndarray:
    """Zero dust below min_weight, renormalize survivors (implicit cash), optionally re-cap."""
    floor = float(max(min_weight, 0.0))
    w = np.asarray(w, dtype=float).copy()
    w = np.maximum(w, 0.0)
    if floor <= 0.0:
        return w
    mask = w >= floor - 1e-12
    if not mask.any():
        i = int(np.argmax(w))
        w[:] = 0.0
        w[i] = 1.0
        return w
    w = np.where(mask, w, 0.0)
    s = float(w.sum())
    if s < 1e-12:
        active = np.where(mask)[0]
        w[active] = 1.0 / float(len(active))
    else:
        w /= s
    if max_weight is not None and float(max_weight) < 1.0 - 1e-12:
        w = project_max_weight(w, float(max_weight))
    return w


def scale_invested_weights(w: np.ndarray, invested_frac: float) -> np.ndarray:
    """Scale a fully-invested weight vector so sum(w) == invested_frac (cash sleeve).

    Does not renormalize afterward — residual 1 − invested_frac is uninvested cash.
    """
    f = float(np.clip(invested_frac, 0.0, 1.0))
    w = np.asarray(w, dtype=float)
    w = np.maximum(w, 0.0)
    if f >= 1.0 - 1e-12:
        return w
    if f <= 1e-12:
        return np.zeros_like(w)
    return w * f


def round_weights_largest_remainder(
    weights: dict[str, float],
    *,
    ndigits: int = 4,
    target: float | None = None,
) -> dict[str, float]:
    """Round weights to ``ndigits`` so the rounded map still sums to ``target``.

    Independent ``round(w, ndigits)`` on equal sleeves (e.g. 1/3) yields 0.9999;
    Hamilton / largest-remainder keeps the packaged book at the intended mass.
    """
    items = [(str(k), float(v)) for k, v in weights.items() if float(v) > 0.0 and np.isfinite(v)]
    if not items:
        return {}
    # Stable order: larger weight first, then ticker (deterministic remainders).
    items.sort(key=lambda kv: (-kv[1], kv[0]))
    tgt = float(sum(v for _, v in items) if target is None else target)
    if tgt <= 0.0:
        return {}
    # Near-fully-invested books: absorb float/rounding dust into target=1.
    if abs(tgt - 1.0) <= 5e-4:
        tgt = 1.0
    scale = 10 ** int(max(ndigits, 0))
    exact = [v * scale for _, v in items]
    floors = [int(np.floor(x + 1e-12)) for x in exact]
    target_units = int(round(tgt * scale))
    assigned = int(sum(floors))
    order = sorted(
        range(len(items)),
        key=lambda i: (-(exact[i] - floors[i]), -items[i][1], items[i][0]),
    )
    units = floors[:]
    need = target_units - assigned
    if need > 0:
        for j in range(need):
            units[order[j % len(order)]] += 1
    elif need < 0:
        # Floors already exceed target — trim names with smallest remainders first.
        trim_order = sorted(
            range(len(items)),
            key=lambda i: ((exact[i] - floors[i]), items[i][1], items[i][0]),
        )
        for i in trim_order:
            if need >= 0:
                break
            if units[i] > 0:
                units[i] -= 1
                need += 1
    out: dict[str, float] = {}
    for (ticker, _), u in zip(items, units):
        if u > 0:
            out[ticker] = u / scale
    return out


