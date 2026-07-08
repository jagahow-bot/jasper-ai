"""Champion registry persistence tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.champion_registry import lookup_champion, record_champion, reset_registry_for_tests
from app.models import BacktestMode, BacktestRequest, Objective, OptimizationMode


@pytest.fixture()
def registry_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db = tmp_path / "champions.db"
    monkeypatch.setenv("CHAMPION_REGISTRY_PATH", str(db))
    reset_registry_for_tests()
    yield db
    reset_registry_for_tests()


def _req() -> BacktestRequest:
    return BacktestRequest(
        scenario_id="reg-test",
        max_weight=0.2,
        objective=Objective.max_sharpe,
        backtest_mode=BacktestMode.static,
        start_date="2020-01-01",
        end_date="2024-12-31",
        trials=10,
        top_models=3,
        asset_classes=["equity"],
        enable_oos=True,
        train_ratio=0.7,
        fee_bps=10.0,
        rebalance_freq="QE",
        max_turnover=1.0,
        optimization_mode=OptimizationMode.standard,
    )


def test_record_and_lookup_champion(registry_db: Path):
    req = _req()
    wrote = record_champion(
        req,
        "job-1",
        {"model_code": "M1", "mode": "risk_parity"},
        "M1",
        "max_sharpe",
        sharpe=1.2,
        objective_score=1.2,
    )
    assert wrote is True
    cached = lookup_champion(req)
    assert cached is not None
    assert cached.job_id == "job-1"
    assert cached.model_code == "M1"
    assert cached.match_type == "exact"


def test_record_skips_regression(registry_db: Path):
    req = _req()
    record_champion(
        req,
        "job-1",
        {"model_code": "M1"},
        "M1",
        "max_sharpe",
        objective_score=1.5,
    )
    wrote = record_champion(
        req,
        "job-2",
        {"model_code": "M2"},
        "M2",
        "max_sharpe",
        objective_score=1.0,
    )
    assert wrote is False
    cached = lookup_champion(req)
    assert cached is not None
    assert cached.job_id == "job-1"


def test_fuzzy_lookup_when_end_date_differs(registry_db: Path):
    req_old = _req()
    record_champion(
        req_old,
        "job-prior",
        {"mode": "mean_variance", "lookback_days": 126},
        "M0007",
        "max_sharpe",
        objective_score=0.9,
    )
    req_new = BacktestRequest(
        **_req().model_dump()
        | {"end_date": "2025-06-30"}
    )
    cached = lookup_champion(req_new)
    assert cached is not None
    assert cached.match_type == "fuzzy"
    assert cached.job_id == "job-prior"
    assert cached.end_date == "2024-12-31"
