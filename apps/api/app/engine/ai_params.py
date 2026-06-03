"""Generate model parameter sets with Gemini and return rationale."""

from __future__ import annotations

import json
import re
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections.abc import Callable
from typing import Any

import httpx

from app.config import settings
from app.engine.factors import (
    DRAWDOWN_INDICATOR_CHOICES,
    LOWVOL_INDICATOR_CHOICES,
    MOM_INDICATOR_CHOICES,
    REVERSAL_INDICATOR_CHOICES,
    TREND_INDICATOR_CHOICES,
    VALUE_INDICATOR_CHOICES,
)
from app.engine.mutable_params import PARAM_DEDUP_KEYS, RUN_LEVEL_FIXED_KEYS
from app.engine.dynamic_objective import (
    REGIME_ALLOCATOR_KEYS,
    REGIME_KEYS,
    is_dynamic_objective,
)
from app.engine.ai_json import (
    AI_NUMBER_DESCRIPTION,
    ai_number_schema,
    dumps_for_ai,
    factor_range_item_schema,
    round_ai_float,
    sanitize_ai_response,
    sanitize_for_ai,
    sanitize_json_text_for_log,
    truncate_json_numeric_literals,
)
from app.engine.param_taxonomy import (
    FACTOR_CATEGORICAL_KEYS,
    FACTOR_NUMERIC_KEYS,
    SETUP_PARAM_KEYS,
    normalize_round_seed,
)
from app.engine.regime_policy import REGIME_OBJECTIVE_MAP
from app.engine.param_bounds import (
    RunBlueprint,
    blueprint_prompt_lines,
    clamp_param_dict,
    normalize_param_controls,
    resolve_control_mode,
    resolve_off_value,
)
from app.engine.refinement import summarize_params_for_ai

_dir_lock = threading.Lock()
_direction_cache: dict[str, dict[str, Any]] = {}

_INDICATOR_SCHEMA_PROPS: dict[str, dict[str, str]] = {
    "mom_indicator": {"type": "STRING"},
    "reversal_indicator": {"type": "STRING"},
    "value_indicator": {"type": "STRING"},
    "lowvol_indicator": {"type": "STRING"},
    "trend_indicator": {"type": "STRING"},
    "drawdown_indicator": {"type": "STRING"},
}

_PARAM_SET_REQUIRED = [
    "mode",
    "lookback_days",
    "risk_aversion",
    "top_n_actual",
    "max_weight_actual",
    "max_turnover_actual",
    "w_mom",
    "w_lowvol",
    "w_equity",
    "w_bond",
]

_PARAM_SET_CORE_PROPS: dict[str, dict[str, str]] = {
    "mode": {"type": "STRING"},
    "lookback_days": {"type": "NUMBER"},
    "risk_aversion": {"type": "NUMBER"},
    "top_n_actual": {"type": "NUMBER"},
    "max_weight_actual": {"type": "NUMBER"},
    "max_turnover_actual": {"type": "NUMBER"},
    "w_mom": {"type": "NUMBER"},
    "w_lowvol": {"type": "NUMBER"},
    "w_equity": {"type": "NUMBER"},
    "w_bond": {"type": "NUMBER"},
}


def _round_param_numbers(s: dict[str, Any]) -> dict[str, Any]:
    cleaned = sanitize_for_ai(s)
    return cleaned if isinstance(cleaned, dict) else dict(s)


def _param_set_response_schema(*, minimal: bool) -> dict[str, Any]:
    """Structured output schema — minimal omits optional numerics that bloat JSON."""
    props = dict(_PARAM_SET_CORE_PROPS)
    if not minimal:
        props.update(_INDICATOR_SCHEMA_PROPS)
    return {
        "type": "OBJECT",
        "properties": props,
        "required": list(_PARAM_SET_REQUIRED),
    }


def _param_response_schema(*, minimal: bool, require_rationale: bool) -> dict[str, Any]:
    properties: dict[str, Any] = {
        "param_sets": {
            "type": "ARRAY",
            "items": _param_set_response_schema(minimal=minimal),
        },
    }
    required = ["param_sets"]
    if require_rationale:
        properties["rationale"] = {"type": "STRING"}
        required.append("rationale")
    return {
        "type": "OBJECT",
        "properties": properties,
        "required": required,
    }


def _salvage_truncated_json(text: str) -> dict[str, Any] | None:
    """Best-effort parse when Gemini stops mid-object (MAX_TOKENS)."""
    text = truncate_json_numeric_literals(text.strip())
    if not text.startswith("{"):
        return None
    repaired = text.rstrip(",")
    if repaired.count('"') % 2 == 1:
        repaired += '"'
    stack: list[str] = []
    for ch in repaired:
        if ch == "{":
            stack.append("}")
        elif ch == "[":
            stack.append("]")
        elif ch in "}]" and stack and stack[-1] == ch:
            stack.pop()
    repaired += "".join(reversed(stack))
    return _extract_json(repaired)


def _extract_json(text: str) -> dict[str, Any] | None:
    text = truncate_json_numeric_literals(text.strip())
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return sanitize_ai_response(parsed)
        if isinstance(parsed, list):
            return sanitize_ai_response({"rationale": "", "param_sets": parsed})
        return None
    except Exception:
        pass
    # Try broad brace extraction for non-fenced replies.
    l = text.find("{")
    r = text.rfind("}")
    if l >= 0 and r > l:
        try:
            parsed = json.loads(text[l : r + 1])
            if isinstance(parsed, dict):
                return sanitize_ai_response(parsed)
            if isinstance(parsed, list):
                return sanitize_ai_response({"rationale": "", "param_sets": parsed})
            return None
        except Exception:
            pass
    m = re.search(r"```json\s*(\{[\s\S]*?\})\s*```", text)
    if m:
        try:
            parsed = json.loads(m.group(1))
            if isinstance(parsed, dict):
                return sanitize_ai_response(parsed)
        except Exception:
            return None
    return None


def resolve_ai_param_seed_plan(requested_n: int) -> dict[str, Any]:
    """How many Gemini param seeds to request vs Optuna-only trials.

    When requested_n exceeds the batch threshold, cap AI seeds and use batched
    generateContent calls instead of one HTTP request per seed.
    """
    requested = int(max(1, requested_n))
    hard_cap = 40
    threshold = max(1, int(settings.ai_param_seed_batch_threshold))
    max_ai = max(1, min(int(settings.ai_param_seed_max_count), hard_cap))
    batch_size = max(1, min(int(settings.ai_param_seed_batch_size), max_ai))
    bounded = min(requested, hard_cap)
    if bounded > threshold:
        target = min(bounded, max_ai)
        return {
            "requested": requested,
            "bounded": bounded,
            "target": target,
            "use_batch": True,
            "batch_size": batch_size,
            "capped": bounded > target,
            "threshold": threshold,
            "max_ai": max_ai,
        }
    return {
        "requested": requested,
        "bounded": bounded,
        "target": bounded,
        "use_batch": False,
        "batch_size": batch_size,
        "capped": False,
        "threshold": threshold,
        "max_ai": max_ai,
    }


def _summarize_set(s: dict[str, Any]) -> str:
    return (
        f"mode={s.get('mode')}, lookback={s.get('lookback_days')}, "
        f"top_n={s.get('top_n_actual')}, risk_aversion={s.get('risk_aversion')}, "
        f"w_mom={s.get('w_mom')}, w_lowvol={s.get('w_lowvol')}, "
        f"mom={s.get('mom_indicator')}, rev={s.get('reversal_indicator')}"
    )


def _stable_param_key(s: dict[str, Any]) -> tuple[Any, ...]:
    """A compact signature used for de-duplication."""
    return tuple(s.get(k) for k in PARAM_DEDUP_KEYS)


def _compact_line(text: str, max_len: int = 220) -> str:
    s = " ".join(str(text).split())
    return s if len(s) <= max_len else (s[: max_len - 3] + "...")


def _direction_cache_key(
    *,
    objective: str,
    rebalance_freq: str,
    max_weight_cap: float,
    max_turnover_cap: float,
    top_n_cap: int,
    tradable_count: int,
    learning_context: dict[str, Any],
) -> str:
    champ = learning_context.get("champion") if learning_context else {}
    payload = {
        "objective": objective,
        "rebalance_freq": rebalance_freq,
        "max_weight_cap": round(float(max_weight_cap), 4),
        "max_turnover_cap": round(float(max_turnover_cap), 4),
        "top_n_cap": int(top_n_cap),
        "tradable_count": int(tradable_count),
        "target": learning_context.get("target_adjusted_score"),
        "champion": {
            "score": (champ or {}).get("adjusted_score"),
            "gap": (champ or {}).get("gap_sharpe"),
            "risk": (champ or {}).get("overfitting_risk"),
            "params": _compact_line(str((champ or {}).get("params_summary")), 120),
        },
        "failure_patterns": _compact_line(
            str((learning_context or {}).get("failure_patterns", "")), 180
        ),
    }
    return json.dumps(payload, sort_keys=True, ensure_ascii=False)


def _default_direction_plan(
    objective: str, learning_context: dict[str, Any] | None = None
) -> dict[str, Any]:
    if objective == "max_return":
        plan = {
            "thesis": "Beat benchmark first, then raise in-sample CAGR above champion.",
            "do_more": ["benchmark_outperformance", "momentum_quality", "controlled_equity_tilt"],
            "do_less": ["failed_param_patterns", "excessive_turnover"],
            "risk_notes": "Keep IS/OOS gap small; do not copy failed challengers.",
        }
    else:
        plan = {
            "thesis": "Beat benchmark risk-adjusted, then lift champion in-sample objective.",
            "do_more": ["alpha_vs_benchmark", "robust_allocations", "generalization"],
            "do_less": ["failed_param_patterns", "parameter_extremes"],
            "risk_notes": "Prefer smaller IS/OOS gap vs champion.",
        }
    lc = learning_context or {}
    champ = lc.get("champion") if isinstance(lc, dict) else None
    if isinstance(champ, dict):
        bvs = champ.get("benchmark_vs") or {}
        pvb = bvs.get("portfolio_vs_benchmark") if isinstance(bvs, dict) else {}
        alpha = pvb.get("alpha") if isinstance(pvb, dict) else None
        if alpha is not None and float(alpha) < 0:
            plan["do_more"] = list(
                dict.fromkeys(["benchmark_outperformance", *plan["do_more"]])
            )[:8]
    return plan


def _get_direction_plan(
    *,
    url: str,
    objective: str,
    rebalance_freq: str,
    max_weight_cap: float,
    max_turnover_cap: float,
    top_n_cap: int,
    tradable_count: int,
    learning_context: dict[str, Any],
) -> dict[str, Any]:
    key = _direction_cache_key(
        objective=objective,
        rebalance_freq=rebalance_freq,
        max_weight_cap=max_weight_cap,
        max_turnover_cap=max_turnover_cap,
        top_n_cap=top_n_cap,
        tradable_count=tradable_count,
        learning_context=learning_context,
    )
    with _dir_lock:
        cached = _direction_cache.get(key)
    if cached:
        return cached
    # Token-safe mode: build direction plan locally (no extra Gemini call).
    plan = _default_direction_plan(objective, learning_context)
    failed = (
        learning_context.get("failed_challengers")
        if isinstance(learning_context, dict)
        else None
    )
    if isinstance(failed, list) and failed:
        avg_gap = sum(float(r.get("gap_sharpe", 0.0)) for r in failed if isinstance(r, dict)) / max(
            1, len([r for r in failed if isinstance(r, dict)])
        )
        if avg_gap > 0.25:
            plan["do_less"] = list(dict.fromkeys(plan["do_less"] + ["high_turnover", "extreme_factor_concentration"]))[:8]
            plan["do_more"] = list(dict.fromkeys(plan["do_more"] + ["generalization", "balanced_exposure"]))[:8]
            plan["risk_notes"] = (
                "Recent failures suggest train-validation instability; "
                "prioritize robust validation behavior and avoid concentrated bets."
            )

    with _dir_lock:
        _direction_cache[key] = plan
    return plan


_LEARNING_CONTEXT_LIMITS: dict[str, int] = {
    "ultra": 500,
    "standard": 1800,
    "full": 3800,
}

_VALID_THINKING_LEVELS = frozenset({"off", "minimal", "low", "medium", "high"})
_ELEVATED_THINKING_LEVELS = frozenset({"low", "medium", "high"})


def _normalize_thinking_level(raw: str | None, *, default: str = "off") -> str:
    level = (raw or default).strip().lower()
    return level if level in _VALID_THINKING_LEVELS else default


def _resolve_thinking_level(
    learning_context: dict[str, Any] | None,
) -> str | None:
    """Map env to Gemini thinkingLevel; None means omit thinkingConfig."""
    base = _normalize_thinking_level(settings.gemini_thinking_level, default="off")
    if base == "off":
        return None

    context_mode = _resolve_learning_context_mode(learning_context)
    if context_mode == "full":
        full_raw = settings.gemini_thinking_level_full
        if full_raw is not None and str(full_raw).strip():
            return _normalize_thinking_level(full_raw, default="low")
        return "low"

    return "minimal"


def _thinking_config_for_model(
    learning_context: dict[str, Any] | None,
    *,
    model: str,
) -> dict[str, Any] | None:
    """Build thinkingConfig for Gemini generateContent (gemini-3.x uses thinkingLevel)."""
    level = _resolve_thinking_level(learning_context)
    if level is None:
        return None
    if "gemini-3" in model or "gemini-2.5" in model:
        return {"thinkingLevel": level}
    if level in _ELEVATED_THINKING_LEVELS:
        budget = {"low": 1024, "medium": 4096, "high": 8192}.get(level, 0)
        return {"thinkingBudget": budget}
    if level == "minimal":
        return {"thinkingBudget": 256}
    return None


def _resolve_round_seed_thinking_level() -> str | None:
    """Round seed thinking: GEMINI_ROUND_SEED_THINKING_LEVEL or inherit GEMINI_THINKING_LEVEL."""
    raw = settings.gemini_round_seed_thinking_level
    if raw is not None and str(raw).strip():
        level = _normalize_thinking_level(raw, default="off")
    else:
        level = _normalize_thinking_level(settings.gemini_thinking_level, default="off")
    return None if level == "off" else level


def _thinking_config_for_round_seed(*, model: str) -> dict[str, Any] | None:
    """Pro round seed thinkingConfig; inherits GEMINI_THINKING_LEVEL when round override unset."""
    level = _resolve_round_seed_thinking_level()
    if level is None:
        return None
    if "gemini-3" in model or "gemini-2.5" in model:
        return {"thinkingLevel": level if level != "minimal" else "minimal"}
    if level in _ELEVATED_THINKING_LEVELS:
        budget = {"low": 1024, "medium": 4096, "high": 8192}.get(level, 0)
        return {"thinkingBudget": budget}
    if level == "minimal":
        return {"thinkingBudget": 256}
    return None


_PROMPT_STRING_MAX_LEN = 120


def _sanitize_prompt_string(value: Any, *, max_len: int = _PROMPT_STRING_MAX_LEN) -> Any:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return round_ai_float(float(value))
    if not isinstance(value, str):
        return value
    s = " ".join(value.split())
    if len(s) <= max_len:
        return s
    return s[: max_len - 3] + "..."


def _sanitize_prompt_dict(data: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(data, dict):
        return {}
    cleaned = sanitize_for_ai(data)
    if not isinstance(cleaned, dict):
        return {}
    return {
        str(k): _sanitize_prompt_string(v)
        if isinstance(v, str)
        else v
        for k, v in cleaned.items()
    }


def _format_ai_number(value: Any, *, key: str | None = None) -> Any:
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return round_ai_float(float(value), key=key)
    return value


def _gemini_thinking_metadata(
    learning_context: dict[str, Any] | None,
    *,
    model: str,
) -> dict[str, Any]:
    """Echo resolved thinking for API responses (verify env without AI Studio logs)."""
    level = _resolve_thinking_level(learning_context)
    return {
        "thinking_level": level,
        "thinking_config": _thinking_config_for_model(learning_context, model=model),
    }


def _resolve_learning_context_mode(
    learning_context: dict[str, Any] | None,
) -> str:
    """Pick ultra|standard|full for Gemini prompt learning block."""
    raw = (settings.gemini_learning_context_mode or "auto").strip().lower()
    if raw in _LEARNING_CONTEXT_LIMITS:
        return raw
    lc = learning_context or {}
    has_research = bool(lc.get("champion_research"))
    has_refinement = lc.get("target_adjusted_score") is not None
    max_tok = max(1024, int(settings.gemini_max_output_tokens))
    if has_research and max_tok >= 4096:
        return "full"
    if (has_research or has_refinement) and max_tok >= 2048:
        return "standard"
    return "ultra"


def _champion_research_lines(learning_context: dict[str, Any]) -> list[str]:
    """JSON subset from build_gemini_learning_context champion_research dossier."""
    cr = learning_context.get("champion_research")
    if not isinstance(cr, dict):
        return []
    lines = ["CHAMPION_RESEARCH:"]
    params = cr.get("params")
    if params:
        lines.append(f"  params={_compact_line(str(params), 900)}")
    outputs = cr.get("in_sample_outputs")
    if isinstance(outputs, dict) and outputs:
        lines.append(
            "  in_sample_outputs="
            + _compact_line(dumps_for_ai(outputs), 420)
        )
    wh = cr.get("weight_history")
    if isinstance(wh, dict) and wh:
        lines.append(
            "  weight_history="
            + _compact_line(dumps_for_ai(wh), 520)
        )
    bench = cr.get("benchmark_comparison")
    if isinstance(bench, dict) and bench:
        lines.append(
            "  benchmark_comparison="
            + _compact_line(dumps_for_ai(bench), 620)
        )
    holdout = cr.get("holdout_outputs")
    if isinstance(holdout, dict) and holdout:
        lines.append(
            "  holdout_outputs="
            + _compact_line(dumps_for_ai(holdout), 300)
        )
    eq = cr.get("equity_summary")
    if isinstance(eq, dict) and eq:
        lines.append(
            "  equity_summary="
            + _compact_line(dumps_for_ai(eq), 200)
        )
    return lines


def _build_learning_context_block_for_mode(
    learning_context: dict[str, Any],
    mode: str,
) -> str:
    """Build refinement learning block; mode is ultra|standard|full."""
    resolved = mode if mode in _LEARNING_CONTEXT_LIMITS else "standard"
    if resolved == "ultra":
        return _build_learning_context_block_ultra(learning_context)
    slim = resolved == "standard" and not learning_context.get("champion_research")
    block = _build_learning_context_block(learning_context, slim=slim)
    if resolved == "full":
        extra = _champion_research_lines(learning_context)
        if extra:
            block = block + "\n" + "\n".join(extra)
    limit = _LEARNING_CONTEXT_LIMITS[resolved]
    if len(block) > limit:
        block = block[: limit - 40] + "\n(context truncated)"
    return block


def _compact_failure_rows(rows: list[dict[str, Any]], limit: int) -> list[str]:
    out: list[str] = []
    for r in rows[:limit]:
        if not isinstance(r, dict):
            continue
        out.append(
            "r{round}|s={score}|gap={gap}|ovf={risk}|p={params}".format(
                round=r.get("round"),
                score=r.get("adjusted_score"),
                gap=r.get("gap_to_beat"),
                risk=r.get("risk_level"),
                params=_compact_line(str(r.get("params_summary")), 90),
            )
        )
    return out


def _build_learning_context_block(
    learning_context: dict[str, Any], *, slim: bool
) -> str:
    if not learning_context:
        return "(none — first batch)"

    lines: list[str] = []
    global_cfg = learning_context.get("global_config")
    if isinstance(global_cfg, dict):
        lines.append(
            "GLOBAL: obj={obj}, reb={reb}, mw={mw}, mt={mt}, tn={tn}, tc={tc}".format(
                obj=global_cfg.get("objective"),
                reb=global_cfg.get("rebalance_freq"),
                mw=global_cfg.get("max_weight_cap"),
                mt=global_cfg.get("max_turnover_cap"),
                tn=global_cfg.get("top_n_cap"),
                tc=global_cfg.get("tradable_count"),
            )
        )
    mutable = learning_context.get("mutable_fields")
    if isinstance(mutable, list) and mutable:
        lines.append(
            "MUTABLE_ONLY: " + ", ".join(str(x) for x in mutable[:32])
        )
    mission = learning_context.get("mission")
    if mission:
        lines.append(f"M: {_compact_line(str(mission), 180 if slim else 260)}")
    target = learning_context.get("target_adjusted_score")
    if target is not None:
        lines.append(f"TGT={target}")

    priorities = learning_context.get("priorities")
    if isinstance(priorities, list) and priorities:
        lines.append(
            "PRIORITY: " + _compact_line("; ".join(str(p) for p in priorities[:3]), 200)
        )
    bench = learning_context.get("benchmark_ticker")
    if bench:
        lines.append(f"BENCH={bench}")
    champ = learning_context.get("champion")
    if isinstance(champ, dict):
        lines.append(
            "CHAMP: is_obj={io}, tr={tr}, va={va}, gap={gap}, risk={risk}, p={p}".format(
                io=champ.get("in_sample_objective"),
                tr=champ.get("train_sharpe"),
                va=champ.get("validation_sharpe"),
                gap=champ.get("gap_objective", champ.get("gap_sharpe")),
                risk=champ.get("overfitting_risk"),
                p=_compact_line(str(champ.get("params_summary")), 110 if slim else 170),
            )
        )
        bvs = champ.get("benchmark_vs")
        if isinstance(bvs, dict):
            pvb = bvs.get("portfolio_vs_benchmark") or bvs
            lines.append(
                "CHAMP_VS_BENCH: p_cagr={pc}, b_ret={br}, alpha={a}, ir={ir}".format(
                    pc=pvb.get("portfolio_cagr"),
                    br=pvb.get("benchmark_total_return_pct"),
                    a=pvb.get("alpha"),
                    ir=pvb.get("information_ratio"),
                )
            )
        wh = champ.get("weight_history_summary")
        if isinstance(wh, dict) and wh.get("top_holdings_latest"):
            lines.append(
                "CHAMP_WEIGHTS: "
                + _compact_line(str(wh.get("top_holdings_latest")), 120 if slim else 180)
            )
    cr = learning_context.get("champion_research")
    if isinstance(cr, dict):
        wh_cr = cr.get("weight_history")
        if isinstance(wh_cr, dict) and wh_cr:
            lines.append(
                "weight_history="
                + _compact_line(dumps_for_ai(wh_cr), 200 if slim else 360)
            )
    avoid = learning_context.get("params_to_avoid")
    if isinstance(avoid, list) and avoid:
        lines.append("AVOID: " + _compact_line("; ".join(str(x) for x in avoid[:4]), 160))

    patterns = learning_context.get("failure_patterns")
    if patterns:
        lines.append(f"PATTERN: {_compact_line(str(patterns), 150 if slim else 240)}")

    failed = learning_context.get("failed_challengers")
    if isinstance(failed, list) and failed:
        lines.append("FAIL:")
        lines.extend(_compact_failure_rows(failed, 2 if slim else 5))

    near = learning_context.get("near_miss_challengers")
    if isinstance(near, list) and near:
        lines.append("NEAR:")
        lines.extend(_compact_failure_rows(near, 1 if slim else 2))

    hint = learning_context.get("hint")
    if hint:
        lines.append(f"HINT: {_compact_line(str(hint), 140 if slim else 220)}")

    block = "\n".join(lines)
    hard_limit = 1000 if slim else 1800
    if len(block) > hard_limit:
        block = block[: hard_limit - 40] + "\n(context truncated)"
    return block


def _build_learning_context_block_ultra(learning_context: dict[str, Any]) -> str:
    if not learning_context:
        return "(none)"
    lines: list[str] = []
    global_cfg = learning_context.get("global_config")
    if isinstance(global_cfg, dict):
        lines.append(
            "G obj={obj}, reb={reb}, mw={mw}, mt={mt}, tn={tn}".format(
                obj=global_cfg.get("objective"),
                reb=global_cfg.get("rebalance_freq"),
                mw=global_cfg.get("max_weight_cap"),
                mt=global_cfg.get("max_turnover_cap"),
                tn=global_cfg.get("top_n_cap"),
            )
        )
    mutable = learning_context.get("mutable_fields")
    if isinstance(mutable, list) and mutable:
        lines.append("MUT: " + ", ".join(str(x) for x in mutable[:20]))
    target = learning_context.get("target_adjusted_score")
    bench = learning_context.get("benchmark_ticker")
    if bench:
        lines.append(f"BENCH={bench}")
    if target is not None:
        lines.append(f"TGT={target}")
    champ = learning_context.get("champion")
    if isinstance(champ, dict):
        lines.append(
            "CHAMP io={io}, tr={tr}, va={va}, gap={gap}, p={p}".format(
                io=champ.get("in_sample_objective"),
                tr=champ.get("train_sharpe"),
                va=champ.get("validation_sharpe"),
                gap=champ.get("gap_objective", champ.get("gap_sharpe")),
                p=_compact_line(str(champ.get("params_summary")), 80),
            )
        )
        bvs = champ.get("benchmark_vs")
        if isinstance(bvs, dict):
            pvb = bvs.get("portfolio_vs_benchmark") or {}
            lines.append(
                "vsB a={a} ir={ir}".format(
                    a=pvb.get("alpha"),
                    ir=pvb.get("information_ratio"),
                )
            )
    avoid = learning_context.get("params_to_avoid")
    if isinstance(avoid, list) and avoid:
        lines.append("AVOID " + _compact_line(avoid[0], 70))
    failed = learning_context.get("failed_challengers")
    if isinstance(failed, list) and failed:
        lines.append("FAIL:")
        lines.extend(_compact_failure_rows(failed, 2))
    near = learning_context.get("near_miss_challengers")
    if isinstance(near, list) and near:
        lines.append("NEAR:")
        lines.extend(_compact_failure_rows(near, 1))
    block = "\n".join(lines)
    return block[:500] if len(block) > 500 else block


def generate_ai_param_sets(
    *,
    n: int,
    objective: str,
    rebalance_freq: str,
    max_weight_cap: float,
    max_turnover_cap: float,
    top_n_cap: int,
    tradable_count: int,
    param_controls: dict[str, dict] | None = None,
    progress_cb: Callable[[int, int, str], None] | None = None,
    learning_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Generate candidate parameter sets via Gemini.

    Returns a dict with:
    - enabled: bool
    - rationale: str
    - param_sets: list[dict]
    - model: str
    - error: optional str
    """
    key = settings.gemini_api_key
    if not key:
        return {
            "enabled": False,
            "model": settings.gemini_model,
            "rationale": "AI key not configured; fallback to Optuna search only.",
            "param_sets": [],
            "error": "missing_api_key",
        }

    model = settings.gemini_model
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
    seed_plan = resolve_ai_param_seed_plan(n)
    requested_n = int(seed_plan["requested"])
    n = int(seed_plan["target"])
    blueprint = RunBlueprint(
        max_weight=float(max_weight_cap),
        max_turnover=float(max_turnover_cap),
        top_n=int(top_n_cap),
    )
    param_controls = normalize_param_controls(param_controls, blueprint)
    learning_context = learning_context or {}
    learning_context_mode = _resolve_learning_context_mode(learning_context)
    learning_context_block = _build_learning_context_block_for_mode(
        learning_context, learning_context_mode
    )
    learning_context_label = {
        "ultra": "ultra-compact",
        "standard": "standard",
        "full": "full (champion dossier)",
    }.get(learning_context_mode, learning_context_mode)
    direction_plan = _get_direction_plan(
        url=url,
        objective=objective,
        rebalance_freq=rebalance_freq,
        max_weight_cap=max_weight_cap,
        max_turnover_cap=max_turnover_cap,
        top_n_cap=top_n_cap,
        tradable_count=tradable_count,
        learning_context=learning_context,
    )
    constraints_compact = (
        f"obj={objective}; reb={rebalance_freq}; "
        f"{blueprint_prompt_lines(blueprint)} "
        f"cap[max_weight]=0.05..{max_weight_cap:.4f}; "
        f"cap[max_turnover]=0.05..{max_turnover_cap:.4f}; "
        f"top_n=5..{min(top_n_cap, tradable_count)}; "
        "lookback=126..504; factor_lb=126..504; rev_lb=63..252; val_lb=63..252; "
        "shrinkage=0..0.5; risk_aversion=0.5..12; no_trade_tol=0..0.02; turnover_penalty=0.5..3; "
        "factor_weights=0..2(trend/drawdown<=1.5); class_weights=0..1; "
        f"mom_indicator in {list(MOM_INDICATOR_CHOICES)}; "
        f"reversal_indicator in {list(REVERSAL_INDICATOR_CHOICES)}; "
        f"value_indicator in {list(VALUE_INDICATOR_CHOICES)}; "
        f"lowvol_indicator in {list(LOWVOL_INDICATOR_CHOICES)}; "
        f"trend_indicator in {list(TREND_INDICATOR_CHOICES)}; "
        f"drawdown_indicator in {list(DRAWDOWN_INDICATOR_CHOICES)}"
    )
    # Keep parallelism small to reduce noisy repeated token failures (per-seed mode only).
    max_parallel = max(1, min(2, n))
    use_batch = bool(seed_plan["use_batch"])
    batch_chunk = int(seed_plan["batch_size"])

    def _seed_count_line(count: int) -> str:
        if count <= 1:
            return (
                "Generate exactly ONE portfolio-model parameter set for backtesting.\n"
                "It must be meaningfully different from any previously generated sets (if listed)."
            )
        return (
            f"Generate exactly {count} distinct portfolio-model parameter sets for backtesting.\n"
            "Each must be meaningfully different from any previously generated sets (if listed) "
            "and from every other set in this response."
        )

    base_prompt = """
You are an institutional quant research assistant.
{seed_count_line}

When refinement learning context is provided, read it carefully — especially CHAMPION_RESEARCH /
champion params, in_sample_outputs, weight_history, and benchmark_comparison when present.
Use those metrics to beat the benchmark first, then beat the champion in-sample objective (above TARGET).
Priorities (in order):
(1) Beat the benchmark on in-sample risk-adjusted terms (alpha / IR / total return vs benchmark).
(2) Beat the champion in-sample objective (above TARGET).
(3) Do NOT reuse parameter patterns listed under params_to_avoid or failed challengers.
Be concise and output the final JSON immediately without additional thinking text.
Treat GLOBAL settings as immutable and only vary fields listed in MUTABLE_ONLY/MUT.
Do not output objective_mode or rebalance_freq (run-level fixed).
Include mode (allocator) plus any MUTABLE fields you change; omit unchanged optional fields.
Required minimum: mode, lookback_days, risk_aversion, top_n_actual, max_weight_actual,
max_turnover_actual, w_mom, w_lowvol, w_equity, w_bond.
Factor indicators (optional; materially different signals): mom_indicator cumulative_return|risk_adjusted_return|skip_month_12_1;
reversal negative_return|off_peak|rsi_mean_reversion; value ma_price_ratio|price_percentile|inverse_long_momentum;
lowvol negative_vol|negative_downside_dev|negative_beta_market; trend price_ma_ratio|ma_slope|dual_ma_crossover;
drawdown max_drawdown_depth|time_since_peak|ulcer_index.
Champion challenge success must follow objective in GLOBAL/constraints (do not optimize a different objective).
Numeric rule: at most 4 decimal places for every number; never emit long float expansions.
Output rule: include required fields plus only optional fields you materially change; omit other optional numerics.

Previously generated this wave (avoid duplicating these):
{previous_sets}

Refinement learning context ({learning_context_label}):
{learning_context_block}

Optimization Direction Blueprint (GLOBAL for this batch):
- thesis: {direction_thesis}
- do_more: {direction_do_more}
- do_less: {direction_do_less}
- risk_notes: {direction_risk_notes}

Compact constraints spec: {constraints_compact}

MUST NOT exceed run ceilings in GLOBAL/constraints (max_weight_actual, max_turnover_actual, top_n_actual).
Note: server-side validation/clamping is authoritative; values above ceilings are rejected or clipped.

Return STRICT JSON only:
{{"rationale":"...", "param_sets":[{{...}}{extra_sets_hint}]}}
"""
    max_output_tokens = max(1024, int(settings.gemini_max_output_tokens))
    max_retries = max(1, int(settings.gemini_param_seed_max_retries))

    try:
        all_sets: list[dict[str, Any]] = []
        fatal_error: str | None = None
        def _apply_controls(s: dict[str, Any]) -> dict[str, Any]:
            out = _round_param_numbers(dict(s))
            for k in RUN_LEVEL_FIXED_KEYS:
                out.pop(k, None)
            for k, c in param_controls.items():
                if not isinstance(c, dict):
                    continue
                mode = resolve_control_mode(c)
                if mode == "off":
                    off_val = resolve_off_value(k, blueprint, c, default_low=0)
                    if off_val is not None:
                        out[k] = off_val
                    else:
                        out.pop(k, None)
                elif mode == "fixed":
                    if c.get("fixed") is not None:
                        out[k] = c.get("fixed")
                else:
                    opts = c.get("options")
                    if isinstance(opts, list) and opts:
                        if k in out:
                            v = str(out[k])
                            if v not in opts:
                                out[k] = opts[0]
                        else:
                            out[k] = opts[0]
                        continue
                    if k in out:
                        try:
                            v = float(out[k])
                            lo = c.get("min")
                            hi = c.get("max")
                            ceiling = blueprint.ceiling(k)
                            if lo is not None:
                                v = max(v, float(lo))
                            if hi is not None:
                                v = min(v, float(hi))
                            if ceiling is not None:
                                v = min(v, float(ceiling))
                            out[k] = v
                        except Exception:
                            pass
            out, _ = clamp_param_dict(out, blueprint, param_controls=param_controls)
            return out

        rationales: list[str] = []
        last_error = ""
        last_excerpt = ""
        seen: set[tuple[Any, ...]] = set()

        def _previous_sets_block(sets: list[dict[str, Any]], *, compact: bool) -> str:
            recent = sets[-12:] if len(sets) > 12 else sets
            block = "\n".join(f"- {_summarize_set(s)}" for s in recent) or "(none yet)"
            if len(sets) > len(recent):
                block = f"(showing last {len(recent)} of {len(sets)})\n" + block
            if compact and len(block) > 400:
                block = block[:397] + "..."
            return block

        def _request_sets(seed_count: int, previous_block: str) -> dict[str, Any] | None:
            nonlocal last_error, last_excerpt
            parsed: dict[str, Any] | None = None
            local_last = ""
            seed_count = max(1, int(seed_count))
            extra_sets_hint = (
                f"; param_sets must contain exactly {seed_count} objects"
                if seed_count > 1
                else ""
            )

            for attempt in range(max_retries):
                compact = attempt > 0
                minimal_schema = attempt > 0
                lc_block = (
                    "(omitted — compact retry)"
                    if compact
                    else learning_context_block
                )
                direction_thesis = (
                    direction_plan.get("thesis", "")
                    if not compact
                    else "Beat benchmark; improve in-sample objective."
                )
                direction_do_more = (
                    ", ".join(direction_plan.get("do_more", []))
                    if not compact
                    else "robust_allocations"
                )
                direction_do_less = (
                    ", ".join(direction_plan.get("do_less", []))
                    if not compact
                    else "verbose_output"
                )
                direction_risk_notes = (
                    direction_plan.get("risk_notes", "")
                    if not compact
                    else "Keep JSON tiny; max 4 decimals."
                )
                prev_block = previous_block
                if compact and len(prev_block) > 400:
                    prev_block = prev_block[:397] + "..."
                prompt_i = base_prompt.format(
                    seed_count_line=_seed_count_line(seed_count),
                    previous_sets=prev_block,
                    learning_context_label=(
                        "omitted" if compact else learning_context_label
                    ),
                    learning_context_block=lc_block,
                    direction_thesis=direction_thesis,
                    direction_do_more=direction_do_more,
                    direction_do_less=direction_do_less,
                    direction_risk_notes=direction_risk_notes,
                    constraints_compact=constraints_compact,
                    extra_sets_hint=extra_sets_hint,
                )
                json_hint = (
                    f'{{"param_sets":[{{...}}]{extra_sets_hint}}}'
                    if minimal_schema
                    else f'{{"rationale":"...", "param_sets":[{{...}}]{extra_sets_hint}}}'
                )
                req_prompt = (
                    prompt_i
                    + f"\nIMPORTANT: reply with a single JSON object only ({json_hint}), "
                    "no markdown, no commentary."
                )
                attempt_tokens = min(
                    8192,
                    max_output_tokens
                    + (attempt * 1024)
                    + max(0, seed_count - 1) * 512,
                )
                generation_config: dict[str, Any] = {
                    "temperature": 0.0,
                    "maxOutputTokens": attempt_tokens,
                    "responseMimeType": "application/json",
                    "responseSchema": _param_response_schema(
                        minimal=minimal_schema,
                        require_rationale=not minimal_schema,
                    ),
                }
                thinking_config = _thinking_config_for_model(
                    learning_context, model=model
                )
                if thinking_config is not None:
                    generation_config["thinkingConfig"] = thinking_config
                res = httpx.post(
                    url,
                    json={
                        "contents": [{"parts": [{"text": req_prompt}]}],
                        "generationConfig": generation_config,
                    },
                    timeout=45.0,
                )
                res.raise_for_status()
                body = res.json()
                parts = (
                    body.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts", [])
                )
                finish_reason = body.get("candidates", [{}])[0].get("finishReason", "")
                text = "".join(
                    p.get("text", "") for p in parts if isinstance(p, dict)
                )
                if finish_reason == "MAX_TOKENS":
                    last_error = "gemini_max_tokens"
                    local_last = "finish_reason=MAX_TOKENS"
                    parsed = _extract_json(text) or _salvage_truncated_json(text)
                    if parsed:
                        break
                    continue
                local_last = sanitize_json_text_for_log(text)
                parsed = _extract_json(text)
                if parsed:
                    break
            if parsed is None:
                last_error = "gemini_non_json_response"
                if local_last == "finish_reason=MAX_TOKENS":
                    last_error = "gemini_max_tokens"
                last_excerpt = local_last
            return parsed

        def _ingest_parsed(parsed: dict[str, Any] | None) -> bool:
            """Merge parsed Gemini JSON into all_sets. Returns True if max_tokens fatal."""
            nonlocal fatal_error
            if not parsed:
                if last_error == "gemini_max_tokens":
                    fatal_error = "gemini_max_tokens"
                    return True
                return False
            r_txt = str(parsed.get("rationale", "")).strip()
            if r_txt:
                rationales.append(r_txt)
            sets = parsed.get("param_sets", [])
            if not isinstance(sets, list):
                return False
            for s in sets:
                if not isinstance(s, dict):
                    continue
                key_sig = _stable_param_key(s)
                if key_sig in seen:
                    continue
                seen.add(key_sig)
                all_sets.append(_apply_controls(s))
                if progress_cb:
                    progress_cb(
                        len(all_sets),
                        n,
                        f"Generated set {len(all_sets)}/{n}: {_summarize_set(s)}",
                    )
                if len(all_sets) >= n:
                    break
            return False

        cap_note = ""
        if seed_plan.get("capped"):
            cap_note = (
                f" (requested {requested_n} trials → {n} AI seeds; "
                "remaining trials use Optuna sampler only)"
            )

        while len(all_sets) < n:
            before_count = len(all_sets)
            remaining = n - len(all_sets)
            prev = _previous_sets_block(all_sets, compact=False)
            if use_batch:
                batch_n = min(batch_chunk, remaining)
                if progress_cb:
                    progress_cb(
                        len(all_sets) + 1,
                        n,
                        f"AI batch request ({batch_n} seeds in one call): "
                        f"{len(all_sets)}/{n}{cap_note}",
                    )
                parsed = _request_sets(batch_n, prev)
                if _ingest_parsed(parsed):
                    break
            else:
                wave = min(max_parallel, remaining)
                if progress_cb:
                    progress_cb(
                        len(all_sets) + 1,
                        n,
                        f"AI parallel gen ({wave} concurrent): {len(all_sets)}/{n}",
                    )
                with ThreadPoolExecutor(max_workers=wave) as ex:
                    futures = [
                        ex.submit(_request_sets, 1, prev) for _ in range(wave)
                    ]
                    for fut in as_completed(futures):
                        if _ingest_parsed(fut.result()):
                            break
                        if len(all_sets) >= n:
                            break
            if fatal_error == "gemini_max_tokens":
                raise ValueError("gemini_max_tokens")
            if len(all_sets) == before_count:
                break
        rationale = " | ".join(dict.fromkeys(rationales))

        if not all_sets:
            if last_error == "gemini_max_tokens":
                raise ValueError("gemini_max_tokens")
            # Fallback 1: call web-side structured endpoint in small batches.
            collected: list[dict[str, Any]] = []
            rationale_fb = ""
            for port in ("3000", "3001", "3002"):
                try:
                    while len(collected) < n:
                        req_n = 1
                        if progress_cb:
                            progress_cb(
                                len(collected) + 1,
                                n,
                                f"Fallback channel generating params {len(collected) + 1}/{n}…",
                            )
                        res = httpx.post(
                            f"http://127.0.0.1:{port}/api/param-seeds",
                            json={
                                "n": req_n,
                                "objective": objective,
                                "rebalance_freq": rebalance_freq,
                                "max_weight_cap": max_weight_cap,
                                "max_turnover_cap": max_turnover_cap,
                                "top_n_cap": top_n_cap,
                                "tradable_count": tradable_count,
                                "existing_sets": collected,
                            },
                            timeout=20.0,
                        )
                        if res.status_code >= 300:
                            break
                        obj = res.json()
                        sets = obj.get("param_sets", [])
                        if not rationale_fb:
                            rationale_fb = str(obj.get("rationale", "")).strip()
                        if not isinstance(sets, list) or not sets:
                            break
                        for s in sets:
                            if isinstance(s, dict):
                                collected.append(_apply_controls(s))
                        if len(collected) >= n:
                            break
                    if collected:
                        return {
                            "enabled": True,
                            "model": model,
                            "rationale": rationale_fb,
                            "param_sets": collected[:n],
                        }
                except Exception:
                    continue

            # Fallback 2: call web-side structured endpoint using generateObject once.
            for port in ("3000", "3001", "3002"):
                try:
                    res = httpx.post(
                        f"http://127.0.0.1:{port}/api/param-seeds",
                        json={
                            "n": n,
                            "objective": objective,
                            "rebalance_freq": rebalance_freq,
                            "max_weight_cap": max_weight_cap,
                            "max_turnover_cap": max_turnover_cap,
                            "top_n_cap": top_n_cap,
                            "tradable_count": tradable_count,
                        },
                        timeout=20.0,
                    )
                    if res.status_code >= 300:
                        continue
                    obj = res.json()
                    sets = obj.get("param_sets", [])
                    if isinstance(sets, list) and sets:
                        return {
                            "enabled": True,
                            "model": model,
                            "rationale": str(obj.get("rationale", "")),
                            "param_sets": [
                                _apply_controls(s)
                                for s in sets
                                if isinstance(s, dict)
                            ][:n],
                        }
                except Exception:
                    continue
            if last_error == "gemini_non_json_response" and last_excerpt:
                raise ValueError(f"gemini_non_json_response: {last_excerpt}")
            raise ValueError(last_error or "gemini_non_json_response")
        return {
            "enabled": True,
            "model": model,
            "rationale": rationale,
            "param_sets": all_sets[:n],
            "seeds_requested": requested_n,
            "seeds_target": n,
            "generation_mode": "batched" if use_batch else "per_seed",
            "seeds_capped": bool(seed_plan.get("capped")),
        }
    except Exception as exc:  # noqa: BLE001
        if str(exc) == "gemini_max_tokens":
            # In Pro iterative mode we want fail-fast behavior.
            raise
        return {
            "enabled": False,
            "model": model,
            "rationale": "AI generation failed; fallback to Optuna random search.",
            "param_sets": [],
            "error": str(exc),
        }


_ROUND_SETUP_SCHEMA_CORE: dict[str, dict[str, str]] = {
    "mode": {"type": "STRING"},
    "lookback_days": ai_number_schema(integer=True),
    "shrinkage": ai_number_schema(),
    "risk_aversion": ai_number_schema(),
    "top_n_actual": ai_number_schema(integer=True),
    "max_weight_actual": ai_number_schema(),
    "max_turnover_actual": ai_number_schema(),
    "no_trade_tol": ai_number_schema(),
    "turnover_penalty_mult": ai_number_schema(),
}

_REGIME_SLICE_SCHEMA: dict[str, Any] = {
    "type": "OBJECT",
    "properties": {
        "mode": {"type": "STRING"},
        "lookback_days": ai_number_schema(integer=True),
        "shrinkage": ai_number_schema(),
        "risk_aversion": ai_number_schema(),
    },
}

_REGIME_SETUPS_SCHEMA: dict[str, Any] = {
    "type": "OBJECT",
    "properties": {r: _REGIME_SLICE_SCHEMA for r in REGIME_KEYS},
}

_REGIME_FACTOR_SLICE_SCHEMA: dict[str, Any] = {
    "type": "OBJECT",
    "properties": {
        key: {"type": "ARRAY", "items": factor_range_item_schema(key)}
        for key in FACTOR_NUMERIC_KEYS
    },
}

_REGIME_FACTOR_RANGES_SCHEMA: dict[str, Any] = {
    "type": "OBJECT",
    "properties": {r: _REGIME_FACTOR_SLICE_SCHEMA for r in REGIME_KEYS},
}

# Sparse schema: AI emits 2–4 focus keys per regime; server completes the rest.
_REGIME_FACTOR_RANGES_SCHEMA_SPARSE: dict[str, Any] = {
    "type": "OBJECT",
    "properties": {
        r: {"type": "OBJECT", "properties": {}} for r in REGIME_KEYS
    },
}

_FACTOR_RANGE_SCHEMA_PROPS: dict[str, Any] = {
    key: {"type": "ARRAY", "items": factor_range_item_schema(key)}
    for key in FACTOR_NUMERIC_KEYS
}


def _round_seed_response_schema(
    *,
    require_rationale: bool = True,
    compact: bool = False,
    include_regime_matrix: bool = False,
) -> dict[str, Any]:
    """Structured output for Pro round seed — sparse objects to limit JSON size."""
    setup_props = dict(_ROUND_SETUP_SCHEMA_CORE)
    range_props: dict[str, Any] = (
        {}
        if compact or include_regime_matrix
        else dict(_FACTOR_RANGE_SCHEMA_PROPS)
    )
    choice_props = (
        {}
        if compact
        else {k: {"type": "STRING"} for k in FACTOR_CATEGORICAL_KEYS}
    )
    properties: dict[str, Any] = {
        "round_setup": {
            "type": "OBJECT",
            "properties": setup_props,
            "required": list(_ROUND_SETUP_SCHEMA_CORE.keys()),
        },
        "factor_ranges": {
            "type": "OBJECT",
            "properties": range_props,
        },
        "factor_choices": {
            "type": "OBJECT",
            "properties": choice_props,
        },
    }
    if include_regime_matrix:
        properties["regime_setups"] = dict(_REGIME_SETUPS_SCHEMA)
        properties["regime_factor_ranges"] = dict(_REGIME_FACTOR_RANGES_SCHEMA_SPARSE)
    properties["optimization_strategy"] = {"type": "STRING"}
    properties["performance_assessment"] = {"type": "STRING"}
    required = ["round_setup"]
    if include_regime_matrix:
        required.append("regime_setups")
    if require_rationale:
        properties["rationale"] = {"type": "STRING"}
        required.append("rationale")
    return {
        "type": "OBJECT",
        "properties": properties,
        "required": required,
    }


_ROUND_SEED_OUTPUT_TOKEN_CEILING = 16384

_ROUND_SEED_PERFORMANCE_ASSESSMENT_RULES = """
performance_assessment (required): 2–3 sentences, objective outcome quality only (not search plan).
Use CHAMPION / VS_BENCHMARK / PRIOR_ROUND_* / TARGET / REFINEMENT_BUDGET from learning — same metrics.
- If in-sample objective or primary metric is below benchmark (VS_BENCHMARK alpha < 0 or clearly worse
  than benchmark return/Sharpe), state plainly e.g. "本輪樣本內表現未達基準" or "results are below benchmark".
- If at or above benchmark, acknowledge modestly without hype.
- Round 1 with no prior champion: note no prior round; judge only what learning provides.
Separate from optimization_strategy (search plan only). No cheerleading."""


def _round_seed_max_output_tokens(*, attempt: int = 0) -> int:
    cap = max(512, int(settings.gemini_round_seed_max_output_tokens))
    base = min(cap, _ROUND_SEED_OUTPUT_TOKEN_CEILING)
    bump = attempt * 2048
    return min(_ROUND_SEED_OUTPUT_TOKEN_CEILING, base + bump)


def _round_seed_learning_max_chars() -> int:
    return max(800, int(settings.gemini_round_seed_learning_max_chars))


def _json_compact(obj: Any) -> str:
    return dumps_for_ai(obj)


def _fit_round_seed_block(lines: list[str], max_chars: int) -> str:
    """Fit learning block by dropping whole trailing sections (no mid-field ellipsis)."""
    while lines:
        block = "\n".join(lines)
        if len(block) <= max_chars:
            return block
        lines.pop()
    return ""


def _weight_summary_line(learning_context: dict[str, Any]) -> str | None:
    champ = learning_context.get("champion")
    wh = None
    if isinstance(champ, dict):
        wh = champ.get("weight_history_summary")
    if not isinstance(wh, dict) or not wh:
        cr = learning_context.get("champion_research")
        if isinstance(cr, dict):
            wh = cr.get("weight_history")
    if not isinstance(wh, dict) or not wh:
        return None
    top = wh.get("top_holdings_latest") or []
    snaps = wh.get("rebalance_snapshots")
    latest_date = wh.get("latest_rebalance_date")
    parts = []
    if snaps is not None:
        parts.append(f"snapshots={snaps}")
    if latest_date:
        parts.append(f"latest={latest_date}")
    if top:
        holdings = ",".join(
            f"{h.get('ticker')}:{h.get('weight_pct')}%"
            for h in top[:6]
            if isinstance(h, dict) and h.get("ticker")
        )
        if holdings:
            parts.append(f"top={holdings}")
    return " ".join(parts) if parts else _json_compact(wh)


def _round_seed_budget_lines(learning_context: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    ri = learning_context.get("round_index") or learning_context.get("round_number")
    total = learning_context.get("total_rounds")
    tpr = learning_context.get("trials_per_round")
    budget = learning_context.get("total_trial_budget")
    if ri is not None and (total is not None or tpr is not None):
        lines.append(
            "REFINEMENT_BUDGET "
            + _json_compact(
                {
                    "round": ri,
                    "total_rounds": total,
                    "trials_this_round": tpr,
                    "total_trial_budget": budget,
                }
            )
        )
    phase = learning_context.get("exploration_phase")
    if phase:
        lines.append(f"EXPLORATION_PHASE {phase}")
    target = learning_context.get("target_adjusted_score")
    if target is not None:
        lines.append(
            f"TARGET_IS_OBJECTIVE {_format_ai_number(target, key='target_adjusted_score')}"
        )
    return lines


def round_seed_factor_range_guidance(
    *,
    exploration_phase: str,
    round_index: int,
    total_rounds: int,
) -> str:
    """Prompt text: wide multi-key explore vs gradual narrow (unit-testable)."""
    phase = (exploration_phase or "explore").strip().lower()
    ri = max(1, int(round_index))
    total = max(1, int(total_rounds))
    all_keys = ", ".join(FACTOR_NUMERIC_KEYS)
    if phase == "explore" or ri <= 1:
        return (
            f"factor_ranges: include EVERY allowed numeric key ({all_keys}) with WIDE "
            "[low, high] intervals (meaningful slice of global bounds — not tight bands "
            "around one scalar). Round 1 / explore phase: do NOT narrow toward a single "
            "champion guess; breadth beats precision. Server fills any omitted key from "
            "defaults, but you must still output all keys."
        )
    if phase == "narrow":
        return (
            f"factor_ranges: include ALL keys ({all_keys}); narrow intervals on keys that "
            "showed sensitivity in PRIOR_FACTOR_RANGES, CHAMPION params, or FAILED_TRIALS; "
            "keep other keys moderately wide inside global bounds."
        )
    return (
        f"factor_ranges: include ALL keys ({all_keys}); moderately narrow bands on "
        "champion-linked factors, wider bands on the rest when trial budget allows."
    )


def round_seed_regime_factor_range_guidance(
    *,
    exploration_phase: str,
    round_index: int,
    total_rounds: int,
) -> str:
    """Prompt text for per-regime factor_ranges when dynamic objective + regime matrix."""
    regimes = ", ".join(REGIME_KEYS)
    focus_keys = ", ".join(FACTOR_NUMERIC_KEYS)
    return (
        f"regime_factor_ranges (REQUIRED for dynamic): nested map keyed by {regimes}. "
        f"Each slice: 2–4 FOCUS numeric keys only ({focus_keys}) where that regime "
        "differs from defaults — server completes ALL omitted keys per regime from global "
        "bounds (same as sparse factor_ranges). Do NOT enumerate every key × 3 regimes. "
        "Omit a regime slice when defaults apply (especially neutral). "
        "Risk-off may favor defensive/low-vol bands; risk-on may allow higher momentum/trend. "
        "Do NOT use top-level factor_ranges when regime_factor_ranges is present."
    )


def _failed_trial_lines(failed: list[dict[str, Any]], limit: int = 5) -> list[str]:
    out: list[str] = []
    for row in failed[:limit]:
        if not isinstance(row, dict):
            continue
        gap = row.get("gap_to_beat", row.get("gap_objective", row.get("gap_sharpe")))
        risk = row.get("risk_level", row.get("overfitting_risk"))
        params = str(row.get("params_summary", "")).strip()
        gap_s = _format_ai_number(gap, key="gap_to_beat")
        out.append(
            f"- gap={gap_s} risk={risk} params={params}"
        )
    return out


def _build_round_seed_learning_block(learning_context: dict[str, Any]) -> str:
    """Structured Pro round context for generate_ai_round_seed (budget-aware)."""
    round_index = int(
        learning_context.get("round_index")
        or learning_context.get("round_number")
        or 1
    )

    max_chars = _round_seed_learning_max_chars()
    lines: list[str] = list(_round_seed_budget_lines(learning_context))

    if round_index <= 1:
        return _fit_round_seed_block(lines, max_chars)

    prev_setup = learning_context.get("prior_round_setup")
    if isinstance(prev_setup, dict) and prev_setup:
        lines.append("PRIOR_ROUND_SETUP " + _json_compact(prev_setup))

    prev_ranges = learning_context.get("prior_factor_ranges")
    if isinstance(prev_ranges, dict) and prev_ranges:
        lines.append("PRIOR_FACTOR_RANGES " + _json_compact(prev_ranges))

    prev_choices = learning_context.get("prior_factor_choices")
    if isinstance(prev_choices, dict) and prev_choices:
        lines.append(
            "PRIOR_FACTOR_CHOICES "
            + _json_compact(_sanitize_prompt_dict(prev_choices))
        )

    prev_regimes = learning_context.get("prior_regime_setups")
    if isinstance(prev_regimes, dict) and prev_regimes:
        lines.append("PRIOR_REGIME_SETUPS " + _json_compact(prev_regimes))

    prev_regime_factors = learning_context.get("prior_regime_factor_ranges")
    if isinstance(prev_regime_factors, dict) and prev_regime_factors:
        lines.append(
            "PRIOR_REGIME_FACTOR_RANGES "
            + _json_compact(_sanitize_prompt_dict(prev_regime_factors))
        )

    champ = learning_context.get("champion")
    champ_params = learning_context.get("champion_record_params")
    champ_m = learning_context.get("champion_record_metrics")
    model_code = learning_context.get("champion_model_code")
    if isinstance(champ_params, dict) and not model_code:
        model_code = champ_params.get("model_code")
    if isinstance(champ, dict) or model_code or isinstance(champ_params, dict):
        assess: dict[str, Any] = {}
        if isinstance(champ_m, dict):
            assess = champ_m.get("overfitting_assessment") or {}
        outputs = (
            champ.get("outputs_summary")
            if isinstance(champ, dict) and isinstance(champ.get("outputs_summary"), dict)
            else {}
        )
        is_obj = (
            champ.get("in_sample_objective")
            if isinstance(champ, dict)
            else None
        )
        if is_obj is None and isinstance(champ_m, dict):
            is_obj = champ_m.get("objective_value_is")
        sharpe = (
            champ.get("train_sharpe")
            if isinstance(champ, dict)
            else None
        )
        if sharpe is None and isinstance(champ_m, dict):
            sharpe = champ_m.get("sharpe")
        cagr = outputs.get("cagr") if outputs else (
            champ_m.get("cagr") if isinstance(champ_m, dict) else None
        )
        mdd = outputs.get("max_drawdown") if outputs else (
            champ_m.get("max_drawdown") if isinstance(champ_m, dict) else None
        )
        champ_lines = ["CHAMPION:"]
        if model_code:
            champ_lines.append(f"  model_code={model_code}")
        champ_lines.append(
            "  IS metrics: sharpe={sh} cagr={cg} mdd={mdd} objective_value_is={obj}".format(
                sh=_format_ai_number(sharpe, key="sharpe"),
                cg=_format_ai_number(cagr, key="cagr"),
                mdd=_format_ai_number(mdd, key="max_drawdown"),
                obj=_format_ai_number(is_obj, key="in_sample_objective"),
            )
        )
        if isinstance(champ, dict):
            oos_obj = champ.get("out_of_sample_objective") or assess.get(
                "out_of_sample_objective"
            )
            gap_obj = champ.get("gap_objective", champ.get("gap_sharpe"))
            if oos_obj is not None or gap_obj is not None:
                champ_lines.append(
                    "  OOS gap: holdout_objective={oos} gap_objective={gap} risk={risk}".format(
                        oos=_format_ai_number(oos_obj, key="out_of_sample_objective"),
                        gap=_format_ai_number(gap_obj, key="gap_objective"),
                        risk=champ.get("overfitting_risk"),
                    )
                )
        if isinstance(champ_params, dict) and champ_params:
            champ_lines.append(
                f"  params={summarize_params_for_ai(champ_params, full=True)}"
            )
        lines.append("\n".join(champ_lines))

    if isinstance(champ, dict):
        bvs = champ.get("benchmark_vs")
        if isinstance(bvs, dict):
            pvb = bvs.get("portfolio_vs_benchmark") or bvs
            if isinstance(pvb, dict) and pvb:
                lines.append(
                    "VS_BENCHMARK "
                    + _json_compact(
                        {
                            k: pvb.get(k)
                            for k in (
                                "alpha",
                                "information_ratio",
                                "beta",
                                "tracking_error",
                                "portfolio_cagr",
                                "portfolio_sharpe",
                                "benchmark_total_return_pct",
                            )
                            if pvb.get(k) is not None
                        }
                    )
                )

    weight_line = _weight_summary_line(learning_context)
    if weight_line:
        lines.append(f"WEIGHT_SUMMARY {weight_line}")

    failed = learning_context.get("failed_challengers")
    if isinstance(failed, list) and failed:
        fail_lines = _failed_trial_lines(failed, limit=5)
        if fail_lines:
            lines.append("FAILED_TRIALS:")
            lines.extend(fail_lines)

    target = learning_context.get("target_adjusted_score")
    if target is not None:
        lines.append(
            "TARGET beat champion IS objective (adjusted score) > "
            f"{_format_ai_number(target, key='target_adjusted_score')}"
        )

    mission = learning_context.get("mission")
    if mission:
        lines.append(f"MISSION {_json_compact(str(mission))}")

    return _fit_round_seed_block(lines, max_chars)


def _build_pro_round_learning_block(learning_context: dict[str, Any]) -> str:
    """Alias for round-seed learning block (Pro round 2+)."""
    return _build_round_seed_learning_block(learning_context)


def generate_ai_round_seed(
    *,
    objective: str,
    rebalance_freq: str,
    max_weight_cap: float,
    max_turnover_cap: float,
    top_n_cap: int,
    tradable_count: int,
    param_controls: dict[str, dict] | None = None,
    progress_cb: Callable[[int, int, str], None] | None = None,
    learning_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """One Gemini call per Pro round: fixed round_setup + factor_ranges + factor_choices."""
    key = settings.gemini_api_key
    empty = {
        "enabled": False,
        "model": settings.gemini_model,
        "rationale": "",
        "round_setup": {},
        "regime_setups": {},
        "regime_factor_ranges": {},
        "factor_ranges": {},
        "factor_choices": {},
        "error": "missing_api_key",
    }
    if not key:
        empty["rationale"] = "AI key not configured; fallback to Optuna search only."
        return empty

    model = settings.gemini_model
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
    blueprint = RunBlueprint(
        max_weight=float(max_weight_cap),
        max_turnover=float(max_turnover_cap),
        top_n=int(top_n_cap),
    )
    param_controls = normalize_param_controls(param_controls, blueprint)
    learning_context = learning_context or {}
    round_index = int(
        learning_context.get("round_index")
        or learning_context.get("round_number")
        or 1
    )
    learning_block = _build_round_seed_learning_block(learning_context)
    total_rounds = int(learning_context.get("total_rounds") or 1)
    exploration_phase = str(
        learning_context.get("exploration_phase") or "explore"
    ).lower()
    dynamic_matrix = is_dynamic_objective(objective) or bool(
        learning_context.get("dynamic_regime_matrix")
    )
    factor_guidance = round_seed_factor_range_guidance(
        exploration_phase=exploration_phase,
        round_index=round_index,
        total_rounds=total_rounds,
    )
    regime_factor_guidance = ""
    if dynamic_matrix:
        regime_factor_guidance = round_seed_regime_factor_range_guidance(
            exploration_phase=exploration_phase,
            round_index=round_index,
            total_rounds=total_rounds,
        )
    learning_mode = (
        "round_seed"
        if round_index > 1
        else _resolve_learning_context_mode(learning_context)
    )
    direction_plan = _get_direction_plan(
        url=url,
        objective=objective,
        rebalance_freq=rebalance_freq,
        max_weight_cap=max_weight_cap,
        max_turnover_cap=max_turnover_cap,
        top_n_cap=top_n_cap,
        tradable_count=tradable_count,
        learning_context=learning_context,
    )
    constraints_compact = (
        f"obj={objective}; reb={rebalance_freq}; "
        f"{blueprint_prompt_lines(blueprint)} "
        f"cap[max_weight]=0.05..{max_weight_cap:.4f}; "
        f"cap[max_turnover]=0.05..{max_turnover_cap:.4f}; "
        f"top_n=5..{min(top_n_cap, tradable_count)}; "
        "lookback=126..504; factor_lb=126..504; rev_lb=63..252; val_lb=63..252; "
        "shrinkage=0..0.5; risk_aversion=0.5..12; no_trade_tol=0..0.02; turnover_penalty=0.5..3; "
        "factor_weights=0..2(trend/drawdown<=1.5); class_weights=0..1"
    )
    alloc_keys = ", ".join(k for k in SETUP_PARAM_KEYS if k.startswith("w_"))
    factor_num_keys = ", ".join(FACTOR_NUMERIC_KEYS)
    factor_cat_keys = ", ".join(FACTOR_CATEGORICAL_KEYS)
    regime_alloc_keys = ", ".join(REGIME_ALLOCATOR_KEYS)
    regime_objective_hint = "; ".join(
        f"{r}→{REGIME_OBJECTIVE_MAP[r]}" for r in REGIME_KEYS
    )
    regime_block = ""
    if dynamic_matrix:
        regime_block = f"""
4) regime_setups (REQUIRED for dynamic objective) — per-regime allocator matrix keyed by
   risk_off, neutral, risk_on. Each slice uses ONLY: {regime_alloc_keys}.
   Align allocator mode/lookback with regime intent ({regime_objective_hint}).
   Simulation applies the active regime's slice at each rebalance (V2 detector).
   round_setup still holds shared caps (top_n, max_weight, class weights); do NOT duplicate
   factor keys inside regime_setups.
5) regime_factor_ranges (REQUIRED for dynamic objective) — per-regime Optuna bounds for factor
   numerics ({factor_num_keys}), keyed risk_off / neutral / risk_on. Optuna samples
   risk_off__w_mom, neutral__w_mom, etc.; simulation uses the active regime's slice each rebalance.
   {regime_factor_guidance}
   Omit top-level factor_ranges when regime_factor_ranges is present (shared factor_ranges only
   as fallback if you cannot emit the nested map).
"""

    factor_ranges_section = (
        f"2) regime_factor_ranges — see item 5 above.\n   {regime_factor_guidance}"
        if dynamic_matrix and regime_factor_guidance
        else f"""2) factor_ranges — Optuna sampling bounds for this round (see strategy below).
   Allowed numeric keys: {factor_num_keys}. Each value is [low, high] within global bounds.
   {factor_guidance}"""
    )

    prompt = f"""
You are an institutional quant research assistant.
Generate exactly ONE Pro-round seed for champion-challenger refinement.
Output the final JSON immediately; no markdown or commentary.

Architecture (critical):
1) round_setup — fixed for ALL Optuna trials this round (portfolio/model setup only).
   Required keys: mode, lookback_days, shrinkage, risk_aversion, top_n_actual, max_weight_actual,
   max_turnover_actual, no_trade_tol, turnover_penalty_mult.
   Optional asset-class quotas ({alloc_keys}): include ONLY if you materially change them from defaults.
   Do NOT put factor weights or factor lookbacks in round_setup.
   {"For dynamic objective: round_setup mode/lookback are shared defaults; per-regime allocator lives in regime_setups." if dynamic_matrix else ""}
{factor_ranges_section}
3) factor_choices — ONLY categorical indicators you fix this round; omit unchanged keys.
   Allowed keys: {factor_cat_keys}.
{regime_block}
optimization_strategy (required): 2–4 sentences (English or 中文, match rationale tone) explaining
why you chose wide vs narrow factor_ranges given REFINEMENT_BUDGET, EXPLORATION_PHASE, champion vs
benchmark (if any), and TARGET.
{_ROUND_SEED_PERFORMANCE_ASSESSMENT_RULES}

Do NOT output objective_mode or rebalance_freq (run-level fixed).
Numeric rule: at most 4 decimal places for every number; use integers for *_days and top_n_actual;
never emit long float expansions (write 0.5 not 0.5000000000000001; write 252 not 252.0000000001).
Example regime_factor_ranges (sparse — 2 focus keys, server fills rest):
{{"risk_off":{{"w_mom":[0,0.8],"w_lowvol":[0.5,1.5]}},"risk_on":{{"w_mom":[0.8,1.5],"w_trend":[0.2,1]}}}}.
Round 2+: evolve round_setup from PRIOR_ROUND_* + CHAMPION; adjust factor_ranges using evidence
(FAILED_TRIALS, VS_BENCHMARK) — start wide early, narrow gradually in late rounds near TARGET.
Round 1: wide exploration only — do NOT copy a single narrow band from defaults.

Refinement learning ({learning_mode}):
{learning_block or "(round 1 — budget above; no prior round champion block)"}

Direction blueprint:
- thesis: {direction_plan.get("thesis", "")}
- do_more: {", ".join(direction_plan.get("do_more", []))}
- do_less: {", ".join(direction_plan.get("do_less", []))}
- risk_notes: {direction_plan.get("risk_notes", "")}

Constraints: {constraints_compact}

Return STRICT JSON only (sparse — omit empty factor_choices if none):
{{"rationale":"...", "optimization_strategy":"...", "performance_assessment":"...",
"round_setup":{{...}},
{('"regime_setups":{"risk_off":{...},"neutral":{...},"risk_on":{...}},' if dynamic_matrix else "")}
{('"regime_factor_ranges":{"risk_off":{"w_mom":[lo,hi],"w_lowvol":[lo,hi]},"risk_on":{"w_mom":[lo,hi],...}},' if dynamic_matrix else '"factor_ranges":{"<2-4 focus numeric keys>":[low,high], ...},')}
"factor_choices":{{"mom_indicator":"risk_adjusted_return"}}}}
"""
    max_retries = max(1, int(settings.gemini_param_seed_max_retries))

    if progress_cb:
        progress_cb(0, 1, "Pro round: requesting AI round seed (1 Gemini call)…")

    last_error = ""
    for attempt in range(max_retries):
        compact = attempt > 0
        compact_tail = (
            '{"rationale":"...","optimization_strategy":"...","performance_assessment":"...",'
            '"round_setup":{...},'
            + (
                '"regime_setups":{"risk_off":{...},"neutral":{...},"risk_on":{...}},'
                '"regime_factor_ranges":{"risk_off":{"w_mom":[lo,hi],...},"risk_on":{...}},'
                if dynamic_matrix
                else '"factor_ranges":{...},'
            )
            + '"factor_choices":{...}}'
        )
        req_prompt = prompt if not compact else (
            prompt[:1000]
            + "\nIMPORTANT: single JSON only, max 4 decimals, omit optional alloc weights and "
            "unchanged factor_ranges/factor_choices. "
            + compact_tail
        )
        generation_config: dict[str, Any] = {
            "temperature": 0.0,
            "maxOutputTokens": _round_seed_max_output_tokens(attempt=attempt),
            "responseMimeType": "application/json",
            "responseSchema": _round_seed_response_schema(
                require_rationale=not compact,
                compact=compact,
                include_regime_matrix=dynamic_matrix,
            ),
        }
        thinking_config = _thinking_config_for_round_seed(model=model)
        if thinking_config is not None:
            generation_config["thinkingConfig"] = thinking_config
        try:
            res = httpx.post(
                url,
                json={
                    "contents": [{"parts": [{"text": req_prompt}]}],
                    "generationConfig": generation_config,
                },
                timeout=45.0,
            )
            res.raise_for_status()
            body = res.json()
            finish_reason = body.get("candidates", [{}])[0].get("finishReason", "")
            parts = (
                body.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [])
            )
            text = "".join(
                p.get("text", "") for p in parts if isinstance(p, dict)
            )
            if finish_reason == "MAX_TOKENS":
                last_error = "gemini_max_tokens"
                parsed = _extract_json(text) or _salvage_truncated_json(text)
                if not parsed:
                    continue
            else:
                parsed = _extract_json(text) or _salvage_truncated_json(text)
            if not parsed:
                last_error = "parse_failed"
                continue
            normalized = normalize_round_seed(
                sanitize_ai_response(parsed), blueprint=blueprint, param_controls=param_controls
            )
            if not normalized["round_setup"]:
                last_error = "empty_round_setup"
                continue
            if dynamic_matrix and not normalized.get("regime_setups"):
                last_error = "empty_regime_setups"
                continue
            if progress_cb:
                progress_cb(1, 1, "Pro round: AI round seed ready")
            return {
                "enabled": True,
                "model": model,
                "rationale": normalized["rationale"],
                "optimization_strategy": normalized.get("optimization_strategy", ""),
                "performance_assessment": normalized.get("performance_assessment", ""),
                "round_setup": normalized["round_setup"],
                "regime_setups": normalized.get("regime_setups") or {},
                "regime_factor_ranges": normalized.get("regime_factor_ranges") or {},
                "factor_ranges": normalized["factor_ranges"],
                "factor_choices": normalized["factor_choices"],
                "generation_mode": "pro_round_seed",
                "exploration_phase": exploration_phase,
                "error": None,
                "thinking_level": _resolve_round_seed_thinking_level(),
                "thinking_config": thinking_config,
            }
        except Exception as exc:  # noqa: BLE001
            last_error = str(exc)

    return {
        "enabled": False,
        "model": model,
        "rationale": "",
        "round_setup": {},
        "regime_setups": {},
        "regime_factor_ranges": {},
        "factor_ranges": {},
        "factor_choices": {},
        "error": last_error or "ai_round_seed_failed",
    }

