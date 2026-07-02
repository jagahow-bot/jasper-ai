"""Optuna hyperparameter search for allocation model parameters.

We do NOT randomize portfolio weights directly. Each trial samples model parameters
(lookback/shrinkage/risk_aversion) and weights are solved by a standard allocator
at each rebalance date.
"""

from __future__ import annotations

import gc
from typing import Callable

import numpy as np
import optuna
import pandas as pd

from app.engine.asset_class_policy import (
    TOP_LEVEL_QUOTA_KEYS,
    class_budget_from_params,
    has_regime_class_quotas,
    regime_class_quota_param_key,
    zero_disallowed_class_params,
)
from app.engine.allocator import AllocatorParams
from app.engine.factors import (
    DRAWDOWN_INDICATOR_CHOICES,
    LOWVOL_INDICATOR_CHOICES,
    MOM_INDICATOR_CHOICES,
    REVERSAL_INDICATOR_CHOICES,
    TREND_INDICATOR_CHOICES,
    VALUE_INDICATOR_CHOICES,
    DEFAULT_DRAWDOWN_INDICATOR,
    DEFAULT_LOWVOL_INDICATOR,
    DEFAULT_MOM_INDICATOR,
    DEFAULT_REVERSAL_INDICATOR,
    DEFAULT_TREND_INDICATOR,
    DEFAULT_VALUE_INDICATOR,
    FactorParams,
)
from app.engine.portfolio import simulate_dynamic_portfolio
from app.engine.weights import min_holdings_for_cap
from app.engine.objectives import compute_objective_score, metrics_snapshot
from app.engine.refinement import assess_overfitting, model_signature
from app.engine.param_bounds import (
    RunBlueprint,
    cap_search_high,
    cap_search_low,
    clamp_param_dict,
    normalize_param_controls,
    resolve_control_mode,
    resolve_off_value,
)
from app.engine.dynamic_objective import (
    REGIME_KEYS,
    build_regime_factor_params_resolver,
    class_budget_resolver_from_trial_params,
    has_regime_matrix,
)
from app.engine.param_taxonomy import (
    build_pro_round_param_controls,
    has_regime_factor_ranges,
    regime_factor_param_key,
)
from app.engine.memory_budget import (
    maybe_collect_garbage,
    optuna_n_jobs,
    prune_search_records,
    search_records_cap,
    slim_search_metrics,
)
from app.engine.report_sim_cache import TrialReportCache
from app.engine.spec import BacktestSpec, DEFAULT_SPEC

optuna.logging.set_verbosity(optuna.logging.WARNING)

INFEASIBLE_SCORE = -1e6


def _objective_display_value(
    objective_mode: str, metrics: dict
) -> float:
    if objective_mode == "max_return":
        return float(metrics.get("cagr", 0.0))
    if objective_mode == "min_max_drawdown":
        return abs(float(metrics.get("max_drawdown", 0.0)))
    if objective_mode == "max_sortino":
        return float(metrics.get("sortino", 0.0))
    if objective_mode == "min_cvar":
        return abs(float(metrics.get("cvar_95", 0.0)))
    if objective_mode == "mean_variance_utility":
        return float(metrics.get("volatility", 0.0))
    # default, risk_parity_erc, max_diversification, custom -> use sharpe-like main axis
    return float(metrics.get("sharpe", 0.0))


def run_optuna_search(
    prices_train: pd.DataFrame,
    *,
    max_weight: float,
    min_weight: float = 0.0,
    max_turnover: float,
    top_n: int,
    objective: str,
    trials: int,
    ai_seed_param_sets: list[dict] | None = None,
    round_setup: dict | None = None,
    regime_setups: dict | None = None,
    regime_factor_ranges: dict | None = None,
    regime_class_quotas: dict | None = None,
    factor_ranges: dict | None = None,
    factor_choices: dict | None = None,
    active_regime_resolver: Callable[[pd.Timestamp], str] | None = None,
    param_controls: dict[str, dict] | None = None,
    spec: BacktestSpec = DEFAULT_SPEC,
    progress_cb: (
        Callable[[int, int, float | None], None]
        | Callable[[int, int, float | None, tuple[float, dict, dict] | None], None]
        | None
    ) = None,
    universe_by_ticker: dict[str, dict] | None = None,
    prices_val: pd.DataFrame | None = None,
    champion_seed: dict | None = None,
    select_on_is: bool = False,
    asset_classes: list[str] | None = None,
    trial_report_cache: TrialReportCache | None = None,
    allocator_resolver: Callable[[pd.Timestamp], AllocatorParams] | None = None,
    class_budget_resolver: Callable[[pd.Timestamp], dict[str, float]] | None = None,
    prices_sim_panel: pd.DataFrame | None = None,
    enforce_class_weights: bool = True,
) -> list[tuple[float, dict, dict]]:
    records: list[tuple[float, dict, dict]] = []
    trial_records: dict[int, tuple[float, dict, dict]] = {}
    best_value: float | None = None
    n_assets = int(prices_train.shape[1])
    top_n_cap = int(max(1, min(int(top_n), n_assets, int(spec.max_holdings))))
    min_top = int(max(2, min(int(spec.min_holdings), n_assets)))
    if top_n_cap < min_top:
        top_n_cap = min_top
    ai_seed_param_sets = ai_seed_param_sets or []
    pro_round_mode = bool(round_setup)
    blueprint = RunBlueprint(
        max_weight=float(max_weight),
        max_turnover=float(max_turnover),
        top_n=int(top_n),
    )
    if pro_round_mode:
        param_controls = build_pro_round_param_controls(
            param_controls,
            blueprint=blueprint,
            round_setup=round_setup,
            factor_ranges=factor_ranges,
            factor_choices=factor_choices,
            regime_setups=regime_setups,
            regime_factor_ranges=regime_factor_ranges,
            regime_class_quotas=regime_class_quotas,
            asset_classes=asset_classes,
        )
    else:
        param_controls = normalize_param_controls(param_controls, blueprint)
    regime_factor_active = bool(
        pro_round_mode
        and has_regime_matrix(regime_setups)
        and has_regime_factor_ranges(regime_factor_ranges)
    )
    regime_quota_active = bool(
        pro_round_mode
        and has_regime_matrix(regime_setups)
        and has_regime_class_quotas(regime_class_quotas)
    )

    def _ctl(key: str) -> dict | None:
        c = param_controls.get(key)
        return c if isinstance(c, dict) else None

    def _seed_or_suggest_float(
        trial: optuna.Trial, seed: dict | None, key: str, low: float, high: float
    ) -> float:
        c = _ctl(key)
        lo = float(cap_search_low(key, low, c))
        hi = float(cap_search_high(key, high, blueprint, c))
        lo, hi = min(lo, hi), max(lo, hi)
        mode = resolve_control_mode(c)
        if mode == "off":
            off_val = resolve_off_value(key, blueprint, c, default_low=lo)
            if off_val is not None:
                return float(np.clip(float(off_val), lo, hi))
            return float(lo)
        if mode == "fixed":
            try:
                return float(np.clip(float(c.get("fixed", lo) if c else lo), lo, hi))
            except Exception:
                return lo
        if seed and key in seed:
            try:
                return float(np.clip(float(seed[key]), lo, hi))
            except Exception:
                pass
        return float(trial.suggest_float(key, lo, hi))

    def _seed_or_suggest_int(
        trial: optuna.Trial, seed: dict | None, key: str, low: int, high: int, step: int = 1
    ) -> int:
        c = _ctl(key)
        lo = int(cap_search_low(key, low, c))
        hi = int(cap_search_high(key, high, blueprint, c))
        if c and c.get("step") is not None:
            step = max(1, int(float(c["step"])))
        lo, hi = min(lo, hi), max(lo, hi)
        mode = resolve_control_mode(c)
        if mode == "off":
            off_val = resolve_off_value(key, blueprint, c, default_low=lo)
            if off_val is not None:
                return int(np.clip(int(off_val), lo, hi))
            return lo
        if mode == "fixed":
            try:
                return int(np.clip(int(float(c.get("fixed", lo) if c else lo)), lo, hi))
            except Exception:
                return lo
        low, high = lo, hi
        if seed and key in seed:
            try:
                v = int(seed[key])
                v = int(np.clip(v, low, high))
                if step > 1:
                    v = low + ((v - low) // step) * step
                return v
            except Exception:
                pass
        return int(trial.suggest_int(key, low, high, step=step))

    def _seed_or_suggest_cat(
        trial: optuna.Trial,
        seed: dict | None,
        key: str,
        choices: list[str],
        default_value: str,
    ) -> str:
        c = _ctl(key)
        if c:
            mode = str(c.get("mode", "search"))
            opts = [str(x) for x in (c.get("options") or choices)]
            opts = [x for x in opts if x in choices] or choices
            if mode == "off":
                return default_value
            if mode == "fixed":
                v = str(c.get("fixed", default_value))
                return v if v in opts else opts[0]
            choices = opts
        if seed and key in seed:
            v = str(seed[key])
            if v in choices:
                return v
        return str(trial.suggest_categorical(key, choices))

    def optuna_objective(trial: optuna.Trial) -> float:
        seed = None
        if not pro_round_mode:
            seed = (
                ai_seed_param_sets[trial.number]
                if trial.number < len(ai_seed_param_sets)
                else None
            )
        bounds_violations: list[dict] = []
        if seed:
            seed, bounds_violations = clamp_param_dict(
                seed, blueprint, param_controls=param_controls
            )
        lookback = _seed_or_suggest_int(trial, seed, "lookback_days", 126, 504, step=21)
        objective_mode = _seed_or_suggest_cat(
            trial,
            seed,
            "objective_mode",
            [
                "max_sharpe",
                "max_return",
                "min_max_drawdown",
                "max_sortino",
                "min_cvar",
                "risk_parity_erc",
                "max_diversification",
                "mean_variance_utility",
                "custom",
            ],
            objective,
        )
        allocator_mode = _seed_or_suggest_cat(
            trial,
            seed,
            "allocator_mode",
            ["auto", "mean_variance", "min_var", "risk_parity", "max_diversification"],
            "auto",
        )
        rebalance_freq = _seed_or_suggest_cat(
            trial,
            seed,
            "rebalance_freq",
            ["W-FRI", "ME", "QE", "YE"],
            str(spec.rebalance_rule),
        )
        shrinkage = _seed_or_suggest_float(trial, seed, "shrinkage", 0.0, 0.5)
        risk_aversion = _seed_or_suggest_float(trial, seed, "risk_aversion", 0.5, 12.0)
        actual_cap = _seed_or_suggest_float(
            trial, seed, "max_weight_actual", 0.05, max(float(max_weight), 0.05)
        )
        if actual_cap <= 0.0:
            actual_cap = float(max_weight)
        actual_cap = float(np.clip(actual_cap, 0.05, float(max_weight)))

        # Factor layer params (shared categoricals; numerics flat or per-regime)
        mom_indicator = _seed_or_suggest_cat(
            trial, seed, "mom_indicator", list(MOM_INDICATOR_CHOICES), DEFAULT_MOM_INDICATOR
        )
        reversal_indicator = _seed_or_suggest_cat(
            trial,
            seed,
            "reversal_indicator",
            list(REVERSAL_INDICATOR_CHOICES),
            DEFAULT_REVERSAL_INDICATOR,
        )
        value_indicator = _seed_or_suggest_cat(
            trial,
            seed,
            "value_indicator",
            list(VALUE_INDICATOR_CHOICES),
            DEFAULT_VALUE_INDICATOR,
        )
        lowvol_indicator = _seed_or_suggest_cat(
            trial,
            seed,
            "lowvol_indicator",
            list(LOWVOL_INDICATOR_CHOICES),
            DEFAULT_LOWVOL_INDICATOR,
        )
        trend_indicator = _seed_or_suggest_cat(
            trial,
            seed,
            "trend_indicator",
            list(TREND_INDICATOR_CHOICES),
            DEFAULT_TREND_INDICATOR,
        )
        drawdown_indicator = _seed_or_suggest_cat(
            trial,
            seed,
            "drawdown_indicator",
            list(DRAWDOWN_INDICATOR_CHOICES),
            DEFAULT_DRAWDOWN_INDICATOR,
        )
        factor_params_resolver = None
        regime_factor_flat: dict[str, float | int] = {}
        if regime_factor_active:
            factor_by_regime: dict[str, FactorParams] = {}
            for regime in REGIME_KEYS:
                factor_lb = _seed_or_suggest_int(
                    trial,
                    seed,
                    regime_factor_param_key(regime, "factor_lookback_days"),
                    126,
                    504,
                    step=21,
                )
                reversal_lb = _seed_or_suggest_int(
                    trial,
                    seed,
                    regime_factor_param_key(regime, "reversal_lookback_days"),
                    63,
                    252,
                    step=21,
                )
                value_lb = _seed_or_suggest_int(
                    trial,
                    seed,
                    regime_factor_param_key(regime, "value_lookback_days"),
                    63,
                    252,
                    step=21,
                )
                w_mom_r = _seed_or_suggest_float(
                    trial,
                    seed,
                    regime_factor_param_key(regime, "w_mom"),
                    0.0,
                    2.0,
                )
                w_reversal_r = _seed_or_suggest_float(
                    trial,
                    seed,
                    regime_factor_param_key(regime, "w_reversal"),
                    0.0,
                    2.0,
                )
                w_value_r = _seed_or_suggest_float(
                    trial,
                    seed,
                    regime_factor_param_key(regime, "w_value"),
                    0.0,
                    2.0,
                )
                w_lowvol_r = _seed_or_suggest_float(
                    trial,
                    seed,
                    regime_factor_param_key(regime, "w_lowvol"),
                    0.0,
                    2.0,
                )
                w_trend_r = _seed_or_suggest_float(
                    trial,
                    seed,
                    regime_factor_param_key(regime, "w_trend"),
                    0.0,
                    1.5,
                )
                w_drawdown_r = _seed_or_suggest_float(
                    trial,
                    seed,
                    regime_factor_param_key(regime, "w_drawdown"),
                    0.0,
                    1.5,
                )
                factor_by_regime[regime] = FactorParams(
                    lookback_days=int(factor_lb),
                    reversal_lookback_days=int(reversal_lb),
                    value_lookback_days=int(value_lb),
                    w_mom=float(w_mom_r),
                    w_reversal=float(w_reversal_r),
                    w_value=float(w_value_r),
                    w_lowvol=float(w_lowvol_r),
                    w_trend=float(w_trend_r),
                    w_drawdown=float(w_drawdown_r),
                    mom_indicator=str(mom_indicator),
                    reversal_indicator=str(reversal_indicator),
                    value_indicator=str(value_indicator),
                    lowvol_indicator=str(lowvol_indicator),
                    trend_indicator=str(trend_indicator),
                    drawdown_indicator=str(drawdown_indicator),
                )
                for fk, val in (
                    ("factor_lookback_days", factor_lb),
                    ("reversal_lookback_days", reversal_lb),
                    ("value_lookback_days", value_lb),
                    ("w_mom", w_mom_r),
                    ("w_reversal", w_reversal_r),
                    ("w_value", w_value_r),
                    ("w_lowvol", w_lowvol_r),
                    ("w_trend", w_trend_r),
                    ("w_drawdown", w_drawdown_r),
                ):
                    regime_factor_flat[regime_factor_param_key(regime, fk)] = val
            f_params = factor_by_regime.get("neutral") or FactorParams()
            if active_regime_resolver is not None:
                factor_params_resolver = build_regime_factor_params_resolver(
                    active_regime_resolver,
                    factor_by_regime,
                )
            factor_lb = int(f_params.lookback_days)
            reversal_lb = int(f_params.reversal_lookback_days)
            value_lb = int(f_params.value_lookback_days)
            w_mom = float(f_params.w_mom)
            w_reversal = float(f_params.w_reversal)
            w_value = float(f_params.w_value)
            w_lowvol = float(f_params.w_lowvol)
            w_trend = float(f_params.w_trend)
            w_drawdown = float(f_params.w_drawdown)
        else:
            factor_lb = _seed_or_suggest_int(
                trial, seed, "factor_lookback_days", 126, 504, step=21
            )
            reversal_lb = _seed_or_suggest_int(
                trial, seed, "reversal_lookback_days", 63, 252, step=21
            )
            value_lb = _seed_or_suggest_int(
                trial, seed, "value_lookback_days", 63, 252, step=21
            )
            w_mom = _seed_or_suggest_float(trial, seed, "w_mom", 0.0, 2.0)
            w_reversal = _seed_or_suggest_float(trial, seed, "w_reversal", 0.0, 2.0)
            w_value = _seed_or_suggest_float(trial, seed, "w_value", 0.0, 2.0)
            w_lowvol = _seed_or_suggest_float(trial, seed, "w_lowvol", 0.0, 2.0)
            w_trend = _seed_or_suggest_float(trial, seed, "w_trend", 0.0, 1.5)
            w_drawdown = _seed_or_suggest_float(trial, seed, "w_drawdown", 0.0, 1.5)
        regime_quota_flat: dict[str, float] = {}
        if regime_quota_active:
            for regime in REGIME_KEYS:
                for quota_key in TOP_LEVEL_QUOTA_KEYS:
                    optuna_key = regime_class_quota_param_key(regime, quota_key)
                    regime_quota_flat[optuna_key] = _seed_or_suggest_float(
                        trial, seed, optuna_key, 0.0, 1.0
                    )
        w_equity = _seed_or_suggest_float(trial, seed, "w_equity", 0.0, 1.0)
        w_bond = _seed_or_suggest_float(trial, seed, "w_bond", 0.0, 1.0)
        w_commodity = _seed_or_suggest_float(trial, seed, "w_commodity", 0.0, 1.0)
        w_real_estate = _seed_or_suggest_float(trial, seed, "w_real_estate", 0.0, 1.0)
        w_alternative = _seed_or_suggest_float(trial, seed, "w_alternative", 0.0, 1.0)
        w_equity_us = _seed_or_suggest_float(trial, seed, "w_equity_us", 0.0, 1.0)
        w_equity_intl = _seed_or_suggest_float(trial, seed, "w_equity_intl", 0.0, 1.0)
        w_equity_em = _seed_or_suggest_float(trial, seed, "w_equity_em", 0.0, 1.0)
        w_bond_us = _seed_or_suggest_float(trial, seed, "w_bond_us", 0.0, 1.0)
        w_bond_intl = _seed_or_suggest_float(trial, seed, "w_bond_intl", 0.0, 1.0)
        w_bond_credit = _seed_or_suggest_float(trial, seed, "w_bond_credit", 0.0, 1.0)
        w_commodity_precious = _seed_or_suggest_float(
            trial, seed, "w_commodity_precious", 0.0, 1.0
        )
        w_commodity_broad = _seed_or_suggest_float(
            trial, seed, "w_commodity_broad", 0.0, 1.0
        )
        w_reit_us = _seed_or_suggest_float(trial, seed, "w_reit_us", 0.0, 1.0)
        w_reit_intl = _seed_or_suggest_float(trial, seed, "w_reit_intl", 0.0, 1.0)

        # Institutional-ish knobs:
        # - pick top_n_actual assets (AI may be stricter than user cap)
        # - no-trade band (reduce rebalancing churn)
        # - turnover penalty multiplier (extra cost pressure)
        top_n_actual = _seed_or_suggest_int(
            trial, seed, "top_n_actual", min_top, top_n_cap
        )
        min_names_for_cap = min(
            min_holdings_for_cap(actual_cap, floor=2), n_assets
        )
        top_n_actual = int(
            np.clip(max(int(top_n_actual), min_names_for_cap), min_top, top_n_cap)
        )
        no_trade_tol = _seed_or_suggest_float(trial, seed, "no_trade_tol", 0.0, 0.02)
        turnover_penalty_mult = _seed_or_suggest_float(
            trial, seed, "turnover_penalty_mult", 0.5, 3.0
        )
        turnover_cap = float(max(max_turnover, 0.05))
        max_turnover_actual = _seed_or_suggest_float(
            trial, seed, "max_turnover_actual", 0.05, turnover_cap
        )

        if allocator_mode != "auto":
            mode = allocator_mode
        elif objective_mode in {"max_sharpe", "max_sortino", "mean_variance_utility"}:
            mode = "mean_variance"
        elif objective_mode == "risk_parity_erc":
            mode = "risk_parity"
        elif objective_mode == "max_diversification":
            mode = "max_diversification"
        else:
            mode = "min_var"
        trial_spec = BacktestSpec(
            benchmark_ticker=spec.benchmark_ticker,
            risk_free_rate=spec.risk_free_rate,
            fee_bps=spec.fee_bps,
            rebalance_rule=rebalance_freq,
            min_holdings=spec.min_holdings,
            max_holdings=spec.max_holdings,
        )
        alloc = AllocatorParams(
            mode=mode,
            lookback_days=int(lookback),
            shrinkage=float(shrinkage),
            risk_aversion=float(risk_aversion),
        )
        if not regime_factor_active:
            f_params = FactorParams(
                lookback_days=int(factor_lb),
                reversal_lookback_days=int(reversal_lb),
                value_lookback_days=int(value_lb),
                w_mom=float(w_mom),
                w_reversal=float(w_reversal),
                w_value=float(w_value),
                w_lowvol=float(w_lowvol),
                w_trend=float(w_trend),
                w_drawdown=float(w_drawdown),
                mom_indicator=str(mom_indicator),
                reversal_indicator=str(reversal_indicator),
                value_indicator=str(value_indicator),
                lowvol_indicator=str(lowvol_indicator),
                trend_indicator=str(trend_indicator),
                drawdown_indicator=str(drawdown_indicator),
            )

        has_holdout = prices_val is not None and len(prices_val) > 60
        use_is_only = bool(select_on_is and has_holdout)
        trial_params_pre = zero_disallowed_class_params(
            {
                "w_equity": w_equity,
                "w_bond": w_bond,
                "w_commodity": w_commodity,
                "w_real_estate": w_real_estate,
                "w_alternative": w_alternative,
                "w_equity_us": w_equity_us,
                "w_equity_intl": w_equity_intl,
                "w_equity_em": w_equity_em,
                "w_bond_us": w_bond_us,
                "w_bond_intl": w_bond_intl,
                "w_bond_credit": w_bond_credit,
                "w_commodity_precious": w_commodity_precious,
                "w_commodity_broad": w_commodity_broad,
                "w_reit_us": w_reit_us,
                "w_reit_intl": w_reit_intl,
            },
            asset_classes,
        )
        class_budget = class_budget_from_params(
            trial_params_pre, asset_classes=asset_classes
        )
        trial_class_resolver = class_budget_resolver
        if regime_quota_active and active_regime_resolver is not None:
            quota_trial_params = {
                **trial_params_pre,
                **regime_quota_flat,
                "regime_class_quota_matrix": True,
            }
            trial_class_resolver = class_budget_resolver_from_trial_params(
                quota_trial_params,
                active_regime_resolver,
                asset_classes=asset_classes,
            ) or class_budget_resolver

        sim_panel = prices_sim_panel if prices_sim_panel is not None else prices_train
        report_train = str(prices_train.index[0].date())
        prices_score = prices_train
        if not use_is_only and has_holdout:
            prices_score = pd.concat([prices_train, prices_val])
        alloc_step = (
            allocator_resolver(prices_score.index[0])
            if allocator_resolver is not None
            else alloc
        )
        sim_common = dict(
            spec=trial_spec,
            max_weight=actual_cap,
            min_weight=float(min_weight),
            allocator=alloc_step,
            top_n=int(top_n_actual),
            factor_params=f_params,
            no_trade_tol=float(no_trade_tol),
            turnover_penalty_mult=float(turnover_penalty_mult),
            max_turnover=float(max_turnover_actual),
            universe_by_ticker=universe_by_ticker,
            class_budget=class_budget,
            class_budget_resolver=trial_class_resolver,
            enforce_class_weights=enforce_class_weights,
            allocator_resolver=allocator_resolver,
            factor_params_resolver=factor_params_resolver,
        )
        try:
            metrics = simulate_dynamic_portfolio(
                sim_panel,
                report_start=report_train,
                **sim_common,
            )
        except Exception:
            return INFEASIBLE_SCORE

        if metrics.get("metrics_suspect"):
            return INFEASIBLE_SCORE

        score = compute_objective_score(objective_mode, metrics)
        params = {
            "mode": mode,
            "lookback_days": int(lookback),
            "shrinkage": float(shrinkage),
            "risk_aversion": float(risk_aversion),
            "max_weight_actual": float(actual_cap),
            "top_n_actual": int(top_n_actual),
            "factor_lookback_days": int(factor_lb),
            "reversal_lookback_days": int(reversal_lb),
            "value_lookback_days": int(value_lb),
            "no_trade_tol": float(no_trade_tol),
            "turnover_penalty_mult": float(turnover_penalty_mult),
            "max_turnover_actual": float(max_turnover_actual),
            "w_mom": float(w_mom),
            "w_reversal": float(w_reversal),
            "w_value": float(w_value),
            "w_lowvol": float(w_lowvol),
            "w_trend": float(w_trend),
            "w_drawdown": float(w_drawdown),
            "mom_indicator": str(mom_indicator),
            "reversal_indicator": str(reversal_indicator),
            "value_indicator": str(value_indicator),
            "lowvol_indicator": str(lowvol_indicator),
            "trend_indicator": str(trend_indicator),
            "drawdown_indicator": str(drawdown_indicator),
            "w_equity": float(trial_params_pre["w_equity"]),
            "w_bond": float(trial_params_pre["w_bond"]),
            "w_commodity": float(trial_params_pre["w_commodity"]),
            "w_real_estate": float(trial_params_pre["w_real_estate"]),
            "w_alternative": float(trial_params_pre["w_alternative"]),
            "w_equity_us": float(trial_params_pre["w_equity_us"]),
            "w_equity_intl": float(trial_params_pre["w_equity_intl"]),
            "w_equity_em": float(trial_params_pre["w_equity_em"]),
            "w_bond_us": float(trial_params_pre["w_bond_us"]),
            "w_bond_intl": float(trial_params_pre["w_bond_intl"]),
            "w_bond_credit": float(trial_params_pre["w_bond_credit"]),
            "w_commodity_precious": float(trial_params_pre["w_commodity_precious"]),
            "w_commodity_broad": float(trial_params_pre["w_commodity_broad"]),
            "w_reit_us": float(trial_params_pre["w_reit_us"]),
            "w_reit_intl": float(trial_params_pre["w_reit_intl"]),
            "objective_mode": objective_mode,
            "allocator_mode": mode,
            "rebalance_freq": rebalance_freq,
            "param_source": (
                "pro_round_optuna"
                if pro_round_mode
                else ("ai_seed" if seed else "optuna")
            ),
        }
        if regime_factor_flat:
            params.update(regime_factor_flat)
            params["regime_factor_matrix"] = True
        if regime_quota_flat:
            params.update(regime_quota_flat)
            params["regime_class_quota_matrix"] = True
        if bounds_violations:
            params["bounds_violations"] = bounds_violations
        train_m_holdout: dict | None = None
        val_m: dict | None = None
        if has_holdout:
            try:
                if use_is_only:
                    train_m_holdout = metrics
                else:
                    train_m_holdout = simulate_dynamic_portfolio(
                        sim_panel,
                        report_start=report_train,
                        **sim_common,
                    )
                val_common = dict(sim_common)
                if allocator_resolver is not None and len(prices_val) > 0:
                    val_common["allocator"] = allocator_resolver(prices_val.index[0])
                val_m = simulate_dynamic_portfolio(
                    sim_panel,
                    report_start=str(prices_val.index[0].date()),
                    **val_common,
                )
            except Exception:
                train_m_holdout = train_m_holdout if use_is_only else None
                val_m = None

        oos_active = bool(has_holdout and val_m is not None)
        assessment = assess_overfitting(
            train_m_holdout or metrics,
            val_m,
            oos_enabled=oos_active,
            objective_mode=objective_mode,
        )
        adjusted = float(score)
        penalty_applied = float(assessment.get("penalty", 0.0))
        is_m = train_m_holdout or metrics
        metrics["train_metrics"] = metrics_snapshot(is_m, objective_mode=objective_mode)
        if val_m:
            metrics["validation_metrics"] = metrics_snapshot(
                val_m, objective_mode=objective_mode
            )
        metrics["objective_value_is"] = float(assessment.get("in_sample_objective", score))
        metrics["objective_value_oos"] = assessment.get("out_of_sample_objective")
        metrics["gap_objective"] = float(assessment.get("gap_objective", 0.0))
        metrics["select_on_is"] = use_is_only
        metrics["overfitting_assessment"] = assessment
        metrics["raw_score"] = float(score)
        metrics["adjusted_score"] = float(adjusted)
        metrics["overfitting_penalty_applied"] = float(penalty_applied)

        params["raw_score"] = float(score)
        params["adjusted_score"] = float(adjusted)
        params["optuna_trial_number"] = int(trial.number)

        if trial_report_cache is not None:
            train_sim = train_m_holdout if has_holdout else metrics
            full_sim: dict | None = None
            if not has_holdout:
                full_sim = metrics
            elif not use_is_only:
                full_sim = metrics
            trial_report_cache.stash_from_trial(
                params,
                train_m=train_sim,
                val_m=val_m if has_holdout else None,
                full_m=full_sim,
            )

        rec = (adjusted, params, slim_search_metrics(metrics))
        records.append(rec)
        trial_records[trial.number] = rec
        return adjusted

    study = optuna.create_study(direction="maximize")

    # Enqueued champion re-sim is an extra trial; challengers must still run `trials` times.
    optuna_trials = trials + (1 if champion_seed else 0)
    if champion_seed:
        try:
            study.enqueue_trial(champion_seed)
        except Exception:
            optuna_trials = trials

    protect_sigs: set[str] = set()
    if champion_seed:
        protect_sigs.add(model_signature(champion_seed))

    def callback(study: optuna.Study, trial: optuna.trial.FrozenTrial) -> None:
        nonlocal best_value
        prune_search_records(
            records,
            max_records=search_records_cap(),
            protect_signatures=protect_sigs,
        )
        maybe_collect_garbage(4, trial.number + 1)
        feasible = [r for r in records if r[0] > INFEASIBLE_SCORE / 2]
        if feasible:
            vals = [
                float(m.get("objective_value_is", m.get("raw_score", 0.0)))
                for _, _, m in feasible
            ]
            best_value = max(vals) if vals else None
        if progress_cb:
            latest = trial_records.get(trial.number)
            try:
                progress_cb(trial.number + 1, optuna_trials, best_value, latest)
            except TypeError:
                progress_cb(trial.number + 1, optuna_trials, best_value)

    study.optimize(
        optuna_objective,
        n_trials=optuna_trials,
        n_jobs=optuna_n_jobs(),
        callbacks=[callback],
        show_progress_bar=False,
    )
    gc.collect()

    feasible_records = [r for r in records if r[0] > INFEASIBLE_SCORE / 2]
    if not feasible_records:
        raise ValueError(
            "No feasible parameter sets found (try a longer backtest window or check data quality)"
        )

    return feasible_records
