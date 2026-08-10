"""Constrained Customization Mode — small named weight scenarios for RM client books.

When customizing an existing client/anchor portfolio the searchable universe is
already locked and Overlay rarely adds many names. Running full Pro multi-round
or large AI/Optuna random search wastes trials and produces near-duplicate books.

Instead we evaluate 2–4 **named, optimizer-based** scenarios on the fixed universe:

1. ``anchor_close`` — stay well inside the customization_drift ceiling
2. ``full_drift`` — push the primary objective using the full drift budget
3. ``defensive`` — min-variance / drawdown-oriented allocation
4. ``theme`` — only when must-include / overlay adds exist

Trigger thresholds (documented here; tune carefully):
- ``MAX_TRADABLE_FOR_CONSTRAINED`` = 20 — locked model books are typically ≤ this
- ``MAX_OVERLAY_SUPPLEMENTS_FOR_CONSTRAINED`` = 8 — overlay rarely adds more names

Mode enables when ``anchor_weights`` is present AND the universe is small
(tradable ≤ 20 OR must-include/supplements ≤ 8), and preferably an RM
customization signal exists (locked ``universe_tickers``, ``client_ref``,
``client_context``, or ``anchor_job_id`` / ``anchor_portfolio_id``).
Static replay jobs never enter this path.
"""

from __future__ import annotations

from typing import Any

from app.engine.customization import (
    derive_must_include_tickers,
    min_holdings_for_customization,
)
from app.engine.objectives import _needs_score, weights_signature
from app.engine.weights import feasible_max_weight

# Locked client books rarely exceed ~15–20 names; above this, full search stays useful.
MAX_TRADABLE_FOR_CONSTRAINED = 20
# Overlay confirmed adds are usually a handful; many adds → treat as open-ish search.
MAX_OVERLAY_SUPPLEMENTS_FOR_CONSTRAINED = 8

# User-facing proposal_set labels (i18n keys on the web: results.proposalLabel.*).
SCENARIO_STYLES = ("anchor_close", "full_drift", "defensive", "theme")


def _locked_universe_count(req: Any) -> int | None:
    tickers = getattr(req, "universe_tickers", None) or None
    if not tickers:
        return None
    return len([t for t in tickers if str(t).strip()])


def _has_rm_customization_signal(req: Any) -> bool:
    """Prefer RM personalization path when any of these are set."""
    if getattr(req, "universe_tickers", None):
        return True
    if (getattr(req, "client_ref", None) or "").strip():
        return True
    if getattr(req, "client_context", None) is not None:
        return True
    if getattr(req, "anchor_job_id", None) or getattr(req, "anchor_portfolio_id", None):
        return True
    return False


def should_use_constrained_customization(
    req: Any,
    *,
    tradable_count: int | None = None,
    must_include_count: int | None = None,
) -> bool:
    """Return True when the engine should skip Pro / large AI search.

    Requires ``anchor_weights``. Universe must be small by tradable count and/or
    overlay-supplement count. Prefers an RM customization signal when present;
    if neither locked whitelist nor client signals exist, still allows the mode
    when the live tradable pool is clearly small (≤ threshold).
    """
    if getattr(req, "static_replay_holdings", None):
        return False
    anchor = getattr(req, "anchor_weights", None)
    if not anchor:
        return False

    n_tradable = int(tradable_count) if tradable_count is not None else _locked_universe_count(req)
    if n_tradable is None:
        return False

    if must_include_count is None:
        supplements = getattr(req, "universe_supplement_tickers", None) or []
        # Prefer explicit must-include derivation when tradable list is known via whitelist.
        whitelist = list(getattr(req, "universe_tickers", None) or [])
        if whitelist and anchor:
            must_include_count = len(
                derive_must_include_tickers(whitelist, dict(anchor))
            )
        else:
            # Fallback: supplements that are not in the anchor book.
            anchor_pos = {
                str(k).upper()
                for k, v in dict(anchor).items()
                if float(v or 0.0) > 1e-12
            }
            must_include_count = len(
                {
                    str(t).upper()
                    for t in supplements
                    if str(t).upper() not in anchor_pos and str(t).upper() != "CASH"
                }
            )

    small_tradable = n_tradable <= MAX_TRADABLE_FOR_CONSTRAINED
    small_overlay = int(must_include_count) <= MAX_OVERLAY_SUPPLEMENTS_FOR_CONSTRAINED
    if not (small_tradable or small_overlay):
        return False

    # Prefer RM path; allow pure small-universe + anchor without client_ref.
    if _has_rm_customization_signal(req):
        return True
    return small_tradable and n_tradable <= MAX_TRADABLE_FOR_CONSTRAINED


def estimate_constrained_trial_count(req: Any) -> int | None:
    """Pre-flight trial estimate for job progress (request fields only).

    Returns None when the request does not look constrained.
    """
    if not should_use_constrained_customization(req):
        return None
    must_n = 0
    anchor = getattr(req, "anchor_weights", None) or {}
    whitelist = list(getattr(req, "universe_tickers", None) or [])
    if whitelist and anchor:
        must_n = len(derive_must_include_tickers(whitelist, dict(anchor)))
    else:
        supplements = getattr(req, "universe_supplement_tickers", None) or []
        anchor_pos = {
            str(k).upper()
            for k, v in dict(anchor).items()
            if float(v or 0.0) > 1e-12
        }
        must_n = len(
            {
                str(t).upper()
                for t in supplements
                if str(t).upper() not in anchor_pos and str(t).upper() != "CASH"
            }
        )
    # 3 base scenarios + optional theme.
    return 4 if must_n > 0 else 3


def _allocator_for_objective(objective: str) -> str:
    obj = str(objective or "max_sharpe")
    if obj in {"max_sharpe", "max_sortino", "mean_variance_utility", "max_return"}:
        return "mean_variance"
    if obj == "risk_parity_erc":
        return "risk_parity"
    if obj == "max_diversification":
        return "max_diversification"
    return "min_var"


def _clip_drift(value: float, ceiling: float) -> float:
    ceil = float(max(0.0, min(1.0, ceiling)))
    return float(max(0.0, min(ceil, value)))


def _base_param_pack(
    req: Any,
    *,
    scenario_style: str,
    drift_actual: float,
    allocator_mode: str,
    lookback_days: int,
    shrinkage: float,
    risk_aversion: float,
    objective: str,
    tradable_count: int,
    factor: dict[str, float],
    no_trade_tol: float,
    turnover_penalty_mult: float,
    max_weight_scale: float = 1.0,
) -> dict[str, Any]:
    drift_cap = float(getattr(req, "customization_drift", 0.5) or 0.5)
    drift_actual = _clip_drift(drift_actual, drift_cap)
    max_w = float(getattr(req, "max_weight", 0.25) or 0.25)
    max_holdings_cap = int(getattr(req, "max_holdings", tradable_count) or tradable_count)
    hold_hi = max(1, min(int(tradable_count), max_holdings_cap))
    # Fixed small universe: invest across the full eligible set.
    holdings = max(2, hold_hi) if hold_hi >= 2 else max(1, hold_hi)
    # Avoid unique equal-at-cap books (e.g. 10×10%) by relaxing the effective cap.
    max_w = float(feasible_max_weight(max_w, holdings))
    # Per-scenario scale so books differ in concentration, not only factors.
    scale = float(max(0.5, min(1.0, max_weight_scale)))
    max_w = float(feasible_max_weight(max_w * scale, holdings))
    top_n_cap = int(getattr(req, "top_n", None) or tradable_count)
    top_n = max(holdings, min(int(top_n_cap), int(tradable_count)))

    rebalance = str(getattr(req, "rebalance_freq", "QE") or "QE")
    max_turnover = float(getattr(req, "max_turnover", 1.0) or 1.0)

    pack: dict[str, Any] = {
        "scenario_style": scenario_style,
        "param_source": "constrained_scenario",
        "allocator_mode": allocator_mode,
        "objective_mode": str(objective),
        "lookback_days": int(lookback_days),
        "shrinkage": float(shrinkage),
        "risk_aversion": float(risk_aversion),
        "max_weight_actual": float(max_w),
        "customization_drift_actual": float(drift_actual),
        "top_n_actual": int(top_n),
        "max_holdings_actual": int(holdings),
        "no_trade_tol": float(no_trade_tol),
        "turnover_penalty_mult": float(turnover_penalty_mult),
        "max_turnover_actual": float(max_turnover),
        "rebalance_freq": rebalance,
        # Balanced sleeve defaults; enforce_class_weights is usually False for RM.
        "w_equity": 0.55,
        "w_bond": 0.30,
        "w_commodity": 0.05,
        "w_real_estate": 0.05,
        "w_alternative": 0.05,
        "w_equity_us": 0.70,
        "w_equity_intl": 0.20,
        "w_equity_em": 0.10,
        "w_bond_us": 0.70,
        "w_bond_intl": 0.15,
        "w_bond_credit": 0.15,
        "w_commodity_precious": 0.60,
        "w_commodity_broad": 0.40,
        "w_reit_us": 0.70,
        "w_reit_intl": 0.30,
        "factor_lookback_days": int(factor.get("factor_lookback_days", 252)),
        "reversal_lookback_days": int(factor.get("reversal_lookback_days", 21)),
        "value_lookback_days": int(factor.get("value_lookback_days", 252)),
        "w_mom": float(factor.get("w_mom", 1.0)),
        "w_reversal": float(factor.get("w_reversal", 0.2)),
        "w_value": float(factor.get("w_value", 0.4)),
        "w_lowvol": float(factor.get("w_lowvol", 0.8)),
        "w_trend": float(factor.get("w_trend", 0.4)),
        "w_drawdown": float(factor.get("w_drawdown", 0.3)),
        "w_income": float(factor.get("w_income", 0.1)),
    }
    return pack


def build_constrained_scenario_seeds(
    req: Any,
    *,
    tradable_count: int,
    must_include: list[str] | None,
    objective: str,
) -> list[dict[str, Any]]:
    """Build 2–4 complete Optuna AI-seed param packs (no random search)."""
    drift_cap = float(getattr(req, "customization_drift", 0.5) or 0.5)
    drift_cap = float(max(0.0, min(1.0, drift_cap)))
    primary_alloc = _allocator_for_objective(objective)
    must = [str(t) for t in (must_include or []) if str(t).strip()]

    # Anchor-close: stay well inside the RM slider (≈35% of budget, min 5pp).
    close_drift = _clip_drift(max(0.05, drift_cap * 0.35), drift_cap)
    # Full budget: use the ceiling.
    full_drift = drift_cap
    # Defensive: mid budget so min-var can still move a little.
    def_drift = _clip_drift(max(close_drift, drift_cap * 0.55), drift_cap)

    seeds: list[dict[str, Any]] = [
        _base_param_pack(
            req,
            scenario_style="anchor_close",
            drift_actual=close_drift,
            allocator_mode=primary_alloc if primary_alloc != "min_var" else "mean_variance",
            lookback_days=252,
            shrinkage=0.20,
            risk_aversion=6.0,
            objective=objective,
            tradable_count=tradable_count,
            factor={
                "w_mom": 0.6,
                "w_lowvol": 1.2,
                "w_drawdown": 0.6,
                "w_trend": 0.3,
                "w_value": 0.4,
                "w_reversal": 0.2,
                "w_income": 0.15,
                "factor_lookback_days": 252,
            },
            no_trade_tol=0.01,
            turnover_penalty_mult=2.0,
            max_weight_scale=0.75,
        ),
        _base_param_pack(
            req,
            scenario_style="full_drift",
            drift_actual=full_drift,
            allocator_mode=primary_alloc,
            lookback_days=126,
            shrinkage=0.10,
            risk_aversion=2.5 if primary_alloc == "mean_variance" else 4.0,
            objective=objective,
            tradable_count=tradable_count,
            factor={
                "w_mom": 1.2,
                "w_lowvol": 0.5,
                "w_drawdown": 0.2,
                "w_trend": 0.6,
                "w_value": 0.5,
                "w_reversal": 0.3,
                "w_income": 0.05,
                "factor_lookback_days": 168,
            },
            no_trade_tol=0.005,
            turnover_penalty_mult=1.0,
            max_weight_scale=1.0,
        ),
        _base_param_pack(
            req,
            scenario_style="defensive",
            drift_actual=def_drift,
            allocator_mode="min_var",
            lookback_days=252,
            shrinkage=0.30,
            risk_aversion=8.0,
            objective=objective,
            tradable_count=tradable_count,
            factor={
                "w_mom": 0.3,
                "w_lowvol": 1.6,
                "w_drawdown": 1.0,
                "w_trend": 0.2,
                "w_value": 0.3,
                "w_reversal": 0.1,
                "w_income": 0.20,
                "factor_lookback_days": 336,
            },
            no_trade_tol=0.012,
            turnover_penalty_mult=2.5,
            max_weight_scale=0.85,
        ),
    ]

    if must:
        theme_drift = _clip_drift(max(def_drift, drift_cap * 0.75), drift_cap)
        theme = _base_param_pack(
            req,
            scenario_style="theme",
            drift_actual=theme_drift,
            allocator_mode="mean_variance",
            lookback_days=126,
            shrinkage=0.12,
            risk_aversion=3.0,
            objective=objective,
            tradable_count=tradable_count,
            factor={
                "w_mom": 1.5,
                "w_lowvol": 0.4,
                "w_drawdown": 0.25,
                "w_trend": 0.8,
                "w_value": 0.3,
                "w_reversal": 0.2,
                "w_income": 0.05,
                "factor_lookback_days": 126,
            },
            no_trade_tol=0.004,
            turnover_penalty_mult=1.2,
            max_weight_scale=1.0,
        )
        # Ensure holdings capacity covers must-includes + anchor residual.
        need = min_holdings_for_customization(
            n_must_include=len(must),
            max_weight=float(theme["max_weight_actual"]),
            customization_drift=float(theme["customization_drift_actual"]),
            n_assets=tradable_count,
        )
        theme["max_holdings_actual"] = int(
            max(int(theme["max_holdings_actual"]), need, len(must) + 1)
        )
        theme["top_n_actual"] = int(
            max(int(theme["top_n_actual"]), int(theme["max_holdings_actual"]))
        )
        theme["must_include_tickers"] = list(must)
        seeds.append(theme)

    return seeds


def select_constrained_champion_code(
    candidates: list[Any],
) -> str | None:
    """Pick recommended = needs-compliant + best primary objective among scenarios.

    Aligns with search-champion = recommended unification: exactly one champion.
    """
    rows: list[tuple[str, bool, float, float, str]] = []
    for c in candidates:
        code = str(getattr(c, "model_code", None) or "").strip()
        if not code:
            continue
        attainment = getattr(c, "needs_attainment", None)
        if not isinstance(attainment, dict):
            attainment = None
        floors_ok = bool(attainment.get("all_floors_met")) if attainment else False
        needs = _needs_score(attainment)
        analytics = getattr(c, "analytics", None) or {}
        sample = (
            (analytics.get("sample_metrics") or {}).get("in_sample") or {}
            if isinstance(analytics, dict)
            else {}
        )
        obj = sample.get("objective_value")
        if obj is None:
            obj = float(getattr(c, "sharpe", 0.0) or 0.0)
        style = ""
        params = getattr(c, "params", None) or {}
        if isinstance(params, dict):
            style = str(params.get("scenario_style") or "")
        rows.append((code, floors_ok, needs, float(obj), style))

    if not rows:
        return None

    rows.sort(
        key=lambda r: (
            not r[1],  # floors_ok first
            -r[2],  # needs_score
            -r[3],  # objective
            - (1 if r[4] == "full_drift" else 0),
            r[0],
        )
    )
    return rows[0][0]


def build_constrained_proposal_set(
    candidates: list[dict[str, Any]],
    *,
    champion_code: str | None = None,
    max_n: int = 4,
) -> list[dict[str, Any]]:
    """Build proposal cards from named scenarios without Pareto collapse.

    Keeps weight-distinct scenarios. Champion → ``recommended``; others keep
    their ``scenario_style`` label (never ``ALTERNATIVE_N``).
    """
    if not candidates:
        return []

    rows: list[dict[str, Any]] = []
    for c in candidates:
        code = str(c.get("model_code") or "").strip()
        if not code:
            continue
        style = str(c.get("scenario_style") or "").strip()
        if not style and isinstance(c.get("params"), dict):
            style = str(c["params"].get("scenario_style") or "").strip()
        attainment = c.get("needs_attainment")
        raw_weights = c.get("weights")
        obj = c.get("objective_score")
        if obj is None:
            obj = float(c.get("sharpe", 0.0))
        rows.append(
            {
                "model_code": code,
                "scenario_style": style if style in SCENARIO_STYLES else "",
                "sharpe": float(c.get("sharpe", 0.0)),
                "cagr": float(c.get("cagr", 0.0)),
                "max_drawdown": float(c.get("max_drawdown", 0.0)),
                "objective_score": float(obj),
                "needs_attainment": attainment if isinstance(attainment, dict) else None,
                "is_champion": bool(c.get("is_champion")) or code == champion_code,
                "_weights_sig": weights_signature(
                    raw_weights if isinstance(raw_weights, dict) else None
                ),
            }
        )
    if not rows:
        return []

    # Dedupe exact weight clones; keep champion / earlier scenario first.
    rows.sort(key=lambda r: (not r["is_champion"], r["model_code"]))
    kept: list[dict[str, Any]] = []
    seen_sigs: set[str] = set()
    for r in rows:
        sig = r.get("_weights_sig")
        if sig and sig in seen_sigs:
            continue
        if sig:
            seen_sigs.add(sig)
        kept.append(r)
        if len(kept) >= max(1, int(max_n)):
            break

    champ = next((r for r in kept if r["is_champion"]), None)
    if champ is None and champion_code:
        champ = next((r for r in kept if r["model_code"] == champion_code), None)
    if champ is None:
        champ = kept[0]

    out: list[dict[str, Any]] = []
    used_styles: set[str] = set()
    for r in kept:
        is_rec = r["model_code"] == champ["model_code"]
        if is_rec:
            label = "recommended"
        else:
            style = r.get("scenario_style") or ""
            if style and style not in used_styles and style != "recommended":
                label = style
                used_styles.add(style)
            elif "defensive" not in used_styles and style == "defensive":
                label = "defensive"
                used_styles.add("defensive")
            else:
                # Fallback friendly role — still never ALTERNATIVE_N.
                label = style if style in SCENARIO_STYLES else "alternative"
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


_ALLOCATOR_LABELS = {
    "en": {
        "mean_variance": "return-risk balance",
        "min_var": "lowest volatility",
        "risk_parity": "equal risk contribution",
        "max_diversification": "maximum diversification",
    },
    "zh": {
        "mean_variance": "報酬—風險平衡",
        "min_var": "最低波動",
        "risk_parity": "等風險貢獻",
        "max_diversification": "最大分散",
    },
    "ko": {
        "mean_variance": "수익-위험 균형",
        "min_var": "최저 변동성",
        "risk_parity": "균등 위험 기여",
        "max_diversification": "최대 분산",
    },
}

_STYLE_LABELS = {
    "en": {
        "anchor_close": "Anchor-close",
        "full_drift": "Full customization space",
        "defensive": "Defensive",
        "theme": "Theme expression",
    },
    "zh": {
        "anchor_close": "貼近錨定",
        "full_drift": "用滿客製化空間",
        "defensive": "防禦型",
        "theme": "主題表達",
    },
    "ko": {
        "anchor_close": "앵커 근접",
        "full_drift": "맞춤화 여유 최대",
        "defensive": "방어형",
        "theme": "테마 표현",
    },
}


def _lang_key(language: str | None) -> str:
    lang = (language or "en").strip().lower()
    if lang.startswith("zh"):
        return "zh"
    if lang.startswith("ko"):
        return "ko"
    return "en"


def _pct_label(value: float | None) -> str | None:
    if value is None:
        return None
    try:
        return f"{float(value) * 100:.0f}%"
    except (TypeError, ValueError):
        return None


def build_constrained_param_rationale(
    language: str | None,
    styles: list[str] | None = None,
    *,
    champion_style: str | None = None,
    drift_actual: float | None = None,
    drift_cap: float | None = None,
    allocator_mode: str | None = None,
) -> str:
    """RM-facing explanation of constrained named-scenario parameter choices.

    Deterministic (no LLM). Prefer champion scenario metadata when available so
    the 「參數為何這樣設定」 panel matches the recommended proposal.
    """
    lang = _lang_key(language)
    style_list = [str(s).strip() for s in (styles or []) if str(s).strip()]
    if not style_list:
        style_list = list(SCENARIO_STYLES)
    labels = _STYLE_LABELS[lang]
    style_names = " / ".join(labels.get(s, s) for s in style_list)

    if lang == "zh":
        lead = (
            f"本次客製化在客戶既定的持倉宇宙上，比較幾個具名優化情境"
            f"（{style_names}），而非大規模隨機搜尋。"
        )
    elif lang == "ko":
        lead = (
            f"이번 맞춤화는 고객의 고정된 보유 유니버스에서 명명된 최적화 시나리오"
            f"（{style_names}）를 비교하며, 대규모 무작위 탐색은 하지 않습니다."
        )
    else:
        lead = (
            f"This customization compared a few named optimizer scenarios on the "
            f"client's fixed universe ({style_names}) instead of a large random search."
        )

    style = (champion_style or "").strip().lower() or None
    if style not in SCENARIO_STYLES:
        style = None
    style_label = labels.get(style, style) if style else None
    alloc_key = (allocator_mode or "").strip().lower() or None
    alloc_label = _ALLOCATOR_LABELS[lang].get(alloc_key or "", alloc_key) if alloc_key else None
    drift_txt = _pct_label(drift_actual)
    cap_txt = _pct_label(drift_cap)

    if not style:
        return lead

    if lang == "zh":
        if style == "anchor_close":
            body = (
                f"建議方案採「{style_label}」參數：在允許的客製化空間內小幅調整，"
                f"盡量貼近基準組合並兼顧優化目標。"
            )
        elif style == "full_drift":
            body = (
                f"建議方案採「{style_label}」參數：在客製化上限內盡量推進優化目標，"
                f"允許與基準組合有較大配置差異。"
            )
        elif style == "defensive":
            body = (
                f"建議方案採「{style_label}」參數：偏重降低波動與回撤，"
                f"在客製化空間內偏向穩健配置。"
            )
        else:  # theme
            body = (
                f"建議方案採「{style_label}」參數：在客製化空間內納入必納／主題標的，"
                f"讓調整方向更貼近客戶指定主題。"
            )
        extras: list[str] = []
        if drift_txt and cap_txt:
            extras.append(f"實際客製化偏離約 {drift_txt}（上限 {cap_txt}）")
        elif drift_txt:
            extras.append(f"實際客製化偏離約 {drift_txt}")
        elif cap_txt:
            extras.append(f"客製化上限 {cap_txt}")
        if alloc_label:
            extras.append(f"配置引擎為「{alloc_label}」")
        if extras:
            body = f"{body.rstrip('。')}；{'；'.join(extras)}。"
        return f"{lead} {body}"

    if lang == "ko":
        if style == "anchor_close":
            body = (
                f"추천 방안은 「{style_label}」 설정을 사용합니다: "
                f"허용된 맞춤화 여유 안에서 소폭 조정해 기준 포트폴리오에 가깝게 유지합니다."
            )
        elif style == "full_drift":
            body = (
                f"추천 방안은 「{style_label}」 설정을 사용합니다: "
                f"맞춤화 한도 안에서 최적화 목표를 최대한 추진합니다."
            )
        elif style == "defensive":
            body = (
                f"추천 방안은 「{style_label}」 설정을 사용합니다: "
                f"변동성과 낙폭을 낮추는 방향의 맞춤화 여유를 씁니다."
            )
        else:
            body = (
                f"추천 방안은 「{style_label}」 설정을 사용합니다: "
                f"필수/테마 종목을 반영해 고객이 지정한 방향에 맞춥니다."
            )
        extras = []
        if drift_txt and cap_txt:
            extras.append(f"실제 맞춤화 편차 약 {drift_txt}(한도 {cap_txt})")
        elif drift_txt:
            extras.append(f"실제 맞춤화 편차 약 {drift_txt}")
        elif cap_txt:
            extras.append(f"맞춤화 한도 {cap_txt}")
        if alloc_label:
            extras.append(f"배분 엔진 「{alloc_label}」")
        if extras:
            body = f"{body.rstrip('.')} ({' · '.join(extras)})."
        return f"{lead} {body}"

    # English
    if style == "anchor_close":
        body = (
            f"The recommendation uses “{style_label}” settings: small moves within "
            f"the allowed customization space, staying close to the baseline book "
            f"while still pursuing the objective."
        )
    elif style == "full_drift":
        body = (
            f"The recommendation uses “{style_label}” settings: push the objective "
            f"using the full customization budget, allowing larger differences from "
            f"the baseline."
        )
    elif style == "defensive":
        body = (
            f"The recommendation uses “{style_label}” settings: emphasize lower "
            f"volatility and drawdown within the customization space."
        )
    else:
        body = (
            f"The recommendation uses “{style_label}” settings: express must-include "
            f"/ theme names within the customization space."
        )
    extras = []
    if drift_txt and cap_txt:
        extras.append(f"customization used about {drift_txt} (cap {cap_txt})")
    elif drift_txt:
        extras.append(f"customization used about {drift_txt}")
    elif cap_txt:
        extras.append(f"customization cap {cap_txt}")
    if alloc_label:
        extras.append(f"allocation engine: {alloc_label}")
    if extras:
        body = f"{body.rstrip('.')} ({'; '.join(extras)})."
    return f"{lead} {body}"
