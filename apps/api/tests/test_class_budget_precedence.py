"""Explicit user constraints (fixed param_controls / class budgets) must win over
AI round seeds and over the anchor-drift projection.

Regression coverage for job 0f82afd8: a customized Pro run pinned w_equity=0.15 /
w_bond=0.75 with enforce_class_weights=True, yet every portfolio landed ~80% equity
because (a) the AI round_setup's customization_drift_actual=0.2 overrode the user's
fixed 1.0, and (b) the anchor L1-drift projection ran after class-budget enforcement.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.engine.allocator import AllocatorParams
from app.engine.asset_class_policy import (
    ALL_ALLOC_WEIGHT_KEYS,
    class_sleeve_totals,
    find_infeasible_class_quotas,
)
from app.engine.factors import FactorParams
from app.engine.param_bounds import RunBlueprint
from app.engine.param_taxonomy import build_pro_round_param_controls
from app.engine.portfolio import simulate_dynamic_portfolio
from app.engine.spec import BacktestSpec


def _blueprint() -> RunBlueprint:
    return RunBlueprint(max_weight=0.2, max_turnover=0.8, top_n=20, max_holdings=15)


# ---------------------------------------------------------------------------
# Fix A: user-fixed param_controls take precedence over AI round_setup pins
# ---------------------------------------------------------------------------


def test_user_fixed_drift_not_overridden_by_round_setup() -> None:
    controls = build_pro_round_param_controls(
        {"customization_drift_actual": {"mode": "fixed", "fixed": 1.0}},
        blueprint=_blueprint(),
        round_setup={"mode": "min_var", "customization_drift_actual": 0.2},
        factor_ranges={},
        factor_choices={},
    )
    assert controls["customization_drift_actual"]["mode"] == "fixed"
    assert float(controls["customization_drift_actual"]["fixed"]) == 1.0


def test_user_fixed_class_quotas_not_overridden_by_round_setup() -> None:
    controls = build_pro_round_param_controls(
        {
            "w_equity": {"mode": "fixed", "fixed": 0.15},
            "w_bond": {"mode": "fixed", "fixed": 0.75},
        },
        blueprint=_blueprint(),
        round_setup={"mode": "min_var", "w_equity": 0.6, "w_bond": 0.3},
        factor_ranges={},
        factor_choices={},
    )
    assert float(controls["w_equity"]["fixed"]) == 0.15
    assert float(controls["w_bond"]["fixed"]) == 0.75


def test_user_fixed_top_n_not_converted_to_search_range() -> None:
    controls = build_pro_round_param_controls(
        {"top_n_actual": {"mode": "fixed", "fixed": 12}},
        blueprint=_blueprint(),
        round_setup={"mode": "min_var", "top_n_actual": 15},
        factor_ranges={},
        factor_choices={},
    )
    assert controls["top_n_actual"]["mode"] == "fixed"
    assert int(controls["top_n_actual"]["fixed"]) == 12


def test_ai_pins_still_apply_for_unfixed_keys() -> None:
    controls = build_pro_round_param_controls(
        {"customization_drift_actual": {"mode": "fixed", "fixed": 1.0}},
        blueprint=_blueprint(),
        round_setup={"mode": "min_var", "lookback_days": 300, "max_weight_actual": 0.12},
        factor_ranges={},
        factor_choices={},
    )
    assert controls["lookback_days"]["fixed"] == 300
    assert float(controls["max_weight_actual"]["fixed"]) == 0.12
    assert controls["allocator_mode"]["fixed"] == "min_var"


def test_user_fixed_quota_applies_to_all_regimes() -> None:
    controls = build_pro_round_param_controls(
        {"w_equity": {"mode": "fixed", "fixed": 0.15}},
        blueprint=_blueprint(),
        round_setup={"mode": "min_var"},
        factor_ranges={},
        factor_choices={},
        regime_setups={
            "risk_off": {"mode": "min_var", "lookback_days": 252, "shrinkage": 0.1, "risk_aversion": 3.0},
            "neutral": {"mode": "min_var", "lookback_days": 252, "shrinkage": 0.1, "risk_aversion": 3.0},
            "risk_on": {"mode": "min_var", "lookback_days": 252, "shrinkage": 0.1, "risk_aversion": 3.0},
        },
        regime_class_quotas={
            "risk_off": {"equity": 0.4, "bond": 0.6},
            "neutral": {"equity": 0.6, "bond": 0.4},
            "risk_on": {"equity": 0.8, "bond": 0.2},
        },
    )
    for regime in ("risk_off", "neutral", "risk_on"):
        key = f"{regime}__w_equity"
        assert float(controls[key]["fixed"]) == 0.15, key
    # Bond was not user-fixed → AI per-regime quota still applies.
    assert float(controls["risk_on__w_bond"]["fixed"]) == 0.2


# ---------------------------------------------------------------------------
# Fix B1: class-budget enforcement runs after the anchor drift projection
# ---------------------------------------------------------------------------


def _universe() -> dict[str, dict[str, str]]:
    return {
        "EQ1": {"asset_class": "equity"},
        "EQ2": {"asset_class": "equity"},
        "BD1": {"asset_class": "bond"},
        "BD2": {"asset_class": "bond"},
        "BD3": {"asset_class": "bond"},
    }


def test_class_budget_wins_over_conflicting_anchor_drift() -> None:
    """100%-equity anchor + tight drift must not drag a 25/75 book back to equity."""
    universe = _universe()
    tickers = list(universe.keys())
    dates = pd.bdate_range("2020-01-01", periods=320)
    rng = np.random.default_rng(7)
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
    out = simulate_dynamic_portfolio(
        prices=prices,
        report_start="2020-07-01",
        spec=BacktestSpec(rebalance_rule="QE", fee_bps=0.0, max_holdings=5),
        max_weight=0.35,
        min_weight=0.0,
        allocator=AllocatorParams(mode="mean_variance", lookback_days=126),
        factor_params=FactorParams(lookback_days=126, w_mom=1.0),
        top_n=5,
        universe_by_ticker=universe,
        class_budget={"bond": 0.75, "equity": 0.25},
        enforce_class_weights=True,
        anchor_weights={"EQ1": 0.6, "EQ2": 0.4},
        customization_drift=0.2,
    )
    totals = class_sleeve_totals(
        np.asarray(out["last_weights"], dtype=float), tickers, universe
    )
    assert abs(totals.get("bond", 0.0) - 0.75) < 0.08
    assert abs(totals.get("equity", 0.0) - 0.25) < 0.08


# ---------------------------------------------------------------------------
# Fix D: cap-feasibility precheck for class quotas
# ---------------------------------------------------------------------------


def test_find_infeasible_class_quotas_flags_short_sleeve() -> None:
    universe = {"SGOV": {"asset_class": "bond"}, "VCIT": {"asset_class": "bond"}}
    out = find_infeasible_class_quotas({"bond": 0.75}, universe, 0.12)
    assert len(out) == 1
    row = out[0]
    assert row["asset_class"] == "bond"
    assert row["required_names"] == 7
    assert row["available_names"] == 2
    assert abs(row["feasible_max_pct"] - 0.24) < 1e-9


def test_find_infeasible_class_quotas_passes_with_enough_members() -> None:
    universe = {f"BD{i}": {"asset_class": "bond"} for i in range(8)}
    assert find_infeasible_class_quotas({"bond": 0.75}, universe, 0.12) == []


def test_find_infeasible_class_quotas_ignores_uncapped_or_empty() -> None:
    universe = {"SGOV": {"asset_class": "bond"}}
    assert find_infeasible_class_quotas({"bond": 0.9}, universe, None) == []
    assert find_infeasible_class_quotas({"bond": 0.9}, universe, 1.0) == []
    assert find_infeasible_class_quotas({}, universe, 0.12) == []
    assert find_infeasible_class_quotas({"bond": 0.9}, None, 0.12) == []


# ---------------------------------------------------------------------------
# Fix C: round_setup response schema carries optional w_* quota keys (static only)
# ---------------------------------------------------------------------------


def test_round_seed_schema_includes_optional_quota_keys_static() -> None:
    from app.engine.ai_params import _round_seed_response_schema

    schema = _round_seed_response_schema(require_rationale=True)
    setup = schema["properties"]["round_setup"]
    for key in ALL_ALLOC_WEIGHT_KEYS:
        assert key in setup["properties"], key
        assert key not in setup["required"]


def test_round_seed_schema_omits_quota_keys_when_dynamic_or_compact() -> None:
    from app.engine.ai_params import _round_seed_response_schema

    dynamic = _round_seed_response_schema(include_regime_matrix=True)
    compact = _round_seed_response_schema(compact=True)
    for schema in (dynamic, compact):
        setup = schema["properties"]["round_setup"]
        for key in ALL_ALLOC_WEIGHT_KEYS:
            assert key not in setup["properties"], key
