from fastapi import APIRouter, HTTPException

from app.models import ScenarioCard
from app.profiles import get_scenario, get_universe, load_profiles

router = APIRouter(prefix="/scenarios", tags=["scenarios"])


@router.get("", response_model=list[ScenarioCard])
def list_scenarios() -> list[ScenarioCard]:
    data = load_profiles()
    return [ScenarioCard(**s) for s in data["scenarios"]]


@router.get("/{scenario_id}")
def get_scenario_detail(scenario_id: str):
    scenario = get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return {"scenario": scenario, "universe": get_universe()}
