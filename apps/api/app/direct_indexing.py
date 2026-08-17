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

DEFAULT_DIRECT_INDEX_SLEEVE = 8
MAX_DIRECT_INDEX_SLEEVE = 50

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

SPX_LARGE_CAP_PRIORITY = [
    "NVDA",
    "MSFT",
    "AAPL",
    "AMZN",
    "GOOGL",
    "META",
    "AVGO",
    "BRK-B",
    "TSLA",
    "LLY",
    "JPM",
    "WMT",
    "V",
    "XOM",
    "MA",
    "UNH",
    "ORCL",
    "COST",
    "NFLX",
    "HD",
    "PG",
    "JNJ",
    "ABBV",
    "BAC",
    "CRM",
    "KO",
    "CVX",
    "MRK",
    "AMD",
    "PEP",
    "CSCO",
    "TMO",
    "LIN",
    "MCD",
    "GE",
    "ABT",
    "DIS",
    "WFC",
    "PM",
    "IBM",
    "CAT",
    "RTX",
    "ADBE",
    "NOW",
    "INTU",
    "AMAT",
    "QCOM",
    "TXN",
    "AMGN",
    "PFE",
    "HON",
    "NEE",
    "LOW",
    "UNP",
    "COP",
    "BA",
    "BLK",
    "GS",
    "AXP",
    "VZ",
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

_TOP_N_RES = (
    re.compile(r"(?:top|largest|biggest|leading)\s*[-–]?\s*(\d{1,2})\b", re.IGNORECASE),
    re.compile(r"前\s*(\d{1,2})\s*(?:大|檔|支|隻|只|名|個股)?"),
    re.compile(r"(?:상위|톱|시총\s*상위|시가총액\s*상위)\s*(\d{1,2})"),
    re.compile(
        r"(\d{1,2})\s*(?:large-?cap\s+)?(?:constituents?|names|stocks|equities|個股|檔股票|隻股票|종목)",
        re.IGNORECASE,
    ),
)
_CN_WORD_RE = re.compile(r"前\s*(十|二十|三十|四十|五十)")
_CN_COUNT_WORDS = {"十": 10, "二十": 20, "三十": 30, "四十": 40, "五十": 50}


def detect_direct_indexing(text: str | None) -> bool:
    return bool(text and text.strip() and _DIRECT_INDEX_RE.search(text))


def detect_ai_tilt(text: str | None) -> bool:
    return bool(text and text.strip() and _AI_TILT_RE.search(text))


def _clamp_sleeve(n: int) -> int:
    return max(2, min(MAX_DIRECT_INDEX_SLEEVE, int(n)))


def parse_direct_index_sleeve_count(text: str | None) -> int | None:
    src = (text or "").strip()
    if not src:
        return None
    matches: list[int] = []
    for cre in _TOP_N_RES:
        for m in cre.finditer(src):
            try:
                n = int(m.group(1))
            except (TypeError, ValueError):
                continue
            if 2 <= n <= MAX_DIRECT_INDEX_SLEEVE:
                matches.append(n)
    for m in _CN_WORD_RE.finditer(src):
        n = _CN_COUNT_WORDS.get(m.group(1))
        if n is not None:
            matches.append(n)
    if not matches:
        return None
    return _clamp_sleeve(matches[-1])


def resolve_direct_index_sleeve_count(text: str | None, limit: int | None = None) -> int:
    if limit is not None:
        return _clamp_sleeve(limit)
    parsed = parse_direct_index_sleeve_count(text)
    return _clamp_sleeve(parsed if parsed is not None else DEFAULT_DIRECT_INDEX_SLEEVE)


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


def _pick_from_prefer(
    prefer: list[str],
    limit: int,
    fill_cats: set[str] | None,
    *,
    us_stock_prefix: bool = False,
) -> list[str]:
    catalog = _catalog()
    stocks = {t for t, u in catalog.items() if _is_stock(u, t)}
    out: list[str] = []
    seen: set[str] = set()
    for t in prefer:
        if t not in stocks or t in seen:
            continue
        seen.add(t)
        out.append(t)
        if len(out) >= limit:
            return out
    for t, item in catalog.items():
        if len(out) >= limit:
            break
        if t in seen or not _is_stock(item, t):
            continue
        cat = str(item.get("category") or "")
        if us_stock_prefix:
            if not cat.startswith("us_stock"):
                continue
        elif fill_cats is not None and cat not in fill_cats:
            continue
        seen.add(t)
        out.append(t)
    return out


def _overweight_ai_within(sleeve: list[str]) -> list[str]:
    ai = set(AI_STOCK_PRIORITY)
    return [t for t in sleeve if t in ai] + [t for t in sleeve if t not in ai]


def pick_direct_index_stocks(text: str, limit: int | None = None) -> list[str]:
    parsed = parse_direct_index_sleeve_count(text)
    n = resolve_direct_index_sleeve_count(text, limit)
    honor_spx = parsed is not None or (
        limit is not None and limit > DEFAULT_DIRECT_INDEX_SLEEVE
    )
    if honor_spx:
        sleeve = _pick_from_prefer(SPX_LARGE_CAP_PRIORITY, n, None, us_stock_prefix=True)
        if detect_ai_tilt(text):
            return _overweight_ai_within(sleeve)[:n]
        return sleeve
    prefer = AI_STOCK_PRIORITY if detect_ai_tilt(text) else MEGA_STOCK_PRIORITY
    fill_cats = (
        {"us_stock_semi", "us_stock_tech", "us_stock_mega"}
        if detect_ai_tilt(text)
        else {"us_stock_mega"}
    )
    return _pick_from_prefer(prefer, n, fill_cats)


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
    limit: int | None = None,
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
    n = resolve_direct_index_sleeve_count(haystack, limit)
    stocks = pick_direct_index_stocks(haystack, limit=n)
    kept = _unique(kept + stocks)

    if not kept:
        return universe_tickers, supplement_tickers
    return kept, kept
