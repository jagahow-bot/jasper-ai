"""Memory budget helpers for Optuna search and API responses (Render 512MB-safe)."""

from __future__ import annotations

import copy
import gc
import os
from typing import Any

from app.engine.refinement import model_signature

# Keys dropped from in-memory search records after trial_report_cache stash.
_HEAVY_METRIC_KEYS = frozenset(
    {
        "equity",
        "port_ret",
        "factor_summary",
        "weight_history",
        "weight_history_tickers",
        "weight_cap_audit",
        "rebalance_dates",
        "last_weights",
        "avg_weights",
    }
)

_DEFAULT_SEARCH_RECORD_CAP = 64
_DEFAULT_RENDER_SEARCH_RECORD_CAP = 48
_DEFAULT_WEIGHT_HISTORY_TICKER_CAP = 28
_DEFAULT_WEIGHT_HISTORY_ROW_CAP = 72
_DEFAULT_RENDER_TRIALS_CAP = 30
_DEFAULT_UNIVERSE_TICKER_CAP = 28


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return max(1, int(raw))
    except ValueError:
        return default


def is_render_runtime() -> bool:
    return bool(os.environ.get("RENDER") or os.environ.get("RENDER_SERVICE_ID"))


def optuna_n_jobs() -> int:
    """Single-process Optuna on Render avoids duplicate price panels in worker RAM."""
    raw = os.environ.get("OPTUNA_N_JOBS", "").strip()
    if raw:
        try:
            return max(1, int(raw))
        except ValueError:
            pass
    return 1 if is_render_runtime() else 1


def search_records_cap() -> int:
    default = (
        _DEFAULT_RENDER_SEARCH_RECORD_CAP
        if is_render_runtime()
        else _DEFAULT_SEARCH_RECORD_CAP
    )
    return _env_int("SEARCH_RECORDS_MAX", default)


def render_trials_cap() -> int | None:
    """Max Optuna trials per standard-mode job on Render (None = no cap)."""
    if not is_render_runtime():
        return None
    return _env_int("RENDER_TRIALS_CAP", _DEFAULT_RENDER_TRIALS_CAP)


def cap_trials_for_runtime(trials: int, *, pro_mode: bool = False) -> int:
    if pro_mode:
        return trials
    cap = render_trials_cap()
    if cap is None:
        return trials
    return min(int(trials), cap)


def universe_ticker_cap() -> int | None:
    if not is_render_runtime():
        return None
    return _env_int("UNIVERSE_TICKER_CAP", _DEFAULT_UNIVERSE_TICKER_CAP)


def cap_universe_for_runtime(
    universe: list[dict[str, Any]],
    *,
    pinned_tickers: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Trim tradable universe on memory-constrained hosts; keep pinned supplements first."""
    cap = universe_ticker_cap()
    if cap is None or len(universe) <= cap:
        return universe
    pinned = {str(t).upper() for t in (pinned_tickers or [])}
    pinned_items = [
        u for u in universe if str(u.get("ticker", "")).upper() in pinned
    ]
    rest = [u for u in universe if str(u.get("ticker", "")).upper() not in pinned]
    if len(pinned_items) >= cap:
        return pinned_items[:cap]
    slots = cap - len(pinned_items)
    return pinned_items + rest[:slots]


def weight_history_ticker_cap() -> int:
    return _env_int("WEIGHT_HISTORY_TICKER_CAP", _DEFAULT_WEIGHT_HISTORY_TICKER_CAP)


def metrics_with_port_ret_from_cache(
    metrics: dict[str, Any],
    params: dict[str, Any],
    cache: Any | None,
) -> dict[str, Any]:
    """Merge port_ret from TrialReportCache for round benchmark when metrics were slimmed."""
    if metrics.get("port_ret") is not None:
        return metrics
    if cache is None:
        return metrics
    bundle = cache.get_bundle(params)
    if bundle is None or bundle.train_m is None:
        return metrics
    pr = bundle.train_m.get("port_ret")
    if pr is None:
        return metrics
    out = dict(metrics)
    out["port_ret"] = pr
    return out


def slim_search_metrics(metrics: dict[str, Any]) -> dict[str, Any]:
    """Drop series/large blobs retained in TrialReportCache for report assembly."""
    if not metrics:
        return metrics
    out: dict[str, Any] = {}
    for k, v in metrics.items():
        if k in _HEAVY_METRIC_KEYS:
            continue
        if k in {
            "overfitting_assessment",
            "train_metrics",
            "validation_metrics",
            "full_metrics",
        }:
            out[k] = copy.deepcopy(v) if isinstance(v, dict) else v
        else:
            out[k] = v
    return out


def downsample_keep_endpoints(items: list[Any], cap: int) -> list[Any]:
    """Evenly sample list entries, always keeping first and last (timeline tail preserved)."""
    n = len(items)
    if n <= cap or cap <= 0:
        return list(items)
    if cap == 1:
        return [items[-1]]
    indices = {int(round(i * (n - 1) / (cap - 1))) for i in range(cap)}
    return [items[i] for i in sorted(indices)]


def trim_weight_history_for_response(
    weight_history: list[dict[str, Any]] | None,
    *,
    tickers: list[str] | None = None,
    max_tickers: int | None = None,
    max_rows: int | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Cap weight chart payload size for API JSON without changing simulation."""
    wh = list(weight_history or [])
    if not wh:
        return [], list(tickers or [])
    cap_t = max_tickers if max_tickers is not None else weight_history_ticker_cap()
    cap_r = max_rows if max_rows is not None else _DEFAULT_WEIGHT_HISTORY_ROW_CAP
    explicit_tickers = list(tickers or [])
    if len(wh) > cap_r:
        wh = downsample_keep_endpoints(wh, cap_r)
    keep = explicit_tickers
    if not keep and wh:
        keys = [k for k in wh[0] if k not in ("date", "OTHER")]
        keep = keys[:cap_t]
    # Respect simulation-selected sleeves; re-ranking inflates Other on the chart.
    elif explicit_tickers:
        keep = explicit_tickers
    if not explicit_tickers and len(keep) > cap_t:
        ranked: list[tuple[str, float]] = []
        for t in keep:
            peak = max(float(row.get(t, 0.0) or 0.0) for row in wh)
            ranked.append((t, peak))
        ranked.sort(key=lambda x: x[1], reverse=True)
        keep = [t for t, _ in ranked[:cap_t]]
    trimmed: list[dict[str, Any]] = []
    for row in wh:
        out = {"date": row.get("date")}
        keep_sum = 0.0
        for t in keep:
            v = float(row.get(t, 0.0) or 0.0)
            out[t] = v
            keep_sum += v
        out["OTHER"] = max(0.0, float(1.0 - keep_sum))
        trimmed.append(out)
    return trimmed, keep


def prune_search_records(
    records: list[tuple[float, dict, dict]],
    *,
    max_records: int | None = None,
    protect_signatures: set[str] | None = None,
) -> None:
    """In-place cap on trial records list while keeping protected champions."""
    cap = max_records if max_records is not None else search_records_cap()
    if len(records) <= cap:
        return
    protect = protect_signatures or set()
    protected: list[tuple[float, dict, dict]] = []
    rest: list[tuple[float, dict, dict]] = []
    for rec in records:
        sig = model_signature(rec[1])
        if sig in protect:
            protected.append(rec)
        else:
            rest.append(rec)
    rest.sort(key=lambda r: r[0], reverse=True)
    slots = max(0, cap - len(protected))
    records[:] = protected + rest[:slots]


def maybe_collect_garbage(every_n: int, counter: int) -> None:
    if every_n > 0 and counter > 0 and counter % every_n == 0:
        gc.collect()
