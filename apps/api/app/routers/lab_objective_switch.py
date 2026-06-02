from fastapi import APIRouter, HTTPException

from app.engine.objective_switch_lab import evaluate_objective_switch_lab
from app.models import ObjectiveSwitchLabRequest, ObjectiveSwitchLabResult

router = APIRouter(prefix="/lab/objective-switch", tags=["lab"])


@router.post("/evaluate", response_model=ObjectiveSwitchLabResult)
def evaluate_lab(req: ObjectiveSwitchLabRequest) -> ObjectiveSwitchLabResult:
    """Objective Switch Lab — regime policy evaluation only (no backtest job)."""
    try:
        return evaluate_objective_switch_lab(req)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
