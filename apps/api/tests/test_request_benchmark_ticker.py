"""Explicit benchmark_ticker on BacktestRequest overrides AI universe pick."""

from __future__ import annotations

from app.engine.backtest import _resolve_request_benchmark_ticker
from app.models import BacktestMode, BacktestRequest, Objective


def _req(**overrides) -> BacktestRequest:
    base = dict(
        scenario_id="test",
        max_weight=0.5,
        objective=Objective.max_sharpe,
        backtest_mode=BacktestMode.static,
        start_date="2018-01-01",
        end_date="2024-12-31",
        trials=5,
        top_models=1,
    )
    base.update(overrides)
    return BacktestRequest(**base)


def test_resolve_request_benchmark_prefers_explicit_ticker() -> None:
    req = _req(benchmark_ticker="SPY")
    bench = _resolve_request_benchmark_ticker(
        req,
        universe_plan={"benchmark_ticker": "VT"},
    )
    assert bench == "SPY"


def test_resolve_request_benchmark_falls_back_to_universe_plan() -> None:
    req = _req()
    bench = _resolve_request_benchmark_ticker(
        req,
        universe_plan={"benchmark_ticker": "VT"},
    )
    assert bench == "VT"


def test_resolve_request_benchmark_normalizes_case() -> None:
    req = _req(benchmark_ticker="spy")
    assert _resolve_request_benchmark_ticker(req) == "SPY"
