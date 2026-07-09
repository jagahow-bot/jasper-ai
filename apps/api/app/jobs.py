import gc
import logging
import threading
import traceback
import uuid

logger = logging.getLogger(__name__)

from app.candidate_charts import (
    ResolvedCandidate,
    merge_charts_into_candidate,
    resolve_candidate,
    resolve_candidate_charts,
)
from app.engine.backtest import run_backtest, _is_pro_mode
from app.engine.memory_budget import is_render_runtime
from app.engine.report_sim_cache import TrialReportCache
from app.job_history import list_job_summaries, load_persisted_job, persist_completed_job
from app.job_continuation import (
    apply_continuation_request,
    continuation_runtime_state,
    extract_continuation_snapshot,
)
from app.models import (
    BacktestRequest,
    BacktestResult,
    CandidateChartsPayload,
    JobProgress,
    JobStatus,
    JobSummary,
)


_jobs: dict[str, dict] = {}
_continuation_snapshots: dict[str, dict] = {}
_lock = threading.Lock()
# One active backtest per API process on Render avoids 2× peak RAM (dual personalization jobs).
_backtest_slot = threading.Semaphore(1 if is_render_runtime() else 2)


def _evict_stale_report_caches(active_job_id: str) -> None:
    with _lock:
        for jid, job in _jobs.items():
            if jid != active_job_id:
                job["report_cache"] = None


def _notify_async(
    job_id: str,
    req: BacktestRequest,
    *,
    status: str,
    result: BacktestResult | None = None,
    error: str | None = None,
) -> None:
    """Fire off a terminal-state email without blocking the job thread.

    Import is local so the email stack (and its config) is only touched when a
    job actually finishes, and any unexpected error here can never affect the
    job's recorded result.
    """
    if not (req.notify_email or "").strip():
        return
    try:
        from app.notifications import notifications_configured, send_job_notification

        if not notifications_configured():
            logger.warning(
                "email notification skipped: SMTP not set (job %s, recipient %s)",
                job_id,
                (req.notify_email or "").strip(),
            )
            return

        threading.Thread(
            target=send_job_notification,
            args=(job_id, req),
            kwargs={"status": status, "result": result, "error": error},
            daemon=True,
        ).start()
    except Exception:  # noqa: BLE001 — notification must never break a job
        logger.exception("email notification setup failed for job %s", job_id)


def _public_log_message(message: str) -> str:
    """User-facing job progress (pass-through from backtest search/assembly).

    Trial phase: Optuna progress. Post-search: Packaging report / Building report
    snapshot when chart backtests re-run. Never show vendor model names.
    """
    return (
        message.replace("Gemini", "AI")
        .replace("gemini_", "ai_")
        .replace("GEMINI", "AI")
    )


def _is_static_replay(req: BacktestRequest) -> bool:
    return bool(req.static_replay_holdings)


def _estimated_trials_total(req: BacktestRequest) -> int:
    if _is_static_replay(req):
        return 1
    if _is_pro_mode(req):
        batch0 = int(req.refinement_batch_size)
        challengers = int(req.refinement_challengers_per_round)
        max_rounds = int(req.refinement_max_rounds)
        return batch0 + (challengers + 1) * max(0, max_rounds - 1)
    return req.trials


def create_job(req: BacktestRequest, *, continuation_snapshot: dict | None = None) -> str:
    job_id = str(uuid.uuid4())
    trials_total = _estimated_trials_total(req)
    with _lock:
        _jobs[job_id] = {
            "request": req,
            "progress": JobProgress(
                status=JobStatus.pending,
                message=(
                    "Static replay job queued…"
                    if _is_static_replay(req)
                    else (
                        "Pro convergence job queued…"
                        if _is_pro_mode(req)
                        else "Backtest job queued…"
                    )
                ),
                trials_total=trials_total,
            ),
            "result": None,
            "report_cache": None,
            "error": None,
        }
        if continuation_snapshot is not None:
            snap = dict(continuation_snapshot)
            snap["prior_job_id"] = snap.get("prior_job_id") or req.continue_from_job_id
            _continuation_snapshots[job_id] = snap
    _evict_stale_report_caches(job_id)

    thread = threading.Thread(target=_run_job, args=(job_id, req), daemon=True)
    thread.start()
    return job_id


def _load_completed_job(job_id: str) -> tuple[BacktestRequest, BacktestResult] | None:
    with _lock:
        job = _jobs.get(job_id)
        if job and job.get("result") is not None and job.get("request") is not None:
            return job["request"], job["result"]
    loaded = load_persisted_job(job_id)
    if loaded is not None:
        req, result = loaded
        _hydrate_from_disk(job_id)
        return req, result
    return None


def continue_job(
    prior_job_id: str,
    *,
    extra_refinement_rounds: int = 4,
    extra_trials_per_round: int | None = None,
    extra_trials: int | None = None,
) -> str:
    """Queue a new job that carries over prior search state (below-benchmark refinement)."""
    loaded = _load_completed_job(prior_job_id)
    if loaded is None:
        raise LookupError("Prior job not found or not completed")
    prior_req, prior_result = loaded
    snapshot = extract_continuation_snapshot(prior_result)
    if snapshot is None:
        raise ValueError("Prior job has no continuation state")
    snapshot = dict(snapshot)
    snapshot["prior_job_id"] = prior_job_id
    new_req = apply_continuation_request(
        prior_req,
        snapshot,
        extra_refinement_rounds=extra_refinement_rounds,
        extra_trials_per_round=extra_trials_per_round,
        extra_trials=extra_trials,
        prior_job_id=prior_job_id,
    )
    return create_job(new_req, continuation_snapshot=snapshot)


def pop_continuation_snapshot(job_id: str) -> dict | None:
    with _lock:
        return _continuation_snapshots.pop(job_id, None)


def _run_job(job_id: str, req: BacktestRequest) -> None:
    def on_progress(**kwargs) -> None:
        with _lock:
            _jobs[job_id]["progress"] = JobProgress(
                status=JobStatus.running,
                message=_public_log_message(str(kwargs.get("message", ""))),
                trial=int(kwargs.get("trial", 0)),
                trials_total=int(kwargs.get("trials_total", _estimated_trials_total(req))),
                best_sharpe=kwargs.get("best_sharpe"),
                refinement_round=int(kwargs.get("refinement_round", 0)),
                refinement_rounds_total=int(kwargs.get("refinement_rounds_total", 0)),
                convergence_preview=kwargs.get("convergence_preview"),
                round_benchmark_status=kwargs.get("round_benchmark_status"),
                round_benchmark_alpha=kwargs.get("round_benchmark_alpha"),
                round_portfolio_vs_benchmark=kwargs.get("round_portfolio_vs_benchmark"),
            )

    try:
        with _lock:
            _jobs[job_id]["progress"] = JobProgress(
                status=JobStatus.running,
                message=(
                    "Static replay: fetching market data…"
                    if _is_static_replay(req)
                    else (
                        "Pro: fetching data, starting iterative search…"
                        if _is_pro_mode(req)
                        else "Fetching market data, starting optimization…"
                    )
                ),
                trials_total=_estimated_trials_total(req),
            )

        with _backtest_slot:
            result = run_backtest(req, job_id, progress_cb=on_progress)
        gc.collect()

        completed_trials = int(
            (result.narrative_facts or {}).get("trials_completed", req.trials)
        )
        with _lock:
            _jobs[job_id]["progress"] = JobProgress(
                status=JobStatus.completed,
                message="Pro convergence complete" if _is_pro_mode(req) else "Backtest complete",
                trial=completed_trials,
                trials_total=completed_trials,
                best_sharpe=result.candidates[0].sharpe if result.candidates else None,
            )
            _jobs[job_id]["result"] = result
        try:
            persist_completed_job(job_id, req, result)
        except Exception:  # noqa: BLE001
            pass
        _notify_async(job_id, req, status="completed", result=result)
    except Exception as exc:  # noqa: BLE001
        err_text = str(exc)
        tb = traceback.format_exc()
        logger.error("Backtest job %s failed: %s\n%s", job_id, err_text, tb)
        with _lock:
            _jobs[job_id]["progress"] = JobProgress(
                status=JobStatus.failed,
                message=_public_log_message(err_text),
                trials_total=_estimated_trials_total(req),
            )
            _jobs[job_id]["error"] = err_text
            _jobs[job_id]["error_traceback"] = tb
        _notify_async(job_id, req, status="failed", error=_public_log_message(err_text))


def _hydrate_from_disk(job_id: str) -> bool:
    """Load persisted job into memory when evicted from the in-memory store."""
    loaded = load_persisted_job(job_id)
    if loaded is None:
        return False
    req, result = loaded
    with _lock:
        if job_id in _jobs:
            return True
        _jobs[job_id] = {
            "request": req,
            "progress": JobProgress(
                status=JobStatus.completed,
                message="Backtest complete",
                trials_total=int((result.narrative_facts or {}).get("trials_completed", req.trials)),
                trial=int((result.narrative_facts or {}).get("trials_completed", req.trials)),
                best_sharpe=result.candidates[0].sharpe if result.candidates else None,
            ),
            "result": result,
            "report_cache": None,
            "error": None,
        }
    return True


def get_progress(job_id: str) -> JobProgress | None:
    with _lock:
        job = _jobs.get(job_id)
        if job:
            return job["progress"]
    if _hydrate_from_disk(job_id):
        with _lock:
            job = _jobs.get(job_id)
            return job["progress"] if job else None
    return None


def get_result(job_id: str) -> BacktestResult | None:
    with _lock:
        job = _jobs.get(job_id)
        if job and job.get("result") is not None:
            return job["result"]
    if _hydrate_from_disk(job_id):
        with _lock:
            job = _jobs.get(job_id)
            return job["result"] if job else None
    return None


def list_jobs(*, limit: int = 30) -> list[JobSummary]:
    """Recent completed jobs (disk index + in-memory completed not yet indexed)."""
    summaries = list_job_summaries(limit=limit)
    seen = {s.job_id for s in summaries}
    with _lock:
        for job_id, job in _jobs.items():
            if job_id in seen:
                continue
            progress = job.get("progress")
            result = job.get("result")
            req = job.get("request")
            if (
                progress
                and progress.status == JobStatus.completed
                and result is not None
                and req is not None
            ):
                from app.job_history import build_summary

                summaries.insert(0, build_summary(job_id, req, result))
                seen.add(job_id)
    return summaries[: max(1, min(int(limit), 50))]


def patch_narrative_facts(job_id: str, patch: dict) -> bool:
    """Merge keys into stored result narrative_facts (e.g. AI compare champion)."""
    with _lock:
        job = _jobs.get(job_id)
        if not job or job.get("result") is None:
            return False
        result = job["result"]
        facts = dict(result.narrative_facts or {})
        facts.update(patch)
        result.narrative_facts = facts
        return True


def stash_trial_report_cache(job_id: str, cache: TrialReportCache) -> None:
    """Retain per-trial sim bundles for lazy chart loads (in-memory, one job at a time)."""
    with _lock:
        job = _jobs.get(job_id)
        if job is not None:
            job["report_cache"] = cache


def get_report_cache(job_id: str) -> TrialReportCache | None:
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return None
        cache = job.get("report_cache")
        return cache if isinstance(cache, TrialReportCache) else None


def get_request(job_id: str) -> BacktestRequest | None:
    with _lock:
        job = _jobs.get(job_id)
        if job:
            return job.get("request")
    if _hydrate_from_disk(job_id):
        with _lock:
            job = _jobs.get(job_id)
            return job.get("request") if job else None
    return None


def _patch_candidate_charts(
    result: BacktestResult,
    resolved: ResolvedCandidate,
    payload: CandidateChartsPayload,
) -> None:
    code = str(payload.model_code or "")
    if resolved.source == "final":
        result.candidates = [
            merge_charts_into_candidate(c, payload)
            if str(c.model_code or "") == code
            else c
            for c in result.candidates
        ]
        return
    idx = resolved.pro_round_index
    if idx is None or not result.pro_rounds or idx >= len(result.pro_rounds):
        return
    pr = result.pro_rounds[idx]
    pr.candidates = [
        merge_charts_into_candidate(c, payload)
        if str(c.model_code or "") == code
        else c
        for c in pr.candidates
    ]
    result.pro_rounds[idx] = pr
    for i, c in enumerate(result.candidates):
        if str(c.model_code or "") == code:
            result.candidates[i] = merge_charts_into_candidate(c, payload)
            break


def get_candidate_charts(
    job_id: str,
    model_code: str,
    *,
    rank: int | None = None,
) -> CandidateChartsPayload:
    """Lazy chart payload for one candidate; patches stored result after rebuild."""
    _hydrate_from_disk(job_id)
    with _lock:
        job = _jobs.get(job_id)
        if not job or job.get("result") is None:
            raise LookupError("Job not found or result not ready")
        req = job["request"]
        result = job["result"]
        cache = job.get("report_cache")
        resolved = resolve_candidate(result, model_code, rank=rank)

    payload = resolve_candidate_charts(
        req,
        result,
        model_code,
        rank=rank,
        trial_report_cache=cache if isinstance(cache, TrialReportCache) else None,
    )

    with _lock:
        job = _jobs.get(job_id)
        if not job or job.get("result") is None:
            return payload
        _patch_candidate_charts(job["result"], resolved, payload)
    return payload
