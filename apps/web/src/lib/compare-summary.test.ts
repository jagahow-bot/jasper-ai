import { describe, expect, it } from "vitest";
import {
  buildCompareFallback,
  isAcceptableCompareSummary,
  looksLikeMetricDump,
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
    expect(text).toContain("research and education");
  });
});
