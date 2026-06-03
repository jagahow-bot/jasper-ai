"""Integration: Pro refinement loop with mocked Optuna rounds."""

from __future__ import annotations

import sys
from types import ModuleType
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

if "optuna" not in sys.modules:
    _optuna_stub = ModuleType("optuna")
    _optuna_stub.Trial = MagicMock()
    _optuna_stub.create_study = MagicMock()
    _optuna_logging = ModuleType("optuna.logging")
    _optuna_logging.WARNING = 30
    _optuna_logging.set_verbosity = lambda *_a, **_k: None
    _optuna_stub.logging = _optuna_logging
    sys.modules["optuna"] = _optuna_stub
    sys.modules["optuna.logging"] = _optuna_logging

from app.engine.backtest import _run_iterative_search
from app.engine.refinement import model_signature
from app.models import BacktestRequest, Objective, OptimizationMode


def _fake_round_seed(**_kwargs):
    return {
        "enabled": True,
        "rationale": "test seed",
        "round_setup": {
            "mode": "risk_parity",
            "lookback_days": 252,
            "risk_aversion": 3.0,
            "top_n_actual": 5,
            "max_weight_actual": 0.2,
            "max_turnover_actual": 0.4,
            "w_equity": 0.7,
            "w_bond": 0.3,
        },
        "factor_ranges": {"w_mom": [0.5, 1.5]},
        "factor_choices": {"mom_indicator": "risk_adjusted_return"},
    }


def _trial(
    portfolio_id: int,
    objective_is: float,
    *,
    bounds_violations: list | None = None,
) -> tuple[float, dict, dict]:
    params: dict = {"mode": "risk_parity", "portfolio_id": portfolio_id}
    if bounds_violations is not None:
        params["bounds_violations"] = bounds_violations
    metrics = {"objective_value_is": objective_is, "sharpe": objective_is}
    return (objective_is, params, metrics)


def _minimal_request(**overrides) -> BacktestRequest:
    base = {
        "scenario_id": "test-pro-refinement",
        "asset_classes": ["equity"],
        "universe_categories": [],
        "universe_tickers": [],
        "universe_filter_text": "",
        "start_date": "2020-01-01",
        "end_date": "2023-12-31",
        "train_ratio": 0.7,
        "objective": Objective.max_sharpe,
        "objective_custom_text": "",
        "optimization_mode": OptimizationMode.pro_auto,
        "trials": 5,
        "top_models": 5,
        "max_weight": 0.25,
        "max_turnover": 0.5,
        "top_n": 10,
        "rebalance_freq": "monthly",
        "refinement_batch_size": 5,
        "refinement_challengers_per_round": 4,
        "refinement_max_rounds": 3,
        "refinement_patience": 2,
        "refinement_min_improvement": 0.01,
        "param_controls": {},
    }
    base.update(overrides)
    return BacktestRequest(**base)


@pytest.fixture
def price_panel() -> pd.DataFrame:
    idx = pd.date_range("2020-01-01", periods=400, freq="B")
    data = {
        "AAA": 100 + pd.Series(range(len(idx))).values * 0.01,
        "BBB": 50 + pd.Series(range(len(idx))).values * 0.02,
        "CCC": 80 + pd.Series(range(len(idx))).values * 0.015,
        "DDD": 60 + pd.Series(range(len(idx))).values * 0.01,
        "EEE": 40 + pd.Series(range(len(idx))).values * 0.012,
    }
    return pd.DataFrame(data, index=idx)


def test_iterative_search_excludes_round1_loser_from_round3(price_panel: pd.DataFrame):
    """m0001 loses R1; m0006 wins R2; m0001 must not appear in R3 pool_signatures."""
    round_outputs = [
        [
            _trial(1, 0.50, bounds_violations=[{"field": "w_mom"}]),
            _trial(2, 0.95),
            _trial(3, 0.60),
            _trial(4, 0.55),
            _trial(5, 0.52),
        ],
        [
            _trial(6, 0.96),
            _trial(7, 0.75),
            _trial(8, 0.72),
            _trial(9, 0.71),
        ],
        [
            _trial(1, 0.88),
            _trial(10, 0.68),
            _trial(11, 0.69),
            _trial(12, 0.67),
        ],
    ]
    call_idx = {"n": 0}

    def fake_optuna(*_args, **_kwargs):
        idx = call_idx["n"]
        call_idx["n"] += 1
        return round_outputs[idx]

    def fake_ai(**_kwargs):
        return _fake_round_seed()

    req = _minimal_request()
    prices_train = price_panel.iloc[:280]
    prices_val = price_panel.iloc[280:]

    with (
        patch("app.engine.backtest.run_optuna_search", side_effect=fake_optuna),
        patch("app.engine.backtest.generate_ai_round_seed", side_effect=fake_ai),
    ):
        _records, _history, meta = _run_iterative_search(
            req,
            prices_train=prices_train,
            prices_val=prices_val,
            oos=False,
            objective_effective="max_sharpe",
            rebalance_rule="monthly",
            spec=__import__("app.engine.spec", fromlist=["DEFAULT_SPEC"]).DEFAULT_SPEC,
            universe_by_ticker={},
            param_controls_dict={},
            report_progress=lambda *_a, **_k: None,
        )

    per_round = meta["per_round"]
    assert len(per_round) == 3

    r1_records = per_round[0]["records"]
    assert [r[1]["portfolio_id"] for r in r1_records] == [1, 2, 3, 4, 5]
    assert [round(r[0], 2) for r in r1_records] == [0.5, 0.95, 0.6, 0.55, 0.52]

    r1_sigs = set(per_round[0]["pool_signatures"])
    r3_sigs = set(per_round[2]["pool_signatures"])
    m0001_sig = model_signature({"mode": "risk_parity", "portfolio_id": 1})
    m0006_sig = model_signature({"mode": "risk_parity", "portfolio_id": 6})

    assert m0001_sig in r1_sigs
    assert m0001_sig not in r3_sigs
    assert m0006_sig in r3_sigs
    assert per_round[1]["round_winner_params"]["portfolio_id"] == 6

    r2_codes = set(per_round[1].get("pool_model_codes") or [])
    r3_codes = set(per_round[2].get("pool_model_codes") or [])
    assert r2_codes
    assert r3_codes
    r2_winner = per_round[1].get("round_winner_model_code")
    r2_incoming = per_round[1].get("incoming_champion_model_code")
    r2_losers = {
        c
        for c in r2_codes
        if c and c not in {r2_winner, r2_incoming}
    }
    for loser_code in r2_losers:
        assert loser_code not in r3_codes


def test_five_round_final_pool_excludes_early_losers(price_panel: pd.DataFrame):
    """After 5 rounds, final round pool must not include round 1-4 loser codes."""
    round_outputs = [
        [
            _trial(1, 0.50),
            _trial(2, 0.95),
            _trial(3, 0.60),
            _trial(4, 0.55),
            _trial(5, 0.52),
        ],
        [_trial(6, 0.96), _trial(7, 0.75), _trial(8, 0.72), _trial(9, 0.71)],
        [_trial(10, 0.98), _trial(11, 0.80), _trial(12, 0.78), _trial(13, 0.77)],
        [_trial(14, 0.99), _trial(15, 0.85), _trial(16, 0.84), _trial(17, 0.83)],
        [_trial(18, 1.00), _trial(19, 0.86), _trial(20, 0.85), _trial(21, 0.84)],
    ]
    call_idx = {"n": 0}

    def fake_optuna(*_args, **_kwargs):
        idx = call_idx["n"]
        call_idx["n"] += 1
        return round_outputs[idx]

    def fake_ai(**_kwargs):
        return _fake_round_seed()

    req = _minimal_request(
        refinement_max_rounds=5,
        refinement_challengers_per_round=4,
        refinement_patience=10,
    )
    prices_train = price_panel.iloc[:280]
    prices_val = price_panel.iloc[280:]

    with (
        patch("app.engine.backtest.run_optuna_search", side_effect=fake_optuna),
        patch("app.engine.backtest.generate_ai_round_seed", side_effect=fake_ai),
    ):
        _records, _history, meta = _run_iterative_search(
            req,
            prices_train=prices_train,
            prices_val=prices_val,
            oos=False,
            objective_effective="max_sharpe",
            rebalance_rule="monthly",
            spec=__import__("app.engine.spec", fromlist=["DEFAULT_SPEC"]).DEFAULT_SPEC,
            universe_by_ticker={},
            param_controls_dict={},
            report_progress=lambda *_a, **_k: None,
        )

    per_round = meta["per_round"]
    assert len(per_round) == 5

    r1_codes = set(per_round[0].get("pool_model_codes") or [])
    r1_winner = per_round[0].get("round_winner_model_code")
    r1_losers = {c for c in r1_codes if c and c != r1_winner}

    r5 = per_round[4]
    r5_codes = set(r5.get("pool_model_codes") or [])
    r5_challengers = set(r5.get("round_challenger_model_codes") or [])
    r5_incoming = r5.get("incoming_champion_model_code")

    for loser_code in r1_losers:
        assert loser_code not in r5_codes
        assert loser_code not in r5_challengers

    assert r5_incoming in r5_codes
    assert r5_incoming not in r5_challengers
    assert r5_codes == {r5_incoming} | r5_challengers


def _assert_per_round_pool_matches_records(per_round: list[dict]) -> None:
    for pr in per_round:
        pool = set(pr.get("pool_model_codes") or [])
        record_codes = {
            str(rec[1].get("model_code"))
            for rec in (pr.get("records") or [])
            if rec[1].get("model_code")
        }
        assert pool == record_codes, (
            f"Round {pr.get('round')}: pool_model_codes {sorted(pool)} "
            f"!= record codes {sorted(record_codes)}"
        )
        incoming = pr.get("incoming_champion_model_code")
        winner = pr.get("round_winner_model_code")
        challengers = list(pr.get("round_challenger_model_codes") or [])
        if incoming:
            assert incoming in pool
        if winner:
            assert winner in pool
        assert set(challengers).issubset(pool)
        if incoming and challengers:
            assert pool == {incoming} | set(challengers)


def test_recycled_loser_excluded_from_later_round_pool_codes(price_panel: pd.DataFrame):
    """Optuna may re-propose a prior loser; it must not appear in later pool metadata."""
    round_outputs = [
        [_trial(1, 0.99), _trial(2, 0.50), _trial(3, 0.60), _trial(4, 0.55), _trial(5, 0.52)],
        [_trial(6, 0.70), _trial(7, 0.75), _trial(8, 0.72), _trial(9, 0.71)],
        [_trial(6, 0.88), _trial(10, 0.68), _trial(11, 0.69), _trial(12, 0.67)],
    ]
    call_idx = {"n": 0}

    def fake_optuna(*_args, **_kwargs):
        idx = call_idx["n"]
        call_idx["n"] += 1
        return round_outputs[idx]

    def fake_ai(**_kwargs):
        return _fake_round_seed()

    req = _minimal_request()
    prices_train = price_panel.iloc[:280]
    prices_val = price_panel.iloc[280:]

    with (
        patch("app.engine.backtest.run_optuna_search", side_effect=fake_optuna),
        patch("app.engine.backtest.generate_ai_round_seed", side_effect=fake_ai),
    ):
        _records, _history, meta = _run_iterative_search(
            req,
            prices_train=prices_train,
            prices_val=prices_val,
            oos=False,
            objective_effective="max_sharpe",
            rebalance_rule="monthly",
            spec=__import__("app.engine.spec", fromlist=["DEFAULT_SPEC"]).DEFAULT_SPEC,
            universe_by_ticker={},
            param_controls_dict={},
            report_progress=lambda *_a, **_k: None,
        )

    per_round = meta["per_round"]
    _assert_per_round_pool_matches_records(per_round)

    r2_losers = {
        c
        for c in (per_round[1].get("pool_model_codes") or [])
        if c
        not in {
            per_round[1].get("round_winner_model_code"),
            per_round[1].get("incoming_champion_model_code"),
        }
    }
    r3_pool = set(per_round[2].get("pool_model_codes") or [])
    for loser in r2_losers:
        assert loser not in r3_pool


def test_fixture_m0006_loser_absent_when_m0001_holds_champion(price_panel: pd.DataFrame):
    """Regression for job_188d36de: M0006 (R2 loser) must not reappear in R3+ pools."""
    round_outputs = [
        [_trial(1, 0.99), _trial(2, 0.50), _trial(3, 0.60), _trial(4, 0.55), _trial(5, 0.52)],
        [_trial(6, 0.70), _trial(7, 0.75), _trial(8, 0.72), _trial(9, 0.71)],
        [_trial(6, 0.88), _trial(10, 0.68), _trial(11, 0.69), _trial(12, 0.67)],
        [_trial(6, 0.87), _trial(13, 0.66), _trial(14, 0.65), _trial(15, 0.64)],
        [_trial(6, 0.86), _trial(16, 0.63), _trial(17, 0.62), _trial(18, 0.61)],
    ]
    call_idx = {"n": 0}

    def fake_optuna(*_args, **_kwargs):
        idx = call_idx["n"]
        call_idx["n"] += 1
        return round_outputs[idx]

    def fake_ai(**_kwargs):
        return _fake_round_seed()

    req = _minimal_request(
        refinement_max_rounds=5,
        refinement_challengers_per_round=4,
        refinement_patience=10,
    )
    prices_train = price_panel.iloc[:280]
    prices_val = price_panel.iloc[280:]

    with (
        patch("app.engine.backtest.run_optuna_search", side_effect=fake_optuna),
        patch("app.engine.backtest.generate_ai_round_seed", side_effect=fake_ai),
    ):
        _records, _history, meta = _run_iterative_search(
            req,
            prices_train=prices_train,
            prices_val=prices_val,
            oos=False,
            objective_effective="max_sharpe",
            rebalance_rule="monthly",
            spec=__import__("app.engine.spec", fromlist=["DEFAULT_SPEC"]).DEFAULT_SPEC,
            universe_by_ticker={},
            param_controls_dict={},
            report_progress=lambda *_a, **_k: None,
        )

    per_round = meta["per_round"]
    assert len(per_round) == 5
    _assert_per_round_pool_matches_records(per_round)

    r2_codes = set(per_round[1].get("pool_model_codes") or [])
    m0006_sig = model_signature({"mode": "risk_parity", "portfolio_id": 6})
    assert m0006_sig in set(per_round[1].get("pool_signatures") or [])

    for pr in per_round[2:]:
        pool = set(pr.get("pool_model_codes") or [])
        record_codes = {
            str(rec[1].get("model_code"))
            for rec in (pr.get("records") or [])
            if rec[1].get("model_code")
        }
        assert pool == record_codes
        for code in r2_codes:
            if code and code != per_round[1].get("round_winner_model_code"):
                assert code not in pool
        assert m0006_sig not in set(pr.get("pool_signatures") or [])


def test_round3_pool_size_incoming_plus_four_challengers(price_panel: pd.DataFrame):
    """Round 3 pool must contain 1 incoming + 4 challengers when champion is re-simulated."""
    challengers = 4
    round_outputs = [
        [
            _trial(1, 0.50, bounds_violations=[{"field": "w_mom"}]),
            _trial(2, 0.95),
            _trial(3, 0.60),
            _trial(4, 0.55),
            _trial(5, 0.52),
        ],
        [
            _trial(6, 0.96),
            _trial(7, 0.75),
            _trial(8, 0.72),
            _trial(9, 0.71),
        ],
        [
            _trial(6, 0.88),
            _trial(10, 0.68),
            _trial(11, 0.69),
            _trial(12, 0.67),
            _trial(13, 0.66),
        ],
    ]
    call_idx = {"n": 0}
    champion_seed_rounds: list[int] = []

    def fake_optuna(*_args, champion_seed=None, trials=0, **_kwargs):
        idx = call_idx["n"]
        call_idx["n"] += 1
        if champion_seed is not None:
            champion_seed_rounds.append(idx + 1)
            assert trials == challengers
        return round_outputs[idx]

    def fake_ai(**_kwargs):
        return _fake_round_seed()

    req = _minimal_request()
    prices_train = price_panel.iloc[:280]
    prices_val = price_panel.iloc[280:]

    with (
        patch("app.engine.backtest.run_optuna_search", side_effect=fake_optuna),
        patch("app.engine.backtest.generate_ai_round_seed", side_effect=fake_ai),
    ):
        _records, _history, meta = _run_iterative_search(
            req,
            prices_train=prices_train,
            prices_val=prices_val,
            oos=False,
            objective_effective="max_sharpe",
            rebalance_rule="monthly",
            spec=__import__("app.engine.spec", fromlist=["DEFAULT_SPEC"]).DEFAULT_SPEC,
            universe_by_ticker={},
            param_controls_dict={},
            report_progress=lambda *_a, **_k: None,
        )

    per_round = meta["per_round"]
    assert len(per_round) == 3
    assert champion_seed_rounds == [2, 3]

    r3 = per_round[2]
    pool_codes = list(r3.get("pool_model_codes") or [])
    challenger_codes = list(r3.get("round_challenger_model_codes") or [])
    incoming = r3.get("incoming_champion_model_code")

    assert len(pool_codes) == 1 + challengers
    assert len(challenger_codes) == challengers
    assert incoming in pool_codes
    assert set(pool_codes) == {incoming} | set(challenger_codes)
    _assert_per_round_pool_matches_records(per_round)


def test_five_round_pools_never_carry_prior_loser_codes(price_panel: pd.DataFrame):
    """Each round pool codes must equal record codes; early losers never reappear."""
    round_outputs = [
        [_trial(1, 0.50), _trial(2, 0.95), _trial(3, 0.60), _trial(4, 0.55), _trial(5, 0.52)],
        [_trial(6, 0.96), _trial(7, 0.75), _trial(8, 0.72), _trial(9, 0.71)],
        [_trial(10, 0.98), _trial(11, 0.80), _trial(12, 0.78), _trial(13, 0.77)],
        [_trial(14, 0.99), _trial(15, 0.85), _trial(16, 0.84), _trial(17, 0.83)],
        [_trial(18, 1.00), _trial(19, 0.86), _trial(20, 0.85), _trial(21, 0.84)],
    ]
    call_idx = {"n": 0}

    def fake_optuna(*_args, **_kwargs):
        idx = call_idx["n"]
        call_idx["n"] += 1
        return round_outputs[idx]

    def fake_ai(**_kwargs):
        return _fake_round_seed()

    req = _minimal_request(
        refinement_max_rounds=5,
        refinement_challengers_per_round=4,
        refinement_patience=10,
    )
    prices_train = price_panel.iloc[:280]
    prices_val = price_panel.iloc[280:]

    with (
        patch("app.engine.backtest.run_optuna_search", side_effect=fake_optuna),
        patch("app.engine.backtest.generate_ai_round_seed", side_effect=fake_ai),
    ):
        _records, _history, meta = _run_iterative_search(
            req,
            prices_train=prices_train,
            prices_val=prices_val,
            oos=False,
            objective_effective="max_sharpe",
            rebalance_rule="monthly",
            spec=__import__("app.engine.spec", fromlist=["DEFAULT_SPEC"]).DEFAULT_SPEC,
            universe_by_ticker={},
            param_controls_dict={},
            report_progress=lambda *_a, **_k: None,
        )

    per_round = meta["per_round"]
    assert len(per_round) == 5
    _assert_per_round_pool_matches_records(per_round)

    accumulated_losers: set[str] = set()
    for pr in per_round:
        pool = set(pr.get("pool_model_codes") or [])
        winner = pr.get("round_winner_model_code")
        incoming = pr.get("incoming_champion_model_code")
        for code in accumulated_losers:
            assert code not in pool
        round_losers = {
            c for c in pool if c and c not in {winner, incoming}
        }
        accumulated_losers.update(round_losers)
