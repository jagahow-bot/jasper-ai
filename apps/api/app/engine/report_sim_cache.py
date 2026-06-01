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
        self._sig_to_code[model_signature(params)] = str(code)

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
        self.register_model_code(params)
        key = cache_key_for_params(params)
        bundle = self._by_key.get(key) or ReportSimBundle()
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
        self._by_key[key] = bundle
        sig = model_signature(params)
        if params.get("model_code"):
            self._sig_to_code[sig] = str(params["model_code"])

    def get_bundle(self, params: dict[str, Any]) -> ReportSimBundle | None:
        key = cache_key_for_params(params)
        hit = self._by_key.get(key)
        if hit is not None:
            return hit
        sig = model_signature(params)
        code = self._sig_to_code.get(sig) or params.get("model_code")
        if code:
            return self._by_key.get(f"code:{code}")
        return self._by_key.get(f"sig:{sig}")

    def copy_bundle(self, params: dict[str, Any]) -> ReportSimBundle | None:
        b = self.get_bundle(params)
        if b is None:
            return None
        return ReportSimBundle(
            train_m=copy.copy(b.train_m) if b.train_m else None,
            val_m=copy.copy(b.val_m) if b.val_m else None,
            full_m=copy.copy(b.full_m) if b.full_m else None,
        )
