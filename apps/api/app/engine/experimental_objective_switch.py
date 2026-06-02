"""Sandbox objective-switch diagnostics and A/B evaluation helpers."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from app.engine.optimizer import run_optuna_search
from app.engine.refinement import assign_search_model_codes, best_record_in_pool
from app.models import BacktestRequest, PortfolioCandidate
from app.engine.spec import BacktestSpec
from app.engine.report_sim_cache import TrialReportCache


def is_experimental_objective_switch_enabled(req: BacktestRequest) -> bool:
    exp = req.experiment
    return bool(exp and exp.enabled and exp.mode == "objective_switch")


def objective_switch_metadata(
    req: BacktestRequest,
    prices: pd.DataFrame,
    benchmark_ticker: str,
) -> dict[str, Any]:
    """Sandbox-only objective-switch diagnostics. Does not mutate core objective."""
    exp = req.experiment
    requested_mode = str(getattr(exp, "regime_mode", "auto")).lower()
    bench = benchmark_ticker if benchmark_ticker in prices.columns else prices.columns[0]
    bench_ret = prices[bench].pct_change().dropna()
    lookback_days = int(min(max(len(bench_ret), 1), 63))
    window = bench_ret.tail(lookback_days)
    trailing_return = float(window.sum()) if len(window) else 0.0
    annualized_vol = float(window.std(ddof=0) * np.sqrt(252.0)) if len(window) > 1 else 0.0

    if requested_mode == "risk_off":
        regime_signal = "risk_off"
    elif requested_mode == "risk_on":
        regime_signal = "risk_on"
    elif requested_mode == "neutral":
        regime_signal = "neutral"
    else:
        if trailing_return < -0.01 or annualized_vol > 0.24:
            regime_signal = "risk_off"
        elif trailing_return > 0.015 and annualized_vol < 0.18:
            regime_signal = "risk_on"
        else:
            regime_signal = "neutral"

    chosen_objective = {
        "risk_off": "min_max_drawdown",
        "neutral": "max_sharpe",
        "risk_on": "max_return",
    }[regime_signal]

    switch_count, regime_labels = _walk_forward_regime_labels(bench_ret, requested_mode)

    reason = (
        f"Sandbox heuristic on {bench} over {lookback_days} days: "
        f"return={trailing_return:.4f}, annualized_vol={annualized_vol:.4f}, "
        f"regime={regime_signal}."
    )
    return {
        "mode": "objective_switch",
        "enabled": True,
        "requested_regime_mode": requested_mode,
        "resolved_regime_signal": regime_signal,
        "chosen_objective": chosen_objective,
        "reason": reason,
        "benchmark_ticker": bench,
        "lookback_days": lookback_days,
        "regime_switch_count": switch_count,
        "regime_labels_sample": regime_labels[-6:],
    }


def _resolve_regime_signal(
    window: pd.Series,
    requested_mode: str,
) -> str:
    if requested_mode == "risk_off":
        return "risk_off"
    if requested_mode == "risk_on":
        return "risk_on"
    if requested_mode == "neutral":
        return "neutral"
    trailing_return = float(window.sum()) if len(window) else 0.0
    annualized_vol = float(window.std(ddof=0) * np.sqrt(252.0)) if len(window) > 1 else 0.0
    if trailing_return < -0.01 or annualized_vol > 0.24:
        return "risk_off"
    if trailing_return > 0.015 and annualized_vol < 0.18:
        return "risk_on"
    return "neutral"


def _walk_forward_regime_labels(
    bench_ret: pd.Series,
    requested_mode: str,
    *,
    step_days: int = 21,
    lookback_days: int = 63,
) -> tuple[int, list[str]]:
    if len(bench_ret) < lookback_days + step_days:
        return 0, []
    labels: list[str] = []
    prev: str | None = None
    switches = 0
    for end in range(lookback_days, len(bench_ret), step_days):
        window = bench_ret.iloc[end - lookback_days : end]
        signal = _resolve_regime_signal(window, requested_mode)
        labels.append(signal)
        if prev is not None and signal != prev:
            switches += 1
        prev = signal
    return switches, labels


def _arm_metrics_from_candidate(candidate: PortfolioCandidate) -> dict[str, Any]:
    sm = (candidate.analytics or {}).get("sample_metrics") or {}
    is_m = sm.get("in_sample") or {}
    oos_m = sm.get("out_of_sample") or {}
    full_m = sm.get("full_sample") or {}
    return {
        "sharpe": candidate.sharpe,
        "cagr": candidate.cagr,
        "max_drawdown": candidate.max_drawdown,
        "train_sharpe": candidate.train_sharpe,
        "validation_sharpe": candidate.validation_sharpe,
        "in_sample_sharpe": is_m.get("sharpe"),
        "out_of_sample_sharpe": oos_m.get("sharpe"),
        "full_sample_sharpe": full_m.get("sharpe"),
    }


def build_evaluation_summary(
    *,
    req: BacktestRequest,
    user_objective: str,
    experimental_meta: dict[str, Any],
    champion: PortfolioCandidate,
    switch_arm_metrics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    switch_objective = str(experimental_meta.get("chosen_objective", ""))
    fixed_metrics = _arm_metrics_from_candidate(champion)
    summary: dict[str, Any] = {
        "disclaimer": (
            "Primary backtest always uses your configured objective. "
            "Switch-policy objective is a sandbox recommendation unless A/B evaluation was run."
        ),
        "user_objective": user_objective,
        "switch_objective": switch_objective,
        "objectives_match": user_objective == switch_objective,
        "fixed_arm": {
            "label": "Your config (actual run)",
            "objective": user_objective,
            **fixed_metrics,
            "regime_signal": experimental_meta.get("resolved_regime_signal"),
            "regime_mode": experimental_meta.get("requested_regime_mode"),
        },
        "switch_arm": None,
        "ab_evaluation_ran": switch_arm_metrics is not None,
    }
    if switch_arm_metrics is not None:
        summary["switch_arm"] = {
            "label": "Switch policy (lightweight eval)",
            "objective": switch_objective,
            **switch_arm_metrics,
            "trials_used": switch_arm_metrics.get("trials_used"),
        }
        fs = fixed_metrics.get("out_of_sample_sharpe") or fixed_metrics.get("sharpe")
        ss = switch_arm_metrics.get("out_of_sample_sharpe") or switch_arm_metrics.get("sharpe")
        if fs is not None and ss is not None:
            summary["oos_sharpe_delta_switch_minus_fixed"] = float(ss) - float(fs)
    return summary


def run_switch_arm_lightweight(
    *,
    req: BacktestRequest,
    switch_objective: str,
    prices_train: pd.DataFrame,
    prices_val: pd.DataFrame,
    oos: bool,
    rebalance_rule: str,
    spec: BacktestSpec,
    universe_by_ticker: dict[str, dict[str, Any]],
    param_controls_dict: dict[str, Any],
    trial_report_cache: TrialReportCache,
    assemble_top_candidate,
) -> dict[str, Any]:
    """Second lightweight Optuna pass under switch-suggested objective."""
    eval_trials = max(5, min(int(req.trials), 20))
    controls = dict(param_controls_dict)
    controls["objective_mode"] = {
        "mode": "fixed",
        "fixed": switch_objective,
        "options": [switch_objective],
    }
    records = run_optuna_search(
        prices_train,
        max_weight=req.max_weight,
        max_turnover=req.max_turnover,
        top_n=req.top_n,
        objective=switch_objective,
        trials=eval_trials,
        ai_seed_param_sets=[],
        param_controls=controls,
        spec=spec,
        progress_cb=None,
        universe_by_ticker=universe_by_ticker,
        prices_val=prices_val if oos and len(prices_val) > 60 else None,
        overfitting_penalty_weight=float(req.overfitting_penalty_weight)
        if oos
        else 0.0,
        apply_holdout_penalty=bool(oos and req.overfitting_penalty_weight > 0),
        select_on_is=bool(oos and len(prices_val) > 60),
        asset_classes=req.asset_classes,
        trial_report_cache=trial_report_cache,
    )
    if not records:
        return {"trials_used": eval_trials, "error": "no_feasible_trials"}
    assign_search_model_codes(records, next_model_no=[9001])
    best_rec = best_record_in_pool(records, switch_objective)
    candidates = assemble_top_candidate(records=[best_rec], objective=switch_objective)
    if not candidates:
        return {"trials_used": eval_trials, "error": "assembly_failed"}
    metrics = _arm_metrics_from_candidate(candidates[0])
    metrics["trials_used"] = eval_trials
    return metrics
