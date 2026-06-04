"""Efficient frontier scatter excludes output model_codes from search samples."""

from app.engine.backtest import _build_frontier_from_records


def _record(
    *,
    model_code: str | None,
    vol: float = 0.2,
    cagr: float = 0.12,
    sharpe: float = 0.5,
    score: float = 1.0,
) -> tuple[float, dict, dict]:
    params: dict = {}
    if model_code is not None:
        params["model_code"] = model_code
    return (
        score,
        params,
        {"volatility": vol, "cagr": cagr, "sharpe": sharpe},
    )


def test_frontier_excludes_output_model_codes():
    records = [
        _record(model_code="M0001", vol=0.18, cagr=0.14),
        _record(model_code="M0002", vol=0.19, cagr=0.13),
        _record(model_code="M0003", vol=0.21, cagr=0.11),
        _record(model_code="M0004", vol=0.22, cagr=0.10),
    ]
    frontier = _build_frontier_from_records(
        records,
        trials_completed=4,
        exclude_model_codes={"M0002", "M0004"},
    )
    codes = {p["model_code"] for p in frontier}
    assert "M0002" not in codes
    assert "M0004" not in codes
    assert "M0001" in codes or "M0003" in codes


def test_frontier_keeps_sampling_after_exclusions():
    records = [_record(model_code=f"M{i:04d}") for i in range(1, 31)]
    frontier = _build_frontier_from_records(
        records,
        trials_completed=30,
        exclude_model_codes={f"M{i:04d}" for i in range(1, 6)},
    )
    assert len(frontier) == 25
    assert all(p["model_code"] not in {f"M{i:04d}" for i in range(1, 6)} for p in frontier)
