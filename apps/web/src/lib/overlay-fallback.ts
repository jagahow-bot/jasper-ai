import { ASSET_CLASSES } from "./constants";
import { parseLiquidityUsdAmount } from "./overlay-gemini-parse";
import {
  detectDirectIndexing,
  directIndexAskCopy,
  directIndexUniversePrompt,
  pickDirectIndexStocks,
  proposedTickersForDirectIndex,
} from "./direct-indexing";
import {
  applyAsksToOverlayLevers,
  type ClientOverlay,
  type OverlayAsk,
  type OverlayExtractOutput,
} from "./overlay-schema";
import { applyDirectIndexingToExtract } from "./overlay-direct-index";
import { syncExtractClarifications } from "./overlay-clarifications";

function parseAmountUsd(text: string): number | undefined {
  return parseLiquidityUsdAmount(text);
}

function hasEsgPreference(text: string): boolean {
  return /esg|sustainab|responsible investing/i.test(text) || /永續|可持續|社會責任/.test(text);
}

/** Detect Ms. Chen-style numbered customization brief (offline / rules demo). */
function extractChenStyleAsks(
  text: string,
  lang: "zh" | "en" | "ko",
): OverlayAsk[] | null {
  const t = text.toLowerCase();
  const looksLikeChen =
    (/nvda/.test(t) && /satellite|衛星|새틀/.test(t) && /40\s*%?\s*[-–~to]+\s*45|40%-?45%/.test(t)) ||
    (/fxaix|spy/.test(t) && /xlv|xlf/.test(t) && /sharpe/.test(t) && /cash|現金|현금/.test(t));
  if (!looksLikeChen) return null;

  const title1 =
    lang === "zh"
      ? "修剪 NVDA、維持 AI 衛星"
      : lang === "ko"
        ? "NVDA 축소 · AI 위성 유지"
        : "Trim NVDA; keep AI satellite";
  const summary1 =
    lang === "zh"
      ? "降低 NVDA 集中度，同時維持 AI／科技衛星約 40–45%。"
      : lang === "ko"
        ? "NVDA 집중도를 낮추되 AI/테크 위성은 약 40–45%로 유지."
        : "Trim excess NVDA concentration while keeping AI/tech satellite exposure at 40–45%.";

  const title2 =
    lang === "zh"
      ? "核心指數整合"
      : lang === "ko"
        ? "코어 지수 정리"
        : "Core index consolidation";
  const summary2 =
    lang === "zh"
      ? "降低 SPY／FXAIX 重疊，轉向 XLV／XLF 等產業 ETF。"
      : lang === "ko"
        ? "SPY/FXAIX 중복을 줄이고 XLV/XLF로 재배분."
        : "Reduce SPY/FXAIX redundancy; reallocate toward XLV/XLF.";

  const title3 =
    lang === "zh"
      ? "最大夏普與現金緩衝"
      : lang === "ko"
        ? "최대 샤프 + 현금 버퍼"
        : "Max Sharpe + cash buffer";
  const summary3 =
    lang === "zh"
      ? "積極成長前提下追求最大夏普，並維持約 5% 現金緩衝。"
      : lang === "ko"
        ? "공격적 성장 하에서 최대 샤프와 약 5% 현금 버퍼."
        : "Target max Sharpe under aggressive growth, with ~5% cash buffer.";

  return [
    {
      id: "ask-1",
      title: title1,
      summary: summary1,
      kind: "group_weight_band",
      group_id: "chen-tech-satellite",
      tickers: ["NVDA", "AAPL", "MSFT", "META", "FDGRX"],
      min_pct: 0.4,
      max_pct: 0.45,
      status: "proposed",
    },
    {
      id: "ask-1b",
      title: lang === "zh" ? "NVDA 上限" : "NVDA trim",
      summary:
        lang === "zh"
          ? "壓低 NVDA 單一持股權重。"
          : "Cap NVDA single-name weight after rebalance.",
      kind: "ticker_max",
      tickers: ["NVDA"],
      max_pct: 0.18,
      status: "proposed",
    },
    {
      id: "ask-2",
      title: title2,
      summary: summary2,
      kind: "exclude_ticker",
      tickers: ["FXAIX"],
      status: "proposed",
    },
    {
      id: "ask-2b",
      title: lang === "zh" ? "偏好 XLV／XLF" : "Prefer XLV/XLF",
      summary:
        lang === "zh"
          ? "核心配置保留或提高 XLV、XLF。"
          : "Keep XLV and XLF expressed in the core book.",
      kind: "ticker_min",
      tickers: ["XLV", "XLF"],
      status: "proposed",
    },
    {
      id: "ask-3",
      title: title3,
      summary: summary3,
      kind: "cash_reserve",
      cash_reserve_pct: 0.05,
      status: "proposed",
    },
    {
      id: "ask-3b",
      title: lang === "zh" ? "優化目標" : "Objective",
      summary:
        lang === "zh" ? "以最大夏普為優化目標。" : "Optimize for maximum Sharpe ratio.",
      kind: "objective",
      objective: "max_sharpe",
      status: "proposed",
    },
  ];
}

function extractDirectIndex(
  text: string,
  lang: "zh" | "en" | "ko",
): OverlayExtractOutput | null {
  if (!detectDirectIndexing(text)) return null;
  const stocks = pickDirectIndexStocks(text);
  const proposed = proposedTickersForDirectIndex(text, lang);
  const copy = directIndexAskCopy(lang);
  const narrative =
    lang === "zh"
      ? "以個股直接指數化基準 ETF，主題超配用股票袖套而非主題 ETF。"
      : lang === "ko"
        ? "개별 주식으로 벤치마크 ETF를 직접 인덱싱하고, 테마 틸트는 주식 슬리브로 표현합니다."
        : "Direct-index the benchmark ETF with individual stocks; express tilts via a stock sleeve, not thematic ETFs.";
  return {
    client_profile: { risk_tolerance: "moderate" },
    market_view: {
      stance: "risk_on",
      themes: ["direct_index", "equity_tilt"],
      narrative_summary: narrative,
    },
    allocation: {
      asset_classes: ["equity"],
      enforce_class_weights: false,
    },
    universe: {
      construction: "direct_index",
      prompts: [directIndexUniversePrompt(lang)],
      supplement_tickers: stocks,
      proposed_tickers: proposed,
    },
    optimization: {
      objective: "max_sharpe",
      regime_adaptive: false,
      optimization_mode: "standard",
    },
    asks: [
      {
        id: "ask-direct-index",
        title: copy.title,
        summary: copy.summary,
        kind: "direct_index",
        tickers: stocks,
        status: "proposed",
      },
    ],
    clarification_questions: [],
    confidence: 0.78,
    rationale: copy.summary,
  };
}

function baseExtract(text: string, lang: "zh" | "en" | "ko"): OverlayExtractOutput {
  const chenAsks = extractChenStyleAsks(text, lang);
  if (chenAsks) {
    return {
      client_profile: {
        risk_tolerance: "aggressive",
        investment_horizon_years: 10,
        esg_preference: "none",
      },
      market_view: {
        stance: "risk_on",
        themes: ["ai_satellite", "core_consolidation", "max_sharpe"],
        narrative_summary:
          lang === "zh"
            ? "積極客戶：修剪 NVDA、維持 AI 衛星 40–45%，整合 SPY／FXAIX 並保留約 5% 現金。"
            : "Aggressive client: trim NVDA, keep AI satellite 40–45%, consolidate SPY/FXAIX, ~5% cash.",
      },
      allocation: {
        asset_classes: ["equity", "bond"],
        max_single_position_pct: 0.18,
        enforce_class_weights: false,
      },
      universe: {
        prompts: [
          lang === "zh"
            ? "維持 AI／科技衛星；降低 FXAIX 重疊；偏好 XLV／XLF"
            : "Keep AI/tech satellite; reduce FXAIX overlap; prefer XLV/XLF",
        ],
        exclude_tickers: ["FXAIX"],
        supplement_tickers: ["XLV", "XLF"],
      },
      optimization: {
        objective: "max_sharpe",
        regime_adaptive: false,
        optimization_mode: "standard",
      },
      deployment_schedule: undefined,
      asks: chenAsks,
      clarification_questions: [],
      confidence: 0.82,
      rationale:
        lang === "zh"
          ? "已從編號需求抽出 Ask 卡片：NVDA／衛星權重、核心整合、最大夏普與現金緩衝。以上為軟目標，不會因落差而失敗。"
          : "Extracted numbered Ask cards for NVDA/satellite band, core consolidation, max Sharpe, and cash buffer. Soft targets only — misses are reported, not job failures.",
    };
  }

  const directIndex = extractDirectIndex(text, lang);
  if (directIndex) return directIndex;

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
        max_single_position_pct: 0.2,
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
        max_single_position_pct: 0.22,
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
        max_single_position_pct: 0.2,
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
      max_single_position_pct: 0.22,
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
  const extracted = syncExtractClarifications(
    applyDirectIndexingToExtract(baseExtract(text, lang), text, lang),
    lang,
  );
  const now = new Date().toISOString();
  const asks =
    extracted.asks?.length
      ? extracted.asks
      : prior?.asks;
  const base: ClientOverlay = {
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
    deployment_schedule:
      extracted.deployment_schedule ?? prior?.deployment_schedule,
    param_adjustments: extracted.param_adjustments,
    experiment: extracted.experiment,
    ...(asks?.length ? { asks } : {}),
    clarifications: extracted.clarifications,
    clarification_questions: extracted.clarification_questions,
    confidence: extracted.confidence,
    rationale: extracted.rationale,
  };
  return applyAsksToOverlayLevers(base);
}
