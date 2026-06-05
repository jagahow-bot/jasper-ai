"""Lazy-load full chart payload for a single portfolio candidate."""

from __future__ import annotations

import os
from typing import Any

import pandas as pd

from app.engine.ai_universe import refine_universe_with_ai
from app.engine.backtest import (
    _resolve_objective,
    _sim_inputs_from_params,
)
from app.engine.data import fetch_prices
from app.engine.dynamic_objective import (
    apply_allocator_resolver,
    build_dynamic_objective_context,
    factor_params_resolver_from_trial_params,
    is_dynamic_objective,
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


def _equity_curve_cap() -> int:
    raw = os.environ.get("LAZY_EQUITY_CURVE_CAP", "").strip()
    if raw:
        try:
            return max(64, int(raw))
        except ValueError:
            pass
    return 512


def find_candidate(result: BacktestResult, model_code: str) -> PortfolioCandidate | None:
    code = str(model_code).strip()
    for c in result.candidates:
        if c.model_code == code:
            return c
    return None


def candidate_has_full_charts(c: PortfolioCandidate) -> bool:
    analytics = c.analytics or {}
    wh = analytics.get("weight_history") or []
    ec = c.equity_curve or []
    return bool(len(wh) > 0 or len(ec) > 0)


def _maybe_downsample_curve(curve: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cap = _equity_curve_cap()
    if len(curve) <= cap:
        return curve
    return downsample_keep_endpoints(curve, cap)


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
    )


def _load_price_panel(
    req: BacktestRequest,
    *,
    benchmark: str,
) -> tuple[list[str], pd.DataFrame, pd.DataFrame, BacktestSpec, dict[str, Any] | None]:
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
    spec = BacktestSpec(
        benchmark_ticker=benchmark or str(universe_plan.get("benchmark_ticker", "SPY")),
        fee_bps=req.fee_bps,
        rebalance_rule=rebalance_rule,
        max_holdings=int(req.max_holdings),
    )
    prices, _meta = fetch_prices(
        tickers, req.start_date, req.end_date, spec.benchmark_ticker
    )
    tickers = [t for t in tickers if t in prices.columns]
    prices_full = prices
    prices_sim_panel = prices_full[tickers]
    prices = trim_prices_to_report_window(prices_full[tickers].copy(), req.start_date)

    dynamic_ctx: dict[str, Any] | None = None
    if is_dynamic_objective(objective_effective):
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
    return tickers, prices, prices_sim_panel, spec, dynamic_ctx


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
    tickers, prices, prices_sim_panel, spec, dynamic_ctx = _load_price_panel(
        req, benchmark=benchmark
    )
    resolver = dynamic_ctx.get("allocator_resolver") if dynamic_ctx else None

    trial_spec, alloc, cap, top_n_actual, no_trade_tol, turnover_penalty_mult, max_turnover_actual, class_budget, f_params = (
        _sim_inputs_from_params(params, req, rebalance_rule, spec)
    )
    universe_by_ticker = {t: {"ticker": t} for t in tickers}
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
    factor_resolver = factor_params_resolver_from_trial_params(
        params,
        active_regime_resolver,
        default_lookback=alloc.lookback_days,
    )
    if factor_resolver is not None:
        sim_kw["factor_params_resolver"] = factor_resolver

    bundle = trial_report_cache.copy_bundle(params) if trial_report_cache else None
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

    model_code = str(params.get("model_code") or "")
    return CandidateChartsPayload(
        model_code=model_code,
        equity_curve=_maybe_downsample_curve(full_curve),
        weight_history=wh,
        weight_history_tickers=wht,
        benchmark_equity_curve=_maybe_downsample_curve(bench_curve),
        weight_cap_audit=full_m.get("weight_cap_audit"),
    )


def resolve_candidate_charts(
    req: BacktestRequest,
    result: BacktestResult,
    model_code: str,
    *,
    trial_report_cache: TrialReportCache | None,
) -> CandidateChartsPayload:
    candidate = find_candidate(result, model_code)
    if candidate is None:
        raise LookupError(f"Unknown model_code: {model_code}")
    if candidate_has_full_charts(candidate):
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
    return candidate.model_copy(
        update={
            "equity_curve": payload.equity_curve,
            "analytics": analytics,
        }
    )
