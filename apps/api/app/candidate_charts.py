"""Lazy-load full chart payload for a single portfolio candidate."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
import pandas as pd

from app.engine.ai_universe import refine_universe_with_ai
from app.engine.analytics import build_full_analytics, exposure_by_regime_from_weight_history
from app.engine.backtest import (
    _resolve_objective,
    _sim_inputs_from_params,
    _weights_dict,
)
from app.engine.data import fetch_prices
from app.engine.dynamic_objective import (
    apply_allocator_resolver,
    apply_class_budget_resolver,
    build_dynamic_objective_context,
    class_budget_resolver_from_trial_params,
    factor_params_resolver_from_trial_params,
    is_dynamic_objective,
    ensure_regime_class_budget_resolver,
    resolve_regime_mode,
    trial_scoring_objective,
)
from app.engine.memory_budget import downsample_keep_endpoints, trim_weight_history_for_response
from app.engine.portfolio import (
    anchor_weight_history_to_date,
    equity_curve_series,
    simulate_dynamic_portfolio,
    split_train_validation,
    trim_prices_to_report_window,
)
from app.engine.report_sim_cache import TrialReportCache
from app.engine.spec import BacktestSpec
from app.models import BacktestRequest, BacktestResult, CandidateChartsPayload, PortfolioCandidate
from app.profiles import get_universe, pin_guaranteed_supplements

_INSTITUTIONAL_KEYS = (
    "benchmark_relative",
    "periodic_returns",
    "periodic_returns_scope",
    "periodic_returns_holdout",
    "rolling",
    "drawdown_episodes",
    "drawdown_series",
    "risk_contribution",
    "execution",
)


def _equity_curve_cap() -> int:
    raw = os.environ.get("LAZY_EQUITY_CURVE_CAP", "").strip()
    if raw:
        try:
            return max(64, int(raw))
        except ValueError:
            pass
    return 512


CandidateSource = Literal["final", "pro_round"]


@dataclass(frozen=True)
class ResolvedCandidate:
    candidate: PortfolioCandidate
    source: CandidateSource
    pro_round_index: int | None = None


def _normalize_model_code(model_code: str) -> str:
    return str(model_code).strip().upper()


def _candidate_matches_code(c: PortfolioCandidate, code: str) -> bool:
    raw = str(c.model_code or "").strip()
    if not raw:
        return False
    return raw.upper() == code


def _collect_candidate_hits(
    result: BacktestResult,
    model_code: str,
) -> list[ResolvedCandidate]:
    code = _normalize_model_code(model_code)
    if not code:
        return []
    hits: list[ResolvedCandidate] = []
    for c in result.candidates:
        if _candidate_matches_code(c, code):
            hits.append(ResolvedCandidate(candidate=c, source="final"))
    for idx, pr in enumerate(result.pro_rounds or []):
        for c in pr.candidates:
            if _candidate_matches_code(c, code):
                hits.append(
                    ResolvedCandidate(
                        candidate=c,
                        source="pro_round",
                        pro_round_index=idx,
                    )
                )
    return hits


def resolve_candidate(
    result: BacktestResult,
    model_code: str,
    *,
    rank: int | None = None,
) -> ResolvedCandidate:
    """Resolve one catalog row by model_code, optionally disambiguated by objective rank."""
    hits = _collect_candidate_hits(result, model_code)
    if not hits:
        raise LookupError(f"Unknown model_code: {model_code}")

    if rank is not None:
        by_rank = [h for h in hits if h.candidate.rank == rank]
        if by_rank:
            hits = by_rank

    if len(hits) == 1:
        return hits[0]

    final_hits = [h for h in hits if h.source == "final"]
    if final_hits:
        return final_hits[0]

    pro_hits = [h for h in hits if h.source == "pro_round"]
    pro_hits.sort(
        key=lambda h: (
            -(result.pro_rounds or [])[h.pro_round_index or 0].round
            if h.pro_round_index is not None
            else 0
        )
    )
    return pro_hits[0]


def find_candidate(result: BacktestResult, model_code: str) -> PortfolioCandidate | None:
    try:
        return resolve_candidate(result, model_code).candidate
    except LookupError:
        return None


def candidate_has_full_charts(c: PortfolioCandidate) -> bool:
    analytics = c.analytics or {}
    wh = analytics.get("weight_history") or []
    ec = c.equity_curve or []
    return bool(len(wh) > 0 or len(ec) > 0)


def candidate_has_deep_analytics(c: PortfolioCandidate) -> bool:
    analytics = c.analytics or {}
    rolling = (analytics.get("rolling") or {}).get("rolling_sharpe") or []
    monthly = (analytics.get("periodic_returns") or {}).get("monthly") or []
    return bool(len(rolling) > 0 or len(monthly) > 0)


def _extract_institutional(analytics: dict[str, Any]) -> dict[str, Any] | None:
    out = {k: analytics[k] for k in _INSTITUTIONAL_KEYS if analytics.get(k)}
    return out or None


def _maybe_downsample_curve(curve: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cap = _equity_curve_cap()
    if len(curve) <= cap:
        return curve
    return downsample_keep_endpoints(curve, cap)


def _build_institutional_analytics(
    *,
    req: BacktestRequest,
    params: dict[str, Any],
    tickers: list[str],
    prices: pd.DataFrame,
    prices_sim_panel: pd.DataFrame,
    spec: BacktestSpec,
    universe_by_ticker: dict[str, dict[str, Any]],
    full_m: dict[str, Any],
    bundle_train_m: dict[str, Any] | None,
    bundle_val_m: dict[str, Any] | None,
    sim_kw: dict[str, Any],
    resolver: Any,
) -> dict[str, Any]:
    """Assemble institutional report analytics from cached or fresh sim slices."""
    oos = bool(req.enable_oos)
    prices_train, prices_val, _train_end, _val_start = split_train_validation(
        prices_sim_panel, float(req.train_ratio)
    )
    val_required = bool(oos and len(prices_val) > 60)

    train_m = bundle_train_m
    val_m = bundle_val_m
    if oos and train_m is None:
        train_kw = apply_allocator_resolver(sim_kw, prices_train, resolver)
        train_m = simulate_dynamic_portfolio(
            prices_sim_panel,
            report_start=str(prices_train.index[0].date()),
            **train_kw,
        )
    if val_required and val_m is None:
        val_kw = apply_allocator_resolver(sim_kw, prices_val, resolver)
        val_m = simulate_dynamic_portfolio(
            prices_sim_panel,
            report_start=str(prices_val.index[0].date()),
            **val_kw,
        )

    weights = _weights_dict(
        tickers,
        np.atleast_1d(np.asarray(full_m.get("last_weights"), dtype=float)).ravel(),
        min_weight=float(req.min_weight),
    )
    port_ret: pd.Series = full_m["port_ret"]
    equity: pd.Series = full_m["equity"]
    bench_t = spec.benchmark_ticker
    bench_ret = (
        prices[bench_t].pct_change().fillna(0.0) if bench_t in prices.columns else None
    )
    periodic_equity = train_m.get("equity") if oos and train_m is not None else None
    holdout_equity = val_m.get("equity") if val_required and val_m is not None else None

    analytics = build_full_analytics(
        port_ret=port_ret,
        equity=equity,
        bench_ret=bench_ret,
        spec=spec,
        weights=weights,
        tickers=tickers,
        universe_by_ticker=universe_by_ticker,
        prices=prices,
        periodic_equity=periodic_equity,
        holdout_equity=holdout_equity,
    )
    analytics["execution"] = {
        "rebalance_freq": full_m.get("rebalance_freq"),
        "rebalance_count": full_m.get("rebalance_count"),
        "rebalance_applied": full_m.get("rebalance_applied"),
        "rebalance_dates_sample": (full_m.get("rebalance_dates") or [])[:12],
    }
    return analytics


def payload_from_candidate(c: PortfolioCandidate) -> CandidateChartsPayload:
    analytics = c.analytics or {}
    return CandidateChartsPayload(
        model_code=str(c.model_code or ""),
        equity_curve=_maybe_downsample_curve(list(c.equity_curve or [])),
        weight_history=list(analytics.get("weight_history") or []),
        weight_history_tickers=list(analytics.get("weight_history_tickers") or []),
        benchmark_equity_curve=_maybe_downsample_curve(
            list(analytics.get("benchmark_equity_curve") or [])
        ),
        weight_cap_audit=analytics.get("weight_cap_audit"),
        institutional=_extract_institutional(analytics),
    )


def _load_price_panel(
    req: BacktestRequest,
    *,
    benchmark: str,
) -> tuple[
    list[str],
    pd.DataFrame,
    pd.DataFrame,
    BacktestSpec,
    dict[str, Any] | None,
    dict[str, dict[str, Any]],
]:
    """Reload tradable prices for one candidate chart rebuild."""
    from app.engine.portfolio import _normalize_rebalance_rule

    guaranteed_supplements = list(req.universe_supplement_tickers or [])
    universe = get_universe(
        req.asset_classes,
        req.universe_categories,
        req.universe_tickers,
        supplement_tickers=guaranteed_supplements or None,
    )
    objective_effective = _resolve_objective(req.objective.value, req.objective_custom_text)
    universe_plan = refine_universe_with_ai(
        universe=universe,
        objective=trial_scoring_objective(objective_effective)
        if is_dynamic_objective(objective_effective)
        else objective_effective,
        asset_classes=req.asset_classes,
    )
    universe = pin_guaranteed_supplements(
        universe_plan["universe"],
        guaranteed_supplements or None,
        asset_classes=req.asset_classes,
    )
    tickers = [u["ticker"] for u in universe]
    rebalance_rule = _normalize_rebalance_rule(req.rebalance_freq)
    bench_ticker = (
        str(req.benchmark_ticker).strip().upper()
        if getattr(req, "benchmark_ticker", None)
        else (benchmark or str(universe_plan.get("benchmark_ticker", "SPY")))
    )
    spec = BacktestSpec(
        benchmark_ticker=bench_ticker,
        fee_bps=req.fee_bps,
        rebalance_rule=rebalance_rule,
        max_holdings=int(req.max_holdings),
    )
    prices, _meta = fetch_prices(
        tickers, req.start_date, req.end_date, spec.benchmark_ticker
    )
    tickers = [t for t in tickers if t in prices.columns]
    universe_by_ticker = {u["ticker"]: u for u in universe if u["ticker"] in tickers}
    prices_full = prices
    prices_sim_panel = prices_full[tickers]
    prices = trim_prices_to_report_window(prices_full[tickers].copy(), req.start_date)

    dynamic_ctx: dict[str, Any] | None = None
    regime_adaptive = bool(getattr(req, "regime_adaptive", False)) or is_dynamic_objective(
        objective_effective
    )
    if regime_adaptive:
        regime_mode = resolve_regime_mode(
            str(req.experiment.regime_mode)
            if req.experiment and req.experiment.enabled
            else None
        )
        dynamic_ctx = build_dynamic_objective_context(
            prices_full,
            spec.benchmark_ticker,
            regime_mode=regime_mode,
            fast_risk_off_exit=True,
        )
    return tickers, prices, prices_sim_panel, spec, dynamic_ctx, universe_by_ticker


def _hydrate_regime_class_budget_ctx(
    dynamic_ctx: dict[str, Any] | None,
    narrative_facts: dict[str, Any],
    *,
    asset_classes: list[str] | None,
) -> dict[str, Any] | None:
    if dynamic_ctx is None:
        return None
    quotas = narrative_facts.get("regime_class_quotas")
    if not quotas:
        return dynamic_ctx
    return ensure_regime_class_budget_resolver(
        dynamic_ctx,
        regime_class_quotas=quotas,
        asset_classes=asset_classes,
    )


def rebuild_candidate_charts(
    req: BacktestRequest,
    params: dict[str, Any],
    *,
    trial_report_cache: TrialReportCache | None,
    narrative_facts: dict[str, Any],
    benchmark: str,
) -> CandidateChartsPayload:
    """Build charts from TrialReportCache and/or one full-period simulate."""
    from app.engine.portfolio import _normalize_rebalance_rule

    objective_effective = str(
        narrative_facts.get("objective")
        or _resolve_objective(req.objective.value, req.objective_custom_text)
    )
    rebalance_rule = str(
        narrative_facts.get("rebalance_freq")
        or _normalize_rebalance_rule(req.rebalance_freq)
    )
    tickers, prices, prices_sim_panel, spec, dynamic_ctx, universe_by_ticker = (
        _load_price_panel(req, benchmark=benchmark)
    )
    dynamic_ctx = _hydrate_regime_class_budget_ctx(
        dynamic_ctx,
        narrative_facts,
        asset_classes=req.asset_classes,
    )
    resolver = dynamic_ctx.get("allocator_resolver") if dynamic_ctx else None

    trial_spec, alloc, cap, top_n_actual, no_trade_tol, turnover_penalty_mult, max_turnover_actual, class_budget, f_params = (
        _sim_inputs_from_params(params, req, rebalance_rule, spec)
    )
    sim_kw = apply_allocator_resolver(
        dict(
            spec=trial_spec,
            max_weight=cap,
            min_weight=req.min_weight,
            allocator=alloc,
            top_n=top_n_actual,
            factor_params=f_params,
            no_trade_tol=no_trade_tol,
            turnover_penalty_mult=turnover_penalty_mult,
            max_turnover=max_turnover_actual,
            universe_by_ticker=universe_by_ticker,
            class_budget=class_budget,
        ),
        prices,
        resolver,
    )
    active_regime_resolver = (
        dynamic_ctx.get("active_regime_resolver") if dynamic_ctx else None
    )
    class_resolver = (
        class_budget_resolver_from_trial_params(
            params,
            active_regime_resolver,
            asset_classes=req.asset_classes,
        )
        if dynamic_ctx
        else None
    )
    if class_resolver is None and dynamic_ctx:
        class_resolver = dynamic_ctx.get("class_budget_resolver")
    sim_kw = apply_class_budget_resolver(
        sim_kw,
        prices,
        class_resolver,
        asset_classes=req.asset_classes,
    )
    sim_kw["enforce_class_weights"] = req.enforce_class_weights
    factor_resolver = factor_params_resolver_from_trial_params(
        params,
        active_regime_resolver,
        default_lookback=alloc.lookback_days,
    )
    if factor_resolver is not None:
        sim_kw["factor_params_resolver"] = factor_resolver

    bundle = trial_report_cache.copy_bundle(params) if trial_report_cache else None
    train_m = bundle.train_m if bundle else None
    val_m = bundle.val_m if bundle else None
    full_m = bundle.full_m if bundle else None
    if full_m is None or not full_m.get("weight_history"):
        report_full = str(req.start_date)
        full_m = simulate_dynamic_portfolio(
            prices_sim_panel,
            report_start=report_full,
            **sim_kw,
        )

    full_curve = equity_curve_series(full_m["equity"])
    wh_raw = full_m.get("weight_history", [])
    wht_raw = full_m.get("weight_history_tickers", [])
    first_eq = str(full_curve[0].get("date", "")) if full_curve else ""
    if first_eq:
        wh_raw = [row for row in wh_raw if str(row.get("date", "")) >= first_eq]
    wh_raw = anchor_weight_history_to_date(wh_raw, first_eq)
    wh, wht = trim_weight_history_for_response(wh_raw, tickers=wht_raw or tickers)

    bench_t = spec.benchmark_ticker
    bench_curve: list[dict[str, Any]] = []
    port_ret: pd.Series = full_m["port_ret"]
    if bench_t in prices.columns:
        bench_ret = prices[bench_t].pct_change().fillna(0.0)
        aligned_bench = bench_ret.reindex(port_ret.index).fillna(0.0)
        bench_equity = (1.0 + aligned_bench).cumprod()
        bench_curve = equity_curve_series(bench_equity)

    institutional = _build_institutional_analytics(
        req=req,
        params=params,
        tickers=tickers,
        prices=prices,
        prices_sim_panel=prices_sim_panel,
        spec=spec,
        universe_by_ticker=universe_by_ticker,
        full_m=full_m,
        bundle_train_m=train_m,
        bundle_val_m=val_m,
        sim_kw=sim_kw,
        resolver=resolver,
    )
    if dynamic_ctx:
        exp_by_regime = exposure_by_regime_from_weight_history(
            wh,
            universe_by_ticker,
            dynamic_ctx.get("regime_timeline") or [],
        )
        if exp_by_regime:
            institutional["exposure_by_regime"] = exp_by_regime

    model_code = str(params.get("model_code") or "")
    return CandidateChartsPayload(
        model_code=model_code,
        equity_curve=_maybe_downsample_curve(full_curve),
        weight_history=wh,
        weight_history_tickers=wht,
        benchmark_equity_curve=_maybe_downsample_curve(bench_curve),
        weight_cap_audit=full_m.get("weight_cap_audit"),
        institutional=institutional,
    )


def resolve_candidate_charts(
    req: BacktestRequest,
    result: BacktestResult,
    model_code: str,
    *,
    rank: int | None = None,
    trial_report_cache: TrialReportCache | None,
) -> CandidateChartsPayload:
    resolved = resolve_candidate(result, model_code, rank=rank)
    candidate = resolved.candidate
    if candidate_has_full_charts(candidate) and candidate_has_deep_analytics(candidate):
        return payload_from_candidate(candidate)
    params = dict(candidate.params or {})
    if not params:
        raise ValueError(f"Candidate {model_code} has no stored params for chart rebuild")
    return rebuild_candidate_charts(
        req,
        params,
        trial_report_cache=trial_report_cache,
        narrative_facts=result.narrative_facts or {},
        benchmark=result.benchmark,
    )


def merge_charts_into_candidate(
    candidate: PortfolioCandidate,
    payload: CandidateChartsPayload,
) -> PortfolioCandidate:
    """Patch one candidate row with lazy charts (does not touch other candidates)."""
    analytics = dict(candidate.analytics or {})
    analytics["weight_history"] = payload.weight_history
    analytics["weight_history_tickers"] = payload.weight_history_tickers
    analytics["benchmark_equity_curve"] = payload.benchmark_equity_curve
    if payload.weight_cap_audit is not None:
        analytics["weight_cap_audit"] = payload.weight_cap_audit
    if payload.institutional:
        for key, value in payload.institutional.items():
            analytics[key] = value
    return candidate.model_copy(
        update={
            "equity_curve": payload.equity_curve,
            "analytics": analytics,
        }
    )
