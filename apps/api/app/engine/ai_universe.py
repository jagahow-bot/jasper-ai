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

_BENCHMARK_CANDIDATES = ["SPY", "ACWI", "VT", "AGG", "BND", "TLT", "GLD", "VNQ"]


def _pick_rep(tickers: list[str]) -> str:
    s = set(tickers)
    for t in _PREFERRED:
        if t in s:
            return t
    return sorted(tickers)[0]


def _pick_benchmark_from_universe(universe: list[dict[str, Any]]) -> str:
    tickers = {str(u.get("ticker")) for u in universe if u.get("ticker")}
    for b in ("SPY", "ACWI", "AGG", "BND", "VTI", "VOO"):
        if b in tickers:
            return b
    for b in _BENCHMARK_CANDIDATES:
        if b in tickers:
            return b
    return sorted(tickers)[0] if tickers else "SPY"


def _deterministic_refine(
    universe: list[dict[str, Any]],
    *,
    pick_representatives: bool = False,
) -> tuple[list[dict[str, Any]], str]:
    if not pick_representatives:
        return list(universe), _pick_benchmark_from_universe(universe)

    by_cat: dict[str, list[dict[str, Any]]] = {}
    for u in universe:
        cat = str(u.get("category") or u.get("asset_class") or "other")
        by_cat.setdefault(cat, []).append(u)
    selected: list[dict[str, Any]] = []
    for _, rows in by_cat.items():
        t = _pick_rep([str(r.get("ticker")) for r in rows if r.get("ticker")])
        row = next((r for r in rows if r.get("ticker") == t), rows[0])
        selected.append(row)
    return selected, _pick_benchmark_from_universe(selected)


def _grouped_categories(universe: list[dict[str, Any]]) -> dict[str, list[str]]:
    grouped: dict[str, list[str]] = {}
    for u in universe:
        cat = str(u.get("category") or u.get("asset_class") or "other")
        t = str(u.get("ticker"))
        grouped.setdefault(cat, [])
        if t not in grouped[cat]:
            grouped[cat].append(t)
    return grouped


def refine_universe_with_ai(
    *,
    universe: list[dict[str, Any]],
    objective: str,
    asset_classes: list[str] | None = None,
    pick_representatives_per_category: bool | None = None,
) -> dict[str, Any]:
    """Filter universe by asset classes (caller) and suggest benchmark.

    By default keeps the full ticker list for Optuna/factor selection. Optional
    legacy mode picks one representative ETF per category when enabled.

    Returns:
    - universe: filtered universe (full list unless legacy pick-one mode)
    - benchmark_ticker: suggested benchmark
    - source: ai|rules|ai_cache
    - grouped_categories: optional metadata for UI/logs
    """
    pick_reps = (
        pick_representatives_per_category
        if pick_representatives_per_category is not None
        else settings.ai_universe_pick_representatives_per_category
    )
    grouped = _grouped_categories(universe)

    key = settings.gemini_api_key
    if not key:
        u, b = _deterministic_refine(universe, pick_representatives=pick_reps)
        return {
            "universe": u,
            "benchmark_ticker": b,
            "source": "rules",
            "grouped_categories": grouped,
            "asset_classes_filter": asset_classes or [],
            "pick_representatives_per_category": pick_reps,
        }

    if pick_reps:
        prompt = {
            "objective": objective,
            "grouped_categories": grouped,
            "benchmark_candidates": _BENCHMARK_CANDIDATES,
            "task": (
                "LEGACY: pick one representative ETF per category and suggest best benchmark"
            ),
        }
        schema = {
            "type": "OBJECT",
            "properties": {
                "representatives": {"type": "ARRAY", "items": {"type": "STRING"}},
                "benchmark_ticker": {"type": "STRING"},
                "rationale": {"type": "STRING"},
            },
            "required": ["representatives", "benchmark_ticker"],
        }
        log_action = "representatives (legacy)"
    else:
        prompt = {
            "objective": objective,
            "asset_classes_filter": asset_classes or [],
            "grouped_categories": grouped,
            "benchmark_candidates": _BENCHMARK_CANDIDATES,
            "task": (
                "Organize ETFs by category for context only. Do NOT remove or narrow tickers. "
                "Pick the single best benchmark_ticker for this backtest pool."
            ),
        }
        schema = {
            "type": "OBJECT",
            "properties": {
                "benchmark_ticker": {"type": "STRING"},
                "rationale": {"type": "STRING"},
                "category_notes": {"type": "OBJECT"},
            },
            "required": ["benchmark_ticker"],
        }
        log_action = "benchmark only (full universe kept)"

    cache_key = json.dumps(
        {"prompt": prompt, "pick_reps": pick_reps}, sort_keys=True, ensure_ascii=False
    )
    with _cache_lock:
        cached = _refine_cache.get(cache_key)
    if cached:
        print(
            f"[ai_universe] cache hit: reuse {log_action}"
            f" (objective={objective}, categories={len(grouped)}, tickers={len(universe)})"
        )
        return {**cached, "source": "ai_cache"}

    try:
        print(
            f"[ai_universe] cache miss: calling AI for {log_action}"
            f" (objective={objective}, categories={len(grouped)}, tickers={len(universe)})"
        )
        res = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models"
            f"/{settings.gemini_model}:generateContent?key={key}",
            json={
                "contents": [{"parts": [{"text": json.dumps(prompt, ensure_ascii=False)}]}],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "temperature": 0.1,
                    "maxOutputTokens": max(1024, int(settings.gemini_max_output_tokens)),
                    "responseSchema": schema,
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
        bench = str(obj.get("benchmark_ticker", "SPY"))

        if pick_reps:
            reps = set(str(t) for t in obj.get("representatives", []))
            if not reps:
                raise ValueError("empty_representatives")
            filtered = [u for u in universe if str(u.get("ticker")) in reps]
            if len(filtered) < 5:
                raise ValueError("too_few_after_ai_refine")
        else:
            filtered = list(universe)
            if bench not in {str(u.get("ticker")) for u in universe}:
                bench = _pick_benchmark_from_universe(universe)

        result = {
            "universe": filtered,
            "benchmark_ticker": bench,
            "source": "ai",
            "rationale": obj.get("rationale"),
            "grouped_categories": grouped,
            "asset_classes_filter": asset_classes or [],
            "category_notes": obj.get("category_notes"),
            "pick_representatives_per_category": pick_reps,
        }
        with _cache_lock:
            _refine_cache[cache_key] = result
        return result
    except Exception:
        u, b = _deterministic_refine(universe, pick_representatives=pick_reps)
        return {
            "universe": u,
            "benchmark_ticker": b,
            "source": "rules",
            "grouped_categories": grouped,
            "asset_classes_filter": asset_classes or [],
            "pick_representatives_per_category": pick_reps,
        }
