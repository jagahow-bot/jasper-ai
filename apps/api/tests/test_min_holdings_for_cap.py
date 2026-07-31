"""min_holdings_for_cap must keep room for differentiated (non equal-at-cap) weights."""

from app.engine.weights import min_holdings_for_cap
from app.models import BacktestRequest, Objective


def test_min_holdings_strictly_exceeds_one_over_cap():
    # 20% cap → 1/w=5; equal-at-cap needs 5, so require 6
    assert min_holdings_for_cap(0.2, floor=2) == 6
    # 25% → 1/w=4 → require 5
    assert min_holdings_for_cap(0.25, floor=2) == 5
    # 8% → 1/w=12.5 → ceil was 13; floor+1 also 13
    assert min_holdings_for_cap(0.08, floor=2) == 13
    # 15% → 1/w≈6.67 → 7
    assert min_holdings_for_cap(0.15, floor=2) == 7


def test_backtest_request_raises_max_holdings_for_tight_cap():
    req = BacktestRequest(
        scenario_id="t",
        max_weight=0.2,
        max_holdings=4,
        objective=Objective.max_sharpe,
    )
    assert req.max_holdings >= 6
