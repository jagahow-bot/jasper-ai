"""Gaps API — capability gap tickets (design §3.5)."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app import gap_tickets as gap_service
from app.gap_tickets import GapTicket

router = APIRouter(prefix="/gaps", tags=["gaps"])


class CreateGapBody(BaseModel):
    stage: Literal[
        "universe",
        "signals",
        "allocator",
        "constraints",
        "objective",
        "rebalance",
        "cash_schedule",
        "reporting",
    ]
    kind: Literal["unsupported_lever", "infeasible_combination", "bounds_exceeded"]
    missing_capability: str = Field(min_length=3, max_length=80)
    summary: str = Field(min_length=8, max_length=600)
    requested: dict[str, Any] = Field(default_factory=dict)
    nearest_supported: dict[str, Any] | None = None
    rm_id: str | None = None
    client_ref: str | None = None
    overlay_session_id: str = ""
    lang: str = "zh"
    notify_email: str | None = None


class PatchGapBody(BaseModel):
    status: str | None = None
    linked_pr: str | None = None
    behavior_spec_card: dict[str, Any] | None = None
    draft_source: str | None = None
    llm_logs: list[dict[str, Any]] | None = None
    semantic_review: dict[str, Any] | None = None
    engineer_checklist: dict[str, Any] | None = None
    codegen_draft: dict[str, Any] | None = None
    summary_i18n: dict[str, str] | None = None


@router.post("", response_model=GapTicket)
def create_gap(body: CreateGapBody) -> GapTicket:
    return gap_service.upsert_gap(
        stage=body.stage,
        kind=body.kind,
        missing_capability=body.missing_capability,
        summary=body.summary,
        requested=body.requested,
        nearest_supported=body.nearest_supported,
        rm_id=body.rm_id,
        client_ref=body.client_ref,
        overlay_session_id=body.overlay_session_id,
        lang=body.lang,
        notify_email=body.notify_email,
    )


@router.get("", response_model=list[GapTicket])
def list_gaps(
    status: str | None = Query(default=None),
    stage: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[GapTicket]:
    return gap_service.list_tickets(status=status, stage=stage, limit=limit)


@router.get("/{ticket_id}", response_model=GapTicket)
def get_gap(ticket_id: str) -> GapTicket:
    ticket = gap_service.get_ticket(ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail="Gap ticket not found")
    return ticket


@router.patch("/{ticket_id}", response_model=GapTicket)
def patch_gap(ticket_id: str, body: PatchGapBody) -> GapTicket:
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        return gap_service.patch_ticket(ticket_id, updates)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
