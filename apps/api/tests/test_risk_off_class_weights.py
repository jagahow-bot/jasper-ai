"""Risk-off regime: low equity sleeve weight, not ~90% equity."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.engine.allocator import AllocatorParams
from app.engine.analytics import exposure_by_regime_from_weight_history
from app.engine.asset_class_policy import (
    build_class_budget_resolver,
    class_sleeve_totals,
    enforce_class_weight_budget,
)
from app.engine.dynamic_objective import build_active_regime_resolver
from app.engine.factors import FactorParams
from app.engine.portfolio import _pick_top_n_with_budget, simulate_dynamic_portfolio
from app.engine.spec import BacktestSpec


def _multi_class_universe() -> tuple[list[str], dict[str, dict[str, str]]]:
  tickers = (
      [f"EQ{i}" for i in range(1, 4)]
      + [f"BD{i}" for i in range(1, 8)]
      + ["CM1", "CM2"]
      + ["ALT1"]
  )
  universe: dict[str, dict[str, str]] = {}
  for t in tickers:
      if t.startswith("EQ"):
          universe[t] = {"asset_class": "equity"}
      elif t.startswith("BD"):
          universe[t] = {"asset_class": "bond"}
      elif t.startswith("CM"):
          universe[t] = {"asset_class": "commodity"}
      else:
          universe[t] = {"asset_class": "alternative"}
  return tickers, universe


def test_risk_off_top_n_picks_bond_heavy_counts() -> None:
    """2 equity / 7 bond / 1 commodity / 1 alt for top_n=11 risk_off budget."""
    tickers, universe = _multi_class_universe()
    scores = pd.Series({t: float(100 - i) for i, t in enumerate(tickers)})
    budget = {
        "equity": 0.18,
        "bond": 0.64,
        "commodity": 0.09,
        "alternative": 0.09,
    }
    chosen = _pick_top_n_with_budget(
        scores,
        top_n=11,
        tickers=tickers,
        universe_by_ticker=universe,
        class_budget=budget,
    )
    counts = {ac: 0 for ac in budget}
    for t in chosen:
        ac = universe[t]["asset_class"]
        counts[ac] = counts.get(ac, 0) + 1
    assert counts["equity"] <= 3
    assert counts["bond"] >= 6
    assert counts["commodity"] >= 1
    assert counts["alternative"] >= 0
    assert sum(counts.values()) == 11


def test_enforce_class_budget_with_max_weight_respects_cap() -> None:
    tickers, universe = _multi_class_universe()
    rng = np.random.default_rng(3)
    w = rng.dirichlet(np.ones(len(tickers)))
    budget = {
        "equity": 0.18,
        "bond": 0.64,
        "commodity": 0.09,
        "alternative": 0.09,
    }
    out = enforce_class_weight_budget(
        w,
        tickers,
        universe,
        budget,
        active_tickers=tickers[:11],
        max_weight=0.30,
    )
    assert float(out.max()) <= 0.30 + 1e-4
    totals = class_sleeve_totals(out, tickers, universe)
    assert totals["equity"] < 0.40
    assert totals["bond"] > 0.50


def test_risk_off_simulation_equity_sleeve_not_dominant() -> None:
    tickers, universe = _multi_class_universe()
    dates = pd.bdate_range("2016-01-01", periods=520)
    rng = np.random.default_rng(21)
    prices = pd.DataFrame(
        {
            t: 100
            * np.cumprod(
                1
                + rng.normal(
                    0.0006 if universe[t]["asset_class"] == "equity" else 0.0001,
                    0.012,
                    len(dates),
                )
            )
            for t in tickers
        },
        index=dates,
    )
    bench = prices["EQ1"].pct_change().fillna(0.0)
    regime_resolver, timeline, _ = build_active_regime_resolver(
        bench, regime_mode="risk_off"
    )
    budget_by_regime = {
        "risk_off": {
            "equity": 0.18,
            "bond": 0.64,
            "commodity": 0.09,
            "alternative": 0.09,
        },
        "neutral": {"equity": 0.50, "bond": 0.50},
        "risk_on": {"equity": 0.85, "bond": 0.15},
    }
    class_resolver = build_class_budget_resolver(regime_resolver, budget_by_regime)
    metrics = simulate_dynamic_portfolio(
        prices,
        report_start="2017-01-01",
        spec=BacktestSpec(rebalance_rule="QE", fee_bps=0.0, max_holdings=11),
        max_weight=0.30,
        min_weight=0.0,
        allocator=AllocatorParams(mode="mean_variance", lookback_days=126),
        factor_params=FactorParams(lookback_days=126, w_mom=1.0, w_lowvol=0.5),
        top_n=11,
        universe_by_ticker=universe,
        class_budget_resolver=class_resolver,
        enforce_class_weights=True,
    )
    wh = metrics.get("weight_history") or []
    assert wh
    exp = exposure_by_regime_from_weight_history(wh, universe, timeline)
    risk_off_eq = exp.get("risk_off", {}).get("equity", 1.0)
    assert risk_off_eq < 0.45, f"risk_off equity sleeve {risk_off_eq:.1%} too high"
    assert exp.get("risk_off", {}).get("bond", 0.0) > 0.35
    cap_audit = metrics.get("weight_cap_audit") or {}
    assert not cap_audit.get("violation"), cap_audit
