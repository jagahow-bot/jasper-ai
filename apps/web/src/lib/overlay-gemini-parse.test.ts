import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractOverlayJsonText,
  normalizeLiquidityNeed,
  normalizePositionPct,
  parseLiquidityUsdAmount,
  parseOverlayExtractFromGemini,
  stripGeminiMetadata,
  stripOverlayExtractKeys,
} from "./overlay-gemini-parse";
import { validateOverlayExtract, wrapExtractAsOverlay } from "./overlay-schema";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const gemini47Response = JSON.parse(
  readFileSync(join(fixtureDir, "gemini-overlay-47-response.json"), "utf8"),
) as unknown;

describe("overlay-gemini-parse", () => {
  it("extracts JSON text from Gemini API response with thoughtSignature", () => {
    const text = extractOverlayJsonText(gemini47Response);
    expect(text).toBeTruthy();
    expect(text).toContain('"confidence": 0.75');
    expect(text).toContain("min_max_drawdown");
  });

  it("strips thoughtSignature from nested Gemini parts", () => {
    const stripped = stripGeminiMetadata(gemini47Response) as {
      candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }>;
    };
    const part = stripped.candidates?.[0]?.content?.parts?.[0];
    expect(part?.thoughtSignature).toBeUndefined();
    expect(typeof part?.text).toBe("string");
  });

  it("normalizes percent-style max_single_position_pct (35 → 0.35 within 40% cap)", () => {
    expect(normalizePositionPct(35)).toBe(0.35);
    expect(normalizePositionPct(0.35)).toBe(0.35);
    expect(normalizePositionPct(45)).toBe(0.4);
    expect(normalizePositionPct(8)).toBe(0.08);
  });

  it("normalizes liquidity_need aliases", () => {
    expect(
      normalizeLiquidityNeed({
        amount: "$1.5M",
        withinMonths: 12,
        purpose: "House purchase",
      }),
    ).toEqual({
      amount_usd: 1_500_000,
      within_months: 12,
      description: "House purchase",
    });
  });

  it("parses ai_studio_code (47).txt fixture into overlay extract", () => {
    const extract = parseOverlayExtractFromGemini(gemini47Response) as {
      confidence: number;
      optimization: { objective: string };
      client_profile: { liquidity_need?: { amount_usd?: number; within_months?: number } };
      allocation: { max_single_position_pct?: number };
      clarification_questions: string[];
      rationale: string;
    };

    expect(extract.confidence).toBe(0.75);
    expect(extract.optimization.objective).toBe("min_max_drawdown");
    expect(extract.client_profile.liquidity_need?.amount_usd).toBe(1_500_000);
    expect(extract.client_profile.liquidity_need?.within_months).toBe(12);
    expect(extract.allocation.max_single_position_pct).toBe(0.35);
    expect(extract.clarification_questions).toHaveLength(4);
    expect(extract.clarification_questions[0]).toContain("target split");
    expect(extract.rationale).toContain("$1.5M");
  });

  it("parses ai_studio_code (50).txt fixture with missing market_view", () => {
    const gemini50Extract = JSON.parse(
      readFileSync(join(fixtureDir, "gemini-overlay-50-extract.json"), "utf8"),
    ) as unknown;

    const extract = parseOverlayExtractFromGemini(gemini50Extract) as {
      confidence: number;
      market_view: { stance: string; narrative_summary: string };
      client_profile: {
        liquidity_need?: { amount_usd?: number; within_months?: number };
        investment_horizon_years?: number;
        age?: number;
      };
      allocation: { max_single_position_pct?: number; sleeve_targets?: unknown };
      clarification_questions: string[];
      param_adjustments?: { w_lowvol?: { mode: string; fixed: number } };
      experiment?: unknown;
    };

    expect(extract.confidence).toBe(0.75);
    expect(extract.market_view.stance).toBe("neutral");
    expect(extract.market_view.narrative_summary.length).toBeGreaterThanOrEqual(8);
    expect(extract.client_profile.liquidity_need?.amount_usd).toBe(1_500_000);
    expect(extract.client_profile.liquidity_need?.within_months).toBe(12);
    expect(extract.client_profile.investment_horizon_years).toBe(5);
    expect(extract.client_profile.age).toBeUndefined();
    expect(extract.allocation.max_single_position_pct).toBe(0.35);
    expect(extract.allocation.sleeve_targets).toBeUndefined();
    expect(extract.clarification_questions).toHaveLength(3);
    expect(extract.clarification_questions[0]).toContain("fixed allocation split");
    expect(extract.clarification_questions[1]).toContain("USD 1.5 million");
    expect(extract.param_adjustments?.w_lowvol).toEqual({ mode: "fixed", fixed: 0.15 });
    expect(extract.experiment).toBeUndefined();
  });

  it("drops unknown param_adjustments keys and clamps eligible bounds", () => {
    const normalized = parseOverlayExtractFromGemini({
      client_profile: { risk_tolerance: "moderate" },
      market_view: {
        stance: "neutral",
        themes: ["balanced"],
        narrative_summary: "Moderate client with balanced multi-asset preference.",
      },
      allocation: { asset_classes: ["equity", "bond"] },
      universe: { prompts: [] },
      optimization: { objective: "max_sharpe" },
      clarification_questions: [],
      confidence: 0.6,
      rationale: "Structured overlay for param whitelist verification only.",
      param_adjustments: {
        w_lowvol: { mode: "fixed", fixed: 9.9 },
        w_equity: { mode: "fixed", fixed: 0.7 },
        not_a_real_param: { mode: "fixed", fixed: 1 },
        w_income: { mode: "search", min: -1, max: 0.9 },
      },
    }) as {
      param_adjustments?: Record<string, { mode: string; fixed?: number; min?: number; max?: number }>;
    };

    expect(normalized.param_adjustments?.w_equity).toBeUndefined();
    expect(normalized.param_adjustments?.not_a_real_param).toBeUndefined();
    expect(normalized.param_adjustments?.w_lowvol).toEqual({ mode: "fixed", fixed: 2 });
    expect(normalized.param_adjustments?.w_income).toEqual({
      mode: "search",
      min: 0,
      max: 0.4,
    });
  });

  it("validates 王先生-style Gemini response (fixture 50) through Zod", () => {
    const gemini50Extract = JSON.parse(
      readFileSync(join(fixtureDir, "gemini-overlay-50-extract.json"), "utf8"),
    ) as unknown;

    const extract = validateOverlayExtract(parseOverlayExtractFromGemini(gemini50Extract));
    const overlay = wrapExtractAsOverlay(extract, "ovl-test-wang", 1, "gemini");

    expect(overlay.confidence).toBe(0.75);
    expect(overlay.optimization.objective).toBe("min_max_drawdown");
    expect(overlay.client_profile.liquidity_need?.amount_usd).toBe(1_500_000);
    expect(overlay.client_profile.liquidity_need?.within_months).toBe(12);
    expect(overlay.clarification_questions).toHaveLength(3);
    expect(overlay.rationale).toContain("USD 1.5M");
    expect(overlay.allocation.max_single_position_pct).toBe(0.35);
  });

  it("validates ai_studio_code (47) Gemini API response through Zod", () => {
    const extract = validateOverlayExtract(parseOverlayExtractFromGemini(gemini47Response));
    expect(extract.confidence).toBe(0.75);
    expect(extract.market_view.stance).toBe("neutral");
    expect(extract.client_profile.liquidity_need?.amount_usd).toBe(1_500_000);
    expect(extract.clarification_questions).toHaveLength(4);
  });

  it("strips Gemini-invented keys before validation", () => {
    const stripped = stripOverlayExtractKeys({
      client_profile: { age: 55, risk_tolerance: "moderate", extra: true },
      allocation: { asset_classes: ["equity"], sleeve_targets: {} },
      universe: { prompts: ["US equity ETFs"], constraints: { max_single_weight: 0.35 } },
      bonus_field: "drop me",
    }) as {
      client_profile: { age?: number; risk_tolerance?: string; extra?: boolean };
      universe: { constraints?: unknown; prompts: string[] };
      bonus_field?: string;
    };

    expect(stripped.client_profile.age).toBeUndefined();
    expect(stripped.client_profile.extra).toBeUndefined();
    expect(stripped.client_profile.risk_tolerance).toBe("moderate");
    expect(stripped.universe.constraints).toBeUndefined();
    expect(stripped.bonus_field).toBeUndefined();
  });

  it("prefers liquidity withdrawal over total portfolio in free text", () => {
    const text =
      "王先生總資產約1200萬美元，明年買房需要提領150萬美元流動性，偏好ESG與防禦配置。";
    expect(parseLiquidityUsdAmount(text)).toBe(1_500_000);
  });

  it("normalizes aggressive growth / no-liquidity 陳女士 Gemini extract through Zod", () => {
    const chenExtract = JSON.parse(
      readFileSync(join(fixtureDir, "gemini-overlay-chen-growth-extract.json"), "utf8"),
    ) as unknown;

    const normalized = parseOverlayExtractFromGemini(chenExtract) as {
      client_profile: {
        risk_tolerance?: string;
        esg_preference?: string;
        liquidity_need?: unknown;
        age?: number;
      };
      market_view: { stance: string; themes: string[]; narrative_summary: string };
      allocation: {
        asset_classes: string[];
        max_single_position_pct?: number;
        sleeve_targets?: unknown;
      };
      universe: { prompts: string[]; exclude_tickers?: string[] };
      optimization: { objective: string };
      clarification_questions: string[];
      confidence: number;
      param_adjustments?: unknown;
      experiment?: unknown;
    };

    expect(normalized.client_profile.risk_tolerance).toBe("aggressive");
    expect(normalized.client_profile.esg_preference).toBe("none");
    expect(normalized.client_profile.liquidity_need).toBeUndefined();
    expect(normalized.client_profile.age).toBeUndefined();
    expect(normalized.market_view.stance).toBe("risk_on");
    expect(normalized.market_view.themes.length).toBeGreaterThan(0);
    expect(normalized.market_view.narrative_summary.length).toBeGreaterThanOrEqual(8);
    expect(normalized.allocation.asset_classes).toEqual(["equity", "bond"]);
    expect(normalized.allocation.max_single_position_pct).toBe(0.4);
    expect(normalized.allocation.sleeve_targets).toBeUndefined();
    expect(normalized.universe.exclude_tickers).toEqual(["QQQ"]);
    expect(normalized.optimization.objective).toBe("max_sharpe");
    expect(normalized.clarification_questions).toHaveLength(2);
    expect(normalized.clarification_questions[0]).toContain("核心美股");
    expect(normalized.confidence).toBe(0.7);
    expect(normalized.param_adjustments).toBeUndefined();
    expect(normalized.experiment).toBeUndefined();

    const extract = validateOverlayExtract(normalized);
    const overlay = wrapExtractAsOverlay(extract, "ovl-test-chen", 1, "gemini");
    expect(overlay.client_profile.risk_tolerance).toBe("aggressive");
    expect(overlay.client_profile.liquidity_need).toBeUndefined();
    expect(overlay.allocation.max_single_position_pct).toBe(0.4);
    expect(overlay.market_view.stance).toBe("risk_on");
  });

  it("keeps structured clarifications with distinct options through normalize + strip", () => {
    const normalized = parseOverlayExtractFromGemini({
      client_profile: { risk_tolerance: "aggressive" },
      market_view: {
        stance: "risk_on",
        themes: ["ai"],
        narrative_summary: "Client wants higher AI exposure with explicit implementation choices.",
      },
      allocation: { asset_classes: ["equity", "bond"] },
      universe: { prompts: [] },
      optimization: { objective: "max_sharpe" },
      clarifications: [
        {
          id: "q1",
          question: "客戶預期將 AI 產業或科技板塊的比重提高至多少？",
          options: [
            { id: "20", label: "整體配置 20%" },
            { id: "30", label: "整體配置 30%" },
            { id: "40", label: "整體配置 40%以上" },
          ],
          allow_multiple: false,
          allow_free_text: true,
          extra_gemini_field: "drop-me",
        },
        {
          id: "q2",
          question: "偏好採用何種方式加碼 AI 曝險？",
          options: [
            { id: "etf", label: "引入主題型 ETF" },
            { id: "single", label: "調升既有 AI 龍頭個股" },
            { id: "both", label: "ETF與個股複合" },
          ],
          allow_multiple: false,
        },
      ],
      clarification_questions: [
        "客戶預期將 AI 產業或科技板塊的比重提高至多少？",
        "偏好採用何種方式加碼 AI 曝險？",
      ],
      confidence: 0.55,
      rationale: "Need explicit AI sleeve target and implementation preference.",
    }) as {
      clarifications?: Array<{
        question: string;
        options: Array<{ label: string }>;
        allow_multiple?: boolean;
      }>;
    };

    expect(normalized.clarifications).toHaveLength(2);
    expect(normalized.clarifications?.[0].options.map((o) => o.label)).toEqual([
      "整體配置 20%",
      "整體配置 30%",
      "整體配置 40%以上",
    ]);
    expect(normalized.clarifications?.[1].options.map((o) => o.label)).toEqual([
      "引入主題型 ETF",
      "調升既有 AI 龍頭個股",
      "ETF與個股複合",
    ]);
    expect(normalized.clarifications?.[0].allow_multiple).toBe(false);

    const stripped = stripOverlayExtractKeys(normalized as Record<string, unknown>) as {
      clarifications?: Array<{ options: Array<{ label: string }> }>;
    };
    expect(stripped.clarifications?.[0].options).toHaveLength(3);
    expect(stripped.clarifications?.[1].options).toHaveLength(3);
  });
});
