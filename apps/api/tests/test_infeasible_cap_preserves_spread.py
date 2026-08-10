"""Regression: infeasible max_weight + class budget must not collapse to 1/N."""

from __future__ import annotations

import numpy as np

from app.engine.allocator import AllocatorParams, solve_weights
from app.engine.asset_class_policy import enforce_class_weight_budget
from app.engine.weights import (
    apply_max_holdings,
    apply_min_holding_weight,
    feasible_max_weight,
    project_max_weight,
)


def test_feasible_max_weight_relaxes_when_holdings_insufficient() -> None:
    assert feasible_max_weight(0.08, 8) == 0.125
    assert feasible_max_weight(0.25, 8) == 0.25
    # Exact n × cap = 1 admits only equal weights — relax to 1/(n-1).
    assert abs(feasible_max_weight(0.1, 10) - (1.0 / 9.0)) < 1e-12


def test_project_max_weight_preserves_spread_when_cap_infeasible() -> None:
    """Job a3556951-style: 8 names + 8% cap must not force exact equal weights."""
    w = np.array([0.2273, 0.1364, 0.1364, 0.1115, 0.1114, 0.1109, 0.1105, 0.0557])
    out = project_max_weight(w, 0.08)
    assert abs(float(out.sum()) - 1.0) < 1e-6
    assert float(out.max() - out.min()) > 0.02
    # Not exact 1/8 collapse.
    assert not np.allclose(out, np.full(8, 0.125), atol=1e-6)


def test_project_max_weight_preserves_spread_at_exact_ten_by_ten() -> None:
    """10 names × 10% cap is a unique equal-weight point — must keep relative weights."""
    w = np.array([0.18, 0.14, 0.12, 0.11, 0.10, 0.09, 0.08, 0.07, 0.06, 0.05], dtype=float)
    w = w / w.sum()
    out = project_max_weight(w, 0.1)
    assert abs(float(out.sum()) - 1.0) < 1e-6
    assert float(out.max() - out.min()) > 0.05
    assert not np.allclose(out, np.full(10, 0.1), atol=1e-5)


def test_class_budget_with_tight_cap_preserves_allocator_spread() -> None:
    """Reproduce job collapse: MV → class enforce + 8% cap → was exact 12.5%×8."""
    tickers = [
        "IVV",
        "SHY",
        "PG",
        "VWELX",
        "AGG",
        "DODIX",
        "TLT",
        "GLD",
        "XOM",
        "BNDX",
        "VNQ",
    ]
    universe = {
        "IVV": {"asset_class": "equity"},
        "PG": {"asset_class": "equity"},
        "VWELX": {"asset_class": "equity"},
        "XOM": {"asset_class": "equity"},
        "SHY": {"asset_class": "bond"},
        "AGG": {"asset_class": "bond"},
        "DODIX": {"asset_class": "bond"},
        "TLT": {"asset_class": "bond"},
        "BNDX": {"asset_class": "bond"},
        "GLD": {"asset_class": "commodity"},
        "VNQ": {"asset_class": "real_estate"},
    }
    chosen = ["IVV", "SHY", "PG", "VWELX", "AGG", "DODIX", "TLT", "GLD"]
    rng = np.random.default_rng(0)
    n_sub = len(chosen)
    mu = rng.normal(0.08, 0.05, size=n_sub)
    a = rng.normal(size=(n_sub, n_sub))
    cov = a @ a.T / n_sub + np.eye(n_sub) * 0.01
    params = AllocatorParams(mode="mean_variance", shrinkage=0.25, risk_aversion=3.0)
    anchor = np.array([0.15, 0.10, 0.05, 0.10, 0.15, 0.10, 0.25, 0.10])
    w_sub = solve_weights(
        mu_annual=mu,
        cov_annual=cov,
        max_weight=0.08,
        params=params,
        w0=np.ones(n_sub) / n_sub,
        anchor_weights=anchor,
        customization_drift=0.05,
    )
    assert float(w_sub.max() - w_sub.min()) > 0.05

    col = {t: i for i, t in enumerate(tickers)}
    w = np.zeros(len(tickers))
    for i, t in enumerate(chosen):
        w[col[t]] = float(w_sub[i])
    w = project_max_weight(w, 0.08)
    w = apply_min_holding_weight(w, 0.005, max_weight=0.08)
    w = apply_max_holdings(w, 8, max_weight=0.08)
    budget = {
        "equity": 0.3,
        "bond": 0.6,
        "commodity": 0.1,
        "real_estate": 0.0,
        "alternative": 0.0,
    }
    out = enforce_class_weight_budget(
        w,
        tickers,
        universe,
        budget,
        active_tickers=chosen,
        max_weight=0.08,
    )
    active = out[out > 1e-4]
    assert abs(float(out.sum()) - 1.0) < 1e-6
    assert len(active) == 8
    # Must keep differentiated MV / anchor structure — not exact equal 1/8.
    assert float(active.max() - active.min()) > 0.02
    assert not np.allclose(active, np.full(len(active), 0.125), atol=1e-5)
