import { describe, expect, it } from "vitest";
import {
  enrichGoalExtractWithClientContext,
  monthsUntilAge,
  parseTargetRetirementAge,
  type GoalExtractResult,
} from "./financial-goal-extract";
import { DEFAULT_GOAL_ASSUMPTIONS } from "./financial-goal";

describe("retirement age helpers", () => {
  it("parses retire-at age from zh notes", () => {
    expect(
      parseTargetRetirementAge("預計60歲以後退休，年生活費約3萬美元"),
    ).toBe(60);
  });

  it("computes months until target age", () => {
    expect(monthsUntilAge(55, 60)).toBe(60);
    expect(monthsUntilAge(40, 65)).toBe(300);
    expect(monthsUntilAge(60, 60)).toBeNull();
  });

  it("fills retirement within_months from client age and drops age questions", () => {
    const base: GoalExtractResult = {
      goals: [
        {
          id: "r1",
          type: "retirement",
          label: "退休",
          amountUsd: 30_000,
          withinMonths: 120,
          priority: 3,
        },
      ],
      assumptions: {
        ...DEFAULT_GOAL_ASSUMPTIONS,
        annualContributionUsd: 100_000,
      },
      clarification_questions: [
        "請確認客戶目前的實際年齡或預計距離60歲退休還有多少個月？",
        "預期投資報酬率假設是多少？",
        "年生活費預計維持多少年？",
      ],
      confidence: 0.7,
      rationale: "Extracted retirement goal.",
    };
    const enriched = enrichGoalExtractWithClientContext(
      base,
      "預計60歲以後退休，年生活費約3萬美元",
      { age: 55, gender: "male" },
      "zh",
    );
    expect(enriched.goals[0].withinMonths).toBe(60);
    expect(enriched.goals[0].retirementSpendYears).toBe(18); // 78 - 60
    expect(
      enriched.clarification_questions.some((q) => q.includes("年齡")),
    ).toBe(false);
    expect(
      enriched.clarification_questions.some((q) => q.includes("多少年")),
    ).toBe(false);
    expect(enriched.rationale).toMatch(/55/);
    expect(enriched.rationale).toMatch(/18/);
    expect(enriched.rationale).toMatch(/退休後不再固定加碼投入/);
    expect(enriched.assumptions.annualLivingSpendUsd).toBe(30_000);
    expect(enriched.rationale).toMatch(/目前年生活開銷/);
  });
});
