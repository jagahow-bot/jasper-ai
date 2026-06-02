import json
from functools import lru_cache
from typing import Any

from app.config import PROFILES_PATH, UNIVERSE_PATH


@lru_cache
def load_profiles() -> dict[str, Any]:
    with PROFILES_PATH.open(encoding="utf-8") as f:
        return json.load(f)


@lru_cache
def load_universe_file() -> dict[str, Any]:
    with UNIVERSE_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def get_scenario(scenario_id: str) -> dict[str, Any] | None:
    for scenario in load_profiles()["scenarios"]:
        if scenario["id"] == scenario_id:
            return scenario
    return None


def get_universe(
    asset_classes: list[str] | None = None,
    categories: list[str] | None = None,
    tickers: list[str] | None = None,
    supplement_tickers: list[str] | None = None,
) -> list[dict[str, Any]]:
    all_items = load_universe_file()["universe"]
    base: list[dict[str, Any]] = list(all_items)
    if asset_classes:
        allowed = set(asset_classes)
        base = [u for u in base if u.get("asset_class") in allowed]

    if supplement_tickers:
        sup_set = {str(t).upper() for t in supplement_tickers}
        seen = {str(u.get("ticker", "")).upper() for u in base}
        for u in all_items:
            t = str(u.get("ticker", "")).upper()
            if t in sup_set and t not in seen:
                base.append(u)
                seen.add(t)
        return base

    items = base
    if categories:
        cat_set = set(categories)
        items = [u for u in items if u.get("category") in cat_set]
    if tickers:
        tick_set = {str(t).upper() for t in tickers}
        items = [u for u in items if str(u.get("ticker", "")).upper() in tick_set]
    return items


def _count_field(items: list[dict[str, Any]], key: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for item in items:
        val = str(item.get(key) or "other")
        out[val] = out.get(val, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: (-kv[1], kv[0])))


def get_universe_meta() -> dict[str, Any]:
    data = load_universe_file()
    universe = data["universe"]
    return {
        "count": len(universe),
        "version": data.get("version"),
        "updated": data.get("updated"),
        "criteria": data.get("criteria"),
        "asset_class_breakdown": _count_field(universe, "asset_class"),
        "region_breakdown": _count_field(universe, "region"),
        "category_breakdown": _count_field(universe, "category"),
    }
