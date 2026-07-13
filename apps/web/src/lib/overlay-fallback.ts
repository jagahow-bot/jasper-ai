import { ASSET_CLASSES } from "./constants";
import { parseLiquidityUsdAmount } from "./overlay-gemini-parse";
import type { ClientOverlay, OverlayExtractOutput } from "./overlay-schema";

function parseAmountUsd(text: string): number | undefined {
  return parseLiquidityUsdAmount(text);
}

function hasEsgPreference(text: string): boolean {
  return /esg|sustainab|responsible investing/i.test(text) || /永續|可持續|社會責任/.test(text);
}

function baseExtract(text: string, lang: "zh" | "en" | "ko"): OverlayExtractOutput {
  const t = text.toLowerCase();
  const amountUsd = parseAmountUsd(text);
  const esgPreference = hasEsgPreference(text);

  if (
    /liquidity|cash.?need|withdraw|house|mortgage|tuition/.test(t) ||
    /流動|提領|買房|學費|現金/.test(text)
  ) {
    const clarificationQuestions = [
      ...(amountUsd
        ? []
        : lang === "zh"
          ? ["預計提領金額（USD）？"]
          : ["Expected withdrawal amount (USD)?"]),
      ...(/high.?yield|高收益|junk/i.test(text)
        ? []
        : lang === "zh"
          ? ["是否排除高收益債？"]
          : ["Exclude high yield credit?"]),
    ];
    const universePrompts = [
      lang === "zh"
        ? "短天期與浮動利率債券 ETF"
        : "short duration and floating rate bond ETFs",
      ...(esgPreference
        ? [
            lang === "zh"
              ? "優先納入 ESG 或永續篩選 ETF"
              : "prefer ESG or sustainable-screened ETFs",
          ]
        : []),
    ];

    return {
      client_profile: {
        risk_tolerance: "moderate",
        ...(esgPreference ? { esg_preference: "strict" as const } : {}),
        liquidity_need: {
          ...(amountUsd ? { amount_usd: amountUsd } : {}),
          description: text.slice(0, 120),
          within_months: /12|一年|12個月/.test(text) ? 12 : 6,
        },
      },
      market_view: {
        stance: "neutral",
        themes: ["liquidity"],
        narrative_summary:
          lang === "zh"
            ? "客戶有中期流動性需求，建議提高債券與短天期曝險、控制單一標的集中度。"
            : "Client has medium-term liquidity needs; tilt to bonds and short duration.",
      },
      allocation: {
        asset_classes: ["equity", "bond", "commodity", "real_estate"],
        sleeve_targets: { w_equity: 0.5, w_bond: 0.35, w_commodity: 0.05, w_real_estate: 0.1 },
        enforce_class_weights: true,
        max_single_position_pct: 0.08,
      },
      universe: {
        prompts: universePrompts,
      },
      optimization: {
        objective: "min_max_drawdown",
        regime_adaptive: false,
        optimization_mode: "standard",
      },
      clarification_questions: clarificationQuestions,
      confidence: clarificationQuestions.length === 0 ? 0.72 : amountUsd ? 0.65 : 0.55,
      rationale:
        lang === "zh"
          ? `偵測到流動性需求${amountUsd ? `（USD ${amountUsd.toLocaleString()}）` : ""}：建議防禦型股債配置並縮短債券存續期。`
          : `Liquidity need detected${amountUsd ? ` (USD ${amountUsd.toLocaleString()})` : ""}: defensive allocation with shorter bond duration.`,
    };
  }

  if (
    /tech|nasdaq|concentrat|bubble|magnificent/.test(t) ||
    /科技|納斯達|集中|泡沫|半導體/.test(text)
  ) {
    return {
      client_profile: { risk_tolerance: "moderate" },
      market_view: {
        stance: "neutral",
        themes: ["tech_concentration"],
        narrative_summary:
          lang === "zh"
            ? "科技股集中度偏高，建議透過品質／低波因子與產業分散降低單一主題風險。"
            : "High tech concentration; diversify via quality/low-vol factors.",
      },
      allocation: {
        asset_classes: ["equity", "bond", "alternative"],
        sleeve_targets: { w_equity: 0.55, w_bond: 0.3, w_alternative: 0.15 },
        max_single_position_pct: 0.1,
      },
      universe: {
        prompts: [
          lang === "zh"
            ? "美國品質與低波動股票 ETF，限制科技類曝險"
            : "US quality and low volatility equity, cap technology sector exposure",
        ],
      },
      optimization: {
        objective: "max_sharpe",
        regime_adaptive: true,
        optimization_mode: "pro_auto",
      },
      param_adjustments: {
        w_lowvol: { mode: "search", min: 0.3, max: 1.2 },
      },
      clarification_questions:
        lang === "zh"
          ? ["科技相關曝險希望上限（%）？"]
          : ["Target cap on technology-related exposure (%)?"],
      confidence: 0.6,
      rationale:
        lang === "zh"
          ? "偵測到科技集中度擔憂：建議因子分散並啟用 regime 自適應。"
          : "Tech concentration concern: factor diversification with regime adaptation.",
    };
  }

  if (
    /risk.?off|bear|recession|defensive|geopolit|war/.test(t) ||
    /風險趨避|熊市|衰退|防禦|地緣|戰爭/.test(text)
  ) {
    return {
      client_profile: { risk_tolerance: "conservative" },
      market_view: {
        stance: "risk_off",
        themes: ["geopolitics", "risk_off"],
        narrative_summary:
          lang === "zh"
            ? "客戶偏風險趨避，建議股債防禦配置並加入通膨保護與另類對沖，避免極端全債。"
            : "Risk-off preference; defensive multi-asset mix with inflation hedges.",
      },
      allocation: {
        asset_classes: ["equity", "bond", "commodity", "alternative"],
        sleeve_targets: { w_equity: 0.3, w_bond: 0.55, w_commodity: 0.1, w_alternative: 0.05 },
        enforce_class_weights: true,
        max_single_position_pct: 0.08,
      },
      universe: {
        prompts: [
          lang === "zh"
            ? "TIPS、黃金與低相關另類 ETF"
            : "TIPS, precious metals, and low-correlation alternative ETFs",
        ],
      },
      optimization: {
        objective: "min_max_drawdown",
        regime_adaptive: true,
        optimization_mode: "standard",
      },
      experiment: {
        enabled: true,
        mode: "objective_switch",
        regime_mode: "risk_off",
      },
      clarification_questions: [],
      confidence: 0.72,
      rationale:
        lang === "zh"
          ? "偵測到風險趨避：建議防禦型多資產配置並啟用 risk-off regime 實驗。"
          : "Risk-off detected: defensive multi-asset with risk-off regime experiment.",
    };
  }

  return {
    client_profile: { risk_tolerance: "moderate" },
    market_view: {
      stance: "neutral",
      themes: ["balanced"],
      narrative_summary:
        lang === "zh"
          ? "一般平衡型需求，維持多資產分散並依敘述微調槽位。"
          : "Balanced multi-asset request; tune sleeves from narrative.",
    },
    allocation: {
      asset_classes: [...ASSET_CLASSES],
      sleeve_targets: { w_equity: 0.5, w_bond: 0.35, w_commodity: 0.05, w_real_estate: 0.1 },
      max_single_position_pct: 0.1,
    },
    universe: { prompts: [] },
    optimization: {
      objective: "max_sharpe",
      regime_adaptive: false,
      optimization_mode: "standard",
    },
    clarification_questions:
      lang === "zh"
        ? ["是否有特定流動性事件或產業曝險需要限制？"]
        : ["Any liquidity event or sector exposure to cap?"],
    confidence: 0.45,
    rationale:
      lang === "zh"
        ? "未偵測到強烈主題，採平衡預設；請補充客戶具體需求。"
        : "No strong theme detected; balanced defaults — please add client specifics.",
  };
}

export function interpretOverlayFallback(
  text: string,
  lang: "zh" | "en" | "ko",
  sessionId: string,
  turns: number,
  prior?: ClientOverlay | null,
): ClientOverlay {
  const extracted = baseExtract(text, lang);
  const now = new Date().toISOString();
  return {
    version: "1.0",
    audit: {
      session_id: sessionId,
      rm_id: prior?.audit.rm_id,
      client_ref: prior?.audit.client_ref,
      created_at: prior?.audit.created_at ?? now,
      updated_at: now,
      phase: extracted.confidence >= 0.7 ? "confirm" : "clarify",
      conversation_turns: turns,
      source: "rules",
      base_scenario_id: prior?.audit.base_scenario_id,
      base_job_id: prior?.audit.base_job_id,
      adjusted_job_id: prior?.audit.adjusted_job_id,
      rm_sign_off: prior?.audit.rm_sign_off,
    },
    client_profile: {
      ...prior?.client_profile,
      ...extracted.client_profile,
      liquidity_need: {
        ...prior?.client_profile.liquidity_need,
        ...extracted.client_profile.liquidity_need,
      },
    },
    market_view: extracted.market_view,
    allocation: extracted.allocation,
    universe: extracted.universe,
    optimization: extracted.optimization,
    param_adjustments: extracted.param_adjustments,
    experiment: extracted.experiment,
    clarification_questions: extracted.clarification_questions,
    confidence: extracted.confidence,
    rationale: extracted.rationale,
  };
}
