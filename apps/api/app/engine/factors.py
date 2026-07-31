"""Cross-sectional factor scoring from price data only.

We compute simple, explainable factors (momentum, low-vol, trend, drawdown)
from a lookback window of returns/prices, then z-score cross-sectionally.
Each factor family supports multiple indicator variants (selectable per run).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

# --- Indicator enums (stable snake_case) ---
MOM_INDICATOR_CHOICES: tuple[str, ...] = (
    "cumulative_return",
    "risk_adjusted_return",
    "skip_month_12_1",
)
REVERSAL_INDICATOR_CHOICES: tuple[str, ...] = (
    "negative_return",
    "off_peak",
    "rsi_mean_reversion",
)
VALUE_INDICATOR_CHOICES: tuple[str, ...] = (
    "ma_price_ratio",
    "price_percentile",
    "inverse_long_momentum",
)
LOWVOL_INDICATOR_CHOICES: tuple[str, ...] = (
    "negative_vol",
    "negative_downside_dev",
    "negative_beta_market",
)
TREND_INDICATOR_CHOICES: tuple[str, ...] = (
    "price_ma_ratio",
    "ma_slope",
    "dual_ma_crossover",
)
DRAWDOWN_INDICATOR_CHOICES: tuple[str, ...] = (
    "max_drawdown_depth",
    "time_since_peak",
    "ulcer_index",
)
INCOME_INDICATOR_CHOICES: tuple[str, ...] = (
    "trailing_12m_yield",
)

INDICATOR_LOGIC_BY_KEY: dict[str, dict[str, str]] = {
    "momentum": {
        "cumulative_return": "L-day cumulative return (P_t/P_{t-L} - 1)",
        "risk_adjusted_return": "Cumulative return / annualized vol over L days",
        "skip_month_12_1": "Return from t-L to t-21 (excludes last ~21 sessions)",
    },
    "reversal": {
        "negative_return": "Negative short/medium cumulative return (mean-reversion proxy)",
        "off_peak": "Price / N-day high - 1 (further below peak scores higher)",
        "rsi_mean_reversion": "Oversold proxy: (50 - RSI) / 50 from window returns",
    },
    "value": {
        "ma_price_ratio": "MA(Lv)/Price_t - 1 (price-based value proxy)",
        "price_percentile": "1 - price percentile in [min,max] over Lv (cheaper in range)",
        "inverse_long_momentum": "Negative cumulative return over value window",
    },
    "lowvol": {
        "negative_vol": "Negative annualized volatility over last L days",
        "negative_downside_dev": "Negative annualized downside deviation",
        "negative_beta_market": "Negative beta vs equal-weight cross-sectional index",
    },
    "trend": {
        "price_ma_ratio": "Price_t/MA(L) - 1",
        "ma_slope": "Short MA / long MA - 1 (rising trend proxy)",
        "dual_ma_crossover": "Fast MA(21) / slow MA(L) - 1",
    },
    "drawdown": {
        "max_drawdown_depth": "Max drawdown over L days (closer to 0 is better)",
        "time_since_peak": "Negative normalized days since last peak (recent peak better)",
        "ulcer_index": "Negative sqrt(mean(drawdown%²)) ulcer proxy",
    },
    "income": {
        "trailing_12m_yield": "Sum(dividends over last 252 sessions) / last price in window",
    },
}

DEFAULT_MOM_INDICATOR = "cumulative_return"
DEFAULT_REVERSAL_INDICATOR = "negative_return"
DEFAULT_VALUE_INDICATOR = "ma_price_ratio"
DEFAULT_LOWVOL_INDICATOR = "negative_vol"
DEFAULT_TREND_INDICATOR = "price_ma_ratio"
DEFAULT_DRAWDOWN_INDICATOR = "max_drawdown_depth"
DEFAULT_INCOME_INDICATOR = "trailing_12m_yield"

_SKIP_MONTH_DAYS = 21
_SHORT_MA_DAYS = 21


@dataclass(frozen=True)
class FactorParams:
    lookback_days: int = 252
    reversal_lookback_days: int = 126
    value_lookback_days: int = 126

    w_mom: float = 1.0
    w_reversal: float = 0.5
    w_value: float = 0.5
    w_lowvol: float = 1.0
    w_trend: float = 0.5
    w_drawdown: float = 0.5
    w_income: float = 0.0

    mom_indicator: str = DEFAULT_MOM_INDICATOR
    reversal_indicator: str = DEFAULT_REVERSAL_INDICATOR
    value_indicator: str = DEFAULT_VALUE_INDICATOR
    lowvol_indicator: str = DEFAULT_LOWVOL_INDICATOR
    trend_indicator: str = DEFAULT_TREND_INDICATOR
    drawdown_indicator: str = DEFAULT_DRAWDOWN_INDICATOR
    income_indicator: str = DEFAULT_INCOME_INDICATOR


def factor_params_from_dict(
    params: dict[str, Any],
    *,
    default_lookback: int = 252,
) -> FactorParams:
    """Build FactorParams from a trial/result param dict (backward compatible)."""
    factor_lb = int(params.get("factor_lookback_days", default_lookback))
    half = max(int(default_lookback) // 2, 63)
    return FactorParams(
        lookback_days=factor_lb,
        reversal_lookback_days=int(params.get("reversal_lookback_days", half)),
        value_lookback_days=int(params.get("value_lookback_days", half)),
        w_mom=float(params.get("w_mom", 1.0)),
        w_reversal=float(params.get("w_reversal", 0.5)),
        w_value=float(params.get("w_value", 0.5)),
        w_lowvol=float(params.get("w_lowvol", 1.0)),
        w_trend=float(params.get("w_trend", 0.5)),
        w_drawdown=float(params.get("w_drawdown", 0.5)),
        w_income=float(params.get("w_income", 0.0)),
        mom_indicator=_resolve_indicator(
            params.get("mom_indicator"), MOM_INDICATOR_CHOICES, DEFAULT_MOM_INDICATOR
        ),
        reversal_indicator=_resolve_indicator(
            params.get("reversal_indicator"),
            REVERSAL_INDICATOR_CHOICES,
            DEFAULT_REVERSAL_INDICATOR,
        ),
        value_indicator=_resolve_indicator(
            params.get("value_indicator"),
            VALUE_INDICATOR_CHOICES,
            DEFAULT_VALUE_INDICATOR,
        ),
        lowvol_indicator=_resolve_indicator(
            params.get("lowvol_indicator"),
            LOWVOL_INDICATOR_CHOICES,
            DEFAULT_LOWVOL_INDICATOR,
        ),
        trend_indicator=_resolve_indicator(
            params.get("trend_indicator"),
            TREND_INDICATOR_CHOICES,
            DEFAULT_TREND_INDICATOR,
        ),
        drawdown_indicator=_resolve_indicator(
            params.get("drawdown_indicator"),
            DRAWDOWN_INDICATOR_CHOICES,
            DEFAULT_DRAWDOWN_INDICATOR,
        ),
        income_indicator=_resolve_indicator(
            params.get("income_indicator"),
            INCOME_INDICATOR_CHOICES,
            DEFAULT_INCOME_INDICATOR,
        ),
    )


def _resolve_indicator(value: Any, choices: tuple[str, ...], default: str) -> str:
    if value is None:
        return default
    s = str(value)
    return s if s in choices else default


def _zscore(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x, dtype=float)
    x = np.nan_to_num(x, nan=0.0, posinf=0.0, neginf=0.0)
    m = float(x.mean()) if x.size else 0.0
    s = float(x.std(ddof=1)) if x.size > 1 else 0.0
    if s < 1e-12:
        return np.zeros_like(x)
    return (x - m) / s


def _slice_last(df: pd.DataFrame, days: int, total_len: int) -> pd.DataFrame:
    d = int(max(1, days))
    start = max(0, total_len - d)
    return df.iloc[start:]


def _mom_cumulative(px: pd.DataFrame) -> np.ndarray:
    return (px.iloc[-1] / px.iloc[0] - 1.0).to_numpy(dtype=float)


def _mom_risk_adjusted(px: pd.DataFrame, rt: pd.DataFrame) -> np.ndarray:
    ret = _mom_cumulative(px)
    vol = rt.std(ddof=1).to_numpy(dtype=float) * np.sqrt(252.0)
    return ret / np.maximum(vol, 1e-12)


def _mom_skip_month(px: pd.DataFrame) -> np.ndarray:
    n = px.shape[0]
    skip = min(_SKIP_MONTH_DAYS, max(1, n // 5))
    end_idx = n - skip
    if end_idx < 2:
        return _mom_cumulative(px)
    start_px = px.iloc[0].to_numpy(dtype=float)
    end_px = px.iloc[end_idx - 1].to_numpy(dtype=float)
    return end_px / np.maximum(start_px, 1e-12) - 1.0


def _rev_negative_return(px: pd.DataFrame) -> np.ndarray:
    rev_raw = (px.iloc[-1] / px.iloc[0] - 1.0).to_numpy(dtype=float)
    return -rev_raw


def _rev_off_peak(px: pd.DataFrame) -> np.ndarray:
    high = px.max(axis=0).to_numpy(dtype=float)
    last = px.iloc[-1].to_numpy(dtype=float)
    return last / np.maximum(high, 1e-12) - 1.0


def _rev_rsi(px: pd.DataFrame) -> np.ndarray:
    rt = px.pct_change().iloc[1:]
    if rt.shape[0] < 2:
        return np.zeros(px.shape[1], dtype=float)
    gains = rt.clip(lower=0).mean(axis=0).to_numpy(dtype=float)
    losses = (-rt.clip(upper=0)).mean(axis=0).to_numpy(dtype=float)
    rs = gains / np.maximum(losses, 1e-12)
    rsi = 100.0 - 100.0 / (1.0 + rs)
    return (50.0 - rsi) / 50.0


def _val_ma_price(px: pd.DataFrame) -> np.ndarray:
    ma = px.mean(axis=0).to_numpy(dtype=float)
    last = px.iloc[-1].to_numpy(dtype=float)
    return ma / np.maximum(last, 1e-12) - 1.0


def _val_price_percentile(px: pd.DataFrame) -> np.ndarray:
    lo = px.min(axis=0).to_numpy(dtype=float)
    hi = px.max(axis=0).to_numpy(dtype=float)
    last = px.iloc[-1].to_numpy(dtype=float)
    pct = (last - lo) / np.maximum(hi - lo, 1e-12)
    return 1.0 - pct


def _val_inverse_long_mom(px: pd.DataFrame) -> np.ndarray:
    return -_mom_cumulative(px)


def _lowvol_neg_vol(rt: pd.DataFrame) -> np.ndarray:
    vol = rt.std(ddof=1).to_numpy(dtype=float) * np.sqrt(252.0)
    return -vol


def _lowvol_neg_downside(rt: pd.DataFrame) -> np.ndarray:
    neg = rt.where(rt < 0, 0.0)
    dd = np.sqrt((neg**2).mean(axis=0).to_numpy(dtype=float)) * np.sqrt(252.0)
    return -dd


def _lowvol_neg_beta(rt: pd.DataFrame) -> np.ndarray:
    mkt = rt.mean(axis=1).to_numpy(dtype=float)
    mkt_var = float(np.var(mkt, ddof=1)) if mkt.size > 1 else 0.0
    out = np.zeros(rt.shape[1], dtype=float)
    if mkt_var < 1e-12:
        return out
    for j, col in enumerate(rt.columns):
        r = rt[col].to_numpy(dtype=float)
        if r.size < 2:
            continue
        cov_m = np.cov(r, mkt, ddof=1)
        cov = float(cov_m[0, 1]) if getattr(cov_m, "ndim", 0) == 2 else 0.0
        out[j] = -cov / mkt_var
    return out


def _trend_price_ma(px: pd.DataFrame) -> np.ndarray:
    ma = px.mean(axis=0).to_numpy(dtype=float)
    last = px.iloc[-1].to_numpy(dtype=float)
    return last / np.maximum(ma, 1e-12) - 1.0


def _trend_ma_slope(px: pd.DataFrame) -> np.ndarray:
    n = px.shape[0]
    half = max(2, n // 2)
    early = px.iloc[:half].mean(axis=0).to_numpy(dtype=float)
    late = px.iloc[half:].mean(axis=0).to_numpy(dtype=float)
    return late / np.maximum(early, 1e-12) - 1.0


def _trend_dual_ma(px: pd.DataFrame) -> np.ndarray:
    n = px.shape[0]
    fast_n = min(_SHORT_MA_DAYS, max(2, n // 4))
    fast = px.iloc[-fast_n:].mean(axis=0).to_numpy(dtype=float)
    slow = px.mean(axis=0).to_numpy(dtype=float)
    return fast / np.maximum(slow, 1e-12) - 1.0


def _dd_max_depth(px: pd.DataFrame) -> np.ndarray:
    arr = px.to_numpy(dtype=float)
    running_max = np.maximum.accumulate(arr, axis=0)
    dd = (arr / np.maximum(running_max, 1e-12) - 1.0).min(axis=0)
    return dd


def _dd_time_since_peak(px: pd.DataFrame) -> np.ndarray:
    arr = px.to_numpy(dtype=float)
    n = arr.shape[0]
    peak_idx = np.argmax(arr, axis=0)
    days_since = (n - 1) - peak_idx.astype(float)
    return -days_since / max(float(n), 1.0)


def _dd_ulcer(px: pd.DataFrame) -> np.ndarray:
    arr = px.to_numpy(dtype=float)
    running_max = np.maximum.accumulate(arr, axis=0)
    dd_pct = arr / np.maximum(running_max, 1e-12) - 1.0
    ulcer = np.sqrt(np.mean(dd_pct**2, axis=0))
    return -ulcer


def _income_trailing_12m_yield(
    prices_window: pd.DataFrame,
    dividend_panel: pd.DataFrame,
    *,
    lookback_days: int = 252,
) -> np.ndarray:
    tickers = list(prices_window.columns)
    aligned = dividend_panel.reindex(
        index=prices_window.index, columns=tickers, fill_value=0.0
    )
    n = prices_window.shape[0]
    d = int(max(1, min(int(lookback_days), n)))
    ttm_div = aligned.iloc[-d:].sum(axis=0).to_numpy(dtype=float)
    price_ref = prices_window.iloc[-1].to_numpy(dtype=float)
    return ttm_div / np.maximum(price_ref, 1e-12)


def _compute_income_raw(
    prices_window: pd.DataFrame,
    dividend_panel: pd.DataFrame | None,
    params: FactorParams,
) -> np.ndarray | None:
    if float(params.w_income) == 0.0:
        return None
    if dividend_panel is None or dividend_panel.empty:
        return None
    income_key = _resolve_indicator(
        params.income_indicator, INCOME_INDICATOR_CHOICES, DEFAULT_INCOME_INDICATOR
    )
    if income_key == "trailing_12m_yield":
        return _income_trailing_12m_yield(
            prices_window,
            dividend_panel,
            lookback_days=params.lookback_days,
        )
    return _income_trailing_12m_yield(
        prices_window,
        dividend_panel,
        lookback_days=params.lookback_days,
    )


def _compute_raw_factors(
    prices_window: pd.DataFrame,
    returns_window: pd.DataFrame,
    params: FactorParams,
) -> tuple[dict[str, np.ndarray], dict[str, str]]:
    """Return raw factor vectors and selected-indicator descriptions."""
    L = prices_window.shape[0]
    px_mom = _slice_last(prices_window, params.lookback_days, L)
    px_rev = _slice_last(prices_window, params.reversal_lookback_days, L)
    px_val = _slice_last(prices_window, params.value_lookback_days, L)
    rt_mom = _slice_last(returns_window, params.lookback_days, L)

    mom_key = _resolve_indicator(
        params.mom_indicator, MOM_INDICATOR_CHOICES, DEFAULT_MOM_INDICATOR
    )
    if mom_key == "risk_adjusted_return":
        mom = _mom_risk_adjusted(px_mom, rt_mom)
    elif mom_key == "skip_month_12_1":
        mom = _mom_skip_month(px_mom)
    else:
        mom = _mom_cumulative(px_mom)

    rev_key = _resolve_indicator(
        params.reversal_indicator, REVERSAL_INDICATOR_CHOICES, DEFAULT_REVERSAL_INDICATOR
    )
    if rev_key == "off_peak":
        reversal = _rev_off_peak(px_rev)
    elif rev_key == "rsi_mean_reversion":
        reversal = _rev_rsi(px_rev)
    else:
        reversal = _rev_negative_return(px_rev)

    val_key = _resolve_indicator(
        params.value_indicator, VALUE_INDICATOR_CHOICES, DEFAULT_VALUE_INDICATOR
    )
    if val_key == "price_percentile":
        value = _val_price_percentile(px_val)
    elif val_key == "inverse_long_momentum":
        value = _val_inverse_long_mom(px_val)
    else:
        value = _val_ma_price(px_val)

    low_key = _resolve_indicator(
        params.lowvol_indicator, LOWVOL_INDICATOR_CHOICES, DEFAULT_LOWVOL_INDICATOR
    )
    if low_key == "negative_downside_dev":
        lowvol = _lowvol_neg_downside(rt_mom)
    elif low_key == "negative_beta_market":
        lowvol = _lowvol_neg_beta(rt_mom)
    else:
        lowvol = _lowvol_neg_vol(rt_mom)

    trend_key = _resolve_indicator(
        params.trend_indicator, TREND_INDICATOR_CHOICES, DEFAULT_TREND_INDICATOR
    )
    if trend_key == "ma_slope":
        trend = _trend_ma_slope(px_mom)
    elif trend_key == "dual_ma_crossover":
        trend = _trend_dual_ma(px_mom)
    else:
        trend = _trend_price_ma(px_mom)

    dd_key = _resolve_indicator(
        params.drawdown_indicator, DRAWDOWN_INDICATOR_CHOICES, DEFAULT_DRAWDOWN_INDICATOR
    )
    if dd_key == "time_since_peak":
        drawdown = _dd_time_since_peak(px_mom)
    elif dd_key == "ulcer_index":
        drawdown = _dd_ulcer(px_mom)
    else:
        drawdown = _dd_max_depth(px_mom)

    selected = {
        "momentum": mom_key,
        "reversal": rev_key,
        "value": val_key,
        "lowvol": low_key,
        "trend": trend_key,
        "drawdown": dd_key,
    }
    logic = {
        k: INDICATOR_LOGIC_BY_KEY[k][selected[k]] for k in selected
    }
    raw = {
        "momentum": mom,
        "reversal": reversal,
        "value": value,
        "lowvol": lowvol,
        "trend": trend,
        "drawdown": drawdown,
    }
    return raw, logic


def score_assets(
    prices_window: pd.DataFrame,
    returns_window: pd.DataFrame,
    params: FactorParams,
    *,
    dividend_panel: pd.DataFrame | None = None,
) -> pd.Series:
    """Return cross-sectional scores indexed by ticker (higher is better)."""
    if prices_window.shape[0] < 60:
        raise ValueError("factor window too short")

    raw, _ = _compute_raw_factors(prices_window, returns_window, params)
    s = (
        params.w_mom * _zscore(raw["momentum"])
        + params.w_reversal * _zscore(raw["reversal"])
        + params.w_value * _zscore(raw["value"])
        + params.w_lowvol * _zscore(raw["lowvol"])
        + params.w_trend * _zscore(raw["trend"])
        + params.w_drawdown * _zscore(raw["drawdown"])
    )
    income_raw = _compute_income_raw(prices_window, dividend_panel, params)
    if income_raw is not None:
        s = s + params.w_income * _zscore(income_raw)
    return pd.Series(s, index=prices_window.columns, dtype=float)


def score_assets_with_details(
    prices_window: pd.DataFrame,
    returns_window: pd.DataFrame,
    params: FactorParams,
    *,
    dividend_panel: pd.DataFrame | None = None,
) -> tuple[pd.Series, dict[str, Any]]:
    """Return score plus per-factor contribution details."""
    if prices_window.shape[0] < 60:
        raise ValueError("factor window too short")

    raw, logic = _compute_raw_factors(prices_window, returns_window, params)
    z = {k: _zscore(v) for k, v in raw.items()}
    weights = {
        "momentum": float(params.w_mom),
        "reversal": float(params.w_reversal),
        "value": float(params.w_value),
        "lowvol": float(params.w_lowvol),
        "trend": float(params.w_trend),
        "drawdown": float(params.w_drawdown),
    }
    income_raw = _compute_income_raw(prices_window, dividend_panel, params)
    if income_raw is not None:
        income_key = _resolve_indicator(
            params.income_indicator, INCOME_INDICATOR_CHOICES, DEFAULT_INCOME_INDICATOR
        )
        z["income"] = _zscore(income_raw)
        weights["income"] = float(params.w_income)
        logic["income"] = INDICATOR_LOGIC_BY_KEY["income"][income_key]
    contrib = {k: weights[k] * z[k] for k in z}
    total = np.zeros(len(prices_window.columns), dtype=float)
    for k in contrib:
        total += contrib[k]

    details = {
        "weights": weights,
        "contrib": {
            k: pd.Series(v, index=prices_window.columns, dtype=float) for k, v in contrib.items()
        },
        "indicator_logic": logic,
        "selected_indicators": {
            "mom_indicator": params.mom_indicator,
            "reversal_indicator": params.reversal_indicator,
            "value_indicator": params.value_indicator,
            "lowvol_indicator": params.lowvol_indicator,
            "trend_indicator": params.trend_indicator,
            "drawdown_indicator": params.drawdown_indicator,
            "income_indicator": params.income_indicator,
        },
    }
    return pd.Series(total, index=prices_window.columns, dtype=float), details


def pick_top_n(scores: pd.Series, top_n: int) -> list[str]:
    n = int(max(top_n, 1))
    ordered = scores.sort_values(ascending=False)
    return list(ordered.head(n).index)
