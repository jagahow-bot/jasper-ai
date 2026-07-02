"""Per-regime class quota matrix for dynamic objective."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.engine.asset_class_policy import (
    build_class_budget_resolver,
    has_regime_class_quotas,
    normalize_regime_class_quotas,
    regime_class_quota_param_key,
)
from app.engine.dynamic_objective import (
    build_active_regime_resolver,
    build_regime_class_budget_resolver,
    refresh_dynamic_class_budget_resolver,
)
from app.engine.param_bounds import RunBlueprint
from app.engine.param_taxonomy import build_pro_round_param_controls, normalize_round_seed
from app.engine.portfolio import _pick_top_n_with_budget


def _bench_returns(n: int = 520) -> pd.Series:
    idx = pd.bdate_range("2018-01-01", periods=n)
    rng = np.random.default_rng(7)
    ret = rng.normal(0.0004, 0.012, n)
    return pd.Series(ret, index=idx)


def test_normalize_regime_class_quotas_sums_to_one() -> None:
    raw = {
        "risk_on": {"w_equity": 0.8, "w_bond": 0.2},
        "risk_off": {"w_bond": 0.6, "w_commodity": 0.4},
    }
    matrix = normalize_regime_class_quotas(raw, shared_setup={"w_equity": 0.5, "w_bond": 0.5})
    assert has_regime_class_quotas(matrix)
    assert abs(sum(matrix["risk_on"].values()) - 1.0) < 1e-9
    assert abs(sum(matrix["risk_off"].values()) - 1.0) < 1e-9
    assert matrix["neutral"]["equity"] == 0.5


def test_normalize_round_seed_regime_class_quotas() -> None:
    blueprint = RunBlueprint(max_weight=0.25, max_turnover=0.5, top_n=10)
    seed = {
        "rationale": "test",
        "round_setup": {
            "mode": "mean_variance",
            "lookback_days": 252,
            "shrinkage": 0.1,
            "risk_aversion": 4.0,
            "top_n_actual": 8,
            "max_weight_actual": 0.2,
            "max_turnover_actual": 0.4,
            "no_trade_tol": 0.0,
            "turnover_penalty_mult": 1.0,
        },
        "regime_setups": {
            "risk_off": {"mode": "min_var", "lookback_days": 252},
            "neutral": {"mode": "mean_variance", "lookback_days": 126},
            "risk_on": {"mode": "mean_variance", "lookback_days": 63},
        },
        "regime_class_quotas": {
            "risk_off": {"w_bond": 0.7, "w_commodity": 0.3},
            "neutral": {"w_equity": 0.5, "w_bond": 0.5},
            "risk_on": {"w_equity": 0.85, "w_bond": 0.15},
        },
        "factor_ranges": {"w_mom": [0.2, 1.0]},
    }
    out = normalize_round_seed(seed, blueprint=blueprint, param_controls={})
    assert has_regime_class_quotas(out["regime_class_quotas"])
    assert out["regime_class_quotas"]["risk_on"]["equity"] > 0.8


def test_class_budget_resolver_changes_with_regime() -> None:
    bench = _bench_returns()
    regime_resolver, timeline, _ = build_active_regime_resolver(bench, regime_mode="auto")
    budget_by_regime = {
        "risk_off": {"bond": 1.0},
        "neutral": {"equity": 0.5, "bond": 0.5},
        "risk_on": {"equity": 1.0},
    }
    resolver = build_class_budget_resolver(regime_resolver, budget_by_regime)
    seen: set[tuple[str, ...]] = set()
    for row in timeline[:: max(1, len(timeline) // 6)]:
        dt = pd.Timestamp(row["date"])
        budget = resolver(dt)
        seen.add(tuple(sorted(budget.items())))
    assert len(seen) >= 2


def test_refresh_dynamic_ctx_class_budget_resolver() -> None:
    bench = _bench_returns()
    regime_resolver, _, _ = build_active_regime_resolver(bench, regime_mode="auto")
    ctx = {
        "bench_ret": bench,
        "regime_mode": "auto",
        "detector_version": "v2",
        "fast_risk_off_exit": True,
        "active_regime_resolver": regime_resolver,
    }
    quotas = normalize_regime_class_quotas(
        {
            "risk_off": {"w_bond": 0.8, "w_commodity": 0.2},
            "risk_on": {"w_equity": 0.9, "w_bond": 0.1},
        }
    )
    updated = refresh_dynamic_class_budget_resolver(
        ctx, regime_class_quotas=quotas, shared_round_setup={"top_n_actual": 10}
    )
    assert updated.get("class_budget_resolver") is not None
    assert updated.get("regime_class_quotas") is not None


def test_regime_switch_changes_top_n_class_budget_at_rebalance() -> None:
    """_pick_top_n_with_budget reflects different regime quotas."""
    scores = pd.Series({"A": 1.0, "B": 0.9, "C": 0.8, "D": 0.7, "E": 0.6})
    universe = {
        "A": {"asset_class": "equity"},
        "B": {"asset_class": "equity"},
        "C": {"asset_class": "bond"},
        "D": {"asset_class": "bond"},
        "E": {"asset_class": "commodity"},
    }
    risk_off = _pick_top_n_with_budget(
        scores, top_n=4, tickers=list(scores.index), universe_by_ticker=universe,
        class_budget={"bond": 0.75, "commodity": 0.25},
    )
    risk_on = _pick_top_n_with_budget(
        scores, top_n=4, tickers=list(scores.index), universe_by_ticker=universe,
        class_budget={"equity": 0.75, "bond": 0.25},
    )
    risk_off_eq = sum(1 for t in risk_off if universe[t]["asset_class"] == "equity")
    risk_on_eq = sum(1 for t in risk_on if universe[t]["asset_class"] == "equity")
    assert risk_off_eq < risk_on_eq


def test_simulate_enforces_per_regime_class_budget() -> None:
    """class_budget_resolver must switch sleeve targets when regime changes."""
    from app.engine.allocator import AllocatorParams
    from app.engine.asset_class_policy import class_sleeve_totals
    from app.engine.factors import FactorParams
    from app.engine.portfolio import simulate_dynamic_portfolio
    from app.engine.spec import BacktestSpec

    dates = pd.bdate_range("2020-01-01", periods=320)
    rng = np.random.default_rng(11)
    tickers = ["EQ1", "EQ2", "BD1", "BD2", "BD3"]
    universe = {
        "EQ1": {"asset_class": "equity"},
        "EQ2": {"asset_class": "equity"},
        "BD1": {"asset_class": "bond"},
        "BD2": {"asset_class": "bond"},
        "BD3": {"asset_class": "bond"},
    }
    prices = pd.DataFrame(
        {
            t: 100
            * np.cumprod(
                1
                + rng.normal(
                    0.0005 if universe[t]["asset_class"] == "equity" else 0.0001,
                    0.01,
                    len(dates),
                )
            )
            for t in tickers
        },
        index=dates,
    )
    switch_date = pd.Timestamp("2020-09-01")

    def regime_resolver(dt: pd.Timestamp) -> str:
        return "risk_off" if dt < switch_date else "risk_on"

    budget_by_regime = {
        "risk_off": {"bond": 0.8, "equity": 0.2},
        "risk_on": {"equity": 0.85, "bond": 0.15},
    }
    class_resolver = build_class_budget_resolver(regime_resolver, budget_by_regime)
    metrics = simulate_dynamic_portfolio(
        prices,
        report_start="2020-07-01",
        spec=BacktestSpec(rebalance_rule="QE", fee_bps=0.0, max_holdings=5),
        max_weight=0.35,
        min_weight=0.0,
        allocator=AllocatorParams(mode="mean_variance", lookback_days=126),
        factor_params=FactorParams(lookback_days=126, w_mom=1.0, w_lowvol=0.5),
        top_n=5,
        universe_by_ticker=universe,
        class_budget_resolver=class_resolver,
        enforce_class_weights=True,
    )
    wh = metrics.get("weight_history") or []
    risk_off_rows = [
        row
        for row in wh
        if pd.Timestamp(str(row["date"])) < switch_date
    ]
    risk_on_rows = [
        row
        for row in wh
        if pd.Timestamp(str(row["date"])) >= switch_date
    ]
    assert risk_off_rows and risk_on_rows

    def avg_equity(rows: list[dict]) -> float:
        totals = []
        for row in rows:
            w = np.array([float(row.get(t, 0.0)) for t in tickers])
            totals.append(class_sleeve_totals(w, tickers, universe).get("equity", 0.0))
        return float(sum(totals) / len(totals))

    assert avg_equity(risk_off_rows) < avg_equity(risk_on_rows)
    assert avg_equity(risk_off_rows) < 0.35


def test_pro_controls_fix_regime_quota_keys() -> None:
    blueprint = RunBlueprint(max_weight=0.25, max_turnover=0.5, top_n=10)
    round_setup = {
        "mode": "mean_variance",
        "lookback_days": 252,
        "shrinkage": 0.1,
        "risk_aversion": 4.0,
        "top_n_actual": 8,
        "max_weight_actual": 0.2,
        "max_turnover_actual": 0.4,
        "no_trade_tol": 0.0,
        "turnover_penalty_mult": 1.0,
        "w_equity": 0.6,
        "w_bond": 0.4,
    }
    regime_setups = {
        "risk_off": {"mode": "min_var", "lookback_days": 252, "shrinkage": 0.2, "risk_aversion": 1.0},
        "neutral": {"mode": "mean_variance", "lookback_days": 126, "shrinkage": 0.1, "risk_aversion": 3.5},
        "risk_on": {"mode": "mean_variance", "lookback_days": 63, "shrinkage": 0.05, "risk_aversion": 1.5},
    }
    regime_class_quotas = normalize_regime_class_quotas(
        {
            "risk_off": {"w_bond": 0.8, "w_commodity": 0.2},
            "neutral": {"w_equity": 0.5, "w_bond": 0.5},
            "risk_on": {"w_equity": 0.9, "w_bond": 0.1},
        },
        shared_setup=round_setup,
    )
    controls = build_pro_round_param_controls(
        {},
        blueprint=blueprint,
        round_setup=round_setup,
        factor_ranges={"w_mom": [0.1, 1.5]},
        factor_choices=None,
        regime_setups=regime_setups,
        regime_class_quotas=regime_class_quotas,
    )
    key = regime_class_quota_param_key("risk_on", "w_equity")
    assert controls[key]["mode"] == "fixed"
    assert controls[key]["fixed"] > 0.85
    assert "w_equity" not in controls or controls.get("w_equity", {}).get("mode") != "search"
