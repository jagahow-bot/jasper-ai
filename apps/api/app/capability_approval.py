"""Capability approval lifecycle helpers (L0/L1/L2 — design §4.5)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from app.engine.stages.registry import StageRegistration, get_registry
from app.notifications import is_valid_email, notifications_configured

ApprovalStatus = Literal["pending_rm_confirmation", "rm_confirmed", "approved"]


def _now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def set_approval_status(
    stage: str,
    implementation_id: str,
    status: ApprovalStatus,
    *,
    actor: str,
    role: Literal["rm", "supervisor", "engineer"] = "rm",
) -> dict[str, Any]:
    """Flip registry approval + pending_supervisor_signoff for a registration."""
    reg = get_registry()
    bucket = reg.catalog().get(stage) or []
    match: StageRegistration | None = None
    for r in bucket:
        if r.implementation_id == implementation_id:
            match = r
            break
    if match is None:
        raise LookupError(f"Unknown capability {stage}/{implementation_id}")

    pending = status == "rm_confirmed"
    approved_by = dict(match.approved_by)
    approved_by[role] = f"{actor}@{_now()}"
    if role == "engineer":
        approved_by["engineer"] = approved_by[role]

    # Dataclass is frozen — re-register a copy.
    updated = StageRegistration(
        stage=match.stage,
        implementation_id=match.implementation_id,
        version=match.version,
        factory=match.factory,
        status=match.status,
        source_pr=match.source_pr,
        approval_status=status,
        pending_supervisor_signoff=pending if status != "approved" else False,
        approved_by=approved_by,
    )
    # Clear pending when approved
    if status == "approved":
        updated = StageRegistration(
            stage=match.stage,
            implementation_id=match.implementation_id,
            version=match.version,
            factory=match.factory,
            status=match.status,
            source_pr=match.source_pr,
            approval_status="approved",
            pending_supervisor_signoff=False,
            approved_by=approved_by,
        )
    reg.register(updated, default=False)
    return {
        "stage": stage,
        "implementation_id": implementation_id,
        "version": match.version,
        "approval_status": updated.approval_status,
        "pending_supervisor_signoff": updated.pending_supervisor_signoff,
        "approved_by": updated.approved_by,
        "catalog_version": reg.catalog_version(),
    }


def confirm_rm(
    stage: str,
    implementation_id: str,
    *,
    rm_id: str,
    notify_email: str | None = None,
    summary: str = "",
    missing_capability: str = "",
) -> dict[str, Any]:
    """L1: RM confirms Behavior Spec Card → rm_confirmed + notify."""
    snap = set_approval_status(
        stage, implementation_id, "rm_confirmed", actor=rm_id, role="rm"
    )
    if notify_email and is_valid_email(notify_email) and notifications_configured():
        try:
            from app.notifications import notify_capability_rm_confirmed

            notify_capability_rm_confirmed(
                to_email=notify_email,
                summary=summary or missing_capability or implementation_id,
                missing_capability=missing_capability or implementation_id,
                catalog_version=str(snap.get("catalog_version") or ""),
            )
        except Exception:  # noqa: BLE001
            pass
    return snap


def supervisor_batch_signoff(
    capabilities: list[dict[str, str]],
    *,
    supervisor_id: str,
) -> list[dict[str, Any]]:
    """L2: batch-approve capabilities used by a proposal."""
    out: list[dict[str, Any]] = []
    for cap in capabilities:
        out.append(
            set_approval_status(
                str(cap["stage"]),
                str(cap["implementation_id"]),
                "approved",
                actor=supervisor_id,
                role="supervisor",
            )
        )
    return out


def proposal_pending_capabilities(
    capabilities_used: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Filter job snapshots that still need L2 supervisor signoff."""
    if not capabilities_used:
        return []
    return [
        c
        for c in capabilities_used
        if c.get("pending_supervisor_signoff")
        or c.get("status") == "rm_confirmed"
    ]
