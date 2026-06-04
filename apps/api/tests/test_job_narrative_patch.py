"""PATCH narrative_facts on completed jobs (AI compare champion persistence)."""

from app import jobs as job_service
from app.models import BacktestRequest, JobProgress, JobStatus, Objective


class _FakeResult:
    def __init__(self) -> None:
        self.narrative_facts: dict = {"champion_model_code": "M0001"}


def test_patch_narrative_facts_merges_ai_champion():
    job_id = "test-job-narrative-patch"
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
    job_service._jobs[job_id] = {
        "request": req,
        "progress": JobProgress(status=JobStatus.completed, message="done"),
        "result": _FakeResult(),
        "error": None,
    }
    ok = job_service.patch_narrative_facts(
        job_id,
        {
            "ai_recommended_model_code": "M0009",
            "ai_champion_model_code": "M0009",
        },
    )
    assert ok is True
    facts = job_service.get_result(job_id).narrative_facts
    assert facts["ai_champion_model_code"] == "M0009"
    assert facts["champion_model_code"] == "M0001"
