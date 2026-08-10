import { describe, expect, it } from "vitest";
import {
  DEFAULT_GOAL_ASSUMPTIONS,
  type FinancialGoal,
} from "./financial-goal";
import {
  buildRuleBasedSegmentation,
  buildSegmentedChartSeries,
  normalizeSegmentCoverage,
  parseGoalSegmentationFromModel,
  projectSegmentedGoals,
  resolveSegmentBands,
  ruleBasedStrategyPick,
  segmentForMonth,
  type GoalSegment,
  type GoalSegmentStrategy,
  type ResolvedSegmentBand,
} from "./financial-goal-segments";
import type { PlanningReturnBand } from "./financial-goal-planning-returns";

const STRATEGIES: GoalSegmentStrategy[] = [
  { modelCode: null, label: "Current holdings" },
  { modelCode: "DEF1", label: "Defensive", cagr: 0.03, volatility: 0.06, maxDrawdown: -0.08 },
  { modelCode: "BAL1", label: "Balanced", cagr: 0.06, volatility: 0.12, maxDrawdown: -0.2, isRecommended: true },
  { modelCode: "GRW1", label: "Growth", cagr: 0.1, volatility: 0.2, maxDrawdown: -0.35 },
];

function makeGoal(partial: Partial<FinancialGoal>): FinancialGoal {
  return {
    id: partial.id ?? "g1",
    type: partial.type ?? "other",
    label: partial.label ?? "Goal",
    amountUsd: partial.amountUsd ?? 1000,
    withinMonths: partial.withinMonths ?? 12,
    priority: partial.priority ?? 3,
  };
}

function makeBand(
  base: number,
  floor: number,
  ceiling: number,
): PlanningReturnBand {
  return {
    baseReturn: base,
    floorReturn: floor,
    ceilingReturn: ceiling,
    optimisticDelta: ceiling - base,
    conservativeDelta: base - floor,
    confidenceLevel: 0.9,
    geometricMean: base,
    winsorizedGeometricMean: base,
    arithmeticMean: base,
    planningCeiling: base,
    shrinkWeight: 1,
    annualVol: 0,
    sampleYears: 10,
    p10Return: floor,
    p50Return: base,
    p90Return: ceiling,
    priorReturn: base,
    method: "winsorized_mean_cap",
  };
}

function resolvedBand(
  segment: GoalSegment,
  band: PlanningReturnBand,
): ResolvedSegmentBand {
  return { segment, band, bandSource: "equity_curve" };
}

describe("ruleBasedStrategyPick", () => {
  it("short → lowest volatility (defensive)", () => {
    expect(ruleBasedStrategyPick("short", STRATEGIES)).toBe("DEF1");
  });
  it("mid → recommended model", () => {
    expect(ruleBasedStrategyPick("mid", STRATEGIES)).toBe("BAL1");
  });
  it("long → highest CAGR (growth)", () => {
    expect(ruleBasedStrategyPick("long", STRATEGIES)).toBe("GRW1");
  });
  it("no models → holdings (null)", () => {
    expect(ruleBasedStrategyPick("short", [STRATEGIES[0]!])).toBeNull();
  });
});

describe("buildRuleBasedSegmentation", () => {
  const goals = [
    makeGoal({ id: "home", type: "home", withinMonths: 24 }),
    makeGoal({ id: "edu", type: "education", withinMonths: 96 }),
    makeGoal({ id: "retire", type: "retirement", withinMonths: 300 }),
  ];

  it("covers the full horizon with short/mid/long windows", () => {
    const seg = buildRuleBasedSegmentation({
      goals,
      strategies: STRATEGIES,
      horizonMonths: 300,
      lang: "en",
    });
    expect(seg.source).toBe("rules");
    expect(seg.segments.map((s) => [s.startMonth, s.endMonth])).toEqual([
      [1, 36],
      [37, 120],
      [121, 300],
    ]);
    expect(seg.segments.map((s) => s.modelCode)).toEqual([
      "DEF1",
      "BAL1",
      "GRW1",
    ]);
    // Goals land in the windows containing their due month.
    expect(seg.segments[0]!.goalIds).toEqual(["home"]);
    expect(seg.segments[1]!.goalIds).toEqual(["edu"]);
    expect(seg.segments[2]!.goalIds).toEqual(["retire"]);
  });

  it("collapses to a single short segment for short horizons", () => {
    const seg = buildRuleBasedSegmentation({
      goals: [makeGoal({ withinMonths: 18 })],
      strategies: STRATEGIES,
      horizonMonths: 18,
      lang: "en",
    });
    expect(seg.segments).toHaveLength(1);
    expect(seg.segments[0]).toMatchObject({
      label: "short",
      startMonth: 1,
      endMonth: 18,
    });
  });
});

describe("parseGoalSegmentationFromModel", () => {
  const goals = [makeGoal({ id: "home", withinMonths: 24 })];

  it("parses fenced JSON and maps codes case-insensitively", () => {
    const text = "```json\n" + JSON.stringify({
      segments: [
        { label: "short", start_month: 1, end_month: 36, model_code: "def1", rationale: "Near-term safety." },
        { label: "long", start_month: 37, end_month: 120, model_code: "GRW1", rationale: "Growth later." },
      ],
      rationale: "Split by horizon.",
    }) + "\n```";
    const seg = parseGoalSegmentationFromModel(text, {
      goals,
      strategies: STRATEGIES,
      horizonMonths: 120,
    });
    expect(seg.source).toBe("ai");
    expect(seg.segments.map((s) => s.modelCode)).toEqual(["DEF1", "GRW1"]);
    expect(seg.rationale).toBe("Split by horizon.");
  });

  it("maps HOLDINGS aliases to current holdings (null)", () => {
    const text = JSON.stringify({
      segments: [
        { label: "short", start_month: 1, end_month: 24, model_code: "HOLDINGS" },
      ],
    });
    const seg = parseGoalSegmentationFromModel(text, {
      goals,
      strategies: STRATEGIES,
      horizonMonths: 24,
    });
    expect(seg.segments[0]!.modelCode).toBeNull();
  });

  it("repairs unknown model codes with the rule-based pick", () => {
    const text = JSON.stringify({
      segments: [
        { label: "short", start_month: 1, end_month: 24, model_code: "NOPE9" },
      ],
    });
    const seg = parseGoalSegmentationFromModel(text, {
      goals,
      strategies: STRATEGIES,
      horizonMonths: 24,
    });
    expect(seg.segments[0]!.modelCode).toBe("DEF1");
  });

  it("extends early-stopping AI output to the horizon", () => {
    const text = JSON.stringify({
      segments: [
        { label: "short", start_month: 1, end_month: 30, model_code: "DEF1" },
      ],
    });
    const seg = parseGoalSegmentationFromModel(text, {
      goals,
      strategies: STRATEGIES,
      horizonMonths: 120,
    });
    expect(seg.segments).toHaveLength(1);
    expect(seg.segments[0]!.endMonth).toBe(120);
  });

  it("throws on structural failure so callers fall back to rules", () => {
    expect(() =>
      parseGoalSegmentationFromModel("not json", {
        goals,
        strategies: STRATEGIES,
        horizonMonths: 120,
      }),
    ).toThrow();
    expect(() =>
      parseGoalSegmentationFromModel("{}", {
        goals,
        strategies: STRATEGIES,
        horizonMonths: 120,
      }),
    ).toThrow();
  });
});

describe("normalizeSegmentCoverage", () => {
  it("bridges gaps by extending the previous segment", () => {
    const segs: GoalSegment[] = [
      { id: "seg-short", label: "short", startMonth: 1, endMonth: 24, goalIds: [], modelCode: "DEF1", rationale: "" },
      { id: "seg-long", label: "long", startMonth: 61, endMonth: 120, goalIds: [], modelCode: "GRW1", rationale: "" },
    ];
    const out = normalizeSegmentCoverage(segs, [], 120);
    expect(out.map((s) => [s.startMonth, s.endMonth])).toEqual([
      [1, 60],
      [61, 120],
    ]);
  });

  it("trims overlaps in favor of the earlier segment", () => {
    const segs: GoalSegment[] = [
      { id: "seg-short", label: "short", startMonth: 1, endMonth: 48, goalIds: [], modelCode: "DEF1", rationale: "" },
      { id: "seg-mid", label: "mid", startMonth: 37, endMonth: 120, goalIds: [], modelCode: "BAL1", rationale: "" },
    ];
    const out = normalizeSegmentCoverage(segs, [], 120);
    expect(out.map((s) => [s.startMonth, s.endMonth])).toEqual([
      [1, 48],
      [49, 120],
    ]);
  });
});

describe("segmentForMonth", () => {
  const segs: GoalSegment[] = [
    { id: "seg-short", label: "short", startMonth: 1, endMonth: 36, goalIds: [], modelCode: null, rationale: "" },
    { id: "seg-long", label: "long", startMonth: 37, endMonth: 120, goalIds: [], modelCode: "GRW1", rationale: "" },
  ];
  it("finds the containing segment and clamps the edges", () => {
    expect(segmentForMonth(segs, 1)?.id).toBe("seg-short");
    expect(segmentForMonth(segs, 36)?.id).toBe("seg-short");
    expect(segmentForMonth(segs, 37)?.id).toBe("seg-long");
    expect(segmentForMonth(segs, 999)?.id).toBe("seg-long");
    expect(segmentForMonth(segs, 0)?.id).toBe("seg-short");
    expect(segmentForMonth([], 5)).toBeNull();
  });
});

describe("resolveSegmentBands", () => {
  const segmentation = buildRuleBasedSegmentation({
    goals: [makeGoal({ withinMonths: 60 })],
    strategies: STRATEGIES,
    horizonMonths: 60,
    lang: "en",
  });

  it("uses the strategy equity curve when available", () => {
    const curve = [
      { date: "2018-12-31", value: 100 },
      { date: "2019-12-31", value: 108 },
      { date: "2020-12-31", value: 118 },
      { date: "2021-12-31", value: 110 },
      { date: "2022-12-31", value: 122 },
    ];
    const bands = resolveSegmentBands(segmentation, {
      curveForModel: () => curve,
      priorReturn: 0.05,
      confidence: 0.9,
    });
    expect(bands.every((b) => b.bandSource === "equity_curve")).toBe(true);
    expect(bands[0]!.band.method).toBe("winsorized_mean_cap");
    expect(bands[0]!.band.sampleYears).toBe(4);
  });

  it("falls back to the plan prior when no curve exists", () => {
    const bands = resolveSegmentBands(segmentation, {
      curveForModel: () => null,
      priorReturn: 0.05,
      confidence: 0.9,
    });
    expect(bands.every((b) => b.bandSource === "prior_fallback")).toBe(true);
    expect(bands[0]!.band.baseReturn).toBeCloseTo(0.05, 9);
    expect(bands[0]!.band.method).toBe("prior_fallback");
  });
});

describe("projectSegmentedGoals (chaining)", () => {
  // One negligible goal at month 24 keeps withdrawals out of the rate math.
  const goals = [makeGoal({ id: "tiny", amountUsd: 1, withinMonths: 24 })];
  const client = { aum_usd: 100_000, cash_usd: 0, age: null, gender: null };
  const assumptions = { ...DEFAULT_GOAL_ASSUMPTIONS };

  const segments: GoalSegment[] = [
    { id: "seg-short", label: "short", startMonth: 1, endMonth: 12, goalIds: [], modelCode: "DEF1", rationale: "" },
    { id: "seg-mid", label: "mid", startMonth: 13, endMonth: 24, goalIds: ["tiny"], modelCode: "BAL1", rationale: "" },
  ];
  const bands: ResolvedSegmentBand[] = [
    resolvedBand(segments[0]!, makeBand(0.12, 0.06, 0.24)),
    resolvedBand(segments[1]!, makeBand(0, 0, 0)),
  ];

  it("chains segment rates into one continuous path", () => {
    const proj = projectSegmentedGoals({
      goals,
      client,
      assumptions,
      segmentBands: bands,
      horizonMonths: 24,
    })!;
    expect(proj).not.toBeNull();
    const p50 = proj.p50.path;
    // 12% annual compounded monthly for 12 months = ×1.12.
    expect(p50[12]!.wealth).toBe(112_000);
    // Second segment at 0% → flat, minus the $1 goal withdrawal at month 24.
    expect(p50[13]!.wealth).toBe(112_000);
    expect(p50[24]!.wealth).toBe(111_999);
  });

  it("produces ordered P10 ≤ P50 ≤ P90 tracks", () => {
    const proj = projectSegmentedGoals({
      goals,
      client,
      assumptions,
      segmentBands: bands,
      horizonMonths: 24,
    })!;
    for (let m = 0; m <= 24; m++) {
      expect(proj.p10.path[m]!.wealth).toBeLessThanOrEqual(
        proj.p50.path[m]!.wealth + 1,
      );
      expect(proj.p50.path[m]!.wealth).toBeLessThanOrEqual(
        proj.p90.path[m]!.wealth + 1,
      );
    }
    // First segment differs by track (6% / 12% / 24%).
    expect(proj.p10.path[12]!.wealth).toBe(106_000);
    expect(proj.p90.path[12]!.wealth).toBe(124_000);
  });

  it("builds a chart series with band = p90 − p10", () => {
    const proj = projectSegmentedGoals({
      goals,
      client,
      assumptions,
      segmentBands: bands,
      horizonMonths: 24,
    })!;
    const chart = buildSegmentedChartSeries(proj, goals, assumptions, 24);
    expect(chart).toHaveLength(25);
    const at12 = chart.find((p) => p.month === 12)!;
    expect(at12.median).toBe(112_000);
    expect(at12.p10).toBe(106_000);
    expect(at12.p90).toBe(124_000);
    expect(at12.bandRange).toBe(124_000 - 106_000);
    expect(at12.segmentLabel).toBe("short");
    expect(at12.segmentModelCode).toBe("DEF1");
    const at24 = chart.find((p) => p.month === 24)!;
    expect(at24.segmentLabel).toBe("mid");
    expect(at24.eventLabel).toContain("Goal");
  });

  it("returns null without goals or segments", () => {
    expect(
      projectSegmentedGoals({
        goals: [],
        client,
        assumptions,
        segmentBands: bands,
      }),
    ).toBeNull();
    expect(
      projectSegmentedGoals({
        goals,
        client,
        assumptions,
        segmentBands: [],
      }),
    ).toBeNull();
  });
});
