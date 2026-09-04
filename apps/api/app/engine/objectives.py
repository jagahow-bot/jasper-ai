"""Shared objective scoring for trial selection and IS/OOS reporting."""

from __future__ import annotations

from typing import Any

import numpy as np

from app.engine.asset_class_policy import class_sleeve_totals, normalize_class_budget
from app.engine.group_weights import parse_group_weight_bands

# Pro/Optuna champion metric when run objective is ``dynamic`` (not per-rebalance blend).
DYNAMIC_COMPREHENSIVE_SCORING = "dynamic_comprehensive"

BAND_TOL = 0.02
CLASS_QUOTA_TOL = 0.02


def compute_dynamic_comprehensive_score(metrics: dict[str, Any]) -> float:
    """Higher is better. Multi-metric in-sample score for dynamic Pro champion ranking.

    Formula (weights sum to 1.0 on normalized terms):
      0.45×Sharpe + 0.25×Sortino + 0.20×(5×CAGR) − 0.35×|max_drawdown| − 0.10×turnover_avg
    CAGR is scaled by 5 so ~10% annual maps near 0.5 alongside typical Sharpe levels.
    """
    sharpe = float(metrics.get("sharpe", 0.0))
    sortino = float(metrics.get("sortino", sharpe))
    cagr = float(metrics.get("cagr", 0.0))
    mdd = abs(float(metrics.get("max_drawdown", 0.0)))
    turnover = float(metrics.get("turnover_avg", 0.0))
    return (
        0.45 * sharpe
        + 0.25 * sortino
        + 0.20 * (5.0 * cagr)
        - 0.35 * mdd
        - 0.10 * turnover
    )


def compute_objective_score(objective_mode: str, metrics: dict[str, Any]) -> float:
    """Higher is better for all modes (drawdown/CVaR converted to maximization)."""
    if objective_mode == "max_return":
        return float(metrics.get("cagr", 0.0))
    if objective_mode == "min_max_drawdown":
        return -abs(float(metrics.get("max_drawdown", 0.0)))
    if objective_mode == "max_sortino":
        return float(metrics.get("sortino", 0.0))
    if objective_mode == "min_cvar":
        return float(metrics.get("cvar_95", -1.0))
    if objective_mode == "risk_parity_erc":
        return float(metrics.get("sharpe", 0.0)) - 0.25 * abs(
            float(metrics.get("max_drawdown", 0.0))
        )
    if objective_mode == "max_diversification":
        return (
            float(metrics.get("cagr", 0.0))
            - 0.35 * abs(float(metrics.get("max_drawdown", 0.0)))
            - 0.10 * float(metrics.get("turnover_avg", 0.0))
        )
    if objective_mode == "mean_variance_utility":
        return float(metrics.get("sharpe", 0.0)) - 0.15 * float(
            metrics.get("volatility", 0.0)
        )
    if objective_mode == "custom":
        return float(metrics.get("sharpe", 0.0)) - 0.2 * abs(
            float(metrics.get("max_drawdown", 0.0))
        )
    if objective_mode in (DYNAMIC_COMPREHENSIVE_SCORING, "dynamic"):
        return compute_dynamic_comprehensive_score(metrics)
    return float(metrics.get("sharpe", 0.0))


def metrics_snapshot(metrics: dict[str, Any], *, objective_mode: str) -> dict[str, Any]:
    return {
        "sharpe": round(float(metrics.get("sharpe", 0.0)), 4),
        "cagr": round(float(metrics.get("cagr", 0.0)), 4),
        "max_drawdown": round(float(metrics.get("max_drawdown", 0.0)), 4),
        "volatility": round(float(metrics.get("volatility", 0.0)), 4),
        "sortino": round(float(metrics.get("sortino", 0.0)), 4),
        "objective_value": round(compute_objective_score(objective_mode, metrics), 6),
    }


def objective_label(objective_mode: str) -> str:
    labels = {
        "max_sharpe": "Sharpe",
        "max_return": "CAGR",
        "min_max_drawdown": "Max DD (min)",
        "max_sortino": "Sortino",
        "min_cvar": "CVaR (min)",
        "risk_parity_erc": "Risk parity score",
        "max_diversification": "Diversification score",
        "mean_variance_utility": "Mean-var utility",
        "custom": "Custom score",
        "dynamic": "Dynamic (regime-based)",
        DYNAMIC_COMPREHENSIVE_SCORING: "Dynamic comprehensive score",
    }
    return labels.get(objective_mode, objective_mode)


def dynamic_comprehensive_score_summary() -> str:
    """One-line UI copy for dynamic Pro champion metric."""
    return (
        "0.45×Sharpe + 0.25×Sortino + 0.20×(5×CAGR) "
        "− 0.35×|max DD| − 0.10×turnover (in-sample, objective_value_is)"
    )


# Soft client-needs penalties. Constants sized so a typical breach reorders
# champions without acting as a hard veto.
CLIENT_NEEDS_DRAWDOWN_PENALTY = 3.0
CLIENT_NEEDS_SINGLE_NAME_PENALTY = 2.0
CLIENT_NEEDS_THEME_PENALTY = 1.5
CLIENT_NEEDS_CASH_PENALTY = 2.0
CLIENT_NEEDS_INCOME_PENALTY = 1.0

# Categories treated as concentrated "theme / growth" exposure when a theme cap is set.
_THEME_CATEGORIES = frozenset(
    {
        "us_tech",
        "us_sector",
        "tech",
        "growth",
        "nasdaq",
        "semiconductor",
        "ai",
        "us_factor",
    }
)


def _ctx_get(client_context: Any | None, key: str) -> Any:
    if not client_context:
        return None
    if isinstance(client_context, dict):
        return client_context.get(key)
    return getattr(client_context, key, None)


def _ctx_float(client_context: Any | None, key: str, *, lo: float, hi: float) -> float | None:
    raw = _ctx_get(client_context, key)
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return None
    if val < lo or val > hi:
        return None
    return val


def _drawdown_tolerance(client_context: Any | None) -> float | None:
    return _ctx_float(client_context, "max_drawdown_tolerance", lo=1e-9, hi=1.0 - 1e-9)


def _holdings_map(holdings: dict[str, float] | None) -> dict[str, float]:
    if not holdings:
        return {}
    out: dict[str, float] = {}
    for k, v in holdings.items():
        try:
            w = float(v)
        except (TypeError, ValueError):
            continue
        if w > 1e-12:
            out[str(k).upper()] = w
    return out


def _max_single_weight(holdings: dict[str, float]) -> float:
    return max(holdings.values()) if holdings else 0.0


def _cash_weight(holdings: dict[str, float], metrics: dict[str, Any]) -> float:
    if "cash_weight" in metrics:
        try:
            return max(0.0, float(metrics["cash_weight"]))
        except (TypeError, ValueError):
            pass
    invested = sum(w for t, w in holdings.items() if t != "CASH")
    if invested <= 0.0 and not holdings:
        return 0.0
    return max(0.0, 1.0 - invested)


def _theme_weight(
    holdings: dict[str, float],
    ticker_meta: dict[str, dict[str, Any]] | None,
) -> float:
    if not holdings or not ticker_meta:
        return 0.0
    total = 0.0
    for ticker, w in holdings.items():
        if ticker == "CASH":
            continue
        meta = ticker_meta.get(ticker) or ticker_meta.get(ticker.lower()) or {}
        cat = str(meta.get("category") or "").lower()
        name = str(meta.get("name") or "").lower()
        if cat in _THEME_CATEGORIES or any(
            token in cat or token in name
            for token in ("tech", "growth", "nasdaq", "semi", "qqq", "ai ")
        ):
            total += w
    return total


def _bond_income_weight(
    holdings: dict[str, float],
    ticker_meta: dict[str, dict[str, Any]] | None,
) -> float:
    if not holdings:
        return 0.0
    total = 0.0
    for ticker, w in holdings.items():
        if ticker == "CASH":
            continue
        meta = (ticker_meta or {}).get(ticker) or (ticker_meta or {}).get(ticker.lower()) or {}
        asset_class = str(meta.get("asset_class") or "").lower()
        cat = str(meta.get("category") or "").lower()
        name = str(meta.get("name") or "").lower()
        if asset_class == "bond" or any(
            token in cat or token in name
            for token in ("income", "dividend", "yield", "bond", "treasury", "tips")
        ):
            total += w
    return total


def compute_client_needs_penalty(
    metrics: dict[str, Any],
    client_context: Any | None,
    *,
    holdings: dict[str, float] | None = None,
    ticker_meta: dict[str, dict[str, Any]] | None = None,
) -> float:
    """Score deduction for breaching soft client floors (0 when all met)."""
    if not client_context:
        return 0.0
    h = _holdings_map(holdings)
    penalty = 0.0

    tolerance = _drawdown_tolerance(client_context)
    if tolerance is not None:
        breach = abs(float(metrics.get("max_drawdown", 0.0))) - tolerance
        if breach > 0.0:
            penalty += CLIENT_NEEDS_DRAWDOWN_PENALTY * breach

    single_cap = _ctx_float(client_context, "max_single_name_pct", lo=0.05, hi=0.40)
    if single_cap is not None and h:
        excess = _max_single_weight({k: v for k, v in h.items() if k != "CASH"}) - single_cap
        if excess > 0.0:
            penalty += CLIENT_NEEDS_SINGLE_NAME_PENALTY * excess

    theme_cap = _ctx_float(client_context, "theme_exposure_cap_pct", lo=0.05, hi=0.60)
    if theme_cap is not None and h and ticker_meta:
        excess = _theme_weight(h, ticker_meta) - theme_cap
        if excess > 0.0:
            penalty += CLIENT_NEEDS_THEME_PENALTY * excess

    cash_floor = _ctx_float(client_context, "cash_reserve_pct", lo=0.0, hi=0.40)
    if cash_floor is not None and cash_floor > 1e-9:
        shortfall = cash_floor - _cash_weight(h, metrics)
        if shortfall > 0.0:
            penalty += CLIENT_NEEDS_CASH_PENALTY * shortfall

    income_need = _ctx_float(client_context, "income_need_pct", lo=0.0, hi=1.0)
    if income_need is not None and income_need > 1e-9 and h:
        # Prefer portfolio TTM yield when available; else bond/income sleeve weight.
        port_yield = metrics.get("portfolio_ttm_yield")
        if port_yield is not None:
            try:
                shortfall = income_need - float(port_yield)
            except (TypeError, ValueError):
                shortfall = 0.0
        else:
            shortfall = income_need - _bond_income_weight(h, ticker_meta)
        if shortfall > 0.0:
            penalty += CLIENT_NEEDS_INCOME_PENALTY * shortfall

    return float(penalty)


def needs_attainment(
    metrics: dict[str, Any],
    client_context: Any | None,
    *,
    holdings: dict[str, float] | None = None,
    ticker_meta: dict[str, dict[str, Any]] | None = None,
    must_include_tickers: list[str] | None = None,
    anchor_weights: dict[str, float] | None = None,
    customization_drift: float | None = None,
    class_budget: dict[str, float] | None = None,
) -> dict[str, Any] | None:
    """Per-portfolio client-floor checks for result reporting; None when no floors."""
    if (
        not client_context
        and not must_include_tickers
        and not anchor_weights
        and not class_budget
    ):
        return None
    h = _holdings_map(holdings)
    checks: dict[str, Any] = {}
    any_floor = False

    tolerance = _drawdown_tolerance(client_context) if client_context else None
    if tolerance is not None:
        any_floor = True
        mdd = abs(float(metrics.get("max_drawdown", 0.0)))
        breach = max(0.0, mdd - tolerance)
        checks["max_drawdown_tolerance"] = round(tolerance, 4)
        checks["max_drawdown_actual"] = round(mdd, 4)
        checks["within_drawdown_tolerance"] = breach <= 1e-9
        checks["drawdown_breach_pct"] = round(breach, 4)

    single_cap = (
        _ctx_float(client_context, "max_single_name_pct", lo=0.05, hi=0.40)
        if client_context
        else None
    )
    if single_cap is not None:
        any_floor = True
        actual = _max_single_weight({k: v for k, v in h.items() if k != "CASH"}) if h else 0.0
        excess = max(0.0, actual - single_cap)
        checks["max_single_name_pct"] = round(single_cap, 4)
        checks["max_single_name_actual"] = round(actual, 4)
        checks["within_single_name_cap"] = excess <= 1e-9

    theme_cap = (
        _ctx_float(client_context, "theme_exposure_cap_pct", lo=0.05, hi=0.60)
        if client_context
        else None
    )
    if theme_cap is not None:
        any_floor = True
        actual = _theme_weight(h, ticker_meta) if h else 0.0
        excess = max(0.0, actual - theme_cap)
        checks["theme_exposure_cap_pct"] = round(theme_cap, 4)
        checks["theme_exposure_actual"] = round(actual, 4)
        checks["within_theme_cap"] = excess <= 1e-9

    cash_floor = (
        _ctx_float(client_context, "cash_reserve_pct", lo=0.0, hi=0.40)
        if client_context
        else None
    )
    if cash_floor is not None and cash_floor > 1e-9:
        any_floor = True
        actual = _cash_weight(h, metrics)
        shortfall = max(0.0, cash_floor - actual)
        checks["cash_reserve_pct"] = round(cash_floor, 4)
        checks["cash_weight_actual"] = round(actual, 4)
        checks["within_cash_reserve"] = shortfall <= 1e-9

    income_need = (
        _ctx_float(client_context, "income_need_pct", lo=0.0, hi=1.0)
        if client_context
        else None
    )
    if income_need is not None and income_need > 1e-9:
        any_floor = True
        port_yield = metrics.get("portfolio_ttm_yield")
        if port_yield is not None:
            try:
                actual = float(port_yield)
            except (TypeError, ValueError):
                actual = _bond_income_weight(h, ticker_meta) if h else 0.0
        else:
            actual = _bond_income_weight(h, ticker_meta) if h else 0.0
        shortfall = max(0.0, income_need - actual)
        checks["income_need_pct"] = round(income_need, 4)
        checks["income_actual"] = round(actual, 4)
        checks["within_income_need"] = shortfall <= 1e-9

    must = [str(t).upper() for t in (must_include_tickers or []) if str(t).strip()]
    if must:
        any_floor = True
        missing = [t for t in must if float(h.get(t, 0.0)) <= 1e-8]
        checks["must_include_tickers"] = must
        checks["missing_must_include"] = missing
        checks["within_must_include"] = len(missing) == 0

    if anchor_weights:
        any_floor = True
        # Run-level slider ceiling (BacktestRequest.customization_drift default 0.5).
        drift_cap = (
            float(customization_drift)
            if customization_drift is not None
            else 0.5
        )

        def _aw(k: str) -> float:
            if k in anchor_weights:
                return float(anchor_weights[k] or 0.0)
            for ak, av in anchor_weights.items():
                if str(ak).upper() == k:
                    return float(av or 0.0)
            return 0.0

        keys = sorted(
            ({str(k).upper() for k in anchor_weights} | {str(k).upper() for k in h if k != "CASH"})
        )
        a_tot = sum(_aw(k) for k in keys)
        l1 = 0.0
        for k in keys:
            a_w = _aw(k) / a_tot if a_tot > 1e-12 else 0.0
            l1 += abs(float(h.get(k, 0.0)) - a_w)
        l1 *= 0.5
        checks["customization_drift_cap"] = round(drift_cap, 4)
        checks["customization_drift_l1"] = round(float(l1), 4)
        checks["within_customization_drift"] = float(l1) <= drift_cap + 1e-4

    bands = (
        parse_group_weight_bands(_ctx_get(client_context, "group_weight_bands"))
        if client_context
        else []
    )
    if bands:
        any_floor = True
        band_rows: list[dict[str, Any]] = []
        for b in bands:
            members = set(b.tickers)
            actual = sum(float(w) for t, w in h.items() if t in members)
            lo, hi = b.min_pct, b.max_pct
            if lo is None and hi is None and b.target_pct is not None:
                lo = float(b.target_pct) - BAND_TOL
                hi = float(b.target_pct) + BAND_TOL
            within = (lo is None or actual >= float(lo) - 1e-9) and (
                hi is None or actual <= float(hi) + 1e-9
            )
            band_rows.append(
                {
                    "group_id": b.group_id,
                    "target_pct": (
                        round(float(b.target_pct), 4) if b.target_pct is not None else None
                    ),
                    "min_pct": round(float(lo), 4) if lo is not None else None,
                    "max_pct": round(float(hi), 4) if hi is not None else None,
                    "actual_pct": round(actual, 4),
                    "within_band": within,
                }
            )
        checks["group_bands"] = band_rows
        checks["within_group_bands"] = all(r["within_band"] for r in band_rows)

    budget = normalize_class_budget(class_budget)
    if budget and ticker_meta is not None:
        any_floor = True
        invested = {t: float(w) for t, w in h.items() if t != "CASH"}
        tot = sum(invested.values()) or 1.0
        tickers = list(invested.keys())
        w_vec = np.asarray([invested[t] / tot for t in tickers], dtype=float)
        totals = class_sleeve_totals(w_vec, tickers, ticker_meta)
        rows: list[dict[str, Any]] = []
        for ac, target in budget.items():
            actual = float(totals.get(ac, 0.0))
            rows.append(
                {
                    "asset_class": ac,
                    "target_pct": round(float(target), 4),
                    "actual_pct": round(actual, 4),
                    "within_class_quota": abs(actual - float(target)) <= CLASS_QUOTA_TOL,
                }
            )
        checks["class_quotas"] = rows
        checks["within_class_quotas"] = all(r["within_class_quota"] for r in rows)

    if not any_floor:
        return None

    floors = [
        checks.get("within_drawdown_tolerance"),
        checks.get("within_single_name_cap"),
        checks.get("within_theme_cap"),
        checks.get("within_cash_reserve"),
        checks.get("within_income_need"),
        checks.get("within_must_include"),
        checks.get("within_customization_drift"),
        checks.get("within_group_bands"),
        checks.get("within_class_quotas"),
    ]
    present = [x for x in floors if x is not None]
    checks["all_floors_met"] = bool(present) and all(present)
    return checks


def _needs_score(attainment: dict[str, Any] | None) -> float:
    if not attainment:
        return 0.0
    keys = (
        "within_drawdown_tolerance",
        "within_single_name_cap",
        "within_theme_cap",
        "within_cash_reserve",
        "within_income_need",
        "within_must_include",
        "within_customization_drift",
        "within_group_bands",
        "within_class_quotas",
    )
    vals = [1.0 if attainment.get(k) else 0.0 for k in keys if k in attainment]
    return float(sum(vals) / len(vals)) if vals else 0.0


# Display-aligned tolerances: Sharpe ~3dp, CAGR/MDD ~2dp of percent.
_METRIC_EPS_SHARPE = 5e-4
_METRIC_EPS_CAGR = 5e-5
_METRIC_EPS_MDD = 5e-5
_WEIGHT_ROUND = 4


def weights_signature(weights: dict[str, Any] | None, *, ndigits: int = _WEIGHT_ROUND) -> str | None:
    """Stable rounded holdings signature, or None when weights are missing/empty."""
    if not isinstance(weights, dict) or not weights:
        return None
    parts: list[str] = []
    for ticker, raw in sorted(weights.items(), key=lambda kv: str(kv[0]).upper()):
        try:
            w = float(raw)
        except (TypeError, ValueError):
            continue
        if abs(w) < 10 ** (-(ndigits + 1)):
            continue
        parts.append(f"{str(ticker).upper()}:{round(w, ndigits):.{ndigits}f}")
    return "|".join(parts) if parts else None


def portfolios_near_identical(
    a: dict[str, Any],
    b: dict[str, Any],
    *,
    sharpe_eps: float = _METRIC_EPS_SHARPE,
    cagr_eps: float = _METRIC_EPS_CAGR,
    mdd_eps: float = _METRIC_EPS_MDD,
) -> bool:
    """True when two proposal candidates are the same portfolio for RM comparison.

    Exact rounded-weight matches are clones. Distinct holdings stay distinct even
    when headline metrics are close. Metrics (and needs floor score) are used only
    when either side lacks a weight signature.
    """
    wa = a.get("_weights_sig")
    wb = b.get("_weights_sig")
    if wa and wb:
        return wa == wb
    if abs(float(a.get("sharpe", 0.0)) - float(b.get("sharpe", 0.0))) > sharpe_eps:
        return False
    if abs(float(a.get("cagr", 0.0)) - float(b.get("cagr", 0.0))) > cagr_eps:
        return False
    if abs(float(a.get("max_drawdown", 0.0)) - float(b.get("max_drawdown", 0.0))) > mdd_eps:
        return False
    return float(a.get("needs_score", 0.0)) == float(b.get("needs_score", 0.0))


def dedupe_proposal_candidates(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep champion/earlier rows; drop later near-identical clones."""
    kept: list[dict[str, Any]] = []
    for row in rows:
        if any(portfolios_near_identical(row, prev) for prev in kept):
            continue
        kept.append(row)
    return kept


def pick_pareto_proposals(
    candidates: list[dict[str, Any]],
    *,
    max_n: int = 3,
    champion_code: str | None = None,
) -> list[dict[str, Any]]:
    """Select up to ``max_n`` non-dominated trade-off proposals for RM comparison.

    Axes (higher better): objective_score, -|max_drawdown|, needs_score.
    Near-identical portfolios (same weights or same headline metrics) are collapsed
    before the Pareto pick so clones are not labeled as alternatives.
    """
    if not candidates:
        return []

    rows: list[dict[str, Any]] = []
    for c in candidates:
        code = str(c.get("model_code") or "")
        if not code:
            continue
        mdd = abs(float(c.get("max_drawdown", 0.0)))
        obj = c.get("objective_score")
        if obj is None:
            obj = float(c.get("sharpe", 0.0))
        attainment = c.get("needs_attainment")
        raw_weights = c.get("weights")
        rows.append(
            {
                "model_code": code,
                "sharpe": float(c.get("sharpe", 0.0)),
                "cagr": float(c.get("cagr", 0.0)),
                "max_drawdown": float(c.get("max_drawdown", 0.0)),
                "objective_score": float(obj),
                "needs_score": _needs_score(attainment if isinstance(attainment, dict) else None),
                "needs_attainment": attainment if isinstance(attainment, dict) else None,
                "is_champion": bool(c.get("is_champion")) or code == champion_code,
                "_mdd_neg": -mdd,
                "_weights_sig": weights_signature(
                    raw_weights if isinstance(raw_weights, dict) else None
                ),
            }
        )
    if not rows:
        return []

    # Champion first so duplicates of the recommended card are dropped.
    rows.sort(
        key=lambda r: (
            not r["is_champion"],
            abs(r["max_drawdown"]),
            -r["objective_score"],
            -r["needs_score"],
            r["model_code"],
        )
    )
    rows = dedupe_proposal_candidates(rows)

    def dominates(a: dict[str, Any], b: dict[str, Any]) -> bool:
        axes_a = (a["objective_score"], a["_mdd_neg"], a["needs_score"])
        axes_b = (b["objective_score"], b["_mdd_neg"], b["needs_score"])
        ge = all(x >= y for x, y in zip(axes_a, axes_b))
        gt = any(x > y for x, y in zip(axes_a, axes_b))
        return ge and gt

    front = [r for r in rows if not any(dominates(o, r) for o in rows if o is not r)]
    if not front:
        front = list(rows)

    # Prefer champion, then lowest MDD, then highest objective.
    front.sort(
        key=lambda r: (
            not r["is_champion"],
            abs(r["max_drawdown"]),
            -r["objective_score"],
            -r["needs_score"],
        )
    )
    selected = front[: max(1, int(max_n))]

    # Canonical recommendation = search/AI champion, even when dominated on
    # Pareto axes (needs/MDD). Never let a non-champion steal the recommended slot.
    champ = next((r for r in rows if r["is_champion"]), None)
    if champ is not None and champ["model_code"] not in {
        r["model_code"] for r in selected
    }:
        selected = [champ, *[r for r in selected if r["model_code"] != champ["model_code"]]]
        selected = selected[: max(1, int(max_n))]
    if champ is None:
        champ = next((r for r in selected if r["is_champion"]), selected[0])

    # Ensure diversity labels: recommended / defensive / growth
    ordered: list[dict[str, Any]] = []
    ordered.append(champ)
    defensive = min(selected, key=lambda r: abs(r["max_drawdown"]))
    growth = max(selected, key=lambda r: r["objective_score"])
    for extra in (defensive, growth):
        if extra["model_code"] not in {r["model_code"] for r in ordered}:
            ordered.append(extra)
        if len(ordered) >= max_n:
            break
    for r in selected:
        if r["model_code"] not in {x["model_code"] for x in ordered}:
            ordered.append(r)
        if len(ordered) >= max_n:
            break

    out: list[dict[str, Any]] = []
    used_labels: set[str] = set()
    champ_code = champ["model_code"]
    for r in ordered:
        is_rec = r["model_code"] == champ_code
        if is_rec:
            label = "recommended"
        elif "defensive" not in used_labels and (
            r is defensive or r["model_code"] == defensive["model_code"]
        ):
            label = "defensive"
        elif "growth" not in used_labels and (
            r is growth or r["model_code"] == growth["model_code"]
        ):
            label = "growth"
        else:
            # Human-facing "其他方案" / Alternative — never raw ALTERNATIVE_N.
            label = "alternative"
        used_labels.add(label)
        out.append(
            {
                "model_code": r["model_code"],
                "label": label,
                "is_recommended": is_rec,
                "sharpe": round(r["sharpe"], 4),
                "cagr": round(r["cagr"], 4),
                "max_drawdown": round(r["max_drawdown"], 4),
                "objective_score": round(r["objective_score"], 6),
                "needs_attainment": r["needs_attainment"],
            }
        )
    return out
