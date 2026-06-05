"""Lazy GET /jobs/{id}/candidates/{model_code}/charts for slim report candidates."""

from __future__ import annotations

from unittest.mock import patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app import jobs as job_service
from app.engine.report_sim_cache import TrialReportCache
from app.models import (
    BacktestRequest,
    BacktestResult,
    CandidateChartsPayload,
    JobProgress,
    JobStatus,
    Objective,
    PortfolioCandidate,
)
from main import app


def _minimal_sim(sharpe: float = 1.0, *, with_weights: bool = True) -> dict:
    idx = pd.date_range("2020-01-01", periods=80, freq="B")
    port_ret = pd.Series(0.0005, index=idx)
    equity = (1.0 + port_ret).cumprod()
    out = {
        "sharpe": sharpe,
        "max_drawdown": -0.1,
        "cagr": 0.12,
        "volatility": 0.15,
        "sortino": 1.1,
        "calmar": 1.0,
        "equity": equity,
        "port_ret": port_ret,
        "last_weights": [0.5, 0.5],
        "rebalance_count": 4,
        "rebalance_freq": "M",
        "rebalance_dates": [],
        "factor_summary": {},
    }
    if with_weights:
        out["weight_history"] = [{"date": "2020-01-01", "SPY": 1.0, "OTHER": 0.0}]
        out["weight_history_tickers"] = ["SPY"]
    return out


def _slim_candidate(model_code: str, rank: int) -> PortfolioCandidate:
    return PortfolioCandidate(
        rank=rank,
        model_code=model_code,
        weights={"SPY": 1.0},
        sharpe=1.0,
        max_drawdown=-0.1,
        cagr=0.1,
        volatility=0.15,
        equity_curve=None,
        params={
            "model_code": model_code,
            "mode": "mean_variance",
            "lookback_days": 252,
            "shrinkage": 0.1,
            "risk_aversion": 2.0,
            "max_weight_actual": 0.25,
            "top_n_actual": 3,
            "rebalance_freq": "M",
        },
        analytics={"sample_metrics": {"in_sample": {"sharpe": 1.0}}},
    )


def _full_charts_payload(model_code: str) -> CandidateChartsPayload:
    return CandidateChartsPayload(
        model_code=model_code,
        equity_curve=[{"date": "2020-01-01", "value": 100.0}],
        weight_history=[{"date": "2020-01-01", "SPY": 1.0, "OTHER": 0.0}],
        weight_history_tickers=["SPY"],
        benchmark_equity_curve=[{"date": "2020-01-01", "value": 100.0}],
    )


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_lazy_get_returns_curves_for_slim_m0005(client: TestClient):
    job_id = "test-lazy-charts-m0005"
    req = BacktestRequest(
        scenario_id="s1",
        start_date="2020-01-01",
        end_date="2024-01-01",
        asset_classes=["equity"],
        objective=Objective.max_sharpe,
        max_weight=0.25,
        max_turnover=0.5,
        top_n=10,
        trials=5,
        top_models=3,
    )
    champ = _slim_candidate("M0001", 1)
    champ.equity_curve = [{"date": "2020-01-01", "value": 100.0}]
    champ.analytics = {
        "sample_metrics": {"in_sample": {"sharpe": 1.2}},
        "weight_history": [{"date": "2020-01-01", "SPY": 1.0, "OTHER": 0.0}],
        "weight_history_tickers": ["SPY"],
        "benchmark_equity_curve": [{"date": "2020-01-01", "value": 100.0}],
    }
    slim = _slim_candidate("M0005", 2)
    result = BacktestResult(
        job_id=job_id,
        scenario_id="s1",
        benchmark="SPY",
        period={"start": "2020-01-01", "end": "2024-01-01"},
        candidates=[champ, slim],
        equity_curve=[{"date": "2020-01-01", "value": 100.0}],
        efficient_frontier=[],
        narrative_facts={"objective": "max_sharpe", "champion_model_code": "M0001"},
    )
    cache = TrialReportCache()
    params = dict(slim.params or {})
    full_m = _minimal_sim(0.9, with_weights=True)
    cache.stash_from_trial(params, train_m=full_m, val_m=None, full_m=full_m)

    job_service._jobs[job_id] = {
        "request": req,
        "progress": JobProgress(status=JobStatus.completed, message="done"),
        "result": result,
        "report_cache": cache,
        "error": None,
    }

    with patch(
        "app.candidate_charts.rebuild_candidate_charts",
        return_value=_full_charts_payload("M0005"),
    ) as rebuild_mock:
        res = client.get(f"/jobs/{job_id}/candidates/M0005/charts")

    assert res.status_code == 200
    body = res.json()
    assert body["model_code"] == "M0005"
    assert len(body["equity_curve"]) == 1
    assert len(body["weight_history"]) == 1
    assert body["weight_history_tickers"] == ["SPY"]
    rebuild_mock.assert_called_once()

    patched = job_service.get_result(job_id)
    m0005 = next(c for c in patched.candidates if c.model_code == "M0005")
    assert m0005.equity_curve
    assert m0005.analytics and m0005.analytics.get("weight_history")


def test_lazy_get_404_unknown_model(client: TestClient):
    job_id = "test-lazy-charts-missing"
    req = BacktestRequest(
        scenario_id="s1",
        start_date="2020-01-01",
        end_date="2024-01-01",
        asset_classes=["equity"],
        objective=Objective.max_sharpe,
        max_weight=0.25,
        max_turnover=0.5,
        top_n=10,
        trials=5,
        top_models=1,
    )
    result = BacktestResult(
        job_id=job_id,
        scenario_id="s1",
        benchmark="SPY",
        period={"start": "2020-01-01", "end": "2024-01-01"},
        candidates=[_slim_candidate("M0001", 1)],
        equity_curve=[],
        efficient_frontier=[],
        narrative_facts={},
    )
    job_service._jobs[job_id] = {
        "request": req,
        "progress": JobProgress(status=JobStatus.completed, message="done"),
        "result": result,
        "report_cache": None,
        "error": None,
    }
    res = client.get(f"/jobs/{job_id}/candidates/M9999/charts")
    assert res.status_code == 404
