"""Shared objective scoring for trial selection and IS/OOS reporting."""

from __future__ import annotations

from typing import Any

# Pro/Optuna champion metric when run objective is ``dynamic`` (not per-rebalance blend).
DYNAMIC_COMPREHENSIVE_SCORING = "dynamic_comprehensive"


def compute_dynamic_comprehensive_score(metrics: dict[str, Any]) -> float:
    """Higher is better. Multi-metric in-sample score for dynamic Pro champion ranking.

    Formula (weights sum to 1.0 on normalized terms):
      0.45×Sharpe + 0.25×Sortino + 0.20×(5×CAGR) − 0.35×|max_drawdown| − 0.10×turnover_avg
    CAGR is scaled by 5 so ~10% annual maps near 0.5 alongside typical Sharpe levels.
    """
    sharpe = float(metrics.get("sharpe", 0.0))
    sortino = float(metrics.get("sortino", sharpe))
    cagr = float(metrics.get("cagr", 0.0))
    mdd = abs(float(metrics.get("max_drawdown", 0.0)))
    turnover = float(metrics.get("turnover_avg", 0.0))
    return (
        0.45 * sharpe
        + 0.25 * sortino
        + 0.20 * (5.0 * cagr)
        - 0.35 * mdd
        - 0.10 * turnover
    )


def compute_objective_score(objective_mode: str, metrics: dict[str, Any]) -> float:
    """Higher is better for all modes (drawdown/CVaR converted to maximization)."""
    if objective_mode == "max_return":
        return float(metrics.get("cagr", 0.0))
    if objective_mode == "min_max_drawdown":
        return -abs(float(metrics.get("max_drawdown", 0.0)))
    if objective_mode == "max_sortino":
        return float(metrics.get("sortino", 0.0))
    if objective_mode == "min_cvar":
        return float(metrics.get("cvar_95", -1.0))
    if objective_mode == "risk_parity_erc":
        return float(metrics.get("sharpe", 0.0)) - 0.25 * abs(
            float(metrics.get("max_drawdown", 0.0))
        )
    if objective_mode == "max_diversification":
        return (
            float(metrics.get("cagr", 0.0))
            - 0.35 * abs(float(metrics.get("max_drawdown", 0.0)))
            - 0.10 * float(metrics.get("turnover_avg", 0.0))
        )
    if objective_mode == "mean_variance_utility":
        return float(metrics.get("sharpe", 0.0)) - 0.15 * float(
            metrics.get("volatility", 0.0)
        )
    if objective_mode == "custom":
        return float(metrics.get("sharpe", 0.0)) - 0.2 * abs(
            float(metrics.get("max_drawdown", 0.0))
        )
    if objective_mode in (DYNAMIC_COMPREHENSIVE_SCORING, "dynamic"):
        return compute_dynamic_comprehensive_score(metrics)
    return float(metrics.get("sharpe", 0.0))


def metrics_snapshot(metrics: dict[str, Any], *, objective_mode: str) -> dict[str, Any]:
    return {
        "sharpe": round(float(metrics.get("sharpe", 0.0)), 4),
        "cagr": round(float(metrics.get("cagr", 0.0)), 4),
        "max_drawdown": round(float(metrics.get("max_drawdown", 0.0)), 4),
        "volatility": round(float(metrics.get("volatility", 0.0)), 4),
        "sortino": round(float(metrics.get("sortino", 0.0)), 4),
        "objective_value": round(compute_objective_score(objective_mode, metrics), 6),
    }


def objective_label(objective_mode: str) -> str:
    labels = {
        "max_sharpe": "Sharpe",
        "max_return": "CAGR",
        "min_max_drawdown": "Max DD (min)",
        "max_sortino": "Sortino",
        "min_cvar": "CVaR (min)",
        "risk_parity_erc": "Risk parity score",
        "max_diversification": "Diversification score",
        "mean_variance_utility": "Mean-var utility",
        "custom": "Custom score",
        "dynamic": "Dynamic (regime-based)",
        DYNAMIC_COMPREHENSIVE_SCORING: "Dynamic comprehensive score",
    }
    return labels.get(objective_mode, objective_mode)


def dynamic_comprehensive_score_summary() -> str:
    """One-line UI copy for dynamic Pro champion metric."""
    return (
        "0.45×Sharpe + 0.25×Sortino + 0.20×(5×CAGR) "
        "− 0.35×|max DD| − 0.10×turnover (in-sample, objective_value_is)"
    )
