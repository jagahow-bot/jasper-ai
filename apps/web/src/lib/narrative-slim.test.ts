import { describe, expect, it } from "vitest";
import {
  buildCandidateNarrativeFacts,
  narrativeCacheKey,
  slimNarrativeFacts,
} from "./narrative-slim";
import type { PortfolioCandidate } from "./types";

describe("slimNarrativeFacts", () => {
  it("removes chart-only and per-round pool signature bloat", () => {
    const facts: Record<string, unknown> = {
      top_sharpe: 0.5,
      dynamic_objective_benchmark_series: [{ date: "2020-01-01", value: 1 }],
      dynamic_objective_timeline: [{ date: "2020-01-01", regime: "neutral" }],
      weight_cap_audit: { rows: Array(100).fill({ ticker: "AAPL" }) },
      portfolio_catalog: [{ model_code: "M0001" }],
      oos_leaderboard: [{ model_code: "M0001" }],
      pro_refinement: {
        rounds_completed: 1,
        per_round: [
          {
            round: 1,
            pool_signatures: "x".repeat(10_000),
            records: [{ trial: 1 }],
            round_winner_model_code: "M0001",
          },
        ],
      },
    };
    const slim = slimNarrativeFacts(facts);
    expect(slim.dynamic_objective_benchmark_series).toBeUndefined();
    expect(slim.dynamic_objective_timeline).toBeUndefined();
    expect(slim.weight_cap_audit).toBeUndefined();
    expect(slim.portfolio_catalog).toBeUndefined();
    expect(slim.oos_leaderboard).toBeUndefined();
    const round = (
      slim.pro_refinement as { per_round: Record<string, unknown>[] }
    ).per_round[0];
    expect(round.pool_signatures).toBeUndefined();
    expect(round.records).toBeUndefined();
    expect(round.round_winner_model_code).toBe("M0001");
    expect(facts.dynamic_objective_benchmark_series).toBeDefined();
    expect(
      (facts.pro_refinement as { per_round: Record<string, unknown>[] })
        .per_round[0].pool_signatures,
    ).toBeDefined();
  });
});

describe("narrativeCacheKey", () => {
  it("keys by model_code and rank", () => {
    expect(narrativeCacheKey({ model_code: "M0003", rank: 2 })).toBe("M0003:2");
  });
});

describe("buildCandidateNarrativeFacts", () => {
  const candidate: PortfolioCandidate = {
    rank: 1,
    model_code: "M0001",
    is_champion: true,
    weights: { SPY: 0.5 },
    sharpe: 1.2,
    max_drawdown: -0.15,
    cagr: 0.08,
    volatility: 0.12,
    train_sharpe: 1.4,
    validation_sharpe: 0.9,
    analytics: {
      sample_metrics: {
        in_sample: { sharpe: 1.4, objective_value: 0.55 },
        out_of_sample: { sharpe: 0.9, objective_value: 0.4 },
        full_sample: { sharpe: 1.2, cagr: 0.08, max_drawdown: -0.15 },
        gap: { sharpe: 0.5, objective: 0.15 },
      },
    },
  };

  const baseFacts: Record<string, unknown> = {
    period: { start: "2018-01-01", end: "2024-12-31" },
    train_period: { start: "2018-01-01", end: "2022-06-30" },
    validation_period: { start: "2022-07-01", end: "2024-12-31" },
    oos_enabled: true,
    objective: "max_sharpe",
    champion_model_code: "M0001",
    backtest_spec: {
      benchmark: "SPY",
      fee_bps: 10,
      rebalance_freq: "QE",
      benchmark_metrics: { sharpe: 0.6 },
    },
    dynamic_objective_benchmark_series: [{ date: "2020-01-01", value: 1 }],
    weight_cap_audit: { violation_count: 0 },
    oos_leaderboard: Array(20).fill({ model_code: "M0001" }),
    pro_refinement: {
      rounds_completed: 3,
      stopped_reason: "patience",
      champion_adjusted_score: 0.72,
      per_round: [{ pool_signatures: "huge", round: 1 }],
      convergence_history: Array(50).fill({ trial: 1 }),
    },
    portfolio_catalog: Array(30).fill({ model_code: "M0099" }),
  };

  it("builds single-candidate slim payload without bulk fields", () => {
    const slim = buildCandidateNarrativeFacts(baseFacts, candidate, {
      championModelCode: "M0001",
    });
    expect(slim.narrative_mode).toBe("single_candidate");
    expect(slim.model_code).toBe("M0001");
    expect(slim.rank).toBe(1);
    expect(slim.top_sharpe).toBe(1.2);
    expect(slim.dynamic_objective_benchmark_series).toBeUndefined();
    expect(slim.weight_cap_audit).toBeUndefined();
    expect(slim.oos_leaderboard).toBeUndefined();
    expect(slim.portfolio_catalog).toBeUndefined();
    const horizons = slim.report_horizons as {
      in_sample?: { sharpe?: number };
      full_sample?: { sharpe?: number };
    };
    expect(horizons.in_sample?.sharpe).toBe(1.4);
    expect(horizons.full_sample?.sharpe).toBe(1.2);
    const spec = slim.backtest_spec as Record<string, unknown>;
    expect(spec.benchmark).toBe("SPY");
    expect(spec.benchmark_metrics).toBeUndefined();
    const pro = slim.pro_refinement as Record<string, unknown>;
    expect(pro.rounds_completed).toBe(3);
    expect(pro.per_round).toBeUndefined();
    expect(pro.convergence_history).toBeUndefined();
    expect(JSON.stringify(slim).length).toBeLessThan(4_000);
  });
});
