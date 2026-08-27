"""Warm-start champion seeding from registry."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pandas as pd
import pytest

from app.champion_registry import record_champion, reset_registry_for_tests
from app.engine.backtest import _run_iterative_search
from app.engine.refinement import params_for_champion_seed
from app.models import BacktestRequest, Objective, OptimizationMode


def _sample_request(**overrides) -> BacktestRequest:
    base = {
        "scenario_id": "growth",
        "start_date": "2020-01-01",
        "end_date": "2023-12-31",
        "asset_classes": ["equity"],
        "objective": Objective.max_sharpe,
        "max_weight": 0.25,
        "max_turnover": 0.5,
        "top_n": 10,
        "trials": 5,
        "top_models": 5,
        "optimization_mode": OptimizationMode.pro_auto,
        "refinement_batch_size": 3,
        "refinement_challengers_per_round": 2,
        "refinement_max_rounds": 1,
    }
    base.update(overrides)
    return BacktestRequest(**base)


@pytest.fixture
def isolated_registry(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("CHAMPION_REGISTRY_PATH", str(tmp_path / "champions.db"))
    reset_registry_for_tests()
    yield
    reset_registry_for_tests()


@pytest.fixture
def tiny_prices() -> pd.DataFrame:
    idx = pd.date_range("2020-01-01", periods=120, freq="B")
    return pd.DataFrame(
        {
            "AAA": 100 + pd.Series(range(len(idx))).values * 0.01,
            "BBB": 50 + pd.Series(range(len(idx))).values * 0.02,
            "CCC": 80 + pd.Series(range(len(idx))).values * 0.015,
            "DDD": 60 + pd.Series(range(len(idx))).values * 0.01,
            "EEE": 40 + pd.Series(range(len(idx))).values * 0.012,
        },
        index=idx,
    )


def test_standard_mode_passes_registry_seed_to_optuna(
    isolated_registry: None,
    tiny_prices: pd.DataFrame,
) -> None:
    req = _sample_request(optimization_mode=OptimizationMode.standard, trials=5)
    cached_params = {"mode": "risk_parity", "lookback_days": 252, "shrinkage": 0.1}
    record_champion(
        req,
        "prior-job",
        cached_params,
        "M0010",
        "max_sharpe",
        objective_score=1.1,
    )
    captured: dict = {}

    class FakeStudy:
        def enqueue_trial(self, seed: dict) -> None:
            captured["seed"] = seed

        def optimize(self, _objective, *, n_trials: int, **_kwargs) -> None:
            captured["n_trials"] = n_trials

    with patch("app.engine.optimizer.optuna.create_study", return_value=FakeStudy()):
        from app.engine.optimizer import run_optuna_search

        with pytest.raises(ValueError, match="No feasible"):
            run_optuna_search(
                tiny_prices,
                max_weight=0.5,
                max_turnover=0.5,
                top_n=2,
                objective="max_sharpe",
                trials=5,
                champion_seed=params_for_champion_seed(cached_params),
            )

    assert captured["n_trials"] == 6
    assert captured["seed"]["allocator_mode"] == "risk_parity"
    assert "model_code" not in captured["seed"]


def test_pro_initial_champion_enqueues_seed_on_round_one(tiny_prices: pd.DataFrame) -> None:
    """initial_champion_record should produce champion_seed in round 1."""
    req = _sample_request()
    initial = (
        1.2,
        {"mode": "risk_parity", "lookback_days": 252, "model_code": "M0099"},
        {"sharpe": 1.2, "cagr": 0.1, "max_drawdown": -0.05, "raw_score": 1.2},
    )
    captured_seeds: list[dict | None] = []

    def fake_optuna(*_args, **kwargs):
        captured_seeds.append(kwargs.get("champion_seed"))
        return [
            (
                1.3,
                {"mode": "risk_parity", "lookback_days": 126, "optuna_trial_number": 1},
                {"sharpe": 1.3, "objective_value_is": 1.3},
            )
        ]

    with (
        patch("app.engine.backtest.run_optuna_search", side_effect=fake_optuna),
        patch("app.engine.backtest.generate_ai_round_seed", return_value=_fake_seed()),
        patch("app.engine.backtest.generate_ai_round_champion", return_value={}),
        patch("app.engine.backtest._ensure_pool_full_sims_for_champion"),
        patch("app.engine.backtest.benchmark_metrics", return_value={"sharpe": 0.5}),
    ):
        from app.engine.spec import BacktestSpec

        _run_iterative_search(
            req,
            prices=tiny_prices,
            prices_sim_panel=tiny_prices,
            prices_train=tiny_prices,
            prices_val=tiny_prices.iloc[0:0],
            oos=False,
            objective_effective="max_sharpe",
            rebalance_rule="ME",
            spec=BacktestSpec(),
            universe_by_ticker={},
            param_controls_dict={},
            report_progress=lambda *_a, **_k: None,
            initial_champion_record=initial,
        )

    assert captured_seeds and captured_seeds[0] is not None
    assert captured_seeds[0]["lookback_days"] == 252
    assert "model_code" not in captured_seeds[0]


def _fake_seed() -> dict:
    return {
        "enabled": True,
        "rationale": "seed",
        "round_setup": {
            "mode": "risk_parity",
            "lookback_days": 252,
            "risk_aversion": 3.0,
            "top_n_actual": 5,
            "max_weight_actual": 0.2,
            "max_turnover_actual": 0.4,
        },
        "factor_ranges": {},
        "factor_choices": {},
    }


def test_lookup_returns_cached_champion_for_warm_start(isolated_registry: None) -> None:
    from app.champion_registry import lookup_champion

    req = _sample_request()
    record_champion(
        req,
        "warm-job",
        {"mode": "risk_parity", "lookback_days": 252},
        "M0022",
        "max_sharpe",
        objective_score=0.88,
    )
    cached = lookup_champion(req)
    assert cached is not None
    assert cached.job_id == "warm-job"
    assert cached.model_code == "M0022"
    assert cached.match_type == "exact"
