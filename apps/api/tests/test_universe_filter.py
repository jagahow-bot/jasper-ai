"""Universe filter: asset-class base pool + AI supplement union."""

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


def test_get_universe_supplement_unions_onto_base():
    """Supplements within allowed asset classes union onto the base pool."""
    base = get_universe(asset_classes=["equity", "bond"])
    base_set = {u["ticker"] for u in base}
    supplement = ["AGG"]
    combined = get_universe(
        asset_classes=["equity", "bond"],
        supplement_tickers=supplement,
    )
    combined_set = {u["ticker"] for u in combined}
    assert base_set.issubset(combined_set)
    assert "AGG" in combined_set
    assert len(combined) >= len(base)


def test_get_universe_supplement_skips_outside_asset_classes():
    base = get_universe(asset_classes=["equity", "bond"])
    combined = get_universe(
        asset_classes=["equity", "bond"],
        supplement_tickers=["GLD"],
    )
    assert "GLD" not in {u["ticker"] for u in combined}
    assert len(combined) == len(base)


def test_get_universe_supplement_dedupes_existing_base():
    base = get_universe(asset_classes=["equity"])
    spy = next(u["ticker"] for u in base if u["ticker"] == "SPY")
    combined = get_universe(
        asset_classes=["equity"],
        supplement_tickers=[spy],
    )
    assert len(combined) == len(base)


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


def test_pin_guaranteed_supplements_after_refine_dedupe():
    """Supplement tickers re-unioned after refine cannot drop guaranteed names."""
    from app.profiles import pin_guaranteed_supplements

    refined = [{"ticker": "SPY", "asset_class": "equity", "category": "us_broad"}]
    pinned = pin_guaranteed_supplements(
        refined, ["AGG", "BTAL"], asset_classes=["equity", "bond", "alternative"]
    )
    tickers = {u["ticker"] for u in pinned}
    assert "SPY" in tickers
    assert "AGG" in tickers
    assert "BTAL" in tickers


def test_resolve_universe_filter_prompts_ignores_joined_duplicate_text():
    from app.models import BacktestRequest, BacktestMode, Objective

    req = BacktestRequest(
        scenario_id="x",
        max_weight=0.1,
        objective=Objective.max_sharpe,
        backtest_mode=BacktestMode.static,
        universe_filter_text="rule a; rule b",
        universe_filter_prompts=["rule a", "rule b"],
    )
    assert req.resolved_universe_filter_prompts() == ["rule a", "rule b"]
