from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app import jobs as job_service
from app.models import (
    BacktestRequest,
    BacktestResult,
    CandidateChartsPayload,
    ContinueJobRequest,
    JobProgress,
    JobSummary,
)


class NarrativeFactsPatch(BaseModel):
    patch: dict[str, Any] = Field(default_factory=dict)

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.post("", response_model=dict)
def create_backtest_job(req: BacktestRequest) -> dict:
    job_id = job_service.create_job(req)
    return {"job_id": job_id}


@router.post("/{job_id}/continue", response_model=dict)
def continue_backtest_job(job_id: str, body: ContinueJobRequest) -> dict:
    progress = job_service.get_progress(job_id)
    if not progress:
        raise HTTPException(status_code=404, detail="Job not found")
    if progress.status.value != "completed":
        raise HTTPException(status_code=409, detail="Prior job must be completed")
    try:
        new_job_id = job_service.continue_job(
            job_id,
            extra_refinement_rounds=body.extra_refinement_rounds,
            extra_trials_per_round=body.extra_trials_per_round,
            extra_trials=body.extra_trials,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"job_id": new_job_id, "continued_from": job_id}


@router.get("", response_model=list[JobSummary])
def list_backtest_jobs(limit: int = Query(default=30, ge=1, le=50)) -> list[JobSummary]:
    return job_service.list_jobs(limit=limit)


@router.get("/{job_id}/request", response_model=BacktestRequest)
def get_job_request(job_id: str) -> BacktestRequest:
    req = job_service.get_request(job_id)
    if not req:
        raise HTTPException(status_code=404, detail="Job not found")
    return req


@router.get("/{job_id}/progress", response_model=JobProgress)
def get_job_progress(job_id: str) -> JobProgress:
    progress = job_service.get_progress(job_id)
    if not progress:
        raise HTTPException(status_code=404, detail="Job not found")
    return progress


@router.get("/{job_id}/result", response_model=BacktestResult)
def get_job_result(job_id: str) -> BacktestResult:
    progress = job_service.get_progress(job_id)
    if not progress:
        raise HTTPException(status_code=404, detail="Job not found")
    if progress.status.value == "running" or progress.status.value == "pending":
        raise HTTPException(status_code=409, detail="Job still running")
    if progress.status.value == "failed":
        raise HTTPException(status_code=500, detail=progress.message)
    result = job_service.get_result(job_id)
    if not result:
        raise HTTPException(status_code=404, detail="Result not ready")
    return result


@router.get(
    "/{job_id}/candidates/{model_code}/charts",
    response_model=CandidateChartsPayload,
)
def get_candidate_charts(
    job_id: str,
    model_code: str,
    rank: int | None = Query(default=None, ge=1),
) -> CandidateChartsPayload:
    progress = job_service.get_progress(job_id)
    if not progress:
        raise HTTPException(status_code=404, detail="Job not found")
    if progress.status.value in ("running", "pending"):
        raise HTTPException(status_code=409, detail="Job still running")
    if progress.status.value == "failed":
        raise HTTPException(status_code=500, detail=progress.message)
    try:
        return job_service.get_candidate_charts(job_id, model_code, rank=rank)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.patch("/{job_id}/narrative-facts")
def patch_job_narrative_facts(job_id: str, body: NarrativeFactsPatch) -> dict:
    progress = job_service.get_progress(job_id)
    if not progress:
        raise HTTPException(status_code=404, detail="Job not found")
    if progress.status.value != "completed":
        raise HTTPException(status_code=409, detail="Job not completed")
    if not body.patch:
        return {"ok": True}
    ok = job_service.patch_narrative_facts(job_id, body.patch)
    if not ok:
        raise HTTPException(status_code=404, detail="Result not ready")
    return {"ok": True}
