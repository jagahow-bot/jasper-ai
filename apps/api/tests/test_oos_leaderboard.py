"""Holdout leaderboard includes all ranked trials, not only full holdout payloads."""

from app.engine.backtest import _oos_leaderboard
from app.models import PortfolioCandidate


def _candidate(
    *,
    rank: int,
    model_code: str,
    is_champion: bool = False,
    sample_metrics: dict,
) -> PortfolioCandidate:
    return PortfolioCandidate(
        rank=rank,
        model_code=model_code,
        is_champion=is_champion,
        weights={"SPY": 1.0},
        sharpe=1.0,
        max_drawdown=-0.1,
        cagr=0.1,
        volatility=0.15,
        analytics={"sample_metrics": sample_metrics},
    )


def test_oos_leaderboard_includes_in_sample_only_slim_trials():
    candidates = [
        _candidate(
            rank=1,
            model_code="M0001",
            sample_metrics={"in_sample": {"objective_value": 0.4551}},
        ),
        _candidate(
            rank=9,
            model_code="M0009",
            is_champion=True,
            sample_metrics={
                "in_sample": {"objective_value": 0.42},
                "out_of_sample": {"objective_value": 0.38},
            },
        ),
    ]
    rows = _oos_leaderboard(candidates, objective_effective="max_sharpe")
    assert len(rows) == 2
    codes = {r["model_code"] for r in rows}
    assert codes == {"M0001", "M0009"}
    slim = next(r for r in rows if r["model_code"] == "M0001")
    assert slim["in_sample_objective"] == 0.4551
    assert slim["out_of_sample_objective"] is None
