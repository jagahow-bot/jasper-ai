"""Portfolio allocator: solve weights from mu/Sigma with simple constraints.

We avoid heavy QP dependencies (no scipy/cvxpy) and use projected gradient descent
onto a capped simplex: sum(w)=1, 0<=w_i<=max_weight.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.engine.weights import project_max_weight


@dataclass(frozen=True)
class AllocatorParams:
    mode: str  # "min_var" | "mean_variance" | "risk_parity" | "max_diversification"
    lookback_days: int = 252
    shrinkage: float = 0.1  # [0..1], towards diagonal
    risk_aversion: float = 4.0  # only for mean-variance
    max_iter: int = 250


def _shrink_cov(cov: np.ndarray, shrinkage: float) -> np.ndarray:
    s = float(np.clip(shrinkage, 0.0, 1.0))
    diag = np.diag(np.diag(cov))
    return (1.0 - s) * cov + s * diag


def _normalize_mu(mu: np.ndarray) -> np.ndarray:
    mu = np.asarray(mu, dtype=float)
    if mu.ndim != 1:
        raise ValueError("mu must be 1D")
    return np.nan_to_num(mu, nan=0.0, posinf=0.0, neginf=0.0)


def solve_weights(
    *,
    mu_annual: np.ndarray,
    cov_annual: np.ndarray,
    max_weight: float,
    params: AllocatorParams,
    w0: np.ndarray | None = None,
) -> np.ndarray:
    """Solve a constrained allocation.

    - min_var: minimize w^T Sigma w
    - mean_variance: minimize (risk_aversion/2)*w^T Sigma w - mu^T w
    """
    mu = _normalize_mu(mu_annual)
    cov = np.asarray(cov_annual, dtype=float)
    if cov.ndim != 2 or cov.shape[0] != cov.shape[1] or cov.shape[0] != mu.shape[0]:
        raise ValueError("cov shape mismatch")

    n = mu.shape[0]
    eps = 1e-6
    cov = _shrink_cov(cov, params.shrinkage)
    cov = cov + np.eye(n) * eps

    if w0 is None:
        w = np.ones(n) / n
    else:
        w = np.asarray(w0, dtype=float).copy()
        if w.shape != (n,):
            w = np.ones(n) / n
        w = project_max_weight(np.maximum(w, 0.0), max_weight)

    # Conservative step size based on trace as a cheap Lipschitz proxy.
    trace = float(np.trace(cov))
    lr = 0.25 / max(trace, 1e-6)

    lam = float(max(params.risk_aversion, 1e-6))
    mode = params.mode
    for _ in range(int(params.max_iter)):
        if mode == "min_var":
            grad = 2.0 * (cov @ w)
        elif mode == "mean_variance":
            grad = lam * (cov @ w) - mu
        elif mode == "risk_parity":
            # Approximate ERC via equalizing component risk contributions.
            mrc = cov @ w
            rc = w * mrc
            tgt = float(np.sum(rc)) / max(n, 1)
            grad = rc - tgt
        elif mode == "max_diversification":
            # Heuristic ascent on diversification ratio proxy via inverse-vol tilt.
            vol = np.sqrt(np.maximum(np.diag(cov), 1e-12))
            inv_vol = 1.0 / np.maximum(vol, 1e-8)
            inv_vol = inv_vol / max(float(np.sum(inv_vol)), 1e-12)
            grad = w - inv_vol
        else:
            raise ValueError(f"Unknown allocator mode: {mode}")

        w_next = project_max_weight(w - lr * grad, max_weight)
        if float(np.max(np.abs(w_next - w))) < 1e-6:
            w = w_next
            break
        w = w_next

    return project_max_weight(w, max_weight)

