import { describe, expect, it } from "vitest";
import {
  buildCompareFallback,
  isAcceptableCompareSummary,
  looksLikeMetricDump,
  parseCompareSummaryResponse,
  resolveCompareChampion,
  slimComparePayload,
} from "./compare-summary";

describe("compare-summary", () => {
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

  it("slimComparePayload puts champion first", () => {
    const slim = slimComparePayload({
      benchmark: "VT",
      candidates: [
        { model_code: "M0001", rank: 1, sharpe: 1.5, is_champion: false },
        { model_code: "M0009", rank: 9, sharpe: 1.2, is_champion: true },
      ],
    });
    expect(slim.candidates[0]?.model_code).toBe("M0009");
    expect(slim.champion_model_code).toBe("M0009");
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
    expect(text).toContain("champion");
    expect(text).toContain("research and education");
  });
});
