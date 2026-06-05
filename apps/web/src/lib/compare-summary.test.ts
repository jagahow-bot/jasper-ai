import { describe, expect, it } from "vitest";
import {
  buildCompareEffectKey,
  buildCompareFallback,
  buildCompareSystemPrompt,
  buildCompareUserPrompt,
  isAcceptableCompareSummary,
  isGeminiMaxTokensFinish,
  looksLikeMetricDump,
  looksLikeTruncatedCompareJson,
  MAX_COMPARE_ATTEMPTS,
  MAX_COMPARE_RETRIES,
  parseCompareSummaryResponse,
  resolveCompareChampion,
  resolveFallbackRecommendedCode,
  shouldRetryCompareGeneration,
  slimComparePayload,
} from "./compare-summary";

/** Truncated Gemini round-seed style JSON from ai_studio_code (30).txt (MAX_TOKENS). */
const MAX_TOKENS_SAMPLE_EXCERPT = `{
  "round_setup": {
    "mode": "max_sharpe",
    "lookback_days": 252
  },
  "factor_choices": {
    "value_indicator": "book_to_market_ratio_ttm_z_score_120d_winsorized_by_sector_and_country_neutralized_by_sector_and_country_standardized_by_sector_and_country_winsorized_by_sector_and_country_neutralized_by_sector_and_country_standardized_by_sector_and_country_winsorized_by_sector_and_country_neutralized_by_sector_and_country_standardized_by_sector_and_country_winsorized_by_sector_and_country_neutralized_by_sector_and_country_standardized_by_sector_and_country_winsorized_by_sector_and_country_neutralized_by_sector_and_country_standardized_by_sector_and_country_winsorized_by_sector_and_country_neutralized_by_sector_and_country_standardized_by_sector_and_country`;

describe("compare-summary", () => {
  it("allows at most one retry (two Gemini calls)", () => {
    expect(MAX_COMPARE_RETRIES).toBe(1);
    expect(MAX_COMPARE_ATTEMPTS).toBe(2);
  });

  it("slims payload and caps candidate count", () => {
    const candidates = Array.from({ length: 14 }, (_, i) => ({
      model_code: `M${String(i + 1).padStart(4, "0")}`,
      rank: i + 1,
      sharpe: 0.5 - i * 0.01,
      horizons: {
        full_sample: { sharpe: 0.5, cagr: 0.1, max_drawdown: -0.2 },
      },
    }));
    const slim = slimComparePayload({
      benchmark: "VT",
      objective: "dynamic",
      candidates,
    });
    expect(slim.candidates).toHaveLength(10);
    expect(slim.candidate_count_total).toBe(14);
    expect(slim.candidates[0]?.horizons?.full_sample).toEqual({
      sharpe: 0.5,
      cagr: 0.1,
      max_drawdown: -0.2,
    });
  });

  it("detects metric dump from truncated Gemini output", () => {
    const dump = `of-sample CAGR: 9.52%
M0010 Volatility:
- Full sample Volatility: 21.20%
- In-sample Volatility: 23.22%
M0010 Sharpe:
- Full sample Sharpe: 0.4965`;
    expect(looksLikeMetricDump(dump)).toBe(true);
    expect(isAcceptableCompareSummary(dump)).toBe(false);
  });

  it("accepts short institutional prose", () => {
    const prose =
      "M0001 leads on the dynamic objective with full-sample Sharpe 0.55 and CAGR 14.4%. " +
      "M0010 offers lower turnover but weaker full-sample risk-adjusted returns. " +
      "Several tail models show large in-sample versus out-of-sample gaps, suggesting overfitting.";
    expect(isAcceptableCompareSummary(prose)).toBe(true);
  });

  it("resolveCompareChampion prefers AI pick over is_champion", () => {
    const candidates = [
      { model_code: "M0001", rank: 1, sharpe: 1.5, is_champion: true },
      { model_code: "M0009", rank: 9, sharpe: 1.2, is_champion: false },
    ];
    expect(
      resolveCompareChampion(candidates, "M0001", "M0009")?.model_code,
    ).toBe("M0009");
  });

  it("parseCompareSummaryResponse reads JSON recommended_model_code", () => {
    const candidates = [
      { model_code: "M0001", rank: 1 },
      { model_code: "M0009", rank: 9 },
    ];
    const parsed = parseCompareSummaryResponse(
      '{"recommended_model_code":"M0009","summary":"M0009 shows a steadier full-sample profile than M0001. Holdout gaps are narrower for M0009, which supports it as the deployable candidate."}',
      candidates,
    );
    expect(parsed.recommended_model_code).toBe("M0009");
    expect(parsed.summary).toContain("M0009");
  });

  it("resolveCompareChampion prefers is_champion over rank 1", () => {
    const candidates = [
      { model_code: "M0001", rank: 1, sharpe: 1.5, is_champion: false },
      { model_code: "M0009", rank: 9, sharpe: 1.2, is_champion: true },
    ];
    expect(resolveCompareChampion(candidates)?.model_code).toBe("M0009");
    expect(
      resolveCompareChampion(candidates, "M0001")?.model_code,
    ).toBe("M0001");
  });

  it("slimComparePayload sorts by objective rank (best first)", () => {
    const slim = slimComparePayload({
      benchmark: "VT",
      champion_model_code: "M0001",
      candidates: [
        { model_code: "M0007", rank: 1, sharpe: 1.5, is_champion: false },
        { model_code: "M0001", rank: 9, sharpe: 1.2, is_champion: true },
      ],
    });
    expect(slim.candidates.map((c) => c.model_code)).toEqual(["M0007", "M0001"]);
    expect(slim.pro_in_sample_champion).toBe("M0001");
    expect(slim.candidates[0]?.is_champion).toBeUndefined();
  });

  it("buildCompareEffectKey is stable when only model dropdown changes", () => {
    const epoch = "job-1\0M0001\0M0002";
    const base = buildCompareEffectKey(epoch, "VT", "dynamic");
    const afterSelectM0009 = buildCompareEffectKey(epoch, "VT", "dynamic");
    expect(afterSelectM0009).toBe(base);
    expect(base).not.toContain("M0009");
  });

  it("compare prompts are narrative-only and reference server champion", () => {
    const slim = slimComparePayload({
      benchmark: "VT",
      objective_label: "Dynamic",
      champion_model_code: "M0001",
      candidates: [
        { model_code: "M0007", rank: 1, sharpe: 1.5, is_champion: false },
        { model_code: "M0001", rank: 9, sharpe: 1.2, is_champion: true },
      ],
    });
    const system = buildCompareSystemPrompt();
    const user = buildCompareUserPrompt(slim);

    expect(system).toContain("do NOT select or recommend a different champion");
    expect(system).not.toContain("recommended_model_code");
    expect(user).toContain("Narrative comparison only");
    expect(user).toContain("do not open with this");
    const payload = JSON.parse(user.slice(user.indexOf("{"))) as {
      candidates: { model_code: string }[];
    };
    expect(payload.candidates[0]?.model_code).toBe("M0007");
  });

  it("buildCompareFallback focuses AI pick when pro champion differs", () => {
    const text = buildCompareFallback({
      benchmark: "VT",
      objective_label: "Dynamic",
      champion_model_code: "M0001",
      ai_recommended_model_code: "M0007",
      candidates: [
        {
          model_code: "M0007",
          rank: 2,
          sharpe: 0.62,
          cagr: 0.15,
          max_drawdown: -0.22,
          turnover_avg: 0.018,
          horizons: {
            full_sample: { sharpe: 0.62, cagr: 0.15, max_drawdown: -0.22 },
          },
        },
        {
          model_code: "M0001",
          rank: 1,
          sharpe: 0.71,
          cagr: 0.18,
          is_champion: true,
          horizons: {
            full_sample: { sharpe: 0.71, cagr: 0.18, max_drawdown: -0.35 },
          },
        },
      ],
    });
    expect(text.startsWith("Across")).toBe(true);
    expect(text).toMatch(/^Across \d+ Optuna trials[\s\S]*M0007/);
    expect(resolveFallbackRecommendedCode({
      benchmark: "VT",
      champion_model_code: "M0001",
      ai_recommended_model_code: "M0007",
      candidates: [
        { model_code: "M0007", rank: 2 },
        { model_code: "M0001", rank: 1, is_champion: true },
      ],
    })).toBe("M0007");
  });

  it("isGeminiMaxTokensFinish detects MAX_TOKENS and length finish", () => {
    expect(isGeminiMaxTokensFinish("length", "MAX_TOKENS")).toBe(true);
    expect(isGeminiMaxTokensFinish("length", undefined)).toBe(true);
    expect(isGeminiMaxTokensFinish("stop", "STOP")).toBe(false);
  });

  it("looksLikeTruncatedCompareJson flags (30).txt-style truncated dump", () => {
    expect(looksLikeTruncatedCompareJson(MAX_TOKENS_SAMPLE_EXCERPT)).toBe(true);
    expect(
      looksLikeTruncatedCompareJson(
        '{"recommended_model_code":"M0001","summary":"Short."}',
      ),
    ).toBe(false);
  });

  it("shouldRetryCompareGeneration when finishReason is MAX_TOKENS", () => {
    const candidates = [{ model_code: "M0001", rank: 1 }];
    const parsed = parseCompareSummaryResponse(
      MAX_TOKENS_SAMPLE_EXCERPT,
      candidates,
    );
    expect(
      shouldRetryCompareGeneration(
        {
          text: MAX_TOKENS_SAMPLE_EXCERPT,
          finishReason: "length",
          rawFinishReason: "MAX_TOKENS",
        },
        parsed,
      ),
    ).toBe(true);
  });

  /** Retries must not alter slim payload (identical request per route). */
  it("slimComparePayload is stable across retry attempts", () => {
    const payload = {
      benchmark: "VT",
      candidates: Array.from({ length: 12 }, (_, i) => ({
        model_code: `M${String(i + 1).padStart(4, "0")}`,
        rank: i + 1,
        horizons: {
          in_sample: { sharpe: 0.5 },
          full_sample: { sharpe: 0.4 },
        },
      })),
    };
    const first = slimComparePayload(payload);
    const second = slimComparePayload(payload);
    expect(second).toEqual(first);
    expect(first.candidates).toHaveLength(10);
    expect(first.candidates[0]?.horizons?.in_sample).toBeDefined();
    expect(first.candidates[0]?.horizons?.full_sample).toBeDefined();
  });

  it("buildCompareFallback returns paragraphs not metric lines", () => {
    const text = buildCompareFallback({
      benchmark: "VT",
      objective_label: "Dynamic",
      candidates: [
        {
          model_code: "M0001",
          rank: 1,
          sharpe: 0.55,
          cagr: 0.144,
          max_drawdown: -0.35,
          turnover_avg: 0.021,
          horizons: {
            full_sample: { sharpe: 0.55, cagr: 0.144, max_drawdown: -0.35 },
          },
        },
        {
          model_code: "M0010",
          rank: 2,
          sharpe: 0.5,
          cagr: 0.128,
        },
      ],
    });
    expect(looksLikeMetricDump(text)).toBe(false);
    expect(text).toContain("M0001");
    expect(text).toContain("catalog number");
    expect(text).not.toMatch(/designated Pro champion/i);
    expect(text).toContain("research and education");
  });
});
