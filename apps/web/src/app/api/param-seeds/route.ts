import { z } from "zod";
import {
  defaultFlashModel,
  FLASH_MAX_OUTPUT_TOKENS,
  isProviderConfigured,
  DEFAULT_FLASH_MODEL_ID,
} from "@/lib/ai-provider";
import { generateObjectWithAudit } from "@/lib/llm-audit";

const ParamSetSchema = z.object({
  mode: z
    .enum([
      "mean_variance",
      "min_var",
      "risk_parity",
      "max_diversification",
    ])
    .default("mean_variance"),
  lookback_days: z.number().int().min(126).max(504),
  shrinkage: z.number().min(0).max(0.5),
  risk_aversion: z.number().min(0.5).max(12),
  max_weight_actual: z.number().min(0.05).max(1),
  top_n_actual: z.number().int().min(5).max(200),
  max_holdings_actual: z.number().int().min(1).max(200),
  factor_lookback_days: z.number().int().min(126).max(504),
  reversal_lookback_days: z.number().int().min(63).max(252),
  value_lookback_days: z.number().int().min(63).max(252),
  no_trade_tol: z.number().min(0).max(0.02),
  turnover_penalty_mult: z.number().min(0.5).max(3),
  max_turnover_actual: z.number().min(0.05).max(2),
  w_mom: z.number().min(0).max(2),
  w_reversal: z.number().min(0).max(2),
  w_value: z.number().min(0).max(2),
  w_lowvol: z.number().min(0).max(2),
  w_trend: z.number().min(0).max(1.5),
  w_drawdown: z.number().min(0).max(1.5),
  w_equity: z.number().min(0).max(1),
  w_bond: z.number().min(0).max(1),
  w_commodity: z.number().min(0).max(1),
  w_real_estate: z.number().min(0).max(1),
  w_alternative: z.number().min(0).max(1),
  w_equity_us: z.number().min(0).max(1),
  w_equity_intl: z.number().min(0).max(1),
  w_equity_em: z.number().min(0).max(1),
  w_bond_us: z.number().min(0).max(1),
  w_bond_intl: z.number().min(0).max(1),
  w_bond_credit: z.number().min(0).max(1),
  w_commodity_precious: z.number().min(0).max(1),
  w_commodity_broad: z.number().min(0).max(1),
  w_reit_us: z.number().min(0).max(1),
  w_reit_intl: z.number().min(0).max(1),
  mom_indicator: z
    .enum(["cumulative_return", "risk_adjusted_return", "skip_month_12_1"])
    .optional(),
  reversal_indicator: z
    .enum(["negative_return", "off_peak", "rsi_mean_reversion"])
    .optional(),
  value_indicator: z
    .enum(["ma_price_ratio", "price_percentile", "inverse_long_momentum"])
    .optional(),
  lowvol_indicator: z
    .enum(["negative_vol", "negative_downside_dev", "negative_beta_market"])
    .optional(),
  trend_indicator: z
    .enum(["price_ma_ratio", "ma_slope", "dual_ma_crossover"])
    .optional(),
  drawdown_indicator: z
    .enum(["max_drawdown_depth", "time_since_peak", "ulcer_index"])
    .optional(),
});

const ResponseSchema = z.object({
  rationale: z.string(),
  param_sets: z.array(ParamSetSchema),
});

export async function POST(req: Request) {
  const body = (await req.json()) as {
    n: number;
    objective: string;
    rebalance_freq: string;
    max_weight_cap: number;
    max_turnover_cap: number;
    top_n_cap: number;
    max_holdings_cap: number;
    tradable_count: number;
    existing_sets?: Record<string, unknown>[];
  };

  if (!isProviderConfigured(DEFAULT_FLASH_MODEL_ID)) {
    return Response.json(
      { error: "missing_api_key", rationale: "", param_sets: [] },
      { status: 400 },
    );
  }

  const n = Math.max(1, Math.min(Number(body.n ?? 1), 5));
  const topNBound = Math.min(Number(body.top_n_cap ?? 50), Number(body.tradable_count ?? 50));
  const maxHoldingsBound = Math.max(
    1,
    Math.min(Number(body.max_holdings_cap ?? 50), Number(body.tradable_count ?? 50)),
  );
  const existing = Array.isArray(body.existing_sets) ? body.existing_sets : [];
  const existingHint =
    existing.length > 0
      ? `\n已產生 ${existing.length} 組，請與下列明顯不同：\n${JSON.stringify(existing.slice(-8))}`
      : "";

  const { result, log } = await generateObjectWithAudit({
    model: defaultFlashModel(),
    maxOutputTokens: FLASH_MAX_OUTPUT_TOKENS,
    schema: ResponseSchema,
    system:
      "你是機構量化研究助理。輸出嚴格 JSON。數值最多 4 位小數；只輸出必要與有實質變化的欄位。每次請求產生的參數必須與既有組合在 lookback、因子權重、top_n、風險厭惡度上明顯不同。在 rationale 中簡述每組參數的因子選擇與配置邏輯，並對照既有組合說明差異原因。",
    prompt: `請產生 ${n} 組參數（param_sets 長度必須為 ${n}）：
- objective=${body.objective}
- rebalance_freq=${body.rebalance_freq}
- max_weight_actual in [0.05, ${body.max_weight_cap}]
- max_turnover_actual in [0.05, ${body.max_turnover_cap}]
- top_n_actual in [5, ${topNBound}]
- max_holdings_actual in [1, ${maxHoldingsBound}]
- asset-class preference weights: w_equity,w_bond,w_commodity,w_real_estate,w_alternative in [0,1]
- finer sub-asset sleeves: w_equity_us,w_equity_intl,w_equity_em,w_bond_us,w_bond_intl,w_bond_credit,w_commodity_precious,w_commodity_broad,w_reit_us,w_reit_intl in [0,1]${existingHint}`,
  });

  return Response.json({ ...(result.object as Record<string, unknown>), llm_log: log });
}

