"""Iterative champion-challenger refinement and overfitting assessment."""

from __future__ import annotations

import json
from typing import Any

import pandas as pd

from app.engine.analytics import benchmark_relative
from app.engine.objectives import compute_objective_score, objective_label
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


def assign_search_model_codes(
    records: list[tuple[float, dict, dict]],
    *,
    next_model_no: list[int],
) -> None:
    """Assign sequential model_code to each search trial (standard Optuna path).

    model_code is immutable after search assignment; the report phase must only read
    params["model_code"] and must not re-encode via signature maps.
    """
    for _score, params, _metrics in records:
        if params.get("model_code"):
            continue
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
    by_code = {
        str(rec[1].get("model_code", "")): rec
        for rec in records
        if rec[1].get("model_code")
    }
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


def apply_overfitting_penalty(
    raw_score: float,
    assessment: dict[str, Any],
    weight: float,
) -> tuple[float, float]:
    """Return (adjusted_score, penalty_applied)."""
    if weight <= 0 or not assessment.get("oos_enabled"):
        return raw_score, 0.0
    penalty = float(assessment.get("penalty", 0.0)) * float(weight)
    return raw_score - penalty, penalty


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
            "beta": rel.get("beta"),
            "alpha": rel.get("alpha") or rel.get("alpha_annual"),
            "information_ratio": rel.get("information_ratio"),
            "tracking_error": rel.get("tracking_error"),
            "up_capture": rel.get("up_capture"),
            "down_capture": rel.get("down_capture"),
        }
    except Exception:
        pass
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
    prior_factor_ranges: dict[str, Any] | None = None,
    prior_factor_choices: dict[str, Any] | None = None,
    failed_records: list[dict[str, Any]] | None = None,
    benchmark_ticker: str = "SPY",
    bench_metrics: dict[str, Any] | None = None,
    prices_train: pd.DataFrame | None = None,
    spec: BacktestSpec | None = None,
    period: dict[str, Any] | None = None,
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
            "factor_ranges": prior_factor_ranges or {},
            "factor_choices": prior_factor_choices or {},
        },
        champion_params=champ_params,
    )
    if prior_seed.get("round_setup"):
        ctx["prior_round_setup"] = prior_seed["round_setup"]
    if prior_seed.get("factor_ranges"):
        ctx["prior_factor_ranges"] = prior_seed["factor_ranges"]
    if prior_seed.get("factor_choices"):
        ctx["prior_factor_choices"] = prior_seed["factor_choices"]

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
    return ctx


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

    return {
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
            return json.dumps(compact, sort_keys=True, default=str)[:900]
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
        "mom_indicator",
        "reversal_indicator",
        "value_indicator",
        "lowvol_indicator",
        "trend_indicator",
        "drawdown_indicator",
        "w_equity",
        "w_bond",
        "max_turnover_actual",
        "rebalance_freq",
    )
    parts = [f"{k}={params.get(k)}" for k in keys if k in params]
    return ", ".join(parts) if parts else str(params)[:120]
