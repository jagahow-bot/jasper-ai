"""Capability L1/L2 approval endpoints (design §4.5)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.capability_approval import (
    confirm_rm,
    proposal_pending_capabilities,
    supervisor_batch_signoff,
)
from app.config import settings
from app.engine.stages.registry import get_registry

router = APIRouter(prefix="/capabilities", tags=["capabilities"])


class RmConfirmBody(BaseModel):
    stage: str
    implementation_id: str
    rm_id: str
    notify_email: str | None = None
    summary: str = ""
    missing_capability: str = ""


class SupervisorSignoffBody(BaseModel):
    supervisor_id: str
    capabilities: list[dict[str, str]] = Field(default_factory=list)


@router.get("/catalog")
def catalog() -> dict[str, Any]:
    reg = get_registry()
    cards = []
    for kind, regs in reg.catalog().items():
        for r in regs:
            cards.append(
                {
                    "stage": kind,
                    "implementation_id": r.implementation_id,
                    "version": r.version,
                    "status": r.status,
                    "approval_status": r.approval_status,
                    "pending_supervisor_signoff": r.pending_supervisor_signoff,
                    "source_pr": r.source_pr,
                    "approved_by": r.approved_by,
                }
            )
    return {
        "catalog_version": reg.catalog_version(),
        "deploy_policy": "deploy-on-merge",
        "proposal_requires_supervisor_signoff": bool(
            settings.proposal_requires_supervisor_signoff
        ),
        "registrations": cards,
    }


@router.post("/rm-confirm")
def rm_confirm(body: RmConfirmBody) -> dict[str, Any]:
    try:
        return confirm_rm(
            body.stage,
            body.implementation_id,
            rm_id=body.rm_id,
            notify_email=body.notify_email,
            summary=body.summary,
            missing_capability=body.missing_capability,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/supervisor-signoff")
def supervisor_signoff(body: SupervisorSignoffBody) -> dict[str, Any]:
    try:
        results = supervisor_batch_signoff(
            body.capabilities, supervisor_id=body.supervisor_id
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"approved": results, "count": len(results)}


@router.post("/proposal-pending")
def proposal_pending(body: dict[str, Any]) -> dict[str, Any]:
    used = body.get("capabilities_used") or []
    pending = proposal_pending_capabilities(used)
    return {
        "pending": pending,
        "badge": "含待簽核能力" if pending else None,
        "block_print": bool(settings.proposal_requires_supervisor_signoff)
        and bool(pending),
    }
