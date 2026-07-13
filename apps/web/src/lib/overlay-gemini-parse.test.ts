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
} from "./overlay-gemini-parse";

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

  it("normalizes percent-style max_single_position_pct (35 → 0.25 cap)", () => {
    expect(normalizePositionPct(35)).toBe(0.25);
    expect(normalizePositionPct(0.35)).toBe(0.25);
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
    expect(extract.allocation.max_single_position_pct).toBe(0.25);
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
      client_profile: { liquidity_need?: { amount_usd?: number; within_months?: number } };
      allocation: { max_single_position_pct?: number };
      clarification_questions: string[];
      param_adjustments?: { w_lowvol?: { mode: string; fixed: number } };
      experiment?: unknown;
    };

    expect(extract.confidence).toBe(0.75);
    expect(extract.market_view.stance).toBe("neutral");
    expect(extract.market_view.narrative_summary.length).toBeGreaterThanOrEqual(8);
    expect(extract.client_profile.liquidity_need?.amount_usd).toBe(1_500_000);
    expect(extract.client_profile.liquidity_need?.within_months).toBe(12);
    expect(extract.allocation.max_single_position_pct).toBe(0.25);
    expect(extract.clarification_questions).toHaveLength(3);
    expect(extract.clarification_questions[0]).toContain("fixed allocation split");
    expect(extract.clarification_questions[1]).toContain("USD 1.5 million");
    expect(extract.param_adjustments?.w_lowvol).toEqual({ mode: "fixed", fixed: 0.15 });
    expect(extract.experiment).toBeUndefined();
  });

  it("prefers liquidity withdrawal over total portfolio in free text", () => {
    const text =
      "王先生總資產約1200萬美元，明年買房需要提領150萬美元流動性，偏好ESG與防禦配置。";
    expect(parseLiquidityUsdAmount(text)).toBe(1_500_000);
  });
});
