"""Sanitize floats in Gemini prompts / AI-facing JSON (not Optuna trial precision)."""

from __future__ import annotations

import json
import re
from decimal import Decimal
from typing import Any

# Half-up rounding for AI param / Pro round seed numerics (四捨五入到小數第 4 位).
PARAM_NUMERIC_DECIMALS = 4
AI_NUMBER_DESCRIPTION = "Max 4 decimal places; no long float expansions."

_INT_KEYS = frozenset(
    {
        "top_n_actual",
        "lookback_days",
        "factor_lookback_days",
        "reversal_lookback_days",
        "value_lookback_days",
        "round",
        "total_rounds",
        "trials_this_round",
        "total_trial_budget",
        "rebalance_snapshots",
    }
)

_WEIGHT_NUMERIC_KEYS = frozenset(
    {
        "shrinkage",
        "risk_aversion",
        "max_weight_actual",
        "max_turnover_actual",
        "no_trade_tol",
        "turnover_penalty_mult",
    }
)

_METRIC_KEYS = frozenset(
    {
        "adjusted_score",
        "raw_score",
        "objective_value",
        "objective_value_is",
        "in_sample_objective",
        "out_of_sample_objective",
        "gap_objective",
        "gap_sharpe",
        "sharpe",
        "cagr",
        "max_drawdown",
        "volatility",
        "sortino",
        "turnover_avg",
        "alpha",
        "beta",
        "information_ratio",
        "tracking_error",
        "up_capture",
        "down_capture",
        "train_sharpe",
        "validation_sharpe",
        "gap_to_beat",
        "target_at_trial",
        "champion_score",
        "target_adjusted_score",
        "overfitting_penalty",
        "end_equity_index",
        "portfolio_cagr",
        "portfolio_sharpe",
        "portfolio_max_drawdown",
        "max_weight_cap",
        "max_turnover_cap",
        "benchmark_alpha",
        "round_best_adjusted_score",
        "champion_adjusted_score",
        "portfolio_total_return_pct",
        "benchmark_total_return_pct",
        "weight_pct",
        "min_gain",
    }
)


def _coerce_scalar(value: Any) -> Any:
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            pass
    if isinstance(value, Decimal):
        return float(value)
    return value


def _is_int_key(key: str | None) -> bool:
    if not key:
        return False
    return key in _INT_KEYS or key.endswith("_days")


def _decimals_for_key(key: str | None) -> int:
    if not key:
        return PARAM_NUMERIC_DECIMALS
    if _is_int_key(key):
        return 0
    if key.startswith("w_") or key in _WEIGHT_NUMERIC_KEYS:
        return PARAM_NUMERIC_DECIMALS
    kl = key.lower()
    if "pct" in kl or key == "weight_pct":
        return 2
    if key in _METRIC_KEYS:
        return 4
    return PARAM_NUMERIC_DECIMALS


def round_ai_float(value: float, *, key: str | None = None) -> int | float:
    """Round one float for AI payloads; preserves Optuna-only paths when unused."""
    value = float(_coerce_scalar(value))
    if _is_int_key(key):
        return int(round(value))
    decimals = _decimals_for_key(key)
    if decimals <= 0:
        return int(round(value))
    rounded = round(value, decimals)
    # Format/re-parse strips IEEE tails so json.dumps never emits 0.20000000000000004.
    return float(f"{rounded:.{decimals}f}")


def sanitize_for_ai(value: Any, *, _key: str | None = None) -> Any:
    """Recursively round floats in dicts/lists destined for Gemini prompts or responses."""
    value = _coerce_scalar(value)
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    if isinstance(value, float):
        return round_ai_float(value, key=_key)
    if isinstance(value, dict):
        return {str(k): sanitize_for_ai(v, _key=str(k)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [sanitize_for_ai(v, _key=_key) for v in value]
    return value


def sanitize_ai_response(value: Any) -> Any:
    """Single entry: normalize Gemini JSON after parse (same rules as prompt sanitization)."""
    return sanitize_for_ai(value)


# Gemini occasionally emits multi-kilobyte numeric literals; cap before json.loads.
_MAX_JSON_NUMERIC_LITERAL_LEN = 24
_JSON_NUMBER_TAIL_RE = re.compile(r"(\.\d{5,})")
_BLOATED_FLOAT_RE = re.compile(
    rf"-?\d+\.\d{{{PARAM_NUMERIC_DECIMALS + 1},}}"
)


def _compact_numeric_literal(literal: str, *, cap: int) -> str:
    """Shorten one JSON number token (MAX_TOKENS salvage + prompt hygiene)."""
    if not literal:
        return literal
    needs_compact = len(literal) > cap
    if not needs_compact and "." in literal:
        frac = literal.split(".", 1)[1]
        if len(frac) > PARAM_NUMERIC_DECIMALS:
            needs_compact = True
    if not needs_compact:
        return literal
    head = literal[:cap] if len(literal) > cap else literal
    try:
        return str(round_ai_float(float(head)))
    except ValueError:
        return head if len(literal) > cap else literal


def deflate_json_bloated_floats(text: str) -> str:
    """Collapse overlong fractional literals (e.g. shrinkage IEEE loops) before json.loads."""
    return _BLOATED_FLOAT_RE.sub(
        lambda m: _compact_numeric_literal(m.group(0), cap=_MAX_JSON_NUMERIC_LITERAL_LEN),
        text,
    )


def prepare_gemini_json_text(text: str) -> str:
    """Normalize raw Gemini JSON before parse (numeric literals + range arrays)."""
    cleaned = deflate_json_bloated_floats(text.strip())
    cleaned = truncate_json_numeric_literals(cleaned)
    return truncate_json_range_arrays(cleaned)


def truncate_json_numeric_literals(text: str, *, max_literal_len: int | None = None) -> str:
    """Truncate overlong JSON numeric literals before parse (prevents MAX_TOKENS salvage failures)."""
    cap = max_literal_len or _MAX_JSON_NUMERIC_LITERAL_LEN
    out: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == "-" and i + 1 < n and text[i + 1].isdigit():
            start = i
            i += 1
            while i < n and text[i].isdigit():
                i += 1
            if i < n and text[i] == ".":
                i += 1
                while i < n and text[i].isdigit():
                    i += 1
            if i < n and text[i] in "eE":
                i += 1
                if i < n and text[i] in "+-":
                    i += 1
                while i < n and text[i].isdigit():
                    i += 1
            literal = _compact_numeric_literal(text[start:i], cap=cap)
            out.append(literal)
            continue
        if ch.isdigit():
            start = i
            while i < n and text[i].isdigit():
                i += 1
            if i < n and text[i] == ".":
                i += 1
                while i < n and text[i].isdigit():
                    i += 1
            if i < n and text[i] in "eE":
                i += 1
                if i < n and text[i] in "+-":
                    i += 1
                while i < n and text[i].isdigit():
                    i += 1
            literal = _compact_numeric_literal(text[start:i], cap=cap)
            out.append(literal)
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def sanitize_json_text_for_log(text: str, *, max_len: int = 240) -> str:
    """Compact Gemini raw JSON for retry/error logs (truncate float bloat first)."""
    cleaned = prepare_gemini_json_text(text)
    cleaned = _JSON_NUMBER_TAIL_RE.sub(
        lambda m: m.group(1)[:5].rstrip("0") or ".0",
        cleaned,
    )
    one_line = cleaned.replace("\n", " ")
    return one_line if len(one_line) <= max_len else one_line[: max_len - 3] + "..."


class _AIJSONEncoder(json.JSONEncoder):
    """Compact JSON for AI payloads — never emit IEEE noise tails."""

    def encode(self, o: Any) -> str:
        return super().encode(sanitize_for_ai(o))

    def iterencode(self, o: Any, _one_shot: bool = False) -> Any:
        return super().iterencode(sanitize_for_ai(o), _one_shot)


def dumps_for_ai(
    obj: Any,
    *,
    max_len: int | None = None,
    ensure_ascii: bool = False,
) -> str:
    """Compact JSON for prompts with sanitized numerics."""
    text = json.dumps(
        sanitize_for_ai(obj),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=ensure_ascii,
        default=str,
        cls=_AIJSONEncoder,
    )
    if max_len is not None and len(text) > max_len:
        return text[: max_len - 3] + "..."
    return text


def factor_range_item_schema(key: str) -> dict[str, str]:
    """Gemini responseSchema item for one factor bound endpoint."""
    if _is_int_key(key):
        return {"type": "INTEGER"}
    return {"type": "NUMBER", "description": AI_NUMBER_DESCRIPTION}


def factor_range_array_schema(key: str) -> dict[str, Any]:
    """Gemini schema for [low, high] factor bounds — exactly two endpoints."""
    return {
        "type": "ARRAY",
        "minItems": 2,
        "maxItems": 2,
        "items": factor_range_item_schema(key),
    }


_RANGE_ARRAY_KEY_RE = re.compile(
    r'"(?:w_[a-z_]+|factor_lookback_days|reversal_lookback_days|value_lookback_days)"\s*:\s*\[',
    re.IGNORECASE,
)


def _split_top_level_array_elems(inner: str) -> list[str]:
    elems: list[str] = []
    buf: list[str] = []
    depth = 0
    for ch in inner:
        if ch in "[{":
            depth += 1
        elif ch in "]}":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            part = "".join(buf).strip()
            if part:
                elems.append(part)
            buf = []
            continue
        buf.append(ch)
    tail = "".join(buf).strip()
    if tail:
        elems.append(tail)
    return elems


def truncate_json_range_arrays(text: str, *, max_elems: int = 2) -> str:
    """Collapse overlong [lo, hi, ...] arrays before json.loads (MAX_TOKENS salvage)."""
    if max_elems < 1:
        return text
    out: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        m = _RANGE_ARRAY_KEY_RE.search(text, i)
        if not m:
            out.append(text[i:])
            break
        out.append(text[i : m.end()])
        inner_start = m.end()
        depth = 1
        k = inner_start
        while k < n:
            ch = text[k]
            if ch == "[":
                depth += 1
            elif ch == "]":
                depth -= 1
                if depth == 0:
                    inner = text[inner_start:k]
                    elems = _split_top_level_array_elems(inner)
                    if len(elems) > max_elems:
                        inner = ", ".join(elems[:max_elems])
                    out.append(inner)
                    out.append("]")
                    i = k + 1
                    break
            k += 1
        else:
            out.append(text[inner_start:])
            break
    return "".join(out)


def coerce_factor_range_pair(
    value: Any,
    *,
    key: str | None = None,
) -> list[int | float] | None:
    """Normalize a factor bound to exactly [low, high]; None if unusable."""
    if not isinstance(value, (list, tuple)):
        return None
    cleaned: list[int | float] = []
    for item in value:
        if isinstance(item, bool):
            continue
        if isinstance(item, (int, float)):
            cleaned.append(round_ai_float(float(item), key=key))
        if len(cleaned) >= 2:
            break
    if len(cleaned) < 2:
        return None
    lo, hi = cleaned[0], cleaned[1]
    if hi < lo:
        lo, hi = hi, lo
    return [lo, hi]


def ai_number_schema(*, integer: bool = False) -> dict[str, str]:
    if integer:
        return {"type": "INTEGER"}
    return {"type": "NUMBER", "description": AI_NUMBER_DESCRIPTION}
