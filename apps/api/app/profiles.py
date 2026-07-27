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

    # Explicit ticker whitelist (model/anchor lock): never open the asset-class
    # pool; union optional supplements from the full catalog.
    if tickers:
        tick_set = {str(t).upper() for t in tickers}
        locked_base = [
            u
            for u in all_items
            if str(u.get("ticker", "")).upper() in tick_set
        ]
        if supplement_tickers:
            return _union_supplement_items(
                locked_base,
                all_items,
                supplement_tickers,
                allowed_asset_classes=None,
                bypass_asset_class_filter=True,
            )
        return locked_base

    base: list[dict[str, Any]] = list(all_items)
    if asset_classes:
        allowed = set(asset_classes)
        base = [u for u in base if u.get("asset_class") in allowed]

    if supplement_tickers:
        allowed = set(asset_classes) if asset_classes else None
        return _union_supplement_items(
            base, all_items, supplement_tickers, allowed_asset_classes=allowed
        )

    items = base
    if categories:
        cat_set = set(categories)
        items = [u for u in items if u.get("category") in cat_set]
    return items


def _union_supplement_items(
    base: list[dict[str, Any]],
    all_items: list[dict[str, Any]],
    supplement_tickers: list[str],
    *,
    allowed_asset_classes: set[str] | None = None,
    bypass_asset_class_filter: bool = False,
) -> list[dict[str, Any]]:
    """Union AI-filter supplement tickers onto the asset-class base pool."""
    sup_set = {str(t).upper() for t in supplement_tickers}
    seen = {str(u.get("ticker", "")).upper() for u in base}
    out = list(base)
    for u in all_items:
        t = str(u.get("ticker", "")).upper()
        if t not in sup_set or t in seen:
            continue
        if (
            not bypass_asset_class_filter
            and allowed_asset_classes
            and str(u.get("asset_class", "")) not in allowed_asset_classes
        ):
            continue
        out.append(u)
        seen.add(t)
    return out


def pin_guaranteed_supplements(
    refined_universe: list[dict[str, Any]],
    supplement_tickers: list[str] | None,
    *,
    asset_classes: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Re-attach AI filter supplement tickers after refine_universe_with_ai.

    Supplement tickers from the user's AI universe filter are pinned/guaranteed:
    category dedupe during refine must not drop them from the final backtest pool.
    Final pool = (asset-class base) ∪ (guaranteed supplements), then refine, then pin.
    """
    if not supplement_tickers:
        return refined_universe
    all_items = load_universe_file()["universe"]
    allowed = set(asset_classes) if asset_classes else None
    return _union_supplement_items(
        refined_universe,
        all_items,
        supplement_tickers,
        allowed_asset_classes=allowed,
        bypass_asset_class_filter=True,
    )


def locked_universe_allowed_set(
    tickers: list[str] | None,
    supplement_tickers: list[str] | None = None,
) -> set[str] | None:
    """Return the allowed ticker set for locked mode, or None when unlocked."""
    if not tickers:
        return None
    allowed = {str(t).upper() for t in tickers if str(t).strip()}
    if not allowed:
        return None
    if supplement_tickers:
        allowed |= {str(t).upper() for t in supplement_tickers if str(t).strip()}
    return allowed


def clamp_universe_to_whitelist(
    universe: list[dict[str, Any]],
    tickers: list[str] | None,
    supplement_tickers: list[str] | None = None,
) -> list[dict[str, Any]]:
    """When an explicit ticker whitelist is set, drop anything outside whitelist ∪ supplements."""
    allowed = locked_universe_allowed_set(tickers, supplement_tickers)
    if allowed is None:
        return universe
    return [
        u
        for u in universe
        if str(u.get("ticker", "")).upper() in allowed
    ]


def assert_locked_universe(
    universe: list[dict[str, Any]] | list[str],
    tickers: list[str] | None,
    supplement_tickers: list[str] | None = None,
    *,
    context: str = "universe",
) -> None:
    """Hard fail-safe: refuse to silently expand past whitelist ∪ supplements.

    Raises ValueError when locked mode is active and any ticker is outside the
    allowed set, or when the pool is larger than the allowed set (open-pool leak).
    """
    allowed = locked_universe_allowed_set(tickers, supplement_tickers)
    if allowed is None:
        return

    got: set[str] = set()
    for item in universe:
        if isinstance(item, str):
            t = item.strip().upper()
        else:
            t = str(item.get("ticker", "")).strip().upper()
        if t:
            got.add(t)

    leaked = sorted(got - allowed)
    if leaked or len(got) > len(allowed):
        raise ValueError(
            f"Locked universe leak in {context}: got {len(got)} tickers "
            f"(allowed {len(allowed)}); "
            f"outside whitelist∪supplements: {leaked[:20]}"
            + ("…" if len(leaked) > 20 else "")
        )


def min_valid_tickers_for_universe(ticker_count: int, locked_mode: bool) -> int:
    """Return the minimum number of valid price columns required for a universe.

    Open-pool searches keep the diversification floor of 5 so optimizers have
    enough instruments to build a diversified portfolio.

    Locked universes (explicit whitelist/supplements) are allowed to shrink to
    the size of the user-confirmed pool, capped at the open-pool floor.
    """
    if not locked_mode:
        return 5
    return min(max(ticker_count, 1), 5)


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
