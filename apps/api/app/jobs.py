import threading
import uuid

from app.candidate_charts import (
    ResolvedCandidate,
    merge_charts_into_candidate,
    resolve_candidate,
    resolve_candidate_charts,
)
from app.engine.backtest import run_backtest, _is_pro_mode
from app.engine.report_sim_cache import TrialReportCache
from app.models import (
    BacktestRequest,
    BacktestResult,
    CandidateChartsPayload,
    JobProgress,
    JobStatus,
)


_jobs: dict[str, dict] = {}
_lock = threading.Lock()


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


def _estimated_trials_total(req: BacktestRequest) -> int:
    if _is_pro_mode(req):
        batch0 = int(req.refinement_batch_size)
        challengers = int(req.refinement_challengers_per_round)
        max_rounds = int(req.refinement_max_rounds)
        return batch0 + (challengers + 1) * max(0, max_rounds - 1)
    return req.trials


def create_job(req: BacktestRequest) -> str:
    job_id = str(uuid.uuid4())
    trials_total = _estimated_trials_total(req)
    with _lock:
        _jobs[job_id] = {
            "request": req,
            "progress": JobProgress(
                status=JobStatus.pending,
                message=(
                    "Pro convergence job queued…"
                    if _is_pro_mode(req)
                    else "Backtest job queued…"
                ),
                trials_total=trials_total,
            ),
            "result": None,
            "report_cache": None,
            "error": None,
        }

    thread = threading.Thread(target=_run_job, args=(job_id, req), daemon=True)
    thread.start()
    return job_id


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
                    "Pro: fetching data, starting iterative search…"
                    if _is_pro_mode(req)
                    else "Fetching market data, starting optimization…"
                ),
                trials_total=_estimated_trials_total(req),
            )

        result = run_backtest(req, job_id, progress_cb=on_progress)

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
    except Exception as exc:  # noqa: BLE001
        with _lock:
            _jobs[job_id]["progress"] = JobProgress(
                status=JobStatus.failed,
                message=_public_log_message(str(exc)),
                trials_total=_estimated_trials_total(req),
            )
            _jobs[job_id]["error"] = str(exc)


def get_progress(job_id: str) -> JobProgress | None:
    with _lock:
        job = _jobs.get(job_id)
        return job["progress"] if job else None


def get_result(job_id: str) -> BacktestResult | None:
    with _lock:
        job = _jobs.get(job_id)
        return job["result"] if job else None


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
        if not job:
            return None
        return job.get("request")


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
