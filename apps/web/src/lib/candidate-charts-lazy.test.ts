import { describe, expect, it } from "vitest";
import {
  candidateHasDeepAnalytics,
  candidateHasFullCharts,
  lazyPayloadComplete,
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

  it("detects deep institutional analytics", () => {
    expect(candidateHasDeepAnalytics(slim)).toBe(false);
    expect(
      candidateHasDeepAnalytics({
        ...slim,
        analytics: {
          periodic_returns: { monthly: [{ period: "2020-01", return: 0.01 }] },
        },
      }),
    ).toBe(true);
  });

  it("merges lazy charts and institutional analytics into selected candidate", () => {
    const merged = mergeCandidateCharts(slim, {
      model_code: "M0005",
      equity_curve: [{ date: "2020-01-01", value: 100 }],
      weight_history: [{ date: "2020-01-01", SPY: 0.62, QQQ: 0.38 }],
      weight_history_tickers: ["SPY", "QQQ"],
      benchmark_equity_curve: [{ date: "2020-01-01", value: 100 }],
      institutional: {
        rolling: {
          rolling_sharpe: [{ date: "2020-06-01", value: 1.2 }],
          rolling_vol: [{ date: "2020-06-01", value: 0.15 }],
        },
        periodic_returns: {
          monthly: [{ period: "2020-01", return: 0.02 }],
          annual: [{ period: "2020", return: 0.1 }],
        },
        risk_contribution: [{ ticker: "SPY", weight: 1, risk_contrib: 1 }],
      },
    });
    expect(merged.equity_curve).toHaveLength(1);
    expect(merged.analytics?.weight_history).toHaveLength(1);
    expect(merged.analytics?.benchmark_equity_curve).toHaveLength(1);
    expect(merged.analytics?.sample_metrics).toBeDefined();
    expect(merged.analytics?.rolling?.rolling_sharpe).toHaveLength(1);
    expect(merged.analytics?.periodic_returns?.monthly).toHaveLength(1);
    expect(merged.analytics?.risk_contribution).toHaveLength(1);
    // Packaged OOS last_weights must not stick after full-path charts load.
    expect(merged.weights).toEqual({ SPY: 0.62, QQQ: 0.38 });
  });

  it("tracks lazy payload completeness", () => {
    const payload = {
      model_code: "M0005",
      equity_curve: [{ date: "2020-01-01", value: 100 }],
      weight_history: [],
      weight_history_tickers: [],
      benchmark_equity_curve: [],
      institutional: {
        periodic_returns: { monthly: [{ period: "2020-01", return: 0.01 }] },
      },
    };
    expect(lazyPayloadComplete(payload, true, true)).toBe(true);
    expect(lazyPayloadComplete(payload, true, false)).toBe(true);
    expect(lazyPayloadComplete(payload, false, true)).toBe(true);
    expect(
      lazyPayloadComplete(
        { ...payload, equity_curve: [], institutional: {} },
        true,
        true,
      ),
    ).toBe(false);
  });
});
