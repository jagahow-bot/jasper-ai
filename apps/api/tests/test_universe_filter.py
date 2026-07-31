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


def test_get_universe_whitelist_plus_supplements_stays_locked():
    """When tickers + supplements are both set, do not open the asset-class pool."""
    locked = get_universe(
        asset_classes=["equity", "bond"],
        tickers=["IVV", "AGG"],
        supplement_tickers=["IVV", "AGG", "GLD"],
    )
    tickers = {u["ticker"] for u in locked}
    assert tickers == {"IVV", "AGG", "GLD"}
    # Must not expand to the full equity+bond asset-class catalog.
    open_pool = get_universe(asset_classes=["equity", "bond"])
    assert len(locked) < len(open_pool)
    assert len(locked) == 3


def test_chen_us_large_cap_overlay_does_not_open_equity_pool():
    """Reproduce Ms Chen leak: locked request with supplements must stay closed.

    Prior bug: whenever universe_supplement_tickers was set, get_universe
    unioned onto the full asset-class base and ignored universe_tickers —
    so EPI/ITA/IYW (and ~200 other equity ETFs) entered the optimizer.
    """
    model = ["SPY", "XLF", "XLV"]
    adds = ["SMH", "SOXX", "BOTZ", "EWT", "EWY"]
    locked = get_universe(
        asset_classes=["equity"],
        tickers=model,
        supplement_tickers=[*model, *adds],
    )
    tickers = {u["ticker"] for u in locked}
    assert tickers == set(model) | set(adds)
    assert len(locked) == 8

    open_equity = get_universe(asset_classes=["equity"])
    assert len(locked) < len(open_equity)
    for leak in (
        "EPI",
        "ITA",
        "IYW",
        "ARKW",
        "ACWI",
        "QQQ",
        "XWEB",
        "IDU",
        "VPU",
        "XLU",
    ):
        assert leak not in tickers

    from app.profiles import assert_locked_universe, clamp_universe_to_whitelist

    # Even if refine somehow drifted, clamp must drop pool names.
    drifted = list(locked) + [
        {"ticker": "EPI", "asset_class": "equity"},
        {"ticker": "ITA", "asset_class": "equity"},
        {"ticker": "IYW", "asset_class": "equity"},
        {"ticker": "XWEB", "asset_class": "equity"},
        {"ticker": "IDU", "asset_class": "equity"},
        {"ticker": "VPU", "asset_class": "equity"},
        {"ticker": "XLU", "asset_class": "equity"},
    ]
    clamped = clamp_universe_to_whitelist(drifted, model, [*model, *adds])
    assert {u["ticker"] for u in clamped} == set(model) | set(adds)
    assert_locked_universe(clamped, model, [*model, *adds], context="chen")

    # Fail-safe must refuse a blown-open pool.
    try:
        assert_locked_universe(
            drifted, model, [*model, *adds], context="chen-leak"
        )
        raised = False
    except ValueError as exc:
        raised = True
        assert "Locked universe leak" in str(exc)
        assert "XWEB" in str(exc) or "IDU" in str(exc)
    assert raised


def test_assert_locked_universe_allows_exact_whitelist():
    from app.profiles import assert_locked_universe

    assert_locked_universe(
        [{"ticker": "SPY"}, {"ticker": "SMH"}],
        ["SPY"],
        ["SMH"],
        context="exact",
    )
    assert_locked_universe(
        ["SPY", "SMH"],
        ["SPY", "SMH"],
        context="ticker-list",
    )


def test_get_universe_whitelist_ignores_asset_class_ceiling():
    """Locked holdings stay available even if outside selected asset classes."""
    locked = get_universe(
        asset_classes=["equity"],
        tickers=["IVV", "AGG"],
    )
    assert {u["ticker"] for u in locked} == {"IVV", "AGG"}


def test_clamp_universe_to_whitelist_drops_drift():
    from app.profiles import clamp_universe_to_whitelist

    universe = [
        {"ticker": "IVV", "asset_class": "equity"},
        {"ticker": "AGG", "asset_class": "bond"},
        {"ticker": "ARKW", "asset_class": "equity"},
        {"ticker": "ACWI", "asset_class": "equity"},
    ]
    clamped = clamp_universe_to_whitelist(
        universe, ["IVV", "AGG"], supplement_tickers=["IVV", "AGG"]
    )
    assert {u["ticker"] for u in clamped} == {"IVV", "AGG"}


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


def test_get_universe_whitelist_pins_unknown_overlay_ticker():
    """Job d3972fe2 regression: AIQ was not in universe.json and vanished silently."""
    locked = get_universe(
        asset_classes=["equity", "bond", "commodity"],
        tickers=["IVV", "TLT", "AIQ", "BOTZ", "SOXX"],
        supplement_tickers=["IVV", "TLT", "AIQ", "BOTZ", "SOXX"],
    )
    tickers = {u["ticker"] for u in locked}
    assert "AIQ" in tickers
    assert "BOTZ" in tickers
    assert "SOXX" in tickers
    aiq = next(u for u in locked if u["ticker"] == "AIQ")
    assert aiq.get("overlay_synthetic") is True


def test_pin_guaranteed_supplements_synthesizes_missing_catalog_ticker():
    from app.profiles import pin_guaranteed_supplements

    refined = [{"ticker": "IVV", "asset_class": "equity", "category": "us_broad"}]
    pinned = pin_guaranteed_supplements(
        refined, ["IVV", "AIQ", "CASH"], asset_classes=["equity"]
    )
    tickers = {u["ticker"] for u in pinned}
    assert "AIQ" in tickers
    assert "CASH" not in tickers  # pseudo sleeve, not a price series


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


def test_min_valid_tickers_for_universe():
    from app.profiles import min_valid_tickers_for_universe

    # Open-pool floor stays at 5 regardless of requested count.
    assert min_valid_tickers_for_universe(3, locked_mode=False) == 5
    assert min_valid_tickers_for_universe(10, locked_mode=False) == 5

    # Locked universes shrink to the user-confirmed pool size.
    assert min_valid_tickers_for_universe(1, locked_mode=True) == 1
    assert min_valid_tickers_for_universe(2, locked_mode=True) == 2
    assert min_valid_tickers_for_universe(3, locked_mode=True) == 3

    # Large locked pools still keep the open-pool diversification ceiling.
    assert min_valid_tickers_for_universe(10, locked_mode=True) == 5
    assert min_valid_tickers_for_universe(5, locked_mode=True) == 5
