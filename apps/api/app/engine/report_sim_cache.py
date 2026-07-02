"""Cache simulation outputs from Optuna trials for report assembly.

Trials already run in-sample (and holdout) simulates for scoring; this module
retains stripped copies keyed by model signature so assembly can skip redundant
re-runs. Full-period simulates with weight history are only required once per
assembled model when not already captured during scoring.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any

from app.engine.memory_budget import slim_search_metrics
from app.engine.refinement import model_signature

_SIM_KEYS = frozenset(
    {
        "sharpe",
        "max_drawdown",
        "cagr",
        "volatility",
        "sortino",
        "calmar",
        "var_95",
        "cvar_95",
        "win_rate",
        "turnover_avg",
        "turnover_total",
        "turnover_median",
        "turnover_max",
        "max_drawdown_duration_days",
        "metrics_suspect",
        "equity",
        "port_ret",
        "last_weights",
        "avg_weights",
        "rebalance_count",
        "rebalance_applied",
        "rebalance_skipped",
        "rebalance_freq",
        "rebalance_dates",
        "factor_summary",
        "weight_cap_audit",
    }
)


def cache_key_for_params(params: dict[str, Any]) -> str:
    code = params.get("model_code")
    if code:
        return f"code:{code}"
    return f"sig:{model_signature(params)}"


def _strip_sim_for_cache(sim: dict[str, Any] | None) -> dict[str, Any] | None:
    if sim is None:
        return None
    out: dict[str, Any] = {}
    for k in _SIM_KEYS:
        if k in sim:
            out[k] = sim[k]
    return out


def _needs_full_with_weights(full_m: dict[str, Any] | None) -> bool:
    if full_m is None:
        return True
    wh = full_m.get("weight_history")
    return not wh


@dataclass
class ReportSimBundle:
    train_m: dict[str, Any] | None = None
    val_m: dict[str, Any] | None = None
    full_m: dict[str, Any] | None = None

    def complete_for_oos(self, *, oos: bool, val_required: bool) -> bool:
        if self.train_m is None:
            return False
        if oos and val_required and self.val_m is None:
            return False
        if self.full_m is None:
            return False
        if _needs_full_with_weights(self.full_m):
            return False
        return True

    def complete_no_oos(self) -> bool:
        return self.full_m is not None and not _needs_full_with_weights(self.full_m)


@dataclass
class TrialReportCache:
    """Per-job cache: latest trial sim per signature (weight_history stripped)."""

    _by_key: dict[str, ReportSimBundle] = field(default_factory=dict)
    _sig_to_code: dict[str, str] = field(default_factory=dict)

    def register_model_code(self, params: dict[str, Any]) -> None:
        code = params.get("model_code")
        if not code:
            return
        sig = model_signature(params)
        code_s = str(code)
        self._sig_to_code[sig] = code_s
        # If the same signature was already stashed under sig:..., alias it to
        # code:... so callers that request by model_code can hit immediately.
        bundle = self._by_key.get(f"sig:{sig}")
        if bundle is not None:
            self._by_key[f"code:{code_s}"] = bundle

    def stash_from_trial(
        self,
        params: dict[str, Any],
        *,
        train_m: dict[str, Any] | None,
        val_m: dict[str, Any] | None,
        full_m: dict[str, Any] | None,
        retain_weight_history: bool = False,
    ) -> None:
        """Store latest trial sim slices for this parameter set (no weight_history)."""
        sig = model_signature(params)
        code = params.get("model_code")
        if code:
            code_s = str(code)
            bundle = self._by_key.get(f"code:{code_s}") or ReportSimBundle()
        else:
            bundle = self._by_key.get(f"sig:{sig}") or ReportSimBundle()
        if train_m is not None:
            bundle.train_m = _strip_sim_for_cache(train_m)
        if val_m is not None:
            bundle.val_m = _strip_sim_for_cache(val_m)
        if full_m is not None:
            bundle.full_m = _strip_sim_for_cache(full_m)
            if retain_weight_history:
                wh = full_m.get("weight_history")
                if wh:
                    if bundle.full_m is None:
                        bundle.full_m = {}
                    bundle.full_m["weight_history"] = wh
                    wht = full_m.get("weight_history_tickers")
                    if wht:
                        bundle.full_m["weight_history_tickers"] = wht
        if code:
            code_s = str(code)
            self._by_key[f"code:{code_s}"] = bundle
            self._sig_to_code[sig] = code_s
        else:
            self._by_key[f"sig:{sig}"] = bundle

    def drop_model_codes(self, codes: set[str] | frozenset[str]) -> None:
        """Release cache entries for retired Pro model codes (frees RAM, avoids stale aliases)."""
        if not codes:
            return
        drop = {str(c) for c in codes if c}
        stale_sigs = [sig for sig, code in self._sig_to_code.items() if code in drop]
        for sig in stale_sigs:
            self._sig_to_code.pop(sig, None)
            self._by_key.pop(f"sig:{sig}", None)
        for code in drop:
            self._by_key.pop(f"code:{code}", None)

    def get_bundle(self, params: dict[str, Any]) -> ReportSimBundle | None:
        code = params.get("model_code")
        if code:
            hit = self._by_key.get(f"code:{code}")
            if hit is not None:
                return hit
        sig = model_signature(params)
        sig_key = f"sig:{sig}"
        hit = self._by_key.get(sig_key)
        if hit is not None:
            return hit
        if code:
            code_s = str(code)
            if self._sig_to_code.get(sig) == code_s:
                return self._by_key.get(f"code:{code_s}")
        return None

    def refresh_from_record_metrics(
        self, params: dict[str, Any], metrics: dict[str, Any]
    ) -> None:
        """Re-stash per-trial IS/OOS from optimizer snapshots keyed by model_code."""
        code = params.get("model_code")
        train_snap = metrics.get("train_metrics")
        if not code or not isinstance(train_snap, dict) or not train_snap:
            return
        val_snap = metrics.get("validation_metrics")
        val_m = copy.deepcopy(val_snap) if isinstance(val_snap, dict) else None
        existing = self.get_bundle(params)
        full_m = existing.full_m if existing else None
        self.stash_from_trial(
            params,
            train_m=copy.deepcopy(train_snap),
            val_m=val_m,
            full_m=full_m,
        )

    def backfill_from_search_record(
        self,
        params: dict[str, Any],
        metrics: dict[str, Any],
        *,
        has_holdout: bool,
        select_on_is: bool,
    ) -> None:
        """Populate cache from a search record when trial stash was missed (e.g. pool-only incoming champion)."""
        if self.get_bundle(params) is not None:
            self.register_model_code(params)
            return
        if not metrics or not isinstance(metrics, dict):
            return
        metrics = slim_search_metrics(metrics)
        train_snap = metrics.get("train_metrics")
        train_m: dict[str, Any] | None = (
            copy.deepcopy(train_snap)
            if isinstance(train_snap, dict) and train_snap
            else copy.deepcopy(metrics)
        )
        val_snap = metrics.get("validation_metrics")
        val_m: dict[str, Any] | None = (
            copy.deepcopy(val_snap) if isinstance(val_snap, dict) else None
        )
        full_m: dict[str, Any] | None = None
        if has_holdout:
            if select_on_is:
                full_m = None
            else:
                full_m = metrics
        else:
            full_m = metrics
        self.stash_from_trial(
            params,
            train_m=train_m,
            val_m=val_m,
            full_m=full_m,
        )

    def copy_bundle(self, params: dict[str, Any]) -> ReportSimBundle | None:
        b = self.get_bundle(params)
        if b is None:
            return None
        return ReportSimBundle(
            train_m=copy.copy(b.train_m) if b.train_m else None,
            val_m=copy.copy(b.val_m) if b.val_m else None,
            full_m=copy.copy(b.full_m) if b.full_m else None,
        )
