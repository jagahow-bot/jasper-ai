"""Tests for user-facing champion metric resolution."""

from __future__ import annotations

from app.champion_metrics import champion_display_metrics
from app.models import PortfolioCandidate


def test_champion_display_metrics_prefers_full_sample():
    cand = PortfolioCandidate(
        rank=1,
        model_code="M0035",
        is_champion=True,
        weights={"SPY": 1.0},
        sharpe=0.63,
        max_drawdown=-0.23,
        cagr=0.12,
        volatility=0.15,
        analytics={
            "sample_metrics": {
                "full_sample": {
                    "sharpe": 0.359,
                    "cagr": 0.0925,
                    "max_drawdown": -0.417,
                },
            },
        },
    )
    metrics = champion_display_metrics(cand)
    assert metrics.horizon == "full_sample"
    assert metrics.sharpe == 0.359
    assert metrics.cagr == 0.0925
    assert metrics.max_drawdown == -0.417


def test_champion_display_metrics_falls_back_to_root_fields():
    cand = PortfolioCandidate(
        rank=1,
        model_code="M0001",
        is_champion=True,
        weights={"SPY": 1.0},
        sharpe=1.25,
        max_drawdown=-0.12,
        cagr=0.11,
        volatility=0.15,
    )
    metrics = champion_display_metrics(cand)
    assert metrics.horizon == "selection"
    assert metrics.sharpe == 1.25
    assert metrics.cagr == 0.11
    assert metrics.max_drawdown == -0.12
