"""Feasible portfolio weights with per-asset cap."""



from __future__ import annotations



import logging

from typing import Any



import numpy as np



logger = logging.getLogger(__name__)



WEIGHT_EPS = 1e-4

CAP_EPS = 1e-4





def min_holdings_for_cap(max_weight: float, floor: int = 5) -> int:

    return max(int(np.ceil(1.0 / max_weight)), floor)





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



    required_names = int(np.ceil(1.0 / cap))
    min_names = min(required_names, n)
    if n < required_names:
        logger.warning(
            "max_weight cap %.4f infeasible with %d tradable names (need >= %d)",
            cap,
            n,
            required_names,
        )
        return w

    if int((w > WEIGHT_EPS).sum()) < min_names:

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

            order = np.argsort(-w)

            w[:] = 0.0

            k = min(min_names, n)

            w[order[:k]] = 1.0 / k

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

        if n < required_names:

            return w

        order = np.argsort(-w)

        w[:] = 0.0

        k = min(required_names, n)

        w[order[:k]] = 1.0 / k

        return project_max_weight(w, cap, max_iter=max_iter)

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


