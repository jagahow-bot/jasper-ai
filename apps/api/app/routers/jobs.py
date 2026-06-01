from fastapi import APIRouter, HTTPException

from app import jobs as job_service
from app.models import BacktestRequest, BacktestResult, JobProgress

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
