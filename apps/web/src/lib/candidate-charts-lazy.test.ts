import { describe, expect, it } from "vitest";
import {
  candidateHasFullCharts,
  mergeCandidateCharts,
} from "./candidate-charts-lazy";
import type { PortfolioCandidate } from "./types";

const slim: PortfolioCandidate = {
  rank: 2,
  model_code: "M0005",
  weights: { SPY: 1 },
  sharpe: 1.1,
  max_drawdown: -0.1,
  cagr: 0.1,
  volatility: 0.15,
  analytics: { sample_metrics: { in_sample: { sharpe: 1.1 } } },
};

describe("candidate-charts-lazy", () => {
  it("detects slim vs full chart payloads", () => {
    expect(candidateHasFullCharts(slim)).toBe(false);
    expect(
      candidateHasFullCharts({
        ...slim,
        equity_curve: [{ date: "2020-01-01", value: 100 }],
      }),
    ).toBe(true);
  });

  it("merges lazy charts into selected candidate", () => {
    const merged = mergeCandidateCharts(slim, {
      model_code: "M0005",
      equity_curve: [{ date: "2020-01-01", value: 100 }],
      weight_history: [{ date: "2020-01-01", SPY: 1 }],
      weight_history_tickers: ["SPY"],
      benchmark_equity_curve: [{ date: "2020-01-01", value: 100 }],
    });
    expect(merged.equity_curve).toHaveLength(1);
    expect(merged.analytics?.weight_history).toHaveLength(1);
    expect(merged.analytics?.benchmark_equity_curve).toHaveLength(1);
    expect(merged.analytics?.sample_metrics).toBeDefined();
  });
});
