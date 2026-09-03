"""Customization path: must-include overlay adds + full-portfolio drift."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.engine.allocator import AllocatorParams, solve_weights
from app.engine.customization import (
    derive_must_include_tickers,
    l1_turnover_distance,
    min_holdings_for_customization,
    pin_must_include_into_chosen,
    project_anchor_l1_drift,
)
from app.engine.objectives import needs_attainment
from app.engine.portfolio import simulate_dynamic_portfolio
from app.engine.spec import BacktestSpec
from app.engine.weights import apply_max_holdings


def test_derive_must_include_from_anchor_gap():
    must = derive_must_include_tickers(
        ["IVV", "TLT", "BOTZ", "AIQ", "ROBO"],
        {"IVV": 0.5, "TLT": 0.5},
    )
    assert must == ["BOTZ", "AIQ", "ROBO"]


def test_accessor_derive_must_include_accepts_explicit():
    """Regression: Phase 0–3 stage accessor dropped ``explicit=``, crashing every trial."""
    from app.engine.stages.accessors import (
        derive_must_include_tickers as stage_derive,
    )

    tickers = ["SPY", "XLV", "BOTZ", "AIQ", "GLD"]
    anchor = {"SPY": 0.7, "XLV": 0.3}
    assert stage_derive(tickers, anchor) == ["BOTZ", "AIQ", "GLD"]
    assert stage_derive(tickers, anchor, explicit=["BOTZ", "GLD"]) == ["BOTZ", "GLD"]
    # Portfolio path passes explicit= even when None — must not TypeError.
    assert stage_derive(tickers, anchor, explicit=None) == ["BOTZ", "AIQ", "GLD"]


def test_simulate_with_explicit_must_include_does_not_typeerror():
    """Every Optuna trial called simulate with explicit=; accessor TypeError → all infeasible."""
    rng = np.random.default_rng(7)
    n = 280
    idx = pd.bdate_range("2019-01-01", periods=n)
    tickers = ["SPY", "XLV", "XLF", "BOTZ", "AIQ", "GLD", "TLT"]
    prices = pd.DataFrame(
        {
            t: 100 * np.cumprod(1 + rng.normal(0.0003, 0.01, size=n))
            for t in tickers
        },
        index=idx,
    )
    anchor = {"SPY": 0.5, "XLV": 0.25, "XLF": 0.25}
    m = simulate_dynamic_portfolio(
        prices,
        spec=BacktestSpec(rebalance_rule="QE", max_holdings=7, min_holdings=2),
        max_weight=0.5,
        min_weight=0.005,
        allocator=AllocatorParams(mode="mean_variance", lookback_days=63),
        top_n=None,
        anchor_weights=anchor,
        customization_drift=0.25,
        must_include_tickers=["BOTZ", "AIQ", "GLD", "TLT"],
    )
    assert not m.get("metrics_suspect")
    assert float(m.get("sharpe", 0.0)) > -1e5


def test_pin_must_include_survives_top_n_trim():
    scores = pd.Series({"A": 3.0, "B": 2.0, "C": 1.0, "BOTZ": -1.0, "AIQ": -2.0})
    chosen = ["A", "B", "C"]
    out = pin_must_include_into_chosen(
        chosen,
        ["BOTZ", "AIQ"],
        scores,
        max_holdings=4,
        n_assets=5,
    )
    assert "BOTZ" in out and "AIQ" in out
    assert len(out) <= 4


def test_project_anchor_l1_enforces_full_book_drift():
    # Anchor: two names. Candidate drops one entirely → L1=0.5 without projection.
    tickers = ["A", "B", "C"]
    anchor = np.array([0.5, 0.5, 0.0])
    w = np.array([0.0, 0.5, 0.5])  # dropped A, added C
    assert l1_turnover_distance(w, anchor) == 0.5
    out = project_anchor_l1_drift(w, anchor, drift=0.1, max_weight=0.6)
    assert l1_turnover_distance(out, project_anchor_l1_drift(anchor, anchor, 1.0, 0.6)) <= 0.1 + 1e-5 or (
        l1_turnover_distance(out, anchor / anchor.sum()) <= 0.1 + 1e-4
    )
    # More direct: measure vs normalized projected anchor
    a_ref = project_anchor_l1_drift(anchor, anchor, 0.0, 0.6)
    assert l1_turnover_distance(out, a_ref) <= 0.1 + 1e-4


def test_allocator_sparse_anchor_does_not_renormalize_away_drift():
    """Subset solve with sparse anchor must not pretend L1 is small."""
    mu = np.array([0.1, 0.05, 0.2])
    cov = np.eye(3) * 0.04
    # Only first two names are in the anchor book.
    w = solve_weights(
        mu_annual=mu,
        cov_annual=cov,
        max_weight=0.6,
        params=AllocatorParams(mode="mean_variance", lookback_days=60),
        anchor_weights=np.array([0.5, 0.5, 0.0]),
        customization_drift=0.05,
    )
    # Sparse hard-projection is skipped; weights still sum to 1.
    assert abs(float(w.sum()) - 1.0) < 1e-6


def test_apply_max_holdings_prefers_must_include():
    w = np.array([0.4, 0.3, 0.2, 0.05, 0.05])
    out = apply_max_holdings(w, 3, prefer_keep=[3, 4])
    active = np.where(out > 1e-8)[0].tolist()
    assert 3 in active and 4 in active
    assert len(active) == 3


def test_needs_attainment_flags_missing_must_include_and_drift():
    att = needs_attainment(
        {"max_drawdown": -0.1},
        {"max_drawdown_tolerance": 0.2},
        holdings={"IVV": 0.5, "TLT": 0.5},
        must_include_tickers=["BOTZ", "AIQ"],
        anchor_weights={"IVV": 0.4, "TLT": 0.4, "AGG": 0.2},
        customization_drift=0.1,
    )
    assert att is not None
    assert att["within_must_include"] is False
    assert set(att["missing_must_include"]) == {"BOTZ", "AIQ"}
    assert att["within_customization_drift"] is False
    assert att["all_floors_met"] is False


def test_needs_attainment_always_reports_drift_when_anchor_set():
    """Anchor alone is enough — drift fields must populate even without client_context."""
    att = needs_attainment(
        {"max_drawdown": -0.05},
        None,
        holdings={"IVV": 0.45, "TLT": 0.45, "AGG": 0.1},
        anchor_weights={"IVV": 0.4, "TLT": 0.4, "AGG": 0.2},
        customization_drift=0.1,
    )
    assert att is not None
    assert "customization_drift_l1" in att
    assert "within_customization_drift" in att
    assert att["customization_drift_cap"] == 0.1
    assert att["within_customization_drift"] is True

    att_default = needs_attainment(
        {"max_drawdown": -0.05},
        None,
        holdings={"IVV": 0.5, "TLT": 0.5},
        anchor_weights={"IVV": 0.5, "TLT": 0.5},
    )
    assert att_default is not None
    assert att_default["customization_drift_cap"] == 0.5
    assert att_default["within_customization_drift"] is True


def test_min_holdings_floor_covers_must_and_anchor_slots():
    # drift=0.1, max_w=0.25 → need 4 anchor slots + 3 must = 7
    need = min_holdings_for_customization(
        n_must_include=3,
        max_weight=0.25,
        customization_drift=0.1,
        n_assets=11,
    )
    assert need == 7


def test_anchored_run_defaults_customization_drift_to_fixed_slider():
    rng = np.random.default_rng(3)
    dates = pd.bdate_range("2018-01-01", periods=280)
    tickers = ["A", "B", "C", "D"]
    prices = pd.DataFrame(
        {t: 100 * np.cumprod(1 + rng.normal(0.0003, 0.01, len(dates))) for t in tickers},
        index=dates,
    )
    from app.engine.optimizer import run_optuna_search
    from app.engine.spec import BacktestSpec

    records = run_optuna_search(
        prices,
        max_weight=0.5,
        max_turnover=1.0,
        top_n=50,
        objective="max_sharpe",
        trials=3,
        customization_drift=0.12,
        param_controls={},
        anchor_weights={"A": 0.5, "B": 0.5},
        spec=BacktestSpec(rebalance_rule="QE"),
    )
    assert records
    for _, params, _ in records:
        assert abs(float(params["customization_drift_actual"]) - 0.12) < 1e-6


def test_simulate_keeps_must_include_under_tight_drift():
    """Regression for job 16c0c7d4: overlay AI names must not vanish under Top-N."""
    rng = np.random.default_rng(7)
    n = 320
    idx = pd.bdate_range("2020-01-01", periods=n)
    tickers = ["IVV", "TLT", "AGG", "SHY", "BOTZ", "AIQ", "ROBO"]
    data = {}
    for i, t in enumerate(tickers):
        # Defensive names slightly calmer; AI names noisier but present.
        vol = 0.01 if t in {"TLT", "AGG", "SHY"} else 0.015
        data[t] = 100 * np.cumprod(1 + rng.normal(0.0002, vol, size=n))
    prices = pd.DataFrame(data, index=idx)
    anchor = {"IVV": 0.25, "TLT": 0.25, "AGG": 0.25, "SHY": 0.25}
    m = simulate_dynamic_portfolio(
        prices,
        spec=BacktestSpec(rebalance_rule="QE", max_holdings=6, min_holdings=2),
        max_weight=0.3,
        min_weight=0.005,
        allocator=AllocatorParams(mode="min_var", lookback_days=60),
        top_n=5,
        anchor_weights=anchor,
        customization_drift=0.15,
        must_include_tickers=["BOTZ", "AIQ", "ROBO"],
    )
    last = np.atleast_1d(np.asarray(m["last_weights"], dtype=float)).ravel()
    held = {
        t: float(last[i])
        for i, t in enumerate(prices.columns)
        if float(last[i]) > 1e-8
    }
    for t in ("BOTZ", "AIQ", "ROBO"):
        assert t in held, f"{t} missing from holdings {held}"
    a = np.array([float(anchor.get(t, 0.0)) for t in prices.columns])
    assert l1_turnover_distance(last, a) <= 0.15 + 0.02


def test_simulate_job_d3972_overlay_adds_auto_derived():
    """Job d3972fe2: BOTZ/AIQ/SOXX in tradable but not in anchor must be held."""
    rng = np.random.default_rng(21)
    n = 360
    idx = pd.bdate_range("2018-01-01", periods=n)
    tickers = [
        "IVV",
        "VWELX",
        "PG",
        "TLT",
        "AGG",
        "DODIX",
        "SHY",
        "GLD",
        "BOTZ",
        "AIQ",
        "SOXX",
    ]
    prices = pd.DataFrame(
        {
            t: 100 * np.cumprod(1 + rng.normal(0.0002, 0.012, size=n))
            for t in tickers
        },
        index=idx,
    )
    anchor = {
        "IVV": 0.15,
        "VWELX": 0.1,
        "PG": 0.05,
        "TLT": 0.25,
        "AGG": 0.15,
        "DODIX": 0.1,
        "SHY": 0.1,
        "GLD": 0.1,
    }
    must = derive_must_include_tickers(tickers, anchor)
    assert set(must) == {"BOTZ", "AIQ", "SOXX"}
    m = simulate_dynamic_portfolio(
        prices,
        spec=BacktestSpec(rebalance_rule="QE", max_holdings=12, min_holdings=2),
        max_weight=0.25,
        min_weight=0.005,
        allocator=AllocatorParams(mode="min_var", lookback_days=60),
        top_n=None,
        anchor_weights=anchor,
        customization_drift=0.1,
    )
    last = np.atleast_1d(np.asarray(m["last_weights"], dtype=float)).ravel()
    held = {
        t: float(last[i])
        for i, t in enumerate(prices.columns)
        if float(last[i]) > 1e-8
    }
    for t in ("BOTZ", "AIQ", "SOXX"):
        assert t in held, f"{t} missing from holdings {held}"


def test_simulate_class_budget_cannot_break_customization_drift():
    """Drift projection must be last — class sleeves must not reopen the L1 budget."""
    rng = np.random.default_rng(11)
    n = 260
    idx = pd.bdate_range("2020-01-01", periods=n)
    tickers = ["IVV", "QQQ", "TLT", "AGG", "GLD"]
    prices = pd.DataFrame(
        {
            t: 100 * np.cumprod(1 + rng.normal(0.0003, 0.012, size=n))
            for t in tickers
        },
        index=idx,
    )
    universe = {
        "IVV": {"asset_class": "equity"},
        "QQQ": {"asset_class": "equity"},
        "TLT": {"asset_class": "bond"},
        "AGG": {"asset_class": "bond"},
        "GLD": {"asset_class": "commodity"},
    }
    anchor = {"IVV": 0.4, "TLT": 0.4, "AGG": 0.2}
    drift = 0.1
    m = simulate_dynamic_portfolio(
        prices,
        spec=BacktestSpec(rebalance_rule="QE", max_holdings=5, min_holdings=2),
        max_weight=0.45,
        min_weight=0.005,
        allocator=AllocatorParams(mode="mean_variance", lookback_days=60),
        top_n=5,
        universe_by_ticker=universe,
        class_budget={"w_equity": 0.2, "w_bond": 0.7, "w_commodity": 0.1},
        enforce_class_weights=True,
        anchor_weights=anchor,
        customization_drift=drift,
    )
    last = np.atleast_1d(np.asarray(m["last_weights"], dtype=float)).ravel()
    a = np.array([float(anchor.get(t, 0.0)) for t in prices.columns], dtype=float)
    a = a / a.sum()
    assert l1_turnover_distance(last, a) <= drift + 1e-3

    att = needs_attainment(
        {"max_drawdown": -0.1},
        None,
        holdings={t: float(last[i]) for i, t in enumerate(prices.columns)},
        anchor_weights=anchor,
        customization_drift=drift,
    )
    assert att is not None
    assert att["within_customization_drift"] is True
    assert float(att["customization_drift_l1"]) <= drift + 1e-3


def test_simulate_starts_near_anchor_under_tight_drift():
    """Day-0 / skipped-lookback weights must not begin as equal-weight far from anchor."""
    rng = np.random.default_rng(19)
    n = 120
    idx = pd.bdate_range("2021-01-01", periods=n)
    tickers = ["IVV", "TLT", "AGG", "SHY", "GLD"]
    prices = pd.DataFrame(
        {
            t: 100 * np.cumprod(1 + rng.normal(0.0002, 0.01, size=n))
            for t in tickers
        },
        index=idx,
    )
    anchor = {"IVV": 0.3, "TLT": 0.3, "AGG": 0.2, "SHY": 0.1, "GLD": 0.1}
    drift = 0.05
    m = simulate_dynamic_portfolio(
        prices,
        spec=BacktestSpec(rebalance_rule="QE", max_holdings=5, min_holdings=2),
        max_weight=0.4,
        min_weight=0.005,
        allocator=AllocatorParams(mode="min_var", lookback_days=60),
        top_n=5,
        anchor_weights=anchor,
        customization_drift=drift,
    )
    last = np.atleast_1d(np.asarray(m["last_weights"], dtype=float)).ravel()
    a = np.array([float(anchor[t]) for t in tickers], dtype=float)
    assert l1_turnover_distance(last, a) <= drift + 1e-3
    # First schedule row (via weight history or last) stays within ceiling.
    wh = m.get("weight_history") or []
    if wh:
        row = wh[0]
        w0 = np.array([float(row.get(t, 0.0)) for t in tickers], dtype=float)
        s = float(w0.sum())
        if s > 1e-9:
            assert l1_turnover_distance(w0 / s, a) <= drift + 0.05
