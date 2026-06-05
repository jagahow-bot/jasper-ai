"""Persist completed backtest jobs to disk for history listing and reload."""

from __future__ import annotations

import json
import os
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.models import BacktestRequest, BacktestResult, JobStatus, JobSummary

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_HISTORY_DIR = ROOT / "apps" / "api" / ".cache" / "jobs"
MAX_HISTORY_ENTRIES = 50

_lock = threading.Lock()
_index: list[dict[str, Any]] | None = None


def _history_dir() -> Path:
    raw = os.environ.get("JOB_HISTORY_DIR", "").strip()
    return Path(raw) if raw else DEFAULT_HISTORY_DIR


def _index_path() -> Path:
    return _history_dir() / "index.json"


def _job_path(job_id: str) -> Path:
    return _history_dir() / f"{job_id}.json"


def _champion_from_result(result: BacktestResult) -> tuple[str | None, float | None, float | None]:
    candidates = result.candidates or []
    facts = result.narrative_facts or {}

    def _code(c: Any) -> str:
        return str(getattr(c, "model_code", None) or "").strip().upper()

    preferred: str | None = None
    for key in ("ai_champion_model_code", "champion_model_code"):
        raw = facts.get(key)
        if isinstance(raw, str) and raw.strip():
            preferred = raw.strip().upper()
            break

    champion = None
    if preferred:
        champion = next((c for c in candidates if _code(c) == preferred), None)
    if champion is None:
        champion = next((c for c in candidates if getattr(c, "is_champion", False)), None)
    if champion is None and candidates:
        champion = next((c for c in candidates if getattr(c, "rank", 0) == 1), candidates[0])

    if champion is None:
        return None, None, None
    return _code(champion) or None, champion.cagr, champion.sharpe


def build_summary(
    job_id: str,
    req: BacktestRequest,
    result: BacktestResult,
    *,
    status: JobStatus = JobStatus.completed,
    created_at: str | None = None,
) -> JobSummary:
    champion_code, cagr, sharpe = _champion_from_result(result)
    ts = created_at or datetime.now(UTC).isoformat()
    return JobSummary(
        job_id=job_id,
        created_at=ts,
        status=status,
        start_date=req.start_date,
        end_date=req.end_date,
        objective=req.objective.value if hasattr(req.objective, "value") else str(req.objective),
        optimization_mode=(
            req.optimization_mode.value
            if hasattr(req.optimization_mode, "value")
            else str(req.optimization_mode)
        ),
        scenario_id=req.scenario_id,
        champion_model_code=champion_code,
        champion_cagr=cagr,
        champion_sharpe=sharpe,
    )


def _load_index_unlocked() -> list[dict[str, Any]]:
    global _index
    if _index is not None:
        return _index
    path = _index_path()
    if not path.is_file():
        _index = []
        return _index
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        _index = raw if isinstance(raw, list) else []
    except (OSError, json.JSONDecodeError):
        _index = []
    return _index


def _save_index_unlocked(entries: list[dict[str, Any]]) -> None:
    global _index
    _index = entries
    directory = _history_dir()
    directory.mkdir(parents=True, exist_ok=True)
    _index_path().write_text(
        json.dumps(entries, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def persist_completed_job(job_id: str, req: BacktestRequest, result: BacktestResult) -> JobSummary:
    summary = build_summary(job_id, req, result)
    payload = {
        "request": req.model_dump(mode="json"),
        "result": result.model_dump(mode="json"),
    }
    directory = _history_dir()
    directory.mkdir(parents=True, exist_ok=True)
    _job_path(job_id).write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )

    with _lock:
        entries = _load_index_unlocked()
        entries = [e for e in entries if e.get("job_id") != job_id]
        entries.insert(0, summary.model_dump(mode="json"))
        stale_ids = {e["job_id"] for e in entries[MAX_HISTORY_ENTRIES:]}
        entries = entries[:MAX_HISTORY_ENTRIES]
        _save_index_unlocked(entries)

    for stale_id in stale_ids:
        try:
            _job_path(stale_id).unlink(missing_ok=True)
        except OSError:
            pass

    return summary


def list_job_summaries(*, limit: int = 30) -> list[JobSummary]:
    cap = max(1, min(int(limit), MAX_HISTORY_ENTRIES))
    with _lock:
        entries = _load_index_unlocked()[:cap]
    return [JobSummary.model_validate(e) for e in entries]


def load_persisted_job(job_id: str) -> tuple[BacktestRequest, BacktestResult] | None:
    path = _job_path(job_id)
    if not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(raw, dict):
        return None
    try:
        req = BacktestRequest.model_validate(raw["request"])
        result = BacktestResult.model_validate(raw["result"])
    except (KeyError, ValueError):
        return None
    return req, result


def reset_history_cache_for_tests() -> None:
    """Clear in-memory index (tests only)."""
    global _index
    with _lock:
        _index = None
