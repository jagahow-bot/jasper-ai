"""Provider-agnostic LLM I/O audit trail for backtest reports.

Captures every call made through the unified Python AI client (ai_client.py) and
any Vercel AI SDK calls forwarded from the Next.js frontend. The trail is stored
in the job cache so every report retains the full conversation that contributed
to it.

Security: API keys are never logged. Only prompts, system messages, raw responses,
model metadata, and public usage/timing are retained.
"""

from __future__ import annotations

import threading
import time
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any

_audit_lock = threading.Lock()
_audit_buffers: dict[str, list[dict[str, Any]]] = {}
_audit_context = threading.local()


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


@contextmanager
def set_llm_audit_job_id(job_id: str | None):
    """Bind the current thread to a job_id so AI calls are recorded together.

    Example:
        with set_llm_audit_job_id(job_id):
            run_backtest(...)
        logs = pop_llm_audit_logs(job_id)
    """
    old = getattr(_audit_context, "job_id", None)
    _audit_context.job_id = job_id
    if job_id is not None:
        with _audit_lock:
            _audit_buffers.setdefault(job_id, [])
    try:
        yield
    finally:
        _audit_context.job_id = old


def clear_llm_audit_context() -> None:
    _audit_context.job_id = None


def append_llm_audit_entry(entry: dict[str, Any]) -> None:
    """Append one log entry to the current thread's job buffer, if bound."""
    job_id = getattr(_audit_context, "job_id", None)
    if job_id is None:
        return
    with _audit_lock:
        _audit_buffers.setdefault(job_id, []).append(entry)


def get_llm_audit_logs(job_id: str) -> list[dict[str, Any]]:
    """Return a copy of the current logs for a job without clearing them."""
    with _audit_lock:
        return list(_audit_buffers.get(job_id, []))


def pop_llm_audit_logs(job_id: str) -> list[dict[str, Any]]:
    """Return and clear the logs for a job."""
    with _audit_lock:
        return _audit_buffers.pop(job_id, [])


def reset_llm_audit_logs(job_id: str) -> None:
    with _audit_lock:
        _audit_buffers.pop(job_id, None)


def merge_llm_audit_logs(job_id: str, entries: list[dict[str, Any]]) -> int:
    """Merge externally captured logs (e.g. from the frontend) into a job buffer."""
    if not entries:
        return 0
    with _audit_lock:
        buf = _audit_buffers.setdefault(job_id, [])
        buf.extend(entries)
        return len(entries)


def build_audit_entry(
    *,
    provider: str,
    model_id: str,
    call_type: str,
    prompt: str,
    system: str | None,
    temperature: float,
    max_output_tokens: int,
    response_mime_type: str | None,
    raw_response: str,
    finish_reason: str,
    usage: dict[str, Any] | None,
    duration_ms: float,
    request_index: int | None = None,
    error: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a single normalized audit entry.

    Fields are intentionally stable and match the schema requested by the
    frontend so that backend and frontend logs can be merged and compared.
    """
    entry: dict[str, Any] = {
        "timestamp": _now_iso(),
        "provider": provider,
        "model_id": model_id,
        "call_type": call_type,
        "prompt": prompt,
        "system": system,
        "temperature": float(temperature),
        "max_output_tokens": int(max_output_tokens),
        "response_mime_type": response_mime_type,
        "raw_response": raw_response,
        "finish_reason": finish_reason,
        "usage": usage or {},
        "duration_ms": round(float(duration_ms), 2),
    }
    if request_index is not None:
        entry["request_index"] = int(request_index)
    if error is not None:
        entry["error"] = error
    if extra:
        entry["extra"] = extra
    return entry
