"""Persistent champion registry keyed by scenario fingerprint."""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.models import BacktestRequest
from app.scenario_fingerprint import compute_scenario_fingerprint

ROOT = Path(__file__).resolve().parents[3]
PERSISTENT_DEFAULT_DIR = Path("/var/data")
LOCAL_DEV_DEFAULT_DIR = ROOT / "apps" / "api" / ".cache"

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None


@dataclass(frozen=True)
class CachedChampion:
    fingerprint: str
    job_id: str
    recorded_at: str
    champion_params: dict[str, Any]
    model_code: str
    objective: str
    sharpe: float | None
    cagr: float | None
    max_drawdown: float | None
    objective_score: float | None
    start_date: str
    end_date: str
    match_type: str = "exact"


def _default_registry_path() -> Path:
    if PERSISTENT_DEFAULT_DIR.is_dir():
        return PERSISTENT_DEFAULT_DIR / "champions.db"
    return LOCAL_DEV_DEFAULT_DIR / "champions.db"


def registry_path() -> Path:
    raw = os.environ.get("CHAMPION_REGISTRY_PATH", "").strip()
    return Path(raw) if raw else _default_registry_path()


def _connect() -> sqlite3.Connection:
    path = registry_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _init_db(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS champions (
            fingerprint TEXT PRIMARY KEY,
            fingerprint_base TEXT NOT NULL,
            job_id TEXT NOT NULL,
            recorded_at TEXT NOT NULL,
            champion_params TEXT NOT NULL,
            model_code TEXT NOT NULL,
            objective TEXT NOT NULL,
            sharpe REAL,
            cagr REAL,
            max_drawdown REAL,
            objective_score REAL,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_champions_base ON champions(fingerprint_base)"
    )
    conn.commit()


def _get_conn() -> sqlite3.Connection:
    global _conn
    with _lock:
        if _conn is None:
            _conn = _connect()
            _init_db(_conn)
        return _conn


def _row_to_cached(row: sqlite3.Row, *, match_type: str) -> CachedChampion:
    return CachedChampion(
        fingerprint=str(row["fingerprint"]),
        job_id=str(row["job_id"]),
        recorded_at=str(row["recorded_at"]),
        champion_params=json.loads(row["champion_params"]),
        model_code=str(row["model_code"]),
        objective=str(row["objective"]),
        sharpe=row["sharpe"],
        cagr=row["cagr"],
        max_drawdown=row["max_drawdown"],
        objective_score=row["objective_score"],
        start_date=str(row["start_date"]),
        end_date=str(row["end_date"]),
        match_type=match_type,
    )


def lookup_champion(req: BacktestRequest) -> CachedChampion | None:
    """Exact fingerprint first; fuzzy (same scenario, different end_date) as fallback."""
    exact_fp = compute_scenario_fingerprint(req, include_end_date=True)
    base_fp = compute_scenario_fingerprint(req, include_end_date=False)
    with _lock:
        conn = _get_conn()
        row = conn.execute(
            "SELECT * FROM champions WHERE fingerprint = ?",
            (exact_fp,),
        ).fetchone()
        if row is not None:
            return _row_to_cached(row, match_type="exact")
        row = conn.execute(
            """
            SELECT * FROM champions
            WHERE fingerprint_base = ?
            ORDER BY recorded_at DESC
            LIMIT 1
            """,
            (base_fp,),
        ).fetchone()
        if row is not None:
            return _row_to_cached(row, match_type="fuzzy")
    return None


def record_champion(
    req: BacktestRequest,
    job_id: str,
    champion_params: dict[str, Any],
    model_code: str,
    objective: str,
    *,
    sharpe: float | None = None,
    cagr: float | None = None,
    max_drawdown: float | None = None,
    objective_score: float | None = None,
) -> bool:
    """Upsert when missing or improved. Returns True if the row was written."""
    exact_fp = compute_scenario_fingerprint(req, include_end_date=True)
    base_fp = compute_scenario_fingerprint(req, include_end_date=False)
    params_json = json.dumps(champion_params, ensure_ascii=False, sort_keys=True, default=str)
    now = datetime.now(UTC).isoformat()

    with _lock:
        conn = _get_conn()
        existing = conn.execute(
            "SELECT objective_score FROM champions WHERE fingerprint = ?",
            (exact_fp,),
        ).fetchone()
        if existing is not None:
            old_score = existing["objective_score"]
            if (
                old_score is not None
                and objective_score is not None
                and float(objective_score) <= float(old_score)
            ):
                return False

        conn.execute(
            """
            INSERT INTO champions (
                fingerprint, fingerprint_base, job_id, recorded_at,
                champion_params, model_code, objective,
                sharpe, cagr, max_drawdown, objective_score,
                start_date, end_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(fingerprint) DO UPDATE SET
                job_id = excluded.job_id,
                recorded_at = excluded.recorded_at,
                champion_params = excluded.champion_params,
                model_code = excluded.model_code,
                objective = excluded.objective,
                sharpe = excluded.sharpe,
                cagr = excluded.cagr,
                max_drawdown = excluded.max_drawdown,
                objective_score = excluded.objective_score,
                start_date = excluded.start_date,
                end_date = excluded.end_date
            """,
            (
                exact_fp,
                base_fp,
                job_id,
                now,
                params_json,
                model_code,
                objective,
                sharpe,
                cagr,
                max_drawdown,
                objective_score,
                req.start_date,
                req.end_date,
            ),
        )
        conn.commit()
    return True


def reset_registry_for_tests() -> None:
    """Close connection and clear in-memory handle (tests only)."""
    global _conn
    with _lock:
        if _conn is not None:
            _conn.close()
            _conn = None
