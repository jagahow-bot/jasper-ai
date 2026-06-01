/** Shared rules for Gemini narrative routes — prevents % formatting mistakes. */
export const AI_METRIC_FORMAT_RULES = `
METRIC FORMAT (payload JSON uses decimal fractions for rates unless noted):
- Multiply by 100 and show as XX.XX%: cagr, volatility, max_drawdown, turnover_avg, turnover_total, var_95, cvar_95, win_rate, alpha, alpha_annual, tracking_error, benchmark_relative.alpha, benchmark_relative.alpha_annual.
  Example: cagr 0.0842 → "8.42%". max_drawdown -0.152 → "15.2% drawdown".
- Unitless (NO % sign): sharpe, sortino, calmar, beta, information_ratio, information_ratio as IR.
- "alpha" / alpha_annual: annualized Jensen alpha vs benchmark (same convention as CAGR). Prefer the word "alpha", not "annual alpha".
- fee_bps: basis points (10 = 10 bps = 0.10% per trade side), not a decimal fraction.
- Do NOT print a decimal like 0.08 meaning 0.08%; if the field is 0.08 and is cagr, write 8.00%.
- Use model_code when naming portfolios. Do not invent numbers not in the payload.
`;

export function formatPctDecimal(v: unknown): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(2)}%`;
}

export function formatAlpha(v: unknown): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(2)}%`;
}
