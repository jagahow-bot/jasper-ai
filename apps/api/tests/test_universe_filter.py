"""Universe filter: asset-class + category + ticker intersection."""

from app.profiles import get_universe


def test_get_universe_intersects_asset_classes_and_categories():
    equity_only = get_universe(asset_classes=["equity"])
    narrowed = get_universe(
        asset_classes=["equity", "bond"],
        categories=["us_sector"],
    )
    assert len(narrowed) <= len(equity_only)
    assert all(u.get("asset_class") == "equity" for u in narrowed)
    assert all(u.get("category") == "us_sector" for u in narrowed)


def test_get_universe_ticker_whitelist_within_asset_classes():
    tickers = ["SPY", "AGG"]
    items = get_universe(asset_classes=["equity", "bond"], tickers=tickers)
    assert {u["ticker"] for u in items}.issubset(set(tickers))
    assert all(u.get("asset_class") in {"equity", "bond"} for u in items)


def test_resolve_universe_filter_prompts_merges_legacy_text():
    from app.models import BacktestRequest, BacktestMode, Objective

    req = BacktestRequest(
        scenario_id="x",
        max_weight=0.1,
        objective=Objective.max_sharpe,
        backtest_mode=BacktestMode.static,
        universe_filter_text="legacy rule",
        universe_filter_prompts=["rule a"],
    )
    prompts = req.resolved_universe_filter_prompts()
    assert prompts == ["legacy rule", "rule a"]


def test_get_universe_asset_classes_always_applied_with_ai_categories():
    """Simulates UI: user picks equity+bond, AI adds us_sector — both must apply."""
    items = get_universe(
        asset_classes=["equity", "bond"],
        categories=["us_sector"],
    )
    assert items
    assert all(u.get("asset_class") in {"equity", "bond"} for u in items)
