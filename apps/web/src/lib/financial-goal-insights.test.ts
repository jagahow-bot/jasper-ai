import { describe, expect, it } from "vitest";
import {
  DEFAULT_GOAL_ASSUMPTIONS,
  projectFinancialGoals,
  type FinancialGoal,
} from "./financial-goal";
import {
  deriveGoalPathInsightSeeds,
  formatGoalHorizonDuration,
  parseGoalPathInsightsFromModel,
  projectionSummaryForLlm,
  rewriteLargeMonthDurationsInText,
} from "./financial-goal-insights";

function goal(
  partial: Partial<FinancialGoal> & Pick<FinancialGoal, "type">,
): FinancialGoal {
  return {
    id: partial.id ?? `g-${partial.type}`,
    type: partial.type,
    label: partial.label ?? partial.type,
    amountUsd: partial.amountUsd ?? 100_000,
    withinMonths: partial.withinMonths ?? 24,
    priority: partial.priority ?? 3,
    mortgage: partial.mortgage ?? null,
    retirementSpendYears: partial.retirementSpendYears ?? null,
  };
}

describe("formatGoalHorizonDuration", () => {
  it("converts whole-year horizons to year labels (564 → 47-year)", () => {
    expect(formatGoalHorizonDuration(564, "en")).toBe("47-year");
    expect(formatGoalHorizonDuration(564, "en", "noun")).toBe("47 years");
    expect(formatGoalHorizonDuration(564, "zh")).toBe("47 年");
    expect(formatGoalHorizonDuration(564, "ko")).toBe("47년");
  });

  it("uses years + months when not divisible by 12", () => {
    expect(formatGoalHorizonDuration(30, "en")).toBe("2 years 6 months");
    expect(formatGoalHorizonDuration(30, "zh")).toBe("2 年 6 個月");
    expect(formatGoalHorizonDuration(30, "ko")).toBe("2년 6개월");
  });

  it("keeps short horizons in months", () => {
    expect(formatGoalHorizonDuration(6, "en")).toBe("6-month");
    expect(formatGoalHorizonDuration(6, "zh")).toBe("6 個月");
  });
});

describe("rewriteLargeMonthDurationsInText", () => {
  it("rewrites huge month phrases in insight prose", () => {
    expect(
      rewriteLargeMonthDurationsInText(
        "Ending wealth ranges over the 564-month horizon.",
        "en",
      ),
    ).toBe("Ending wealth ranges over the 47-year horizon.");
    expect(
      rewriteLargeMonthDurationsInText("緩衝需覆蓋 564 個月。", "zh"),
    ).toBe("緩衝需覆蓋 47 年。");
  });

  it("leaves small month counts alone", () => {
    expect(
      rewriteLargeMonthDurationsInText(
        "Keep a 12-month liquidity buffer.",
        "en",
      ),
    ).toBe("Keep a 12-month liquidity buffer.");
  });
});

describe("deriveGoalPathInsightSeeds", () => {
  it("flags near_term_shortfall when base path cannot fund a goal", () => {
    const goals = [
      goal({
        type: "liquidity",
        label: "Down payment",
        amountUsd: 5_000_000,
        withinMonths: 12,
      }),
    ];
    const projection = projectFinancialGoals(
      goals,
      { aum_usd: 200_000, cash_usd: 20_000, age: 45, gender: "male" },
      DEFAULT_GOAL_ASSUMPTIONS,
    );
    expect(projection.firstShortfall).not.toBeNull();
    const seeds = deriveGoalPathInsightSeeds(projection);
    expect(seeds.map((s) => s.id)).toContain("near_term_shortfall");
    expect(seeds[0]?.severity).toBe("critical");
  });

  it("flags cash_vs_liquidity when near need dwarfs cash", () => {
    const goals = [
      goal({
        type: "education",
        label: "Tuition",
        amountUsd: 400_000,
        withinMonths: 36,
      }),
    ];
    const projection = projectFinancialGoals(
      goals,
      { aum_usd: 2_000_000, cash_usd: 10_000, age: 40, gender: "female" },
      DEFAULT_GOAL_ASSUMPTIONS,
    );
    const seeds = deriveGoalPathInsightSeeds(projection);
    expect(seeds.map((s) => s.id)).toContain("cash_vs_liquidity");
  });

  it("returns non-critical seeds when path covers near goals", () => {
    const goals = [
      goal({
        type: "liquidity",
        label: "Buffer",
        amountUsd: 50_000,
        withinMonths: 24,
      }),
    ];
    const projection = projectFinancialGoals(
      goals,
      { aum_usd: 5_000_000, cash_usd: 500_000, age: 45, gender: "male" },
      { ...DEFAULT_GOAL_ASSUMPTIONS, annualReturn: 0.06 },
    );
    expect(projection.firstShortfall).toBeNull();
    const seeds = deriveGoalPathInsightSeeds(projection);
    expect(seeds.length).toBeGreaterThan(0);
    expect(seeds.map((s) => s.id)).not.toContain("near_term_shortfall");
  });

  it("projectionSummaryForLlm includes seeds and year horizon_label", () => {
    const goals = [
      goal({ type: "home", amountUsd: 800_000, withinMonths: 48 }),
    ];
    const projection = projectFinancialGoals(
      goals,
      { aum_usd: 1_000_000, cash_usd: 100_000 },
      DEFAULT_GOAL_ASSUMPTIONS,
    );
    const summary = projectionSummaryForLlm(projection, "en");
    expect(summary.insight_seeds.length).toBeGreaterThan(0);
    expect(summary.scenarios.base.ending_wealth_usd).toBeGreaterThan(0);
    expect(summary.goals[0]?.type).toBe("home");
    expect(summary.goals[0]?.within_label).toBe("4-year");
    expect(summary.horizon_label).toMatch(/-year$|years /);
  });
});

describe("parseGoalPathInsightsFromModel", () => {
  const seeds = [
    {
      id: "near_term_shortfall" as const,
      severity: "critical" as const,
      customization_hooks: ["liquidity_buffer" as const],
      facts: { shortfall_usd: 100 },
    },
  ];

  it("parses valid gemini json", () => {
    const text = JSON.stringify({
      insights: [
        {
          id: "near_term_shortfall",
          title: "Funding gap",
          detail: "Shortfall of USD 100 before the goal.",
          talking_point: "We should raise the liquidity buffer.",
          customization_hooks: ["liquidity_buffer", "contribution"],
        },
      ],
    });
    const parsed = parseGoalPathInsightsFromModel(text, seeds);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.title).toBe("Funding gap");
    expect(parsed[0]?.customization_hooks).toContain("contribution");
  });

  it("rejects unknown ids and empty payloads", () => {
    expect(() =>
      parseGoalPathInsightsFromModel(
        JSON.stringify({
          insights: [{ id: "made_up", title: "x", detail: "y" }],
        }),
        seeds,
      ),
    ).toThrow(/insights_none_valid/);
  });
});
