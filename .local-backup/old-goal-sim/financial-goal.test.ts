import { describe, expect, it } from "vitest";
import {
  computeFinancialGoalGap,
  goalHorizonYears,
  goalToHandoffParams,
  nextGoalCollectStep,
  parseGoalAmountUsd,
  parseGoalHandoffFromSearch,
  parseGoalMonths,
} from "./financial-goal";

describe("parseGoalAmountUsd", () => {
  it("parses currency-ish strings", () => {
    expect(parseGoalAmountUsd("1,500,000")).toBe(1500000);
    expect(parseGoalAmountUsd("USD1500000")).toBe(1500000);
    expect(parseGoalAmountUsd("$1500000")).toBe(1500000);
    expect(parseGoalAmountUsd("abc")).toBeNull();
  });
});

describe("parseGoalMonths", () => {
  it("clamps to 1–120", () => {
    expect(parseGoalMonths("12")).toBe(12);
    expect(parseGoalMonths("0")).toBeNull();
    expect(parseGoalMonths("200")).toBe(120);
  });
});

describe("computeFinancialGoalGap", () => {
  it("marks Wang-style house goal as covered when cash >> goal", () => {
    const gap = computeFinancialGoalGap(
      {
        type: "home",
        amountUsd: 1_500_000,
        withinMonths: 12,
        description: "House",
      },
      { cash_usd: 12_000_000, aum_usd: 12_000_000 },
    );
    expect(gap.status).toBe("covered");
    expect(gap.cashShortfallUsd).toBe(0);
    expect(gap.surplusCashUsd).toBe(10_500_000);
    expect(gap.timeline.length).toBeGreaterThan(2);
    expect(gap.timeline[0].goalLine).toBe(1_500_000);
  });

  it("reports shortfall when cash is below goal", () => {
    const gap = computeFinancialGoalGap(
      { type: "home", amountUsd: 2_000_000, withinMonths: 6 },
      { cash_usd: 500_000, aum_usd: 5_000_000 },
    );
    expect(gap.status).toBe("shortfall");
    expect(gap.cashShortfallUsd).toBe(1_500_000);
    expect(gap.cashCoverageRatio).toBeCloseTo(0.25, 4);
  });
});

describe("handoff helpers", () => {
  it("round-trips search params", () => {
    const goal = {
      type: "home" as const,
      amountUsd: 1_500_000,
      withinMonths: 12,
      description: "Purchase",
    };
    const p = goalToHandoffParams(goal);
    const qs = new URLSearchParams({
      goalType: p.goalType,
      goalAmount: String(p.goalAmount),
      goalMonths: String(p.goalMonths),
      goalDesc: p.goalDesc!,
    });
    expect(parseGoalHandoffFromSearch(qs)).toEqual(goal);
    expect(goalHorizonYears(goal)).toBe(1);
  });

  it("advances collect steps", () => {
    expect(nextGoalCollectStep("type")).toBe("amount");
    expect(nextGoalCollectStep("confirm")).toBe("result");
    expect(nextGoalCollectStep("result")).toBe("result");
  });
});
