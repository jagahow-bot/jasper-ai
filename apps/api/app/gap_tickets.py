"""Capability-gap tickets persisted under ``.cache/gaps/`` (design §3.5)."""

from __future__ import annotations

import hashlib
import json
import os
import threading
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[3]
PERSISTENT_DEFAULT_DIR = Path("/var/data/gaps")
LOCAL_DEV_DEFAULT_DIR = ROOT / "apps" / "api" / ".cache" / "gaps"

StageKind = Literal[
    "universe",
    "signals",
    "allocator",
    "constraints",
    "objective",
    "rebalance",
    "cash_schedule",
    "reporting",
]
GapKind = Literal["unsupported_lever", "infeasible_combination", "bounds_exceeded"]
TicketStatus = Literal[
    "open",
    "triaged",
    "drafted",
    "in_review",
    "merged",
    "rejected",
    "blocked_model_unavailable",
    "blocked_ci",
]

_lock = threading.Lock()


def _gaps_dir() -> Path:
    raw = os.environ.get("GAP_TICKETS_DIR", "").strip()
    if raw:
        return Path(raw)
    if PERSISTENT_DEFAULT_DIR.parent.is_dir():
        return PERSISTENT_DEFAULT_DIR
    return LOCAL_DEV_DEFAULT_DIR


def _index_path() -> Path:
    return _gaps_dir() / "index.json"


def _ticket_path(ticket_id: str) -> Path:
    return _gaps_dir() / f"{ticket_id}.json"


def _now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def fingerprint_for(
    stage: str,
    missing_capability: str,
    requested: dict[str, Any] | None,
) -> str:
    payload = {
        "stage": stage,
        "missing_capability": missing_capability,
        "requested": requested or {},
    }
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:24]


class GapTicket(BaseModel):
    ticket_id: str
    fingerprint: str
    stage: StageKind
    kind: GapKind
    missing_capability: str
    summary_i18n: dict[str, str] = Field(default_factory=dict)
    requested: dict[str, Any] = Field(default_factory=dict)
    nearest_supported: dict[str, Any] | None = None
    rm_id: str | None = None
    client_ref: str | None = None
    overlay_session_id: str = ""
    status: TicketStatus = "open"
    reuse_count: int = 1
    created_at: str = ""
    updated_at: str = ""
    linked_pr: str | None = None
    behavior_spec_card: dict[str, Any] | None = None
    draft_source: Literal["kimi", "template", "human"] | None = None
    llm_logs: list[dict[str, Any]] = Field(default_factory=list)
    semantic_review: dict[str, Any] | None = None
    engineer_checklist: dict[str, Any] | None = None
    codegen_draft: dict[str, Any] | None = None
    notify_email: str | None = None


def _load_index_unlocked() -> list[dict[str, Any]]:
    path = _index_path()
    if not path.exists():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return raw if isinstance(raw, list) else []


def _save_index_unlocked(entries: list[dict[str, Any]]) -> None:
    d = _gaps_dir()
    d.mkdir(parents=True, exist_ok=True)
    _index_path().write_text(
        json.dumps(entries, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _index_entry(ticket: GapTicket) -> dict[str, Any]:
    return {
        "ticket_id": ticket.ticket_id,
        "fingerprint": ticket.fingerprint,
        "stage": ticket.stage,
        "kind": ticket.kind,
        "missing_capability": ticket.missing_capability,
        "status": ticket.status,
        "reuse_count": ticket.reuse_count,
        "updated_at": ticket.updated_at,
        "summary": (ticket.summary_i18n.get("zh") or ticket.summary_i18n.get("en") or "")[
            :120
        ],
    }


def get_ticket(ticket_id: str) -> GapTicket | None:
    path = _ticket_path(ticket_id)
    if not path.exists():
        return None
    try:
        return GapTicket.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, ValueError):
        return None


def list_tickets(
    *,
    status: str | None = None,
    stage: str | None = None,
    limit: int = 100,
) -> list[GapTicket]:
    with _lock:
        entries = _load_index_unlocked()
    out: list[GapTicket] = []
    for e in sorted(entries, key=lambda x: (-int(x.get("reuse_count") or 1), x.get("updated_at") or ""), reverse=False):
        # sort by reuse_count desc then updated_at desc
        pass
    entries_sorted = sorted(
        entries,
        key=lambda x: (int(x.get("reuse_count") or 1), x.get("updated_at") or ""),
        reverse=True,
    )
    for e in entries_sorted:
        if status and e.get("status") != status:
            continue
        if stage and e.get("stage") != stage:
            continue
        t = get_ticket(str(e.get("ticket_id") or ""))
        if t is not None:
            out.append(t)
        if len(out) >= limit:
            break
    return out


def upsert_gap(
    *,
    stage: StageKind,
    kind: GapKind,
    missing_capability: str,
    summary: str,
    requested: dict[str, Any] | None = None,
    nearest_supported: dict[str, Any] | None = None,
    rm_id: str | None = None,
    client_ref: str | None = None,
    overlay_session_id: str = "",
    lang: str = "zh",
    notify_email: str | None = None,
) -> GapTicket:
    """Create a new ticket or bump reuse_count on fingerprint match."""
    fp = fingerprint_for(stage, missing_capability, requested)
    with _lock:
        entries = _load_index_unlocked()
        for e in entries:
            if e.get("fingerprint") == fp:
                existing = get_ticket(str(e["ticket_id"]))
                if existing is not None:
                    existing.reuse_count += 1
                    existing.updated_at = _now()
                    if summary and lang:
                        existing.summary_i18n[lang] = summary
                    _ticket_path(existing.ticket_id).write_text(
                        existing.model_dump_json(indent=2) + "\n",
                        encoding="utf-8",
                    )
                    for i, row in enumerate(entries):
                        if row.get("ticket_id") == existing.ticket_id:
                            entries[i] = _index_entry(existing)
                            break
                    _save_index_unlocked(entries)
                    return existing

        now = _now()
        ticket = GapTicket(
            ticket_id=f"GAP-{uuid.uuid4().hex[:8].upper()}",
            fingerprint=fp,
            stage=stage,
            kind=kind,
            missing_capability=missing_capability,
            summary_i18n={lang: summary},
            requested=requested or {},
            nearest_supported=nearest_supported,
            rm_id=rm_id,
            client_ref=client_ref,
            overlay_session_id=overlay_session_id,
            status="open",
            reuse_count=1,
            created_at=now,
            updated_at=now,
            notify_email=notify_email,
        )
        d = _gaps_dir()
        d.mkdir(parents=True, exist_ok=True)
        _ticket_path(ticket.ticket_id).write_text(
            ticket.model_dump_json(indent=2) + "\n",
            encoding="utf-8",
        )
        entries.append(_index_entry(ticket))
        _save_index_unlocked(entries)
        return ticket


def patch_ticket(ticket_id: str, updates: dict[str, Any]) -> GapTicket:
    with _lock:
        ticket = get_ticket(ticket_id)
        if ticket is None:
            raise LookupError(f"Gap ticket not found: {ticket_id}")
        data = ticket.model_dump()
        for k, v in updates.items():
            if k in data and k not in ("ticket_id", "fingerprint", "created_at"):
                data[k] = v
        data["updated_at"] = _now()
        updated = GapTicket.model_validate(data)
        _ticket_path(ticket_id).write_text(
            updated.model_dump_json(indent=2) + "\n",
            encoding="utf-8",
        )
        entries = _load_index_unlocked()
        for i, row in enumerate(entries):
            if row.get("ticket_id") == ticket_id:
                entries[i] = _index_entry(updated)
                break
        _save_index_unlocked(entries)
        return updated
