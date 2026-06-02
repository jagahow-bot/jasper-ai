"""AI universe refine: full pool by default, legacy pick-one optional."""

from __future__ import annotations

from app.engine.ai_universe import _deterministic_refine, refine_universe_with_ai


def _sample_universe() -> list[dict]:
    return [
        {"ticker": "SPY", "category": "us_broad", "asset_class": "equity"},
        {"ticker": "QQQ", "category": "us_broad", "asset_class": "equity"},
        {"ticker": "AGG", "category": "treasury", "asset_class": "bond"},
        {"ticker": "TLT", "category": "treasury", "asset_class": "bond"},
    ]


def test_deterministic_refine_keeps_full_universe_by_default() -> None:
    universe = _sample_universe()
    selected, bench = _deterministic_refine(universe)
    assert len(selected) == 4
    assert bench in {"SPY", "AGG", "ACWI", "BND"}


def test_deterministic_refine_legacy_pick_one_per_category() -> None:
    universe = _sample_universe()
    selected, _bench = _deterministic_refine(universe, pick_representatives=True)
    assert len(selected) == 2
    tickers = {u["ticker"] for u in selected}
    assert tickers.issubset({"SPY", "QQQ", "AGG", "TLT"})


def test_refine_default_keeps_full_pool() -> None:
    plan = refine_universe_with_ai(
        universe=_sample_universe(),
        objective="max_sharpe",
        pick_representatives_per_category=False,
    )
    assert len(plan["universe"]) == 4
    assert plan["source"] in {"rules", "ai", "ai_cache"}
    assert plan.get("pick_representatives_per_category") is False
    assert plan.get("grouped_categories")


def test_refine_legacy_pick_one_flag() -> None:
    plan = refine_universe_with_ai(
        universe=_sample_universe(),
        objective="max_sharpe",
        pick_representatives_per_category=True,
    )
    assert len(plan["universe"]) == 2
    assert plan.get("pick_representatives_per_category") is True
