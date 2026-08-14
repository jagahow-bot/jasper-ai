"""Demo-client helpers (opportunistic performance refresh)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.engine.client_performance_refresh import refresh_all_client_performance

router = APIRouter(prefix="/clients", tags=["clients"])


class ClientPerformanceRefreshResponse(BaseModel):
    as_of: str | None
    tickers: int
    clients: int = 0
    skipped: bool
    data_source: str = ""
    window: dict[str, Any] | None = None
    reason: str | None = None


@router.post("/refresh-performance", response_model=ClientPerformanceRefreshResponse)
def refresh_performance() -> ClientPerformanceRefreshResponse:
    """Warm price cache for all demo-client tickers through the latest close.

    Client-triggered (website open), not a cron. Safe to call repeatedly: a
    panel already fetched today is returned without hitting Yahoo.
    """
    try:
        result = refresh_all_client_performance()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return ClientPerformanceRefreshResponse(**result)
