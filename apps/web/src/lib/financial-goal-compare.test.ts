import { describe, expect, it } from "vitest";
import {
  DEFAULT_GOAL_ASSUMPTIONS,
  type FinancialGoal,
} from "./financial-goal";
import {
  buildGoalPathCompare,
  detectSurplusGlideSuggestion,
  planningReturnFromCagr,
  SURPLUS_GLIDE_MAX_MULTIPLE,
} from "./financial-goal-compare";
import { planningReturnBandFromAnnualReturns } from "./financial-goal-planning-returns";

const goals: FinancialGoal[] = [
  {
    id: "g1",
    type: "liquidity",
    label: "Buffer",
    amountUsd: 200_000,
    withinMonths: 24,
    priority: 3,
  },
];

describe("planningReturnFromCagr", () => {
  it("soft-clamps only", () => {
    expect(planningReturnFromCagr(0.5)).toBe(0.35);
    expect(planningReturnFromCagr(-0.5)).toBe(-0.15);
  });
});

describe("detectSurplusGlideSuggestion", () => {
  it("flags large surplus when goals covered", () => {
    const hit = detectSurplusGlideSuggestion({
      startingWealth: 1_000_000,
      goals,
      afterEndingUsd: 10_000_000,
      afterShortfallUsd: 0,
      beforeEndingUsd: 2_000_000,
    });
    expect(hit.suggest).toBe(true);
    expect(hit.surplusMultiple).toBeGreaterThan(2.5);
  });

  it("does not flag when shortfall remains", () => {
    expect(
      detectSurplusGlideSuggestion({
        startingWealth: 1_000_000,
        goals,
        afterEndingUsd: 10_000_000,
        afterShortfallUsd: 50_000,
        beforeEndingUsd: 1_000_000,
      }).suggest,
    ).toBe(false);
  });

  it("suppresses absurd multiples that distract in client meetings", () => {
    const hit = detectSurplusGlideSuggestion({
      startingWealth: 5_000_000,
      goals,
      afterEndingUsd: 2_260_000_000,
      afterShortfallUsd: 0,
      beforeEndingUsd: 50_000_000,
    });
    expect(hit.surplusMultiple).toBeGreaterThan(SURPLUS_GLIDE_MAX_MULTIPLE);
    expect(hit.suggest).toBe(false);
  });
});

describe("buildGoalPathCompare", () => {
  it("wires confidence floor into conservative band", () => {
    const band = planningReturnBandFromAnnualReturns(
      [0.18, 0.22, 0.15, 0.2, 0.19, 0.16, 0.21, 0.17],
      0.05,
      0.6,
    );
    const compare = buildGoalPathCompare({
      goals,
      assumptions: { ...DEFAULT_GOAL_ASSUMPTIONS, annualReturn: 0.05 },
      client: { aum_usd: 3_000_000, cash_usd: 400_000, age: 45, gender: "male" },
      planningBand: band,
      chartHorizonMonths: 60,
    });
    expect(compare).not.toBeNull();
    expect(compare!.planningBand.floorReturn).toBeCloseTo(band.floorReturn, 6);
    expect(compare!.afterReturn).toBeCloseTo(band.baseReturn, 6);
  });
});
