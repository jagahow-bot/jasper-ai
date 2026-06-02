"""Legacy sandbox helpers — prefer Objective Switch Lab API for evaluation."""

from __future__ import annotations

from typing import Any

import pandas as pd

from app.engine.regime_policy import (
    current_regime_snapshot,
    objective_for_regime,
    resolve_regime_signal,
    walk_forward_regime_timeline,
)
from app.models import BacktestRequest


def is_experimental_objective_switch_enabled(req: BacktestRequest) -> bool:
    exp = req.experiment
    return bool(exp and exp.enabled and exp.mode == "objective_switch")


def objective_switch_metadata(
    req: BacktestRequest,
    prices: pd.DataFrame,
    benchmark_ticker: str,
) -> dict[str, Any]:
    """Diagnostics only — full evaluation lives in Objective Switch Lab."""
    exp = req.experiment
    requested_mode = str(getattr(exp, "regime_mode", "auto")).lower()
    bench = benchmark_ticker if benchmark_ticker in prices.columns else prices.columns[0]
    bench_ret = prices[bench].pct_change().dropna()
    snap = current_regime_snapshot(bench_ret, requested_mode)
    switch_count, labels_raw = walk_forward_regime_timeline(bench_ret, requested_mode)
    labels = [str(r.get("regime", "")) for r in labels_raw]

    reason = (
        f"Sandbox heuristic on {bench} over {snap['lookback_days']} days: "
        f"return={snap['trailing_return']:.4f}, annualized_vol={snap['annualized_vol']:.4f}, "
        f"regime={snap['regime']}."
    )
    return {
        "mode": "objective_switch",
        "enabled": True,
        "requested_regime_mode": requested_mode,
        "resolved_regime_signal": snap["regime"],
        "chosen_objective": snap["objective"],
        "reason": reason,
        "benchmark_ticker": bench,
        "lookback_days": snap["lookback_days"],
        "regime_switch_count": switch_count,
        "regime_labels_sample": labels[-6:],
        "lab_note": "Use POST /lab/objective-switch/evaluate for standalone A/B evaluation.",
    }
