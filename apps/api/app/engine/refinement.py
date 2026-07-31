"""Iterative champion-challenger refinement and overfitting assessment."""

from __future__ import annotations

import copy
import json
import re
from typing import Any, Literal

import pandas as pd

BenchmarkStatus = Literal["above", "below", "unknown"]

from app.engine.analytics import benchmark_relative
from app.engine.dynamic_objective import is_dynamic_objective, trial_scoring_objective
from app.engine.objectives import (
    compute_objective_score,
    metrics_snapshot,
    objective_label,
)
from app.engine.portfolio import metrics_for_horizon_window, stitch_full_path_from_slices
from app.engine.ai_json import dumps_for_ai, round_ai_float, sanitize_for_ai
from app.engine.param_taxonomy import summarize_prior_round_seed
from app.engine.spec import BacktestSpec, DEFAULT_SPEC


def model_signature(params: dict[str, Any]) -> str:
    """Stable identity for portfolio params across rounds (excludes run metadata)."""
    ignored = {
        "raw_score",
        "adjusted_score",
        "param_source",
        "in_sample_objective",
        "out_of_sample_objective",
        "gap_objective",
        "pro_round_role",
        "pro_round_index",
        "model_code",
        "bounds_violations",
        "objective_mode",
        "allocator_mode",
        "select_on_is",
    }
    base = {k: v for k, v in params.items() if k not in ignored}
    return json.dumps(base, sort_keys=True, ensure_ascii=False, default=str)


def params_for_champion_seed(params: dict[str, Any]) -> dict[str, Any]:
    """Strip run metadata before Optuna enqueue so seeds match trial signatures."""
    skip = {
        "raw_score",
        "adjusted_score",
        "param_source",
        "in_sample_objective",
        "out_of_sample_objective",
        "gap_objective",
        "pro_round_role",
        "pro_round_index",
        "model_code",
        "bounds_violations",
    }
    return {k: v for k, v in params.items() if k not in skip}


def _optuna_trial_sort_key(params: dict) -> tuple[int, int]:
    try:
        return (int(params.get("optuna_trial_number", 10**9)), 0)
    except (TypeError, ValueError):
        return (10**9, id(params))


def records_in_optuna_trial_order(
    records: list[tuple[float, dict, dict]],
) -> list[tuple[float, dict, dict]]:
    """Stable Optuna trial order (trial number, not completion or objective)."""
    return sorted(records, key=lambda r: _optuna_trial_sort_key(r[1]))


_MODEL_CODE_RE = re.compile(r"^M(\d+)$", re.I)


def model_code_sort_key(code: str | None) -> tuple[int, str]:
    """Numeric catalog order for M#### codes; unknown codes sort last."""
    raw = str(code or "").strip()
    m = _MODEL_CODE_RE.match(raw)
    if m:
        return (int(m.group(1)), "")
    return (10**9, raw)


def records_in_model_code_order(
    records: list[tuple[float, dict, dict]],
) -> list[tuple[float, dict, dict]]:
    """Presentation order by catalog model_code (M0001, M0002, …)."""
    return sorted(
        records,
        key=lambda r: model_code_sort_key(str(r[1].get("model_code", ""))),
    )


def top_records_for_report(
    records: list[tuple[float, dict, dict]],
    objective_effective: str,
    top_n_models: int,
) -> list[tuple[float, dict, dict]]:
    """Pick top-N by objective, return sorted by model_code for display."""
    ranked = sorted(
        records,
        key=lambda r: record_objective_sort_value(objective_effective, r[0], r[2]),
        reverse=True,
    )[:top_n_models]
    return records_in_model_code_order(ranked)


def assign_search_model_codes(
    records: list[tuple[float, dict, dict]],
    *,
    next_model_no: list[int],
) -> None:
    """Assign model_code from Optuna trial number (M0001 = trial 0).

    model_code is immutable after search assignment; the report phase must only read
    params["model_code"] and must not re-encode via signature maps.
    """
    for _score, params, _metrics in records:
        if params.get("model_code"):
            continue
        try:
            trial_no = int(params["optuna_trial_number"])
            params["model_code"] = f"M{trial_no + 1:04d}"
            continue
        except (KeyError, TypeError, ValueError):
            pass
        code = f"M{next_model_no[0]:04d}"
        next_model_no[0] += 1
        params["model_code"] = code


def assign_pro_round_model_codes(
    records: list[tuple[float, dict, dict]],
    *,
    incoming_champion_record: tuple[float, dict, dict] | None,
    incoming_champion_model_code: str | None,
    next_model_no: list[int],
) -> list[str]:
    """Tag each Pro-round trial with model_code; incoming champion may reuse its prior code.

    model_code is immutable after this assignment; report assembly reads params["model_code"] only.

    Returns model codes assigned to new trials this round (never includes incoming).
    """
    incoming_sig = (
        model_signature(incoming_champion_record[1])
        if incoming_champion_record is not None
        else None
    )
    new_codes: list[str] = []
    for _score, params, _metrics in records:
        sig = model_signature(params)
        if (
            incoming_sig is not None
            and incoming_champion_model_code
            and sig == incoming_sig
        ):
            params["model_code"] = incoming_champion_model_code
        else:
            code = f"M{next_model_no[0]:04d}"
            next_model_no[0] += 1
            params["model_code"] = code
            new_codes.append(code)
    return new_codes


def reconcile_pro_round_pool(
    pool_records: list[tuple[float, dict, dict]],
    *,
    incoming_champion_model_code: str | None,
    retired_model_codes: set[str] | frozenset[str] | None = None,
) -> tuple[list[tuple[float, dict, dict]], list[str], list[str]]:
    """Single source of truth: pool = incoming + this round's competing records only.

    pool_model_codes and round_challenger_model_codes are derived exclusively from
    filtered pool records — never from assign_pro_round_model_codes on trials that
    were excluded from the competition pool.
    """
    retired = set(retired_model_codes or ())
    incoming = (
        str(incoming_champion_model_code)
        if incoming_champion_model_code and incoming_champion_model_code not in retired
        else None
    )

    incoming_rec: tuple[float, dict, dict] | None = None
    challenger_recs: list[tuple[float, dict, dict]] = []
    for rec in pool_records:
        code = str(rec[1].get("model_code", ""))
        if not code or code in retired:
            continue
        if incoming and code == incoming:
            incoming_rec = rec
            continue
        challenger_recs.append(rec)

    filtered: list[tuple[float, dict, dict]] = []
    pool_model_codes: list[str] = []
    if incoming:
        pool_model_codes.append(incoming)
        if incoming_rec is not None:
            filtered.append(incoming_rec)
    elif incoming_rec is not None:
        filtered.append(incoming_rec)

    round_challenger_model_codes: list[str] = []
    for rec in challenger_recs:
        code = str(rec[1].get("model_code", ""))
        if not code or code in retired or (incoming and code == incoming):
            continue
        filtered.append(rec)
        if code not in round_challenger_model_codes:
            round_challenger_model_codes.append(code)
        if code not in pool_model_codes:
            pool_model_codes.append(code)

    return filtered, pool_model_codes, round_challenger_model_codes


def retire_non_winner_model_codes(
    pool_records: list[tuple[float, dict, dict]],
    round_winner: tuple[float, dict, dict] | None,
    retired: set[str],
    *,
    prior_signatures: set[str] | None = None,
) -> None:
    """Retire every model_code in this round's pool except the round winner."""
    winner_code: str | None = None
    winner_sig: str | None = None
    if round_winner is not None:
        raw = (round_winner[1] or {}).get("model_code")
        winner_code = str(raw) if raw else None
        winner_sig = model_signature(round_winner[1])
    for _score, params, _metrics in pool_records:
        sig = model_signature(params)
        if winner_sig and sig == winner_sig:
            continue
        if prior_signatures is not None:
            prior_signatures.add(sig)
        code = params.get("model_code")
        if not code:
            continue
        code_s = str(code)
        if winner_code and code_s == winner_code:
            continue
        retired.add(code_s)


def pro_round_display_allowlist(
    *,
    pool_model_codes: list[str] | None = None,
    incoming_champion_model_code: str | None = None,
    round_winner_model_code: str | None = None,
    round_challenger_model_codes: list[str] | None = None,
) -> set[str]:
    """Explicit allowlist for per-round UI candidates (no signature inference)."""
    if pool_model_codes:
        return {str(c) for c in pool_model_codes if c}
    allowed: set[str] = set()
    if incoming_champion_model_code:
        allowed.add(incoming_champion_model_code)
    if round_winner_model_code:
        allowed.add(round_winner_model_code)
    for code in round_challenger_model_codes or []:
        if code:
            allowed.add(str(code))
    return allowed


def records_for_pool_model_codes(
    records: list[tuple[float, dict, dict]],
    pool_model_codes: list[str],
) -> tuple[list[tuple[float, dict, dict]], list[str]]:
    """Order trial records by pool_model_codes; drop codes with no matching record."""
    by_code: dict[str, tuple[float, dict, dict]] = {}
    for rec in records:
        code = str(rec[1].get("model_code", ""))
        if not code:
            continue
        existing = by_code.get(code)
        if existing is None or float(rec[0]) > float(existing[0]):
            by_code[code] = rec
    ordered = [by_code[c] for c in pool_model_codes if c in by_code]
    codes = [c for c in pool_model_codes if c in by_code]
    return ordered, codes


def pro_round_report_top_n(
    *,
    pool_model_codes: list[str],
    req_top_models: int,
    feasible_count: int,
) -> int:
    """Pro per-round reports assemble the full competition pool, not global top_models."""
    if pool_model_codes:
        return min(len(pool_model_codes), feasible_count)
    return min(req_top_models, feasible_count)


def register_prior_challenger_signatures(
    round_records: list[tuple[float, dict, dict]],
    *,
    incoming_champion: tuple[float, dict, dict] | None,
    round_winner: tuple[float, dict, dict] | None,
    prior: set[str],
) -> None:
    """Track trial signatures for later-round pool exclusion.

    Only the round winner may carry forward as next round's incoming champion.
    Deposed incoming champions and all other trials are excluded from future pools.
    """
    winner_sig = (
        model_signature(round_winner[1]) if round_winner is not None else None
    )
    incoming_sig = (
        model_signature(incoming_champion[1])
        if incoming_champion is not None
        else None
    )
    for _score, params, _metrics in round_records:
        sig = model_signature(params)
        if sig == winner_sig:
            continue
        prior.add(sig)
    if incoming_sig and incoming_sig != winner_sig:
        prior.add(incoming_sig)


def record_objective_sort_value(
    objective_effective: str,
    score: float,
    metrics: dict[str, Any],
) -> float:
    if metrics.get("objective_value_is") is not None:
        return float(metrics["objective_value_is"])
    if objective_effective == "max_return":
        return float(metrics.get("cagr", 0.0))
    if objective_effective == "min_max_drawdown":
        return -abs(float(metrics.get("max_drawdown", 0.0)))
    if objective_effective == "max_sortino":
        return float(metrics.get("sortino", 0.0))
    if objective_effective == "min_cvar":
        return -abs(float(metrics.get("cvar_95", 0.0)))
    if objective_effective == "max_sharpe":
        return float(metrics.get("sharpe", 0.0))
    if objective_effective == "risk_parity_erc":
        return float(metrics.get("sharpe", 0.0)) - 0.25 * abs(
            float(metrics.get("max_drawdown", 0.0))
        )
    if objective_effective == "max_diversification":
        return (
            float(metrics.get("cagr", 0.0))
            - 0.35 * abs(float(metrics.get("max_drawdown", 0.0)))
            - 0.10 * float(metrics.get("turnover_avg", 0.0))
        )
    if objective_effective == "mean_variance_utility":
        return float(metrics.get("sharpe", 0.0)) - 0.15 * float(
            metrics.get("volatility", 0.0)
        )
    if objective_effective == "custom":
        return float(metrics.get("sharpe", 0.0)) - 0.2 * abs(
            float(metrics.get("max_drawdown", 0.0))
        )
    return float(score)


def build_round_competition_pool(
    round_records: list[tuple[float, dict, dict]],
    incoming_champion: tuple[float, dict, dict] | None,
    *,
    prior_challenger_signatures: frozenset[str] | set[str] | None = None,
    retired_model_codes: set[str] | frozenset[str] | None = None,
) -> list[tuple[float, dict, dict]]:
    """Incoming champion + this round's new trials only (no prior-round losers)."""
    excluded = set(prior_challenger_signatures or ())
    retired = set(retired_model_codes or ())
    incoming_sig = (
        model_signature(incoming_champion[1]) if incoming_champion is not None else None
    )
    incoming_code = (
        str(incoming_champion[1].get("model_code", ""))
        if incoming_champion is not None
        else ""
    )
    pool: list[tuple[float, dict, dict]] = []
    for rec in round_records:
        code = str(rec[1].get("model_code", ""))
        if code and code in retired:
            continue
        sig = model_signature(rec[1])
        if sig in excluded and sig != incoming_sig:
            continue
        pool.append(rec)
    if incoming_champion is None:
        return pool
    if incoming_code and incoming_code in retired:
        return pool
    if incoming_sig and any(model_signature(r[1]) == incoming_sig for r in pool):
        return pool
    return [incoming_champion, *pool]


def pool_records_in_trial_order(
    round_records: list[tuple[float, dict, dict]],
    pool_records: list[tuple[float, dict, dict]],
    pool_model_codes: list[str] | None = None,
) -> list[tuple[float, dict, dict]]:
    """Return competition-pool records in Optuna execution order (round_records order)."""
    allowed = {str(c) for c in (pool_model_codes or []) if c}
    if not allowed:
        allowed = {
            str(r[1].get("model_code", ""))
            for r in pool_records
            if r[1].get("model_code")
        }

    ordered: list[tuple[float, dict, dict]] = []
    seen: set[str] = set()
    for rec in round_records:
        code = str(rec[1].get("model_code", ""))
        if code and code in allowed and code not in seen:
            ordered.append(rec)
            seen.add(code)
    for rec in pool_records:
        code = str(rec[1].get("model_code", ""))
        if code and code in allowed and code not in seen:
            ordered.insert(0, rec)
            seen.add(code)
    return ordered


def best_record_in_pool(
    pool_records: list[tuple[float, dict, dict]],
    objective_effective: str,
) -> tuple[float, dict, dict] | None:
    best: tuple[float, dict, dict] | None = None
    best_obj = float("-inf")
    for score, params, metrics in pool_records:
        objective_value = record_objective_sort_value(
            objective_effective, score, metrics
        )
        if objective_value > best_obj:
            best_obj = objective_value
            best = (score, params, metrics)
    return best


def order_records_champion_first(
    records: list[tuple[float, dict, dict]],
    champion_record: tuple[float, dict, dict] | None,
) -> list[tuple[float, dict, dict]]:
    if champion_record is None:
        records.sort(key=lambda x: x[0], reverse=True)
        return records
    champ_sig = model_signature(champion_record[1])
    others = [r for r in records if model_signature(r[1]) != champ_sig]
    others.sort(key=lambda x: x[0], reverse=True)
    return [champion_record, *others]


def assess_overfitting(
    train_m: dict[str, Any],
    val_m: dict[str, Any] | None,
    *,
    oos_enabled: bool,
    objective_mode: str = "max_sharpe",
) -> dict[str, Any]:
    """Estimate overfitting risk from in-sample vs holdout metrics."""
    is_obj = compute_objective_score(objective_mode, train_m)
    if not oos_enabled or not val_m:
        return {
            "oos_enabled": False,
            "objective_mode": objective_mode,
            "objective_label": objective_label(objective_mode),
            "gap_sharpe": 0.0,
            "gap_sortino": 0.0,
            "gap_cagr": 0.0,
            "gap_max_drawdown": 0.0,
            "gap_objective": 0.0,
            "penalty": 0.0,
            "risk_level": "unknown",
            "train_sharpe": float(train_m.get("sharpe", 0.0)),
            "validation_sharpe": None,
            "in_sample_objective": round(is_obj, 6),
            "out_of_sample_objective": None,
        }

    oos_obj = compute_objective_score(objective_mode, val_m)
    gap_objective = is_obj - oos_obj

    train_sh = float(train_m.get("sharpe", 0.0))
    val_sh = float(val_m.get("sharpe", 0.0))
    gap_sharpe = train_sh - val_sh

    train_so = float(train_m.get("sortino", train_sh))
    val_so = float(val_m.get("sortino", val_sh))
    gap_sortino = train_so - val_so

    train_cagr = float(train_m.get("cagr", 0.0))
    val_cagr = float(val_m.get("cagr", 0.0))
    gap_cagr = train_cagr - val_cagr

    train_mdd = abs(float(train_m.get("max_drawdown", 0.0)))
    val_mdd = abs(float(val_m.get("max_drawdown", 0.0)))
    gap_max_drawdown = val_mdd - train_mdd

    penalty = (
        max(0.0, gap_sharpe) * 1.0
        + max(0.0, gap_sortino) * 0.5
        + max(0.0, gap_cagr) * 2.0
        + max(0.0, gap_max_drawdown) * 1.5
        + max(0.0, gap_objective) * 1.25
    )

    if penalty < 0.15:
        risk = "low"
    elif penalty < 0.45:
        risk = "moderate"
    else:
        risk = "high"

    return {
        "oos_enabled": True,
        "objective_mode": objective_mode,
        "objective_label": objective_label(objective_mode),
        "gap_sharpe": round(gap_sharpe, 4),
        "gap_sortino": round(gap_sortino, 4),
        "gap_cagr": round(gap_cagr, 4),
        "gap_max_drawdown": round(gap_max_drawdown, 4),
        "gap_objective": round(gap_objective, 6),
        "penalty": round(penalty, 4),
        "risk_level": risk,
        "train_sharpe": round(train_sh, 4),
        "validation_sharpe": round(val_sh, 4),
        "in_sample_objective": round(is_obj, 6),
        "out_of_sample_objective": round(oos_obj, 6),
    }


def _failure_pattern_summary(failed: list[dict[str, Any]]) -> str:
    if not failed:
        return "No failed challengers recorded yet."
    high_risk = sum(1 for f in failed if f.get("risk_level") == "high")
    moderate = sum(1 for f in failed if f.get("risk_level") == "moderate")
    gaps = [float(f.get("gap_objective", f.get("gap_sharpe", 0.0))) for f in failed]
    avg_gap = sum(gaps) / len(gaps) if gaps else 0.0
    lines = [
        f"{len(failed)} failed challenger(s) in history.",
        f"Overfitting risk: high={high_risk}, moderate={moderate}.",
        f"Avg in-sample vs holdout objective gap among failures: {avg_gap:.4f}.",
    ]
    if high_risk >= max(2, len(failed) // 2):
        lines.append(
            "Pattern: many failures show large IS/OOS gaps — "
            "prefer configs that generalize, not just fit the in-sample window."
        )
    if avg_gap > 0.35:
        lines.append(
            "Pattern: failures often overfit in-sample — reduce aggressive factor weights "
            "or increase diversification vs champion."
        )
    return " ".join(lines)


def _equity_output_summary(champ_m: dict[str, Any]) -> dict[str, Any]:
    eq = champ_m.get("equity")
    if eq is None:
        return {}
    try:
        s = pd.Series(eq)
        if len(s) < 2:
            return {}
        total_ret = float(s.iloc[-1] / s.iloc[0] - 1.0)
        return {
            "total_return_pct": round(total_ret * 100.0, 2),
            "end_equity_index": round(float(s.iloc[-1]), 4),
        }
    except Exception:
        return {}


def _weight_history_summary(champ_m: dict[str, Any]) -> dict[str, Any]:
    wh = champ_m.get("weight_history") or []
    if not wh:
        return {}
    last = wh[-1] if isinstance(wh[-1], dict) else {}
    holdings: list[tuple[str, float]] = []
    for k, v in last.items():
        if k in ("date", "OTHER"):
            continue
        try:
            fv = float(v)
        except (TypeError, ValueError):
            continue
        if fv >= 0.01:
            holdings.append((str(k), fv))
    holdings.sort(key=lambda x: -x[1])
    return {
        "rebalance_snapshots": len(wh),
        "latest_rebalance_date": last.get("date"),
        "top_holdings_latest": [
            {"ticker": t, "weight_pct": round(w * 100.0, 2)} for t, w in holdings[:10]
        ],
        "sample_rebalance_dates": [
            str(r.get("date"))
            for r in wh[:: max(1, len(wh) // 5)][:6]
            if isinstance(r, dict) and r.get("date")
        ],
    }


def _benchmark_comparison_summary(
    champ_m: dict[str, Any],
    *,
    prices_train: pd.DataFrame | None,
    benchmark_ticker: str,
    bench_metrics: dict[str, Any] | None,
    spec: BacktestSpec,
) -> dict[str, Any]:
    out: dict[str, Any] = {"benchmark": benchmark_ticker}
    if bench_metrics:
        out["benchmark_window_metrics"] = {
            k: bench_metrics.get(k)
            for k in ("sharpe", "cagr", "max_drawdown", "volatility")
            if bench_metrics.get(k) is not None
        }
    port_ret = champ_m.get("port_ret")
    if port_ret is None or prices_train is None or benchmark_ticker not in prices_train.columns:
        return out
    try:
        pr = pd.Series(port_ret)
        bench_ret = prices_train[benchmark_ticker].pct_change().fillna(0.0)
        bench_ret = bench_ret.reindex(pr.index).fillna(0.0)
        rel = benchmark_relative(pr, bench_ret, spec)
        bench_eq = (1.0 + bench_ret).cumprod()
        port_eq = (1.0 + pr).cumprod()
        out["portfolio_vs_benchmark"] = {
            "portfolio_cagr": round(float(champ_m.get("cagr", 0.0)), 4),
            "portfolio_sharpe": round(float(champ_m.get("sharpe", 0.0)), 4),
            "portfolio_max_drawdown": round(float(champ_m.get("max_drawdown", 0.0)), 4),
            "benchmark_total_return_pct": round(
                float(bench_eq.iloc[-1] / bench_eq.iloc[0] - 1.0) * 100.0, 2
            )
            if len(bench_eq) > 1
            else None,
            "portfolio_total_return_pct": round(
                float(port_eq.iloc[-1] / port_eq.iloc[0] - 1.0) * 100.0, 2
            )
            if len(port_eq) > 1
            else None,
            **{
                k: round_ai_float(float(v), key=k)
                for k, v in {
                    "beta": rel.get("beta"),
                    "alpha": rel.get("alpha") or rel.get("alpha_annual"),
                    "information_ratio": rel.get("information_ratio"),
                    "tracking_error": rel.get("tracking_error"),
                    "up_capture": rel.get("up_capture"),
                    "down_capture": rel.get("down_capture"),
                }.items()
                if v is not None
            },
        }
    except Exception:
        pass
    return out


def _benchmark_alpha_from_comparison(comparison: dict[str, Any] | None) -> float | None:
    if not isinstance(comparison, dict):
        return None
    pvb = comparison.get("portfolio_vs_benchmark") or comparison
    if not isinstance(pvb, dict):
        return None
    alpha = pvb.get("alpha")
    if alpha is None:
        return None
    try:
        return float(alpha)
    except (TypeError, ValueError):
        return None


def _benchmark_alpha_from_champion(champion: dict[str, Any] | None) -> float | None:
    if not isinstance(champion, dict):
        return None
    bvs = champion.get("benchmark_vs")
    return _benchmark_alpha_from_comparison(bvs if isinstance(bvs, dict) else None)


def benchmark_status_from_alpha(alpha: float | None) -> BenchmarkStatus:
    if alpha is None:
        return "unknown"
    try:
        return "above" if float(alpha) >= 0.0 else "below"
    except (TypeError, ValueError):
        return "unknown"


def beats_benchmark_from_alpha(alpha: float | None) -> bool | None:
    if alpha is None:
        return None
    try:
        return float(alpha) >= 0.0
    except (TypeError, ValueError):
        return None


def compute_round_benchmark_fields(
    metrics: dict[str, Any] | None,
    *,
    prices_train: pd.DataFrame | None = None,
    benchmark_ticker: str = "SPY",
    bench_metrics: dict[str, Any] | None = None,
    spec: BacktestSpec | None = None,
) -> dict[str, Any]:
    """Per-round benchmark outcome (same alpha threshold as exploration phase)."""
    comparison: dict[str, Any] = {}
    if isinstance(metrics, dict):
        comparison = _benchmark_comparison_summary(
            metrics,
            prices_train=prices_train,
            benchmark_ticker=benchmark_ticker,
            bench_metrics=bench_metrics,
            spec=spec or DEFAULT_SPEC,
        )
    alpha = _benchmark_alpha_from_comparison(comparison)
    pvb = comparison.get("portfolio_vs_benchmark")
    status = benchmark_status_from_alpha(alpha)
    beats = beats_benchmark_from_alpha(alpha)
    out: dict[str, Any] = {
        "benchmark_status": status,
        "beats_benchmark": beats,
        "benchmark_alpha": round(alpha, 6) if alpha is not None else None,
    }
    if isinstance(pvb, dict):
        out["portfolio_vs_benchmark"] = pvb
    return out


def compute_exploration_phase(
    *,
    round_index: int,
    total_rounds: int,
    target_adjusted_score: float | None = None,
    champion_in_sample_objective: float | None = None,
    benchmark_alpha: float | None = None,
    near_target_fraction: float = 0.98,
) -> str:
    """Signal for Pro round seed: explore (wide) vs balance vs narrow factor_ranges."""
    ri = max(1, int(round_index))
    total = max(1, int(total_rounds))
    early = ri <= 1 or ri <= max(1, total // 2)

    near_target = False
    if target_adjusted_score is not None and champion_in_sample_objective is not None:
        try:
            target = float(target_adjusted_score)
            champ = float(champion_in_sample_objective)
            near_target = champ >= target * float(near_target_fraction)
        except (TypeError, ValueError):
            near_target = False

    far_from_bench = benchmark_alpha is not None and float(benchmark_alpha) < 0.0

    if early or far_from_bench:
        return "explore"
    late = ri >= max(2, total - 1)
    if late and near_target:
        return "narrow"
    return "balance"


def merge_round_seed_budget_fields(
    learning_context: dict[str, Any] | None,
    *,
    round_index: int,
    total_rounds: int,
    trials_per_round: int,
    total_trial_budget: int,
) -> dict[str, Any]:
    """Attach trial/round budget and exploration_phase for generate_ai_round_seed."""
    out = dict(learning_context or {})
    out["round_index"] = int(round_index)
    out["total_rounds"] = int(total_rounds)
    out["trials_per_round"] = int(trials_per_round)
    out["total_trial_budget"] = int(total_trial_budget)
    champ = out.get("champion") if isinstance(out.get("champion"), dict) else None
    is_obj = None
    if isinstance(champ, dict):
        is_obj = champ.get("in_sample_objective")
    out["exploration_phase"] = compute_exploration_phase(
        round_index=int(round_index),
        total_rounds=int(total_rounds),
        target_adjusted_score=out.get("target_adjusted_score"),
        champion_in_sample_objective=is_obj,
        benchmark_alpha=_benchmark_alpha_from_champion(champ),
    )
    return out


def _failed_params_avoid_list(failed: list[dict[str, Any]], limit: int = 8) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for row in failed:
        ps = str(row.get("params_summary", "")).strip()
        if not ps or ps in seen:
            continue
        seen.add(ps)
        out.append(ps)
        if len(out) >= limit:
            break
    return out


def build_round_seed_learning_payload(
    *,
    champion_record: tuple[float, dict[str, Any], dict[str, Any]],
    champion_score: float,
    min_gain: float,
    learning_trials: list[dict[str, Any]],
    objective: str,
    round_index: int,
    prior_round_setup: dict[str, Any] | None = None,
    prior_regime_setups: dict[str, Any] | None = None,
    prior_regime_factor_ranges: dict[str, Any] | None = None,
    prior_regime_class_quotas: dict[str, Any] | None = None,
    prior_factor_ranges: dict[str, Any] | None = None,
    prior_factor_choices: dict[str, Any] | None = None,
    failed_records: list[dict[str, Any]] | None = None,
    benchmark_ticker: str = "SPY",
    bench_metrics: dict[str, Any] | None = None,
    prices_train: pd.DataFrame | None = None,
    spec: BacktestSpec | None = None,
    period: dict[str, Any] | None = None,
    total_rounds: int | None = None,
    trials_per_round: int | None = None,
    total_trial_budget: int | None = None,
) -> dict[str, Any]:
    """Learning context for Pro round-2+ generate_ai_round_seed (rich, structured)."""
    _sc, champ_params, champ_m = champion_record
    ctx = build_gemini_learning_context(
        champion_record=champion_record,
        champion_score=champion_score,
        min_gain=min_gain,
        learning_trials=learning_trials,
        objective=objective,
        round_number=round_index,
        benchmark_ticker=benchmark_ticker,
        bench_metrics=bench_metrics,
        prices_train=prices_train,
        spec=spec,
        period=period,
    )
    ctx["round_index"] = int(round_index)
    ctx["champion_record_params"] = dict(champ_params)
    ctx["champion_record_metrics"] = dict(champ_m)
    if champ_params.get("model_code"):
        ctx["champion_model_code"] = str(champ_params["model_code"])

    prior_seed = summarize_prior_round_seed(
        {
            "round_setup": prior_round_setup or {},
            "regime_setups": prior_regime_setups or {},
            "regime_factor_ranges": prior_regime_factor_ranges or {},
            "regime_class_quotas": prior_regime_class_quotas or {},
            "factor_ranges": prior_factor_ranges or {},
            "factor_choices": prior_factor_choices or {},
        },
        champion_params=champ_params,
    )
    if prior_seed.get("round_setup"):
        ctx["prior_round_setup"] = prior_seed["round_setup"]
    if prior_seed.get("regime_setups"):
        ctx["prior_regime_setups"] = prior_seed["regime_setups"]
    if prior_seed.get("regime_factor_ranges"):
        ctx["prior_regime_factor_ranges"] = prior_seed["regime_factor_ranges"]
    if prior_seed.get("regime_class_quotas"):
        ctx["prior_regime_class_quotas"] = prior_seed["regime_class_quotas"]
    if prior_seed.get("factor_ranges"):
        ctx["prior_factor_ranges"] = prior_seed["factor_ranges"]
    if prior_seed.get("factor_choices"):
        ctx["prior_factor_choices"] = prior_seed["factor_choices"]
    if is_dynamic_objective(objective):
        ctx["dynamic_regime_matrix"] = True

    if failed_records:
        merged = list(failed_records) + list(ctx.get("failed_challengers") or [])
        seen: set[str] = set()
        deduped: list[dict[str, Any]] = []
        for row in merged:
            if not isinstance(row, dict):
                continue
            key = str(row.get("params_summary", "")) + str(row.get("round", ""))
            if key in seen:
                continue
            seen.add(key)
            deduped.append(row)
        ctx["failed_challengers"] = sorted(
            deduped,
            key=lambda t: float(t.get("gap_to_beat", 0.0)),
            reverse=True,
        )[:15]
    if total_rounds is not None:
        ctx = merge_round_seed_budget_fields(
            ctx,
            round_index=int(round_index),
            total_rounds=int(total_rounds),
            trials_per_round=int(trials_per_round or 0),
            total_trial_budget=int(total_trial_budget or 0),
        )
    return ctx


def client_needs_prompt_block(client_context: Any | None) -> dict[str, Any] | None:
    """Compact client-needs card injected into AI seed / narration prompts.

    This is the only channel through which the signed overlay's client story
    reaches the optimizer-side AI: without it the AI sees metrics but never
    who it is optimizing for. Values are plain fields; prompt-side rendering
    sanitizes strings.
    """
    if not client_context:
        return None
    keys = (
        "risk_tolerance",
        "investment_horizon_years",
        "max_drawdown_tolerance",
        "income_need_pct",
        "max_single_name_pct",
        "theme_exposure_cap_pct",
        "cash_reserve_pct",
        "needs_summary",
    )
    if not isinstance(client_context, dict):
        client_context = {k: getattr(client_context, k, None) for k in keys}
    block: dict[str, Any] = {}
    risk = client_context.get("risk_tolerance")
    if risk:
        block["risk_tolerance"] = str(risk)
    horizon = client_context.get("investment_horizon_years")
    if horizon:
        block["investment_horizon_years"] = horizon
    tolerance = client_context.get("max_drawdown_tolerance")
    if tolerance:
        block["max_drawdown_tolerance"] = tolerance
        block["drawdown_floor_rule"] = (
            "Trials are penalized when in-sample max drawdown breaches this floor; "
            "prefer parameters that keep the portfolio inside it."
        )
    income = client_context.get("income_need_pct")
    if income:
        block["income_need_pct"] = income
        block["income_rule"] = (
            "Prefer higher w_income / bond-income sleeves when income_need_pct is set."
        )
    single = client_context.get("max_single_name_pct")
    if single:
        block["max_single_name_pct"] = single
        block["single_name_rule"] = (
            "Penalize trials whose largest holding exceeds this soft cap."
        )
    theme = client_context.get("theme_exposure_cap_pct")
    if theme:
        block["theme_exposure_cap_pct"] = theme
        block["theme_rule"] = (
            "Penalize concentrated theme/growth equity sleeves above this soft cap."
        )
    cash = client_context.get("cash_reserve_pct")
    if cash:
        block["cash_reserve_pct"] = cash
        block["cash_rule"] = (
            "Keep an uninvested cash sleeve near this floor; cash earns the risk-free rate."
        )
    summary = client_context.get("needs_summary")
    if isinstance(summary, str) and summary.strip():
        block["needs_summary"] = summary.strip()[:300]
    return block or None
    return block or None


def build_gemini_learning_context(
    *,
    champion_record: tuple[float, dict[str, Any], dict[str, Any]],
    champion_score: float,
    min_gain: float,
    learning_trials: list[dict[str, Any]],
    objective: str,
    round_number: int,
    benchmark_ticker: str = "SPY",
    bench_metrics: dict[str, Any] | None = None,
    prices_train: pd.DataFrame | None = None,
    spec: BacktestSpec | None = None,
    period: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Package champion research + failures for Gemini challengers."""
    _sc, champ_params, champ_m = champion_record
    assess = champ_m.get("overfitting_assessment") or {}
    trial_spec = spec or DEFAULT_SPEC
    target = float(champion_score) + float(min_gain)
    obj_lbl = objective_label(objective)

    failed = [t for t in learning_trials if t.get("outcome") == "failed"]
    failed_sorted = sorted(
        failed,
        key=lambda t: float(t.get("gap_to_beat", 0.0)),
        reverse=True,
    )
    near_miss = sorted(
        failed,
        key=lambda t: float(t.get("gap_to_beat", 0.0)),
    )[:5]
    params_avoid = _failed_params_avoid_list(failed_sorted)

    champion_research = {
        "period": period or {},
        "params": summarize_params_for_ai(champ_params, full=True),
        "in_sample_outputs": {
            "objective": objective,
            "objective_label": obj_lbl,
            "objective_value": assess.get(
                "in_sample_objective", champ_m.get("objective_value_is")
            ),
            "sharpe": round(float(champ_m.get("sharpe", 0.0)), 4),
            "cagr": round(float(champ_m.get("cagr", 0.0)), 4),
            "max_drawdown": round(float(champ_m.get("max_drawdown", 0.0)), 4),
            "volatility": round(float(champ_m.get("volatility", 0.0)), 4),
            "sortino": round(float(champ_m.get("sortino", 0.0)), 4),
            "turnover_avg": round(float(champ_m.get("turnover_avg", 0.0)), 4),
            "rebalance_applied": champ_m.get("rebalance_applied"),
        },
        "holdout_outputs": {
            "out_of_sample_objective": assess.get("out_of_sample_objective"),
            "validation_sharpe": assess.get("validation_sharpe"),
            "gap_objective": assess.get("gap_objective"),
            "overfitting_risk": assess.get("risk_level"),
        },
        "equity_summary": _equity_output_summary(champ_m),
        "weight_history": _weight_history_summary(champ_m),
        "benchmark_comparison": _benchmark_comparison_summary(
            champ_m,
            prices_train=prices_train,
            benchmark_ticker=benchmark_ticker,
            bench_metrics=bench_metrics,
            spec=trial_spec,
        ),
    }

    ctx = {
        "mission": (
            f"Round {round_number}: study the CHAMPION RESEARCH dossier (params, outputs, "
            f"weight history, benchmark comparison over the in-sample window). "
            f"Priority 1: propose challengers that beat benchmark {benchmark_ticker} "
            f"(higher risk-adjusted return / alpha vs benchmark on in-sample). "
            f"Priority 2: beat champion in-sample {obj_lbl} "
            f"(>{target:.4f}; champion {champion_score:.4f} + min gain {min_gain:.4f}). "
            f"Priority 3: avoid parameter patterns from FAILED models. "
            "Holdout tail is diagnostic only — not used for selection."
        ),
        "priorities": [
            f"Beat benchmark {benchmark_ticker} on in-sample risk-adjusted basis",
            f"Improve champion in-sample {obj_lbl} above {target:.4f}",
            "Avoid failed challenger parameter patterns; keep IS/OOS gap small",
        ],
        "target_adjusted_score": round(target, 4),
        "champion_score": round(float(champion_score), 4),
        "objective": objective,
        "objective_label": obj_lbl,
        "benchmark_ticker": benchmark_ticker,
        "champion_research": champion_research,
        "champion": {
            "in_sample_objective": assess.get(
                "in_sample_objective", champ_m.get("objective_value_is")
            ),
            "out_of_sample_objective": assess.get("out_of_sample_objective"),
            "gap_objective": assess.get("gap_objective"),
            "train_sharpe": assess.get("train_sharpe", champ_m.get("sharpe")),
            "validation_sharpe": assess.get("validation_sharpe"),
            "gap_sharpe": assess.get("gap_sharpe"),
            "overfitting_risk": assess.get("risk_level"),
            "params_summary": summarize_params_for_ai(champ_params),
            "outputs_summary": champion_research.get("in_sample_outputs"),
            "benchmark_vs": champion_research.get("benchmark_comparison"),
            "weight_history_summary": champion_research.get("weight_history"),
        },
        "params_to_avoid": params_avoid,
        "failed_challengers": failed_sorted[:15],
        "near_miss_challengers": near_miss,
        "failure_patterns": _failure_pattern_summary(failed),
        "hint": (
            "Deep-read champion: allocation mode, factor weights, class budgets, rebalance behavior, "
            "and how weights evolved across rebalance dates. Compare portfolio vs benchmark "
            "over the same in-sample dates. Then design challengers that first surpass the benchmark, "
            "then surpass the champion objective, without copying failed parameter sets."
        ),
    }
    cleaned = sanitize_for_ai(ctx)
    return cleaned if isinstance(cleaned, dict) else ctx


def summarize_params_for_ai(params: dict[str, Any], *, full: bool = False) -> str:
    if full:
        skip = {
            "raw_score",
            "adjusted_score",
            "param_source",
            "model_code",
            "in_sample_objective",
            "out_of_sample_objective",
            "gap_objective",
        }
        compact = {k: v for k, v in params.items() if k not in skip}
        try:
            return dumps_for_ai(compact, max_len=900)
        except Exception:
            pass
    keys = (
        "mode",
        "lookback_days",
        "top_n_actual",
        "risk_aversion",
        "w_mom",
        "w_reversal",
        "w_value",
        "w_lowvol",
        "w_trend",
        "w_drawdown",
        "w_income",
        "mom_indicator",
        "reversal_indicator",
        "value_indicator",
        "lowvol_indicator",
        "trend_indicator",
        "drawdown_indicator",
        "w_equity",
        "w_bond",
        "max_turnover_actual",
        "customization_drift_actual",
        "rebalance_freq",
    )
    parts: list[str] = []
    for k in keys:
        if k not in params:
            continue
        v = params[k]
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            parts.append(f"{k}={round_ai_float(float(v), key=k)}")
        else:
            parts.append(f"{k}={v}")
    return ", ".join(parts) if parts else str(params)[:120]


def _horizon_row_from_snapshot(snap: dict[str, Any] | None) -> dict[str, Any] | None:
    if not snap:
        return None
    out: dict[str, Any] = {}
    for key in ("sharpe", "cagr", "max_drawdown", "objective_value"):
        raw = snap.get(key)
        if raw is not None:
            out[key] = round_ai_float(raw, key=key)
    return out or None


def _trial_sim_slices_from_record(
    metrics: dict[str, Any] | None,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Per-trial optimizer snapshots (deep-copied per record in slim_search_metrics)."""
    if not metrics:
        return None, None
    train_snap = metrics.get("train_metrics")
    if not isinstance(train_snap, dict) or not train_snap:
        return None, None
    train_m = copy.deepcopy(train_snap)
    val_snap = metrics.get("validation_metrics")
    val_m = copy.deepcopy(val_snap) if isinstance(val_snap, dict) else None
    return train_m, val_m


def attach_full_period_objective(
    metrics: dict[str, Any],
    *,
    objective_mode: str,
    train_m: dict[str, Any] | None = None,
    val_m: dict[str, Any] | None = None,
    full_m: dict[str, Any] | None = None,
    spec: BacktestSpec | None = None,
    overwrite: bool = False,
) -> dict[str, Any]:
    """Write objective_value_full (+ full_metrics) for leaderboard / report rows.

    Prefer a continuous full_m when present; otherwise stitch IS+OOS port_ret and
    recompute window metrics. Mutates and returns ``metrics``.
    """
    if not overwrite and metrics.get("objective_value_full") is not None:
        return metrics
    scoring_obj = trial_scoring_objective(objective_mode)
    source: dict[str, Any] | None = None
    if full_m is not None and full_m.get("port_ret") is not None:
        if spec is not None:
            try:
                n = len(full_m["port_ret"])
                source = metrics_for_horizon_window(full_m, spec, 0, n)
            except (ValueError, KeyError, TypeError):
                source = full_m
        else:
            source = full_m
    elif train_m is not None and val_m is not None and spec is not None:
        stitched = stitch_full_path_from_slices(train_m, val_m)
        if stitched is not None and stitched.get("port_ret") is not None:
            try:
                n = len(stitched["port_ret"])
                source = metrics_for_horizon_window(stitched, spec, 0, n)
            except (ValueError, KeyError, TypeError):
                source = None
    elif train_m is not None and val_m is None and train_m.get("port_ret") is not None:
        source = train_m
    elif metrics.get("port_ret") is not None and (
        metrics.get("sharpe") is not None or metrics.get("cagr") is not None
    ):
        source = metrics
    if source is None:
        return metrics
    try:
        snap = metrics_snapshot(source, objective_mode=scoring_obj)
    except (TypeError, ValueError, KeyError):
        return metrics
    metrics["full_metrics"] = snap
    metrics["objective_value_full"] = float(snap["objective_value"])
    return metrics


def horizon_snapshots_from_full_path(
    full_m: dict[str, Any],
    *,
    spec: BacktestSpec,
    objective_effective: str,
    oos_enabled: bool,
    is_split_idx: int | None,
    train_m: dict[str, Any] | None = None,
    val_m: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any] | None, dict[str, Any]]:
    """IS/OOS/full snapshots from one continuous full-period backtest (report grid source)."""
    scoring_obj = trial_scoring_objective(objective_effective)
    port_ret_full = full_m.get("port_ret")
    n_full = len(port_ret_full) if port_ret_full is not None else 0
    if oos_enabled and is_split_idx is not None and is_split_idx > 0:
        if port_ret_full is not None and 0 < is_split_idx < n_full:
            try:
                is_window = metrics_for_horizon_window(
                    full_m, spec, 0, is_split_idx
                )
                oos_window = metrics_for_horizon_window(
                    full_m, spec, is_split_idx, n_full
                )
                full_window = metrics_for_horizon_window(full_m, spec, 0, n_full)
                is_snap = metrics_snapshot(is_window, objective_mode=scoring_obj)
                oos_snap = metrics_snapshot(
                    oos_window, objective_mode=scoring_obj
                )
                full_snap = metrics_snapshot(
                    full_window, objective_mode=scoring_obj
                )
                return is_snap, oos_snap, full_snap
            except ValueError:
                pass
    full_snap = metrics_snapshot(full_m, objective_mode=scoring_obj)
    is_snap = metrics_snapshot(
        train_m or full_m, objective_mode=scoring_obj
    )
    oos_snap = (
        metrics_snapshot(val_m, objective_mode=scoring_obj)
        if val_m is not None
        else None
    )
    return is_snap, oos_snap, full_snap


def _full_path_slices_from_cache(
    params: dict[str, Any],
    *,
    trial_report_cache: Any | None,
    spec: BacktestSpec | None,
    objective_effective: str,
    oos_enabled: bool,
    is_split_idx: int | None,
    train_m: dict[str, Any] | None,
    val_m: dict[str, Any] | None,
) -> tuple[dict[str, Any], dict[str, Any] | None, dict[str, Any]] | None:
    """Report-aligned IS/OOS/full when full-period port_ret is cached."""
    if trial_report_cache is None or spec is None:
        return None
    bundle = trial_report_cache.get_bundle(params)
    if bundle is None or bundle.full_m is None:
        return None
    full_m = bundle.full_m
    if full_m.get("port_ret") is None:
        return None
    return horizon_snapshots_from_full_path(
        full_m,
        spec=spec,
        objective_effective=objective_effective,
        oos_enabled=oos_enabled,
        is_split_idx=is_split_idx,
        train_m=train_m,
        val_m=val_m,
    )


def resolve_trial_metrics_for_reporting(
    params: dict[str, Any],
    metrics: dict[str, Any],
    *,
    trial_report_cache: Any | None,
    objective_effective: str,
    oos_enabled: bool,
    score: float | None = None,
    spec: BacktestSpec | None = None,
    is_split_idx: int | None = None,
) -> dict[str, Any]:
    """Per-trial IS/OOS metrics; prefer full-path slices, then snapshots, then cache."""
    scoring_obj = trial_scoring_objective(objective_effective)
    train_m, val_m = _trial_sim_slices_from_record(metrics)
    if train_m is None and trial_report_cache is not None:
        bundle = trial_report_cache.get_bundle(params)
        if bundle is not None:
            train_m = bundle.train_m
            val_m = bundle.val_m if val_m is None else val_m
    full_path = _full_path_slices_from_cache(
        params,
        trial_report_cache=trial_report_cache,
        spec=spec,
        objective_effective=objective_effective,
        oos_enabled=oos_enabled,
        is_split_idx=is_split_idx,
        train_m=train_m,
        val_m=val_m,
    )
    if full_path is not None:
        is_snap, oos_snap, full_snap = full_path
        assess = assess_overfitting(
            is_snap,
            oos_snap,
            oos_enabled=bool(oos_enabled and oos_snap is not None),
            objective_mode=scoring_obj,
        )
        merged = copy.deepcopy(metrics) if metrics else {}
        fallback_score = float(score if score is not None else merged.get("raw_score", 0.0))
        merged["objective_value_is"] = float(
            assess.get("in_sample_objective", fallback_score)
        )
        merged["objective_value_oos"] = assess.get("out_of_sample_objective")
        merged["gap_objective"] = float(assess.get("gap_objective", 0.0))
        merged["overfitting_assessment"] = assess
        merged["overfitting_penalty_applied"] = float(assess.get("penalty", 0.0))
        merged["train_metrics"] = is_snap
        if oos_snap is not None:
            merged["validation_metrics"] = oos_snap
        merged["full_metrics"] = full_snap
        merged["objective_value_full"] = float(full_snap.get("objective_value", 0.0))
        for key in ("sharpe", "cagr", "max_drawdown", "sortino", "volatility"):
            if key in full_snap:
                merged[key] = full_snap[key]
        return merged
    if train_m is not None:
        assess = assess_overfitting(
            train_m,
            val_m,
            oos_enabled=bool(oos_enabled and val_m is not None),
            objective_mode=scoring_obj,
        )
        merged = copy.deepcopy(metrics) if metrics else {}
        fallback_score = float(score if score is not None else merged.get("raw_score", 0.0))
        merged["objective_value_is"] = float(
            assess.get("in_sample_objective", fallback_score)
        )
        merged["objective_value_oos"] = assess.get("out_of_sample_objective")
        merged["gap_objective"] = float(assess.get("gap_objective", 0.0))
        merged["overfitting_assessment"] = assess
        merged["overfitting_penalty_applied"] = float(assess.get("penalty", 0.0))
        merged["train_metrics"] = metrics_snapshot(train_m, objective_mode=scoring_obj)
        if val_m is not None:
            merged["validation_metrics"] = metrics_snapshot(
                val_m, objective_mode=scoring_obj
            )
        attach_full_period_objective(
            merged,
            objective_mode=scoring_obj,
            train_m=train_m,
            val_m=val_m,
            full_m=None,
            spec=spec,
        )
        for key in ("sharpe", "cagr", "max_drawdown", "sortino", "volatility"):
            if key in train_m:
                merged[key] = train_m[key]
        return merged
    return copy.deepcopy(metrics) if metrics else {}


def build_round_champion_ai_payload(
    pool_records: list[tuple[float, dict, dict]],
    *,
    objective_effective: str,
    round_index: int,
    incoming_champion_model_code: str | None,
    benchmark_ticker: str,
    oos_enabled: bool,
    trial_report_cache: Any | None = None,
    spec: BacktestSpec | None = None,
    is_split_idx: int | None = None,
    client_needs: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Slim per-round trial metrics for post-Optuna AI champion selection."""
    candidates: list[dict[str, Any]] = []
    incoming = (
        str(incoming_champion_model_code).strip().upper()
        if incoming_champion_model_code
        else None
    )
    for score, params, metrics in records_in_model_code_order(pool_records):
        code = str(params.get("model_code", "")).strip().upper()
        if not code:
            continue
        metrics = resolve_trial_metrics_for_reporting(
            params,
            metrics,
            trial_report_cache=trial_report_cache,
            objective_effective=objective_effective,
            oos_enabled=oos_enabled,
            score=score,
            spec=spec,
            is_split_idx=is_split_idx,
        )
        assess = metrics.get("overfitting_assessment") or {}
        role = "incoming_champion" if incoming and code == incoming else "challenger"
        obj = record_objective_sort_value(objective_effective, score, metrics)
        is_obj = metrics.get("objective_value_is") or assess.get("in_sample_objective")
        oos_obj = metrics.get("objective_value_oos") or assess.get(
            "out_of_sample_objective"
        )
        train_snap = metrics.get("train_metrics")
        if train_snap is None:
            train_snap = {
                "sharpe": metrics.get("sharpe"),
                "cagr": metrics.get("cagr"),
                "max_drawdown": metrics.get("max_drawdown"),
                "objective_value": is_obj if is_obj is not None else obj,
            }
        is_horizon = _horizon_row_from_snapshot(train_snap)
        if is_horizon is not None and is_obj is not None:
            is_horizon["objective_value"] = round_ai_float(is_obj, key="objective_value")

        oos_horizon = (
            _horizon_row_from_snapshot(metrics.get("validation_metrics"))
            if oos_enabled
            else None
        )
        if oos_horizon is not None and oos_obj is not None:
            oos_horizon["objective_value"] = round_ai_float(
                oos_obj, key="objective_value"
            )

        full_horizon: dict[str, Any] | None = None
        full_snap = metrics.get("full_metrics")
        if isinstance(full_snap, dict) and full_snap:
            full_horizon = _horizon_row_from_snapshot(full_snap)
        elif trial_report_cache is not None:
            bundle = trial_report_cache.get_bundle(params)
            if bundle is not None and bundle.full_m is not None:
                full_horizon = _horizon_row_from_snapshot(
                    metrics_snapshot(bundle.full_m, objective_mode=objective_effective)
                )
        if full_horizon is None and not oos_enabled:
            full_horizon = _horizon_row_from_snapshot(
                {
                    "sharpe": metrics.get("sharpe"),
                    "cagr": metrics.get("cagr"),
                    "max_drawdown": metrics.get("max_drawdown"),
                    "objective_value": is_obj if is_obj is not None else obj,
                }
            )

        gap: dict[str, Any] = {}
        gap_obj = metrics.get("gap_objective", assess.get("gap_objective"))
        gap_sh = assess.get("gap_sharpe")
        if gap_obj is not None:
            gap["objective"] = round_ai_float(gap_obj, key="gap_objective")
        if gap_sh is not None:
            gap["sharpe"] = round_ai_float(gap_sh, key="gap_sharpe")

        row: dict[str, Any] = {
            "model_code": code,
            "role": role,
            "objective_value": round_ai_float(obj),
            "objective_value_is": round_ai_float(is_obj, key="objective_value")
            if is_obj is not None
            else None,
            "holdout_objective": round_ai_float(oos_obj, key="objective_value")
            if oos_obj is not None
            else None,
            "overfitting_risk": assess.get("risk_level"),
            "horizons": {
                "in_sample": is_horizon,
                "out_of_sample": oos_horizon,
                "full_sample": full_horizon,
                "gap": gap or None,
            },
        }
        display_metrics = (
            metrics.get("full_metrics")
            if isinstance(metrics.get("full_metrics"), dict)
            else train_snap
        )
        for metric_key in ("sharpe", "cagr", "max_drawdown"):
            raw = (display_metrics or metrics).get(metric_key)
            if raw is not None:
                row[metric_key] = round_ai_float(raw)
        if oos_enabled:
            val_sh = metrics.get("validation_sharpe", assess.get("validation_sharpe"))
            if val_sh is not None:
                row["validation_sharpe"] = round_ai_float(val_sh)
        candidates.append(row)
    payload: dict[str, Any] = {
        "round": int(round_index),
        "objective": objective_effective,
        "benchmark": benchmark_ticker,
        "oos_enabled": bool(oos_enabled),
        "incoming_champion_model_code": incoming,
        "selection_note": (
            "Champion is chosen deterministically by user objective on the selection horizon "
            "(in-sample when OOS holdout is active, else full-sample). "
            "IS/OOS gap and overfitting_risk are informational only — they do not demote the "
            "objective winner. horizons.in_sample and horizons.out_of_sample use full-path "
            "slices from the same continuous backtest as the report grid — NOT independent "
            "trial simulates. horizons.full_sample matches the user's full-period report grid."
        ),
        "candidates": candidates,
    }
    if client_needs:
        payload["client_needs"] = client_needs
    return payload


def record_for_model_code(
    pool_records: list[tuple[float, dict, dict]],
    model_code: str | None,
) -> tuple[float, dict, dict] | None:
    """Find a pool record by catalog model_code (case-insensitive)."""
    if not model_code:
        return None
    target = str(model_code).strip().upper()
    for rec in pool_records:
        mc = str(rec[1].get("model_code", "")).strip().upper()
        if mc == target:
            return rec
    return None
