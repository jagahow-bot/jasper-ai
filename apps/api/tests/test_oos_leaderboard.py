"""Holdout leaderboard includes all ranked trials, not only top_models payloads."""

from app.engine.backtest import (
    _leaderboard_row_from_record,
    _oos_leaderboard,
)
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


def _record(
    *,
    model_code: str,
    trial_no: int,
    objective_is: float,
    objective_oos: float | None = None,
) -> tuple[float, dict, dict]:
    metrics: dict = {
        "objective_value_is": objective_is,
        "sharpe": objective_is,
    }
    if objective_oos is not None:
        metrics["objective_value_oos"] = objective_oos
        metrics["gap_objective"] = round(objective_is - objective_oos, 6)
    return (
        objective_is,
        {"model_code": model_code, "optuna_trial_number": trial_no},
        metrics,
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


def test_oos_leaderboard_uses_all_search_records_not_top_models_cap():
    records = [
        _record(model_code=f"M{i:04d}", trial_no=i - 1, objective_is=0.1 * i)
        for i in range(1, 9)
    ]
    candidates = [
        _candidate(
            rank=1,
            model_code="M0008",
            sample_metrics={
                "in_sample": {"objective_value": 0.8},
                "out_of_sample": {"objective_value": 0.5},
                "full_sample": {"objective_value": 0.7},
                "gap": {"objective": 0.3},
            },
        ),
    ]
    rows = _oos_leaderboard(
        candidates,
        records=records,
        objective_effective="max_sharpe",
    )
    assert len(rows) == 8
    assert rows[0]["model_code"] == "M0008"
    enriched = next(r for r in rows if r["model_code"] == "M0008")
    assert enriched["full_sample_objective"] == 0.7


def test_oos_leaderboard_dedupes_duplicate_model_code_from_champion_resim():
    records = [
        _record(model_code="M0016", trial_no=15, objective_is=0.40, objective_oos=0.30),
        _record(model_code="M0016", trial_no=15, objective_is=0.55, objective_oos=0.28),
        _record(model_code="M0008", trial_no=7, objective_is=0.50, objective_oos=0.45),
    ]
    rows = _oos_leaderboard([], records=records, objective_effective="max_sharpe")
    assert len(rows) == 2
    m16 = next(r for r in rows if r["model_code"] == "M0016")
    assert m16["in_sample_objective"] == 0.55


def test_oos_leaderboard_prefers_candidate_packaged_is_over_higher_record():
    """Search-time IS can disagree with full-path slices; UI summary uses packaged."""
    records = [
        _record(
            model_code="M0018",
            trial_no=17,
            objective_is=0.6538,
            objective_oos=1.1606,
        ),
    ]
    candidates = [
        _candidate(
            rank=1,
            model_code="M0018",
            is_champion=True,
            sample_metrics={
                "in_sample": {"objective_value": 0.4715, "sharpe": 0.471},
                "out_of_sample": {"objective_value": 1.1606, "sharpe": 1.161},
                "full_sample": {"objective_value": 0.6555, "sharpe": 0.655},
                "gap": {"objective": -0.6891},
            },
        ),
    ]
    rows = _oos_leaderboard(
        candidates,
        records=records,
        objective_effective="max_sharpe",
    )
    m18 = next(r for r in rows if r["model_code"] == "M0018")
    assert m18["in_sample_objective"] == 0.4715
    assert m18["full_sample_objective"] == 0.6555
    assert m18["gap_objective"] == -0.6891


def test_leaderboard_row_from_record_falls_back_to_train_validation_metrics():
    row = _leaderboard_row_from_record(
        {"model_code": "M0003", "optuna_trial_number": 2},
        {
            "train_metrics": {"objective_value": 0.61, "sharpe": 0.61},
            "validation_metrics": {"objective_value": 0.44, "sharpe": 0.44},
        },
        objective_effective="max_sharpe",
    )
    assert row is not None
    assert row["in_sample_objective"] == 0.61
    assert row["out_of_sample_objective"] == 0.44
    assert row["gap_objective"] == 0.17
