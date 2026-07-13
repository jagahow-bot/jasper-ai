import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractOverlayJsonText,
  normalizeLiquidityNeed,
  normalizePositionPct,
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
});
