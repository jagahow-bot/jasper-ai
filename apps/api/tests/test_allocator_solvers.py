"""Allocator solver precision: SLSQP primary path + PGD fallback."""

from __future__ import annotations

import numpy as np
import pytest

from app.engine import allocator as allocator_mod
from app.engine.allocator import AllocatorParams, solve_weights


def _diag_cov(vols: np.ndarray) -> np.ndarray:
    return np.diag(np.asarray(vols, dtype=float) ** 2)


def _mu(n: int, value: float = 0.08) -> np.ndarray:
    return np.full(n, value, dtype=float)


def test_min_var_respects_cap_and_budget():
    vols = np.array([0.10, 0.20, 0.30, 0.40])
    w = solve_weights(
        mu_annual=_mu(4),
        cov_annual=_diag_cov(vols),
        max_weight=0.40,
        params=AllocatorParams(mode="min_var", shrinkage=0.0),
    )
    assert w.shape == (4,)
    assert abs(float(w.sum()) - 1.0) < 1e-6
    assert float(w.max()) <= 0.40 + 1e-6
    # Lowest-vol name should dominate when unconstrained by correlation.
    assert float(w[0]) >= float(w[1]) >= float(w[2]) - 1e-6


def test_mean_variance_tilts_toward_higher_mu():
    vols = np.ones(4) * 0.20
    mu = np.array([0.05, 0.08, 0.12, 0.20])
    w = solve_weights(
        mu_annual=mu,
        cov_annual=_diag_cov(vols),
        max_weight=0.50,
        params=AllocatorParams(mode="mean_variance", risk_aversion=2.0, shrinkage=0.0),
    )
    assert abs(float(w.sum()) - 1.0) < 1e-6
    assert float(w[3]) >= float(w[0])


def test_risk_parity_equalizes_risk_contributions():
    vols = np.array([0.10, 0.20, 0.30, 0.40])
    cov = _diag_cov(vols)
    w = solve_weights(
        mu_annual=_mu(4),
        cov_annual=cov,
        max_weight=0.60,
        params=AllocatorParams(mode="risk_parity", shrinkage=0.0, max_iter=400),
    )
    assert abs(float(w.sum()) - 1.0) < 1e-5
    mrc = cov @ w
    rc = w * mrc
    rc_share = rc / max(float(rc.sum()), 1e-12)
    # True ERC: risk shares within ~3 pp of equal (1/n).
    assert float(rc_share.std()) < 0.03


def test_max_div_beats_inverse_vol_baseline():
    # Mild correlation so the true DR optimum differs from pure inverse-vol.
    vols = np.array([0.12, 0.18, 0.25, 0.35])
    corr = np.array(
        [
            [1.0, 0.4, 0.2, 0.1],
            [0.4, 1.0, 0.3, 0.2],
            [0.2, 0.3, 1.0, 0.5],
            [0.1, 0.2, 0.5, 1.0],
        ]
    )
    cov = np.outer(vols, vols) * corr
    w = solve_weights(
        mu_annual=_mu(4),
        cov_annual=cov,
        max_weight=0.60,
        params=AllocatorParams(mode="max_diversification", shrinkage=0.0, max_iter=400),
    )
    inv_vol = 1.0 / vols
    inv_vol = inv_vol / inv_vol.sum()

    def _dr(weights: np.ndarray) -> float:
        numer = float(weights @ vols)
        denom = float(np.sqrt(max(weights @ cov @ weights, 1e-18)))
        return numer / denom

    assert abs(float(w.sum()) - 1.0) < 1e-5
    assert _dr(w) + 1e-6 >= _dr(inv_vol)


def test_anchor_zero_drift_returns_anchor():
    vols = np.array([0.15, 0.20, 0.25])
    anchor = np.array([0.5, 0.3, 0.2])
    w = solve_weights(
        mu_annual=_mu(3),
        cov_annual=_diag_cov(vols),
        max_weight=0.60,
        params=AllocatorParams(mode="min_var"),
        anchor_weights=anchor,
        customization_drift=0.0,
    )
    np.testing.assert_allclose(w, anchor, atol=1e-6)


def test_anchor_drift_still_enforced():
    vols = np.ones(4) * 0.20
    anchor = np.array([0.4, 0.3, 0.2, 0.1])
    drift = 0.15
    w = solve_weights(
        mu_annual=np.array([0.30, 0.05, 0.05, 0.05]),
        cov_annual=_diag_cov(vols),
        max_weight=0.50,
        params=AllocatorParams(mode="mean_variance", risk_aversion=1.0, shrinkage=0.0),
        anchor_weights=anchor,
        customization_drift=drift,
    )
    # Half L1 distance to (projected) anchor must stay within drift.
    from app.engine.weights import project_max_weight

    anchor_ref = project_max_weight(anchor, 0.50)
    half_l1 = float(np.sum(np.abs(w - anchor_ref))) / 2.0
    assert half_l1 <= drift + 1e-5


def test_pgd_fallback_when_scipy_missing(monkeypatch):
    monkeypatch.setattr(allocator_mod, "_HAS_SCIPY", False)
    monkeypatch.setattr(allocator_mod, "_scipy_minimize", None)
    vols = np.array([0.10, 0.20, 0.30])
    w = solve_weights(
        mu_annual=_mu(3),
        cov_annual=_diag_cov(vols),
        max_weight=0.50,
        params=AllocatorParams(mode="min_var", shrinkage=0.0),
    )
    assert abs(float(w.sum()) - 1.0) < 1e-6
    assert float(w.max()) <= 0.50 + 1e-6


def test_unknown_mode_raises():
    with pytest.raises(ValueError, match="Unknown allocator mode"):
        solve_weights(
            mu_annual=_mu(2),
            cov_annual=_diag_cov(np.array([0.2, 0.2])),
            max_weight=0.6,
            params=AllocatorParams(mode="not_a_real_mode"),
        )
