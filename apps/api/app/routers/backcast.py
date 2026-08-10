"""Portfolio backcast endpoint for financial-goal planning returns."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.engine.client_daily_nav import build_client_daily_nav
from app.engine.goal_backcast import (
    DEFAULT_BACKCAST_YEARS,
    MAX_BACKCAST_YEARS,
    build_backcast_monthly_returns,
)

router = APIRouter(prefix="/backcast", tags=["backcast"])


class BackcastMonthlyRequest(BaseModel):
    """Target mix to backcast; weights are normalized server-side."""

    weights: dict[str, float] = Field(min_length=1)
    years: int = Field(default=DEFAULT_BACKCAST_YEARS, ge=3, le=MAX_BACKCAST_YEARS)
    rebalance_freq: str = "QE"
    fee_bps: float = Field(default=10.0, ge=0.0, le=500.0)
    end: str | None = None


class BackcastMonthlyResponse(BaseModel):
    monthly: list[dict[str, Any]]
    meta: dict[str, Any]


@router.post("/monthly", response_model=BackcastMonthlyResponse)
def backcast_monthly(payload: BackcastMonthlyRequest) -> BackcastMonthlyResponse:
    try:
        build = build_backcast_monthly_returns(
            payload.weights,
            years=payload.years,
            rebalance_rule=payload.rebalance_freq,
            fee_bps=payload.fee_bps,
            end=payload.end,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return BackcastMonthlyResponse(monthly=build.monthly, meta=build.meta)


class DailyNavHolding(BaseModel):
    """One book position: initial capital weight + optional invested date."""

    ticker: str = Field(min_length=1)
    weight: float = Field(gt=0)
    invested_at: str | None = None


class BackcastDailyNavRequest(BaseModel):
    """Client-style book to reconstruct from real daily closes."""

    holdings: list[DailyNavHolding] = Field(min_length=1)
    start: str | None = None  # YYYY-MM-DD; default = earliest invested_at (else 3y)
    end: str | None = None  # YYYY-MM-DD; default = today


class BackcastDailyNavResponse(BaseModel):
    daily: list[dict[str, Any]]  # [{date, nav}] — nav rebased to 1.0 at day 1
    meta: dict[str, Any]


@router.post("/daily-nav", response_model=BackcastDailyNavResponse)
def backcast_daily_nav(payload: BackcastDailyNavRequest) -> BackcastDailyNavResponse:
    try:
        build = build_client_daily_nav(
            [h.model_dump() for h in payload.holdings],
            start=payload.start,
            end=payload.end,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return BackcastDailyNavResponse(daily=build.daily, meta=build.meta)
