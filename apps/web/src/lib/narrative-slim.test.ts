import { describe, expect, it } from "vitest";
import { slimNarrativeFacts } from "./narrative-slim";

describe("slimNarrativeFacts", () => {
  it("removes chart-only and per-round pool signature bloat", () => {
    const facts: Record<string, unknown> = {
      top_sharpe: 0.5,
      dynamic_objective_benchmark_series: [{ date: "2020-01-01", value: 1 }],
      weight_cap_audit: { rows: Array(100).fill({ ticker: "AAPL" }) },
      pro_refinement: {
        rounds_completed: 1,
        per_round: [
          {
            round: 1,
            pool_signatures: "x".repeat(10_000),
            round_winner_model_code: "M0001",
          },
        ],
      },
    };
    const slim = slimNarrativeFacts(facts);
    expect(slim.dynamic_objective_benchmark_series).toBeUndefined();
    expect(slim.weight_cap_audit).toBeUndefined();
    const round = (
      slim.pro_refinement as { per_round: Record<string, unknown>[] }
    ).per_round[0];
    expect(round.pool_signatures).toBeUndefined();
    expect(round.round_winner_model_code).toBe("M0001");
    expect(facts.dynamic_objective_benchmark_series).toBeDefined();
    expect(
      (facts.pro_refinement as { per_round: Record<string, unknown>[] })
        .per_round[0].pool_signatures,
    ).toBeDefined();
  });
});
