"""Direct indexing: stock sleeves around a benchmark ETF, not thematic ETFs."""

from __future__ import annotations

import re
from typing import Any

from app.profiles import load_universe_file

THEMATIC_SUBSTITUTE_ETFS = frozenset(
    {
        "AIQ",
        "IRBO",
        "BOTZ",
        "ROBO",
        "THNQ",
        "IGPT",
        "TECB",
        "ROBT",
        "CHAT",
        "ARKK",
        "ARKW",
        "ARKG",
        "CIBR",
        "CLOU",
        "WCLD",
        "SKYY",
        "SMH",
        "SOXX",
        "XSD",
        "IGV",
    }
)
THEMATIC_CATEGORIES = frozenset({"us_thematic", "intl_thematic"})

AI_STOCK_PRIORITY = [
    "NVDA",
    "MSFT",
    "AAPL",
    "GOOGL",
    "AMZN",
    "META",
    "AVGO",
    "AMD",
    "AMAT",
    "QCOM",
    "ORCL",
    "CRM",
    "ADBE",
    "NOW",
    "INTU",
    "MU",
    "KLAC",
    "LRCX",
    "TSLA",
]

MEGA_STOCK_PRIORITY = [
    "AAPL",
    "MSFT",
    "AMZN",
    "GOOGL",
    "META",
    "NVDA",
    "AVGO",
    "BRK-B",
    "JPM",
    "JNJ",
    "UNH",
    "XOM",
    "V",
    "PG",
    "HD",
    "MA",
    "LLY",
    "COST",
]

_DIRECT_INDEX_RE = re.compile(
    r"direct[\s-]*index|directindexing|直接索引|直接指數化|直接指数化|"
    r"直接指數|直接指数|직접\s*인덱싱|다이렉트\s*인덱싱|직접지수화|직접\s*지수",
    re.IGNORECASE,
)
_AI_TILT_RE = re.compile(
    r"\bai\b|artificial intelligence|machine learning|genai|generative ai|"
    r"人工智慧|人工智能|機器人|机器人|인공지능|로봇",
    re.IGNORECASE,
)


def detect_direct_indexing(text: str | None) -> bool:
    return bool(text and text.strip() and _DIRECT_INDEX_RE.search(text))


def detect_ai_tilt(text: str | None) -> bool:
    return bool(text and text.strip() and _AI_TILT_RE.search(text))


def _join_filter_texts(
    filter_text: str | None,
    filter_prompts: list[str] | None,
) -> str:
    parts: list[str] = []
    if filter_text and str(filter_text).strip():
        parts.append(str(filter_text).strip())
    for p in filter_prompts or []:
        if p and str(p).strip():
            parts.append(str(p).strip())
    return "\n".join(parts)


def _catalog() -> dict[str, dict[str, Any]]:
    items = load_universe_file().get("universe") or []
    out: dict[str, dict[str, Any]] = {}
    for u in items:
        t = str(u.get("ticker") or "").strip().upper()
        if t:
            out[t] = u
    return out


def _is_stock(item: dict[str, Any] | None, ticker: str) -> bool:
    if item is None:
        return False
    return str(item.get("product_type") or "etf").lower() == "stock"


def is_thematic_substitute_etf(ticker: str, catalog: dict[str, dict[str, Any]] | None = None) -> bool:
    key = str(ticker or "").strip().upper()
    if key in THEMATIC_SUBSTITUTE_ETFS:
        return True
    item = (catalog or _catalog()).get(key)
    if not item:
        return False
    if _is_stock(item, key):
        return False
    return str(item.get("category") or "") in THEMATIC_CATEGORIES


def pick_direct_index_stocks(text: str, limit: int = 8) -> list[str]:
    catalog = _catalog()
    stocks = {t for t, u in catalog.items() if _is_stock(u, t)}
    prefer = AI_STOCK_PRIORITY if detect_ai_tilt(text) else MEGA_STOCK_PRIORITY
    out: list[str] = []
    seen: set[str] = set()
    for t in prefer:
        if t not in stocks or t in seen:
            continue
        seen.add(t)
        out.append(t)
        if len(out) >= limit:
            return out
    fill_cats = (
        {"us_stock_semi", "us_stock_tech", "us_stock_mega"}
        if detect_ai_tilt(text)
        else {"us_stock_mega"}
    )
    for t, item in catalog.items():
        if len(out) >= limit:
            break
        if t in seen or not _is_stock(item, t):
            continue
        if str(item.get("category") or "") not in fill_cats:
            continue
        seen.add(t)
        out.append(t)
    return out


def _unique(tickers: list[str] | None) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in tickers or []:
        key = str(raw or "").strip().upper()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


def expand_direct_index_locked_lists(
    *,
    universe_tickers: list[str] | None,
    supplement_tickers: list[str] | None,
    filter_text: str | None = None,
    filter_prompts: list[str] | None = None,
    limit: int = 8,
) -> tuple[list[str] | None, list[str] | None]:
    """When DI language is present and the locked book is ETF-only, union stocks.

    Also drops thematic ETF substitutes (AIQ/BOTZ/IRBO-style) from adds.
    No-op when the request is not a locked whitelist.
    """
    if not universe_tickers:
        return universe_tickers, supplement_tickers

    haystack = _join_filter_texts(filter_text, filter_prompts)
    if not detect_direct_indexing(haystack):
        return universe_tickers, supplement_tickers

    catalog = _catalog()
    locked = _unique(list(universe_tickers) + list(supplement_tickers or []))
    kept = [t for t in locked if not is_thematic_substitute_etf(t, catalog)]
    has_stock = any(_is_stock(catalog.get(t), t) for t in kept)
    stocks = pick_direct_index_stocks(haystack, limit=limit)
    if not has_stock:
        kept = _unique(kept + stocks)
    else:
        # Already has a stock sleeve — still ensure AI/mega names are eligible.
        kept = _unique(kept + stocks[: max(4, min(limit, 6))])

    if not kept:
        return universe_tickers, supplement_tickers
    return kept, kept
