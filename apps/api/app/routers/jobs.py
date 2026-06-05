from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app import jobs as job_service
from app.models import BacktestRequest, BacktestResult, CandidateChartsPayload, JobProgress


class NarrativeFactsPatch(BaseModel):
    patch: dict[str, Any] = Field(default_factory=dict)

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.post("", response_model=dict)
def create_backtest_job(req: BacktestRequest) -> dict:
    job_id = job_service.create_job(req)
    return {"job_id": job_id}


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
def get_candidate_charts(job_id: str, model_code: str) -> CandidateChartsPayload:
    progress = job_service.get_progress(job_id)
    if not progress:
        raise HTTPException(status_code=404, detail="Job not found")
    if progress.status.value in ("running", "pending"):
        raise HTTPException(status_code=409, detail="Job still running")
    if progress.status.value == "failed":
        raise HTTPException(status_code=500, detail=progress.message)
    try:
        return job_service.get_candidate_charts(job_id, model_code)
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
