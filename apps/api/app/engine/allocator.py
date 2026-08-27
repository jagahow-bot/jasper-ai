"""Portfolio allocator: solve weights from mu/Sigma with simple constraints.

Primary path uses scipy SLSQP with analytical Jacobians for all four modes.
Falls back to projected gradient descent when scipy is unavailable or the
solver fails to converge, preserving legacy behaviour bit-for-bit.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.engine.weights import project_max_weight

try:
    from scipy.optimize import minimize as _scipy_minimize

    _HAS_SCIPY = True
except ImportError:  # pragma: no cover - exercised via monkeypatch in tests
    _scipy_minimize = None  # type: ignore[assignment]
    _HAS_SCIPY = False


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


def _anchor_penalty_grad(
    w: np.ndarray,
    anchor: np.ndarray | None,
    penalty_strength: float,
) -> np.ndarray:
    if anchor is None or penalty_strength <= 0.0:
        return np.zeros_like(w)
    return penalty_strength * (w - anchor)


def _solve_pgd(
    *,
    mu: np.ndarray,
    cov: np.ndarray,
    max_weight: float,
    mode: str,
    lam: float,
    max_iter: int,
    w0: np.ndarray,
    anchor: np.ndarray | None,
    penalty_strength: float,
) -> np.ndarray:
    """Legacy projected-gradient path (kept as scipy fallback)."""
    n = mu.shape[0]
    w = w0.copy()
    trace = float(np.trace(cov))
    lr = 0.25 / max(trace, 1e-6)

    for _ in range(int(max_iter)):
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

        grad = grad + _anchor_penalty_grad(w, anchor, penalty_strength)
        w_next = project_max_weight(w - lr * grad, max_weight)
        if float(np.max(np.abs(w_next - w))) < 1e-6:
            w = w_next
            break
        w = w_next

    return project_max_weight(w, max_weight)


def _solve_slsqp(
    *,
    mu: np.ndarray,
    cov: np.ndarray,
    max_weight: float,
    mode: str,
    lam: float,
    max_iter: int,
    w0: np.ndarray,
    anchor: np.ndarray | None,
    penalty_strength: float,
) -> np.ndarray:
    """Exact constrained solve via scipy SLSQP with analytical Jacobians."""
    if not _HAS_SCIPY or _scipy_minimize is None:
        raise RuntimeError("scipy unavailable")

    n = mu.shape[0]
    vol = np.sqrt(np.maximum(np.diag(cov), 1e-12))
    # Soft floor for risk-parity / max-div so log / ratio stay defined.
    w_floor = 1e-8

    def _pen(w: np.ndarray) -> float:
        if anchor is None or penalty_strength <= 0.0:
            return 0.0
        d = w - anchor
        return 0.5 * penalty_strength * float(d @ d)

    def _pen_grad(w: np.ndarray) -> np.ndarray:
        return _anchor_penalty_grad(w, anchor, penalty_strength)

    if mode == "min_var":

        def objective(w: np.ndarray) -> float:
            return float(w @ cov @ w) + _pen(w)

        def jac(w: np.ndarray) -> np.ndarray:
            return 2.0 * (cov @ w) + _pen_grad(w)

    elif mode == "mean_variance":

        def objective(w: np.ndarray) -> float:
            return float(0.5 * lam * (w @ cov @ w) - mu @ w) + _pen(w)

        def jac(w: np.ndarray) -> np.ndarray:
            return lam * (cov @ w) - mu + _pen_grad(w)

    elif mode == "risk_parity":
        # True ERC: minimise Σᵢ (RCᵢ − σₚ/n)² where RCᵢ = wᵢ (Σw)ᵢ.
        def objective(w: np.ndarray) -> float:
            mrc = cov @ w
            rc = w * mrc
            tgt = float(np.sum(rc)) / max(n, 1)
            return float(np.sum((rc - tgt) ** 2)) + _pen(w)

        def jac(w: np.ndarray) -> np.ndarray:
            mrc = cov @ w
            rc = w * mrc
            tgt = float(np.sum(rc)) / max(n, 1)
            # d(rc_i)/dw_j = δᵢⱼ·mrcᵢ + wᵢ·Σᵢⱼ
            # d(tgt)/dw_j = (mrc_j + (Σw)_j)/n = 2·mrc_j / n
            # ∂L/∂w_k = 2 Σᵢ (rcᵢ−tgt) · (∂rcᵢ/∂w_k − ∂tgt/∂w_k)
            diff = rc - tgt
            # Vectorised: ∂rc/∂w = diag(mrc) + diag(w)·Σ
            # ∂tgt/∂w = 2·mrc / n
            d_rc = np.diag(mrc) + (w[:, None] * cov)
            d_tgt = (2.0 / max(n, 1)) * mrc
            grad = 2.0 * ((d_rc - d_tgt[None, :]).T @ diff)
            return grad + _pen_grad(w)

    elif mode == "max_diversification":
        # Maximise diversification ratio DR = (wᵀσ) / √(wᵀΣw); minimise −DR.
        def objective(w: np.ndarray) -> float:
            numer = float(w @ vol)
            denom = float(np.sqrt(max(w @ cov @ w, 1e-18)))
            return -numer / denom + _pen(w)

        def jac(w: np.ndarray) -> np.ndarray:
            numer = float(w @ vol)
            quad = float(max(w @ cov @ w, 1e-18))
            denom = float(np.sqrt(quad))
            # d(−DR)/dw = −σ/denom + numer · (Σw) / denom³
            grad = -vol / denom + numer * (cov @ w) / (denom ** 3)
            return grad + _pen_grad(w)

    else:
        raise ValueError(f"Unknown allocator mode: {mode}")

    bounds = [(w_floor if mode in ("risk_parity", "max_diversification") else 0.0,
               float(max_weight))] * n
    constraints = {"type": "eq", "fun": lambda w: float(np.sum(w) - 1.0),
                   "jac": lambda w: np.ones(n)}

    result = _scipy_minimize(
        objective,
        w0,
        method="SLSQP",
        jac=jac,
        bounds=bounds,
        constraints=constraints,
        options={"maxiter": int(max(max_iter, 100)), "ftol": 1e-12, "disp": False},
    )
    if not result.success and result.status not in (0, 4, 9):
        # status 4 / 9 can still yield a usable point; only hard-fail otherwise.
        # Re-raise so caller falls back to PGD.
        raise RuntimeError(f"SLSQP failed: {result.message}")

    w = np.asarray(result.x, dtype=float)
    w = np.nan_to_num(w, nan=0.0, posinf=0.0, neginf=0.0)
    return project_max_weight(np.maximum(w, 0.0), max_weight)


def solve_weights(
    *,
    mu_annual: np.ndarray,
    cov_annual: np.ndarray,
    max_weight: float,
    params: AllocatorParams,
    w0: np.ndarray | None = None,
    anchor_weights: np.ndarray | None = None,
    customization_drift: float | None = None,
) -> np.ndarray:
    """Solve a constrained allocation.

    - min_var: minimize w^T Sigma w
    - mean_variance: minimize (risk_aversion/2)*w^T Sigma w - mu^T w
    - risk_parity: equalize risk contributions (true ERC via SLSQP)
    - max_diversification: maximize diversification ratio (wᵀσ)/√(wᵀΣw)
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

    anchor = np.asarray(anchor_weights, dtype=float) if anchor_weights is not None else None
    drift = float(customization_drift) if customization_drift is not None else None
    if anchor is not None and anchor.shape != (n,):
        anchor = None
    if anchor is not None:
        anchor = np.maximum(anchor, 0.0)
    # Keep sparse subset anchors as-is (do NOT renormalize to sum 1). Renormalizing
    # a partial book made within-subset L1 look small while full-portfolio turnover
    # vs the true anchor far exceeded the committed customization_drift.
    anchor_sum = float(anchor.sum()) if anchor is not None else 0.0
    if anchor is not None and anchor_sum <= 1e-12:
        anchor = None
    sparse_anchor = bool(anchor is not None and anchor_sum < 1.0 - 1e-6)
    # Zero drift means hold the (renormalized) anchor exactly when the subset
    # covers the full book; sparse zero-drift is handled by full-portfolio projection.
    if anchor is not None and drift == 0.0 and not sparse_anchor:
        return project_max_weight(np.maximum(anchor, 0.0), max_weight)

    lam = float(max(params.risk_aversion, 1e-6))
    mode = params.mode
    # Penalty strength increases as drift shrinks so that low drift stays near anchor.
    penalty_strength = 0.0
    if anchor is not None and drift is not None and drift > 0.0 and drift < 1.0:
        penalty_strength = 10.0 * (1.0 - drift) / max(drift, 0.01)

    solve_kwargs = dict(
        mu=mu,
        cov=cov,
        max_weight=float(max_weight),
        mode=mode,
        lam=lam,
        max_iter=int(params.max_iter),
        w0=w,
        anchor=anchor,
        penalty_strength=penalty_strength,
    )
    try:
        w = _solve_slsqp(**solve_kwargs)
    except Exception:
        w = _solve_pgd(**solve_kwargs)

    w = project_max_weight(w, max_weight)

    # Hard projection onto the subset L1 ball only when the subset already covers
    # the full anchor mass. Sparse subsets defer to full-portfolio projection in
    # portfolio.simulate so turnover is measured against the true anchor.
    if (
        anchor is not None
        and drift is not None
        and 0.0 < drift < 1.0
        and not sparse_anchor
    ):
        anchor_ref = project_max_weight(np.maximum(anchor, 0.0), max_weight)
        for _ in range(5):
            dev = float(np.sum(np.abs(w - anchor_ref))) / 2.0
            if dev <= drift + 1e-6:
                break
            scale = drift / max(dev, 1e-12)
            w = anchor_ref + (w - anchor_ref) * scale
            w = project_max_weight(w, max_weight)
    return w
