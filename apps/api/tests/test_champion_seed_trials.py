"""Champion seed must not consume a challenger trial slot."""

from __future__ import annotations

from unittest.mock import patch

import pandas as pd
import pytest


@pytest.fixture
def tiny_prices() -> pd.DataFrame:
    idx = pd.date_range("2020-01-01", periods=120, freq="B")
    return pd.DataFrame(
        {
            "AAA": 100 + pd.Series(range(len(idx))).values * 0.01,
            "BBB": 50 + pd.Series(range(len(idx))).values * 0.02,
        },
        index=idx,
    )


def test_champion_seed_runs_extra_optuna_trial(tiny_prices: pd.DataFrame):
    captured: dict[str, int] = {}

    class FakeStudy:
        def enqueue_trial(self, _seed: dict) -> None:
            pass

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
                trials=4,
                champion_seed={"mode": "risk_parity", "lookback_days": 252},
            )

    assert captured["n_trials"] == 5


def test_no_champion_seed_uses_challenger_count_only(tiny_prices: pd.DataFrame):
    captured: dict[str, int] = {}

    class FakeStudy:
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
                trials=4,
                champion_seed=None,
            )

    assert captured["n_trials"] == 4
