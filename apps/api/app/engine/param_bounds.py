"""Run-level ceilings and param_controls resolution for Optuna / AI / backtest."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

# Trial keys capped by run-level sliders on BacktestRequest.
RUN_CEILING_KEYS: dict[str, str] = {
    "max_weight_actual": "max_weight",
    "max_turnover_actual": "max_turnover",
    "top_n_actual": "top_n",
}

_NUMERIC_FLOOR: dict[str, float] = {
    "max_weight_actual": 0.05,
    "max_turnover_actual": 0.05,
}


@dataclass(frozen=True)
class RunBlueprint:
    max_weight: float
    max_turnover: float
    top_n: int | None

    @classmethod
    def from_request(cls, req: Any) -> RunBlueprint:
        top_n = None if req.top_n is None else int(req.top_n)
        return cls(
            max_weight=float(req.max_weight),
            max_turnover=float(req.max_turnover),
            top_n=top_n,
        )

    def ceiling(self, param_key: str) -> float | int | None:
        run_field = RUN_CEILING_KEYS.get(param_key)
        if run_field is None:
            return None
        if run_field == "max_weight":
            return float(self.max_weight)
        if run_field == "max_turnover":
            return float(self.max_turnover)
        if run_field == "top_n":
            return int(self.top_n) if self.top_n is not None else None
        return None

    def off_default(self, param_key: str) -> float | int | None:
        """When param_controls mode is off, use run slider (not zero / full search)."""
        return self.ceiling(param_key)


def normalize_param_controls(
    param_controls: dict[str, dict] | None,
    blueprint: RunBlueprint,
) -> dict[str, dict]:
    """Off on ceiling keys → fixed at run value; cap search max to run ceiling."""
    base = dict(param_controls or {})
    for key in RUN_CEILING_KEYS:
        c = dict(base.get(key) or {})
        mode = str(c.get("mode", "search"))
        ceiling = blueprint.ceiling(key)
        if ceiling is None:
            continue
        if mode == "off":
            c["mode"] = "fixed"
            c["fixed"] = float(ceiling) if key != "top_n_actual" else int(ceiling)
        elif mode == "search":
            hi = c.get("max")
            if hi is None:
                c["max"] = ceiling
            else:
                if key == "top_n_actual":
                    c["max"] = int(min(int(hi), int(ceiling)))
                else:
                    c["max"] = float(min(float(hi), float(ceiling)))
            lo = c.get("min")
            floor = _NUMERIC_FLOOR.get(key, 0.0)
            if lo is not None and key != "top_n_actual":
                c["min"] = float(max(float(lo), floor))
        elif mode == "fixed" and c.get("fixed") is not None:
            if key == "top_n_actual":
                c["fixed"] = int(min(int(float(c["fixed"])), int(ceiling)))
            else:
                c["fixed"] = float(min(float(c["fixed"]), float(ceiling)))
                if key in _NUMERIC_FLOOR:
                    c["fixed"] = float(max(c["fixed"], _NUMERIC_FLOOR[key]))
        base[key] = c
    return base


def cap_search_high(
    param_key: str,
    default_high: float | int,
    blueprint: RunBlueprint,
    control: dict | None,
) -> float | int:
    ceiling = blueprint.ceiling(param_key)
    high = default_high
    if control:
        if control.get("max") is not None:
            high = control["max"]
    if ceiling is not None:
        if isinstance(ceiling, int):
            high = int(min(int(high), int(ceiling)))
        else:
            high = float(min(float(high), float(ceiling)))
    return high


def cap_search_low(
    param_key: str,
    default_low: float | int,
    control: dict | None,
) -> float | int:
    low = default_low
    if control and control.get("min") is not None:
        low = control["min"]
    floor = _NUMERIC_FLOOR.get(param_key)
    if floor is not None and param_key != "top_n_actual":
        low = float(max(float(low), floor))
    return low


def resolve_control_mode(control: dict | None) -> str:
    if not control:
        return "search"
    return str(control.get("mode", "search"))


def resolve_off_value(
    param_key: str,
    blueprint: RunBlueprint,
    control: dict | None,
    *,
    default_low: float | int,
) -> float | int | None:
    """Return fixed value for off mode; None means caller should use generic default."""
    run_default = blueprint.off_default(param_key)
    if run_default is not None:
        return run_default
    if control and control.get("fixed") is not None:
        try:
            if param_key == "top_n_actual":
                return int(control["fixed"])
            return float(control["fixed"])
        except (TypeError, ValueError):
            pass
    return None


def clamp_param_dict(
    params: dict[str, Any],
    blueprint: RunBlueprint,
    *,
    param_controls: dict[str, dict] | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Clip trial/AI params to run ceilings; return violations for audit."""
    out = dict(params)
    violations: list[dict[str, Any]] = []
    controls = param_controls or {}

    for key, run_field in RUN_CEILING_KEYS.items():
        if key not in out and key not in controls:
            continue
        ceiling = blueprint.ceiling(key)
        if ceiling is None:
            continue
        raw = out.get(key)
        if raw is None:
            continue
        try:
            if key == "top_n_actual":
                val = int(raw)
                capped = int(min(val, int(ceiling)))
                floor = int(_NUMERIC_FLOOR.get(key, 1))
                capped = int(max(capped, floor))
            else:
                val = float(raw)
                cap_f = float(ceiling)
                floor = float(_NUMERIC_FLOOR.get(key, 0.0))
                capped = float(np.clip(val, floor, cap_f))
        except (TypeError, ValueError):
            continue
        if capped != val:
            violations.append(
                {
                    "param": key,
                    "raw": val,
                    "clipped": capped,
                    "ceiling": ceiling,
                }
            )
        out[key] = capped

    if "max_weight_actual" in out or "max_weight_actual" in controls:
        eff = out.get("max_weight_actual")
        if eff is not None:
            try:
                out["max_weight_actual"] = float(
                    min(float(eff), float(blueprint.max_weight))
                )
            except (TypeError, ValueError):
                out["max_weight_actual"] = float(blueprint.max_weight)

    return out, violations


def blueprint_prompt_lines(blueprint: RunBlueprint) -> str:
    top_n_line = (
        f"top_n_actual<={blueprint.top_n}"
        if blueprint.top_n is not None
        else "top_n_actual unconstrained (all eligible assets)"
    )
    return (
        f"HARD CEILINGS (never exceed): max_weight_actual<={blueprint.max_weight:.4f}; "
        f"max_turnover_actual<={blueprint.max_turnover:.4f}; "
        f"{top_n_line}. "
        "Run sliders are authoritative; search only within [floor, ceiling]."
    )
