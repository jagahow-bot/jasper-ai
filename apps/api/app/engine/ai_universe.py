"""Universe refinement and benchmark suggestion."""

from __future__ import annotations

import json
import threading
from typing import Any

import httpx

from app.config import settings

_cache_lock = threading.Lock()
_refine_cache: dict[str, dict[str, Any]] = {}

_PREFERRED = [
    "VOO",
    "SPY",
    "IVV",
    "VTI",
    "VXUS",
    "ACWI",
    "AGG",
    "BND",
    "TLT",
    "IEF",
    "GLD",
    "VNQ",
]


def _pick_rep(tickers: list[str]) -> str:
    s = set(tickers)
    for t in _PREFERRED:
        if t in s:
            return t
    return sorted(tickers)[0]


def _deterministic_refine(universe: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str]:
    by_cat: dict[str, list[dict[str, Any]]] = {}
    for u in universe:
        cat = str(u.get("category") or u.get("asset_class") or "other")
        by_cat.setdefault(cat, []).append(u)
    selected: list[dict[str, Any]] = []
    for _, rows in by_cat.items():
        t = _pick_rep([str(r.get("ticker")) for r in rows if r.get("ticker")])
        row = next((r for r in rows if r.get("ticker") == t), rows[0])
        selected.append(row)
    # Simple fallback benchmark preference.
    tickers = {str(u.get("ticker")) for u in selected}
    for b in ("SPY", "ACWI", "AGG", "BND"):
        if b in tickers:
            return selected, b
    return selected, "SPY"


def refine_universe_with_ai(
    *,
    universe: list[dict[str, Any]],
    objective: str,
) -> dict[str, Any]:
    """Reduce duplicate products and suggest benchmark.

    Returns:
    - universe: filtered universe
    - benchmark_ticker: suggested benchmark
    - source: ai|rules
    """
    key = settings.gemini_api_key
    if not key:
        u, b = _deterministic_refine(universe)
        return {"universe": u, "benchmark_ticker": b, "source": "rules"}

    grouped: dict[str, list[str]] = {}
    for u in universe:
        cat = str(u.get("category") or u.get("asset_class") or "other")
        t = str(u.get("ticker"))
        grouped.setdefault(cat, [])
        if t not in grouped[cat]:
            grouped[cat].append(t)

    model = settings.gemini_model
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
    prompt = {
        "objective": objective,
        "grouped_categories": grouped,
        "benchmark_candidates": ["SPY", "ACWI", "VT", "AGG", "BND", "TLT", "GLD", "VNQ"],
        "task": "pick one representative ETF per category and suggest best benchmark",
    }
    cache_key = json.dumps(prompt, sort_keys=True, ensure_ascii=False)
    with _cache_lock:
        cached = _refine_cache.get(cache_key)
    if cached:
        print(
            "[ai_universe] cache hit: reuse representatives once"
            f" (objective={objective}, categories={len(grouped)})"
        )
        return {**cached, "source": "ai_cache"}

    try:
        print(
            "[ai_universe] cache miss: calling AI for representatives"
            f" (objective={objective}, categories={len(grouped)})"
        )
        res = httpx.post(
            url,
            json={
                "contents": [{"parts": [{"text": json.dumps(prompt, ensure_ascii=False)}]}],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "temperature": 0.1,
                    "maxOutputTokens": max(1024, int(settings.gemini_max_output_tokens)),
                    "responseSchema": {
                        "type": "OBJECT",
                        "properties": {
                            "representatives": {"type": "ARRAY", "items": {"type": "STRING"}},
                            "benchmark_ticker": {"type": "STRING"},
                            "rationale": {"type": "STRING"},
                        },
                        "required": ["representatives", "benchmark_ticker"],
                    },
                },
            },
            timeout=25.0,
        )
        res.raise_for_status()
        body = res.json()
        text = (
            body.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
        )
        obj = json.loads(text)
        reps = set(str(t) for t in obj.get("representatives", []))
        bench = str(obj.get("benchmark_ticker", "SPY"))
        if not reps:
            raise ValueError("empty_representatives")
        filtered = [u for u in universe if str(u.get("ticker")) in reps]
        if len(filtered) < 5:
            raise ValueError("too_few_after_ai_refine")
        result = {
            "universe": filtered,
            "benchmark_ticker": bench,
            "source": "ai",
            "rationale": obj.get("rationale"),
        }
        with _cache_lock:
            _refine_cache[cache_key] = result
        return result
    except Exception:
        u, b = _deterministic_refine(universe)
        return {"universe": u, "benchmark_ticker": b, "source": "rules"}

