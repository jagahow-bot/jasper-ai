/** Factor indicator options (aligned with apps/api/app/engine/factors.py). */

export type FactorIndicatorSpec = {
  key: string;
  label: string;
  factorLabel: string;
  options: readonly string[];
  defaultFixed: string;
  hint: string;
};

export const FACTOR_INDICATOR_SPECS: FactorIndicatorSpec[] = [
  {
    key: "mom_indicator",
    label: "Momentum",
    factorLabel: "Momentum",
    options: ["cumulative_return", "risk_adjusted_return", "skip_month_12_1"],
    defaultFixed: "cumulative_return",
    hint: "Return level, vol-adjusted return, or 12-1 skip-month style",
  },
  {
    key: "reversal_indicator",
    label: "Reversal",
    factorLabel: "Reversal",
    options: ["negative_return", "off_peak", "rsi_mean_reversion"],
    defaultFixed: "negative_return",
    hint: "Short return flip, distance from peak, or RSI oversold proxy",
  },
  {
    key: "value_indicator",
    label: "Value",
    factorLabel: "Value",
    options: ["ma_price_ratio", "price_percentile", "inverse_long_momentum"],
    defaultFixed: "ma_price_ratio",
    hint: "Below MA, cheap in range, or contrarian long-window return",
  },
  {
    key: "lowvol_indicator",
    label: "Low vol",
    factorLabel: "Low vol",
    options: ["negative_vol", "negative_downside_dev", "negative_beta_market"],
    defaultFixed: "negative_vol",
    hint: "Total vol, downside vol, or low beta vs equal-weight index",
  },
  {
    key: "trend_indicator",
    label: "Trend",
    factorLabel: "Trend",
    options: ["price_ma_ratio", "ma_slope", "dual_ma_crossover"],
    defaultFixed: "price_ma_ratio",
    hint: "Price vs MA, MA slope, or fast/slow MA crossover",
  },
  {
    key: "drawdown_indicator",
    label: "Drawdown",
    factorLabel: "Drawdown",
    options: ["max_drawdown_depth", "time_since_peak", "ulcer_index"],
    defaultFixed: "max_drawdown_depth",
    hint: "Drawdown depth, recency of peak, or ulcer-style pain index",
  },
];

export function formatIndicatorOption(value: string): string {
  return value.replace(/_/g, " ");
}
