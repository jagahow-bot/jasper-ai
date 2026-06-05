"""Tests for GET /jobs history listing and disk persistence."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import job_history
from app import jobs as job_service
from app.models import (
    BacktestRequest,
    BacktestResult,
    JobProgress,
    JobStatus,
    JobSummary,
    Objective,
    OptimizationMode,
    PortfolioCandidate,
)
from main import app

client = TestClient(app)


def _sample_request() -> BacktestRequest:
    return BacktestRequest(
        scenario_id="custom",
        start_date="2018-01-01",
        end_date="2024-12-31",
        asset_classes=["equity"],
        objective=Objective.max_sharpe,
        max_weight=0.25,
        max_turnover=0.5,
        top_n=10,
        trials=5,
        top_models=1,
        optimization_mode=OptimizationMode.standard,
    )


def _sample_result(job_id: str) -> BacktestResult:
    return BacktestResult(
        job_id=job_id,
        scenario_id="custom",
        benchmark="SPY",
        period={"start": "2018-01-01", "end": "2024-12-31"},
        candidates=[
            PortfolioCandidate(
                rank=1,
                model_code="M0001",
                is_champion=True,
                weights={"SPY": 1.0},
                sharpe=1.25,
                max_drawdown=-0.12,
                cagr=0.11,
                volatility=0.15,
            )
        ],
        equity_curve=[],
        efficient_frontier=[],
        narrative_facts={"champion_model_code": "M0001", "trials_completed": 5},
    )


@pytest.fixture
def isolated_history(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("JOB_HISTORY_DIR", str(tmp_path))
    job_history.reset_history_cache_for_tests()
    job_service._jobs.clear()
    yield tmp_path
    job_history.reset_history_cache_for_tests()
    job_service._jobs.clear()


def test_list_jobs_empty(isolated_history: Path) -> None:
    res = client.get("/jobs")
    assert res.status_code == 200
    assert res.json() == []


def test_persist_and_list_job_summary(isolated_history: Path) -> None:
    job_id = "hist-job-001"
    req = _sample_request()
    result = _sample_result(job_id)
    job_service._jobs[job_id] = {
        "request": req,
        "progress": JobProgress(status=JobStatus.completed, message="done"),
        "result": result,
        "report_cache": None,
        "error": None,
    }
    job_history.persist_completed_job(job_id, req, result)

    res = client.get("/jobs?limit=10")
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 1
    row = body[0]
    assert row["job_id"] == job_id
    assert row["status"] == "completed"
    assert row["champion_model_code"] == "M0001"
    assert row["champion_sharpe"] == pytest.approx(1.25)
    assert row["optimization_mode"] == "standard"


def test_reload_job_from_disk_after_memory_eviction(isolated_history: Path) -> None:
    job_id = "hist-job-reload"
    req = _sample_request()
    result = _sample_result(job_id)
    job_history.persist_completed_job(job_id, req, result)
    job_service._jobs.pop(job_id, None)

    prog = client.get(f"/jobs/{job_id}/progress")
    assert prog.status_code == 200
    assert prog.json()["status"] == "completed"

    req_res = client.get(f"/jobs/{job_id}/request")
    assert req_res.status_code == 200
    assert req_res.json()["start_date"] == "2018-01-01"

    result_res = client.get(f"/jobs/{job_id}/result")
    assert result_res.status_code == 200
    assert result_res.json()["job_id"] == job_id
    assert result_res.json()["candidates"][0]["model_code"] == "M0001"


def test_index_survives_simulated_restart(isolated_history: Path) -> None:
    """Simulate redeploy: in-memory cache cleared, index reloads from disk."""
    job_id = "hist-restart-001"
    req = _sample_request()
    result = _sample_result(job_id)
    job_history.persist_completed_job(job_id, req, result)

    job_history.reset_history_cache_for_tests()
    assert (isolated_history / "index.json").is_file()
    assert (isolated_history / f"{job_id}.json").is_file()

    summaries = job_history.list_job_summaries()
    assert len(summaries) == 1
    assert summaries[0].job_id == job_id

    res = client.get("/jobs?limit=10")
    assert res.status_code == 200
    assert res.json()[0]["job_id"] == job_id

    loaded = job_history.load_persisted_job(job_id)
    assert loaded is not None
    loaded_req, loaded_result = loaded
    assert loaded_req.start_date == "2018-01-01"
    assert loaded_result.candidates[0].model_code == "M0001"


def test_build_summary_model() -> None:
    job_id = "x"
    req = _sample_request()
    req.optimization_mode = OptimizationMode.pro_auto
    result = _sample_result(job_id)
    summary = job_history.build_summary(job_id, req, result)
    assert isinstance(summary, JobSummary)
    assert summary.optimization_mode == "pro_auto"
