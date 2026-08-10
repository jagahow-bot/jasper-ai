import { describe, expect, it } from "vitest";
import {
  buildGoalChartEventMarkers,
  buildGoalChartSeries,
  DEFAULT_GOAL_ASSUMPTIONS,
  monthlyMortgagePayment,
  parseGoalHandoffFromSearch,
  projectFinancialGoals,
  resolveChartHorizonMonths,
  retirementSpendYearsFromLongevity,
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
    const house = result.scenarios.base.events.find(
      (e) => e.kind === "goal" && e.goal.id === "g-home",
    );
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

  it("stops annual contributions at retirement start", () => {
    const retirement: FinancialGoal = {
      id: "g-ret",
      type: "retirement",
      label: "Retire",
      amountUsd: 0,
      withinMonths: 12,
      priority: 4,
      retirementSpendYears: 2,
    };
    const result = projectFinancialGoals(
      [retirement],
      { aum_usd: 1_000_000, cash_usd: 0 },
      {
        ...DEFAULT_GOAL_ASSUMPTIONS,
        annualReturn: 0,
        annualContributionUsd: 120_000,
      },
    );
    // Working months 1–11 only: 11 * 10k
    expect(result.scenarios.base.totalContributed).toBe(110_000);
    expect(result.scenarios.base.path[11].contributed).toBe(10_000);
    expect(result.scenarios.base.path[12].contributed).toBe(0);
    expect(result.scenarios.base.path[24].contributed).toBe(0);
  });

  it("deducts current living spend until retirement, then retirement spend", () => {
    const retirement: FinancialGoal = {
      id: "g-ret",
      type: "retirement",
      label: "Retire",
      amountUsd: 36_000, // 3k / month after retire
      withinMonths: 12,
      priority: 4,
      retirementSpendYears: 1,
    };
    const result = projectFinancialGoals(
      [retirement],
      { aum_usd: 2_000_000, cash_usd: 0 },
      {
        ...DEFAULT_GOAL_ASSUMPTIONS,
        annualReturn: 0,
        annualLivingSpendUsd: 24_000, // 2k / month before retire
      },
    );
    // Months 1–11: living 2k; month 12+: retirement 3k (no living)
    expect(result.scenarios.base.path[1].livingPaid).toBe(2_000);
    expect(result.scenarios.base.path[11].livingPaid).toBe(2_000);
    expect(result.scenarios.base.totalLivingPaid).toBe(2_000 * 11);
    expect(result.scenarios.base.path[12].livingPaid).toBe(0);
    expect(result.scenarios.base.path[12].retirementPaid).toBe(3_000);
    expect(result.scenarios.base.path[1].wealth).toBe(2_000_000 - 2_000);
  });

  it("deducts amortizing mortgage payments after home purchase", () => {
    const homeWithMortgage: FinancialGoal = {
      id: "g-home-m",
      type: "home",
      label: "House",
      amountUsd: 500_000,
      withinMonths: 6,
      priority: 5,
      mortgage: {
        loanUsd: 1_200_000,
        annualRate: 0.036,
        termMonths: 360,
      },
    };
    const payment = monthlyMortgagePayment(homeWithMortgage.mortgage!);
    expect(payment).toBeGreaterThan(1000);

    const result = projectFinancialGoals(
      [homeWithMortgage],
      { aum_usd: 5_000_000, cash_usd: 5_000_000 },
      { ...DEFAULT_GOAL_ASSUMPTIONS, annualReturn: 0 },
    );

    expect(result.horizonMonths).toBe(6 + 360);
    const start = result.scenarios.base.events.find(
      (e) => e.kind === "mortgage_start",
    );
    expect(start?.monthlyPaymentUsd).toBe(Math.round(payment));

    const paidOff = result.scenarios.base.events.find(
      (e) => e.kind === "mortgage_end",
    );
    expect(paidOff?.month).toBe(6 + 360);

    const markers = buildGoalChartEventMarkers(result);
    expect(markers.some((m) => m.kind === "mortgage_end")).toBe(true);
    expect(markers.some((m) => m.month === 6 + 360)).toBe(true);

    const month7 = result.scenarios.base.path[7];
    expect(month7.mortgagePaid).toBe(Math.round(payment));
    // After down payment at m6 and one mortgage payment at m7 (0% return)
    expect(month7.wealth).toBe(
      Math.round(5_000_000 - 500_000 - payment),
    );
    expect(result.scenarios.base.totalMortgagePaid).toBeGreaterThan(0);
  });

  it("spreads retirement annual spend across months (no lump-sum cliff)", () => {
    const retirement: FinancialGoal = {
      id: "g-ret",
      type: "retirement",
      label: "Retire",
      amountUsd: 36_000, // 3k / month
      withinMonths: 12,
      priority: 4,
      retirementSpendYears: 2,
    };
    const result = projectFinancialGoals(
      [retirement],
      { aum_usd: 2_000_000, cash_usd: 2_000_000 },
      { ...DEFAULT_GOAL_ASSUMPTIONS, annualReturn: 0 },
    );
    const start = result.scenarios.base.events.find(
      (e) => e.kind === "retirement_start",
    );
    expect(start?.monthlyPaymentUsd).toBe(3000);
    // No lump-sum withdrawal in the start month beyond the first monthly spend
    const m12 = result.scenarios.base.path[12];
    expect(m12.retirementPaid).toBe(3000);
    expect(m12.wealth).toBe(2_000_000 - 3000);
    const m13 = result.scenarios.base.path[13];
    expect(m13.retirementPaid).toBe(3000);
    expect(result.scenarios.base.totalRetirementPaid).toBe(3000 * 24);
  });

  it("derives spend years from life expectancy minus retire age", () => {
    expect(retirementSpendYearsFromLongevity(60, "male")).toBe(18);
    expect(retirementSpendYearsFromLongevity(60, "female")).toBe(25);
    expect(retirementSpendYearsFromLongevity(60, null)).toBe(22);
  });

  it("ends path at life expectancy and treats ending wealth as inheritance", () => {
    const retirement: FinancialGoal = {
      id: "g-ret",
      type: "retirement",
      label: "Retire",
      amountUsd: 12_000,
      withinMonths: 60,
      priority: 4,
      retirementSpendYears: 10,
    };
    const result = projectFinancialGoals(
      [retirement],
      { aum_usd: 1_000_000, cash_usd: 0, age: 38, gender: "female" },
      { ...DEFAULT_GOAL_ASSUMPTIONS, annualReturn: 0 },
    );
    // Female LE 85 − 38 = 47y → 564 months
    expect(result.lifeExpectancyAge).toBe(85);
    expect(result.lifeExpectancyMonth).toBe(564);
    expect(result.horizonMonths).toBe(564);
    expect(result.inheritanceUsd).toBe(result.scenarios.base.endingWealth);
    expect(
      result.scenarios.base.events.some((e) => e.kind === "inheritance"),
    ).toBe(true);
    const markers = buildGoalChartEventMarkers(result);
    expect(markers.some((m) => m.kind === "inheritance")).toBe(true);
  });
});

describe("buildGoalChartSeries", () => {
  it("aligns three scenarios by month and exposes event markers", () => {
    const result = projectFinancialGoals(
      goals,
      { aum_usd: 12_000_000, cash_usd: 12_000_000 },
      DEFAULT_GOAL_ASSUMPTIONS,
    );
    const series = buildGoalChartSeries(result);
    expect(series[0].month).toBe(0);
    expect(series.some((p) => p.goalMarkers.includes("House"))).toBe(true);

    const markers = buildGoalChartEventMarkers(result);
    expect(markers.some((m) => m.goalLabel === "House")).toBe(true);

    const clipped = buildGoalChartSeries(result, 12);
    expect(clipped.every((p) => p.month <= 12)).toBe(true);
    expect(resolveChartHorizonMonths(12, result.horizonMonths)).toBe(12);
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
