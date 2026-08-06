import { describe, expect, it } from "vitest";
import {
  buildGoalChartSeries,
  DEFAULT_GOAL_ASSUMPTIONS,
  parseGoalHandoffFromSearch,
  projectFinancialGoals,
  type FinancialGoal,
} from "./financial-goal";

const goals: FinancialGoal[] = [
  {
    id: "g-home",
    type: "home",
    label: "House",
    amountUsd: 1_500_000,
    withinMonths: 12,
    priority: 5,
  },
  {
    id: "g-edu",
    type: "education",
    label: "Tuition",
    amountUsd: 200_000,
    withinMonths: 36,
    priority: 3,
  },
];

describe("projectFinancialGoals", () => {
  it("covers Wang-style cash-heavy book on base path for near-term house", () => {
    const result = projectFinancialGoals(
      goals,
      { aum_usd: 12_000_000, cash_usd: 12_000_000 },
      DEFAULT_GOAL_ASSUMPTIONS,
    );
    const house = result.scenarios.base.events.find((e) => e.goal.id === "g-home");
    expect(house?.covered).toBe(true);
    expect(result.firstShortfall).toBeNull();
    expect(result.scenarios.optimistic.endingWealth).toBeGreaterThan(
      result.scenarios.conservative.endingWealth,
    );
  });

  it("flags shortfall when AUM cannot fund the goal", () => {
    const result = projectFinancialGoals(
      [
        {
          id: "g1",
          type: "home",
          label: "House",
          amountUsd: 5_000_000,
          withinMonths: 6,
          priority: 5,
        },
      ],
      { aum_usd: 1_000_000, cash_usd: 100_000 },
      { ...DEFAULT_GOAL_ASSUMPTIONS, annualReturn: 0.05 },
    );
    expect(result.firstShortfall?.covered).toBe(false);
    expect(result.scenarios.base.totalShortfall).toBeGreaterThan(0);
  });

  it("applies annual contributions along the path", () => {
    const withContrib = projectFinancialGoals(
      [],
      { aum_usd: 1_000_000, cash_usd: 0 },
      {
        ...DEFAULT_GOAL_ASSUMPTIONS,
        annualReturn: 0,
        annualContributionUsd: 120_000,
      },
    );
    // 12 months * 10k = 120k
    expect(withContrib.scenarios.base.path[12].wealth).toBe(1_120_000);
  });
});

describe("buildGoalChartSeries", () => {
  it("aligns three scenarios by month", () => {
    const result = projectFinancialGoals(
      goals,
      { aum_usd: 12_000_000, cash_usd: 12_000_000 },
      DEFAULT_GOAL_ASSUMPTIONS,
    );
    const series = buildGoalChartSeries(result);
    expect(series[0].month).toBe(0);
    expect(series.some((p) => p.goalMarkers.includes("House"))).toBe(true);
  });
});

describe("parseGoalHandoffFromSearch", () => {
  it("reads goalJson payload", () => {
    const payload = {
      goals,
      assumptions: DEFAULT_GOAL_ASSUMPTIONS,
    };
    const qs = new URLSearchParams({ goalJson: JSON.stringify(payload) });
    const parsed = parseGoalHandoffFromSearch(qs);
    expect(parsed?.goals).toHaveLength(2);
    expect(parsed?.assumptions.annualReturn).toBe(0.05);
  });
});
