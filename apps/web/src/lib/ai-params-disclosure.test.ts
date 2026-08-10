import { describe, expect, it } from "vitest";
import {
  buildParamSummaryKnobs,
  buildRoundTimeline,
  categorizeParamKey,
  diffGroupedParams,
  formatParamRawValue,
  groupCandidateParams,
  resolveBaselineParams,
} from "./ai-params-disclosure";
import type { PortfolioCandidate, ProRoundSnapshot } from "./types";

describe("categorizeParamKey", () => {
  it("maps known keys into taxonomy buckets", () => {
    expect(categorizeParamKey("objective_mode")).toBe("objective");
    expect(categorizeParamKey("max_weight_actual")).toBe("risk");
    expect(categorizeParamKey("top_n_actual")).toBe("universe");
    expect(categorizeParamKey("mode")).toBe("allocation");
    expect(categorizeParamKey("rebalance_freq")).toBe("rebalance");
    expect(categorizeParamKey("w_equity")).toBe("allocation");
  });
});

describe("formatParamRawValue", () => {
  it("formats weights and drift as percents", () => {
    expect(formatParamRawValue("max_weight_actual", 0.2)).toBe("20.0%");
    expect(formatParamRawValue("customization_drift_actual", 0.15)).toBe(
      "15.0%",
    );
  });

  it("keeps integers for holdings / top-n", () => {
    expect(formatParamRawValue("top_n_actual", 8)).toBe("8");
  });
});

describe("buildParamSummaryKnobs", () => {
  it("returns friendly knobs without raw param keys as labels", () => {
    const knobs = buildParamSummaryKnobs(
      {
        objective_mode: "max_sharpe",
        mode: "mean_variance",
        top_n_actual: 12,
        max_holdings_actual: 8,
        customization_drift_actual: 0.15,
        adjusted_score: 1.2,
      },
      {
        customization_drift_cap: 0.2,
        must_include_tickers: ["BOTZ", "SMH", "CHAT"],
      },
    );
    expect(knobs.map((k) => k.id)).toEqual([
      "objective",
      "allocator",
      "holdings",
      "customization",
      "mustInclude",
    ]);
    expect(knobs.every((k) => k.labelKey.startsWith("params.summary."))).toBe(
      true,
    );
    expect(knobs.find((k) => k.id === "holdings")?.displayValue).toBe(
      "8 / Top-12",
    );
    expect(knobs.find((k) => k.id === "customization")?.displayValue).toBe(
      "15% / 20%",
    );
    expect(knobs.find((k) => k.id === "mustInclude")?.displayValue).toBe("3");
  });

  it("surfaces constrained scenario style as first summary knob", () => {
    const knobs = buildParamSummaryKnobs({
      scenario_style: "anchor_close",
      objective_mode: "max_sharpe",
      mode: "mean_variance",
      customization_drift_actual: 0.07,
    });
    expect(knobs[0]?.id).toBe("scenario");
    expect(knobs[0]?.valueCode).toBe("anchor_close");
  });
});

describe("groupCandidateParams / diffGroupedParams", () => {
  const base = {
    objective_mode: "max_sharpe",
    mode: "mean_variance",
    top_n_actual: 8,
    max_weight_actual: 0.2,
    adjusted_score: 9,
  };
  const alt = {
    ...base,
    top_n_actual: 12,
    max_weight_actual: 0.15,
    mode: "min_var",
  };

  it("groups params and drops internal bookkeeping keys", () => {
    const groups = groupCandidateParams(base);
    const keys = groups.flatMap((g) => g.rows.map((r) => r.key));
    expect(keys).toContain("objective_mode");
    expect(keys).not.toContain("adjusted_score");
    expect(groups.some((g) => g.category === "objective")).toBe(true);
  });

  it("highlights only changed rows in diff-only mode", () => {
    const groups = diffGroupedParams(alt, base, { diffOnly: true });
    const rows = groups.flatMap((g) => g.rows);
    expect(rows.every((r) => r.changed)).toBe(true);
    expect(rows.map((r) => r.key).sort()).toEqual([
      "max_weight_actual",
      "mode",
      "top_n_actual",
    ]);
  });

  it("marks changed flags when showing full table", () => {
    const groups = diffGroupedParams(alt, base, { diffOnly: false });
    const byKey = Object.fromEntries(
      groups.flatMap((g) => g.rows.map((r) => [r.key, r])),
    );
    expect(byKey.objective_mode.changed).toBe(false);
    expect(byKey.mode.changed).toBe(true);
    expect(byKey.mode.baselineDisplayValue).toBe("mean_variance");
  });
});

describe("resolveBaselineParams", () => {
  it("prefers recommended proposal code", () => {
    const candidates: PortfolioCandidate[] = [
      {
        rank: 1,
        model_code: "M0001",
        sharpe: 1,
        max_drawdown: -0.1,
        cagr: 0.1,
        volatility: 0.1,
        weights: { SPY: 1 },
        params: { mode: "min_var" },
      },
      {
        rank: 2,
        model_code: "M0002",
        is_champion: true,
        sharpe: 1.1,
        max_drawdown: -0.1,
        cagr: 0.12,
        volatility: 0.1,
        weights: { SPY: 1 },
        params: { mode: "mean_variance" },
      },
    ];
    const { code, params } = resolveBaselineParams(candidates, [
      {
        model_code: "M0002",
        label: "recommended",
        is_recommended: true,
        sharpe: 1.1,
        cagr: 0.12,
        max_drawdown: -0.1,
      },
      {
        model_code: "M0001",
        label: "growth",
        is_recommended: false,
        sharpe: 1,
        cagr: 0.1,
        max_drawdown: -0.1,
      },
    ]);
    expect(code).toBe("M0002");
    expect(params.mode).toBe("mean_variance");
  });
});

describe("buildRoundTimeline", () => {
  it("emits key param changes between rounds", () => {
    const rounds: ProRoundSnapshot[] = [
      {
        round: 1,
        improved: true,
        trials_in_round: 10,
        round_best_adjusted_score: 1.1,
        round_winner_model_code: "M0001",
        incoming_champion_model_code: null,
        round_setup: {
          mode: "mean_variance",
          top_n_actual: 8,
          max_weight_actual: 0.2,
        },
        candidates: [
          {
            rank: 1,
            model_code: "M0001",
            sharpe: 1.2,
            cagr: 0.2,
            max_drawdown: -0.15,
            volatility: 0.1,
            weights: {},
            params: { objective_mode: "max_sharpe" },
          },
        ],
        equity_curve: [],
        efficient_frontier: [],
        narrative_facts: {},
      },
      {
        round: 2,
        improved: false,
        trials_in_round: 12,
        round_best_adjusted_score: 1.15,
        round_winner_model_code: "M0003",
        incoming_champion_model_code: "M0001",
        round_setup: {
          mode: "min_var",
          top_n_actual: 12,
          max_weight_actual: 0.2,
        },
        candidates: [
          {
            rank: 1,
            model_code: "M0003",
            sharpe: 1.25,
            cagr: 0.18,
            max_drawdown: -0.12,
            volatility: 0.09,
            weights: {},
            params: { objective_mode: "min_max_drawdown" },
          },
        ],
        equity_curve: [],
        efficient_frontier: [],
        narrative_facts: {},
      },
    ];
    const timeline = buildRoundTimeline(rounds);
    expect(timeline).toHaveLength(2);
    expect(timeline[0].keyChanges).toEqual([]);
    expect(timeline[1].keyChanges.map((c) => c.key).sort()).toEqual([
      "mode",
      "objective_mode",
      "top_n_actual",
    ]);
    expect(timeline[1].winnerCode).toBe("M0003");
    expect(timeline[1].championCode).toBe("M0001");
  });
});
