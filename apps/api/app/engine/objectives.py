"""Shared objective scoring for trial selection and IS/OOS reporting."""

from __future__ import annotations

from typing import Any


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
    if objective_mode == "dynamic":
        return float(metrics.get("sharpe", 0.0))
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
    }
    return labels.get(objective_mode, objective_mode)
