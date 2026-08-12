import { describe, expect, it } from "vitest";
import {
  enrichGoalExtractWithClientContext,
  mergeGoalExtract,
  monthsUntilAge,
  parseTargetRetirementAge,
  type GoalExtractResult,
  type GoalExtractSnapshot,
} from "./financial-goal-extract";
import { DEFAULT_GOAL_ASSUMPTIONS, type FinancialGoal } from "./financial-goal";

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
    // Living spend is not UI-editable; do not default it from retirement spend.
    expect(enriched.assumptions.annualLivingSpendUsd).toBe(0);
  });
});

function goal(
  partial: Partial<FinancialGoal> & Pick<FinancialGoal, "id" | "type">,
): FinancialGoal {
  return {
    label: partial.label ?? partial.type,
    amountUsd: partial.amountUsd ?? 100_000,
    withinMonths: partial.withinMonths ?? 12,
    priority: partial.priority ?? 3,
    mortgage: partial.mortgage,
    retirementSpendYears: partial.retirementSpendYears,
    ...partial,
  };
}

describe("mergeGoalExtract", () => {
  const baseAssumptions = {
    ...DEFAULT_GOAL_ASSUMPTIONS,
    annualContributionUsd: 50_000,
  };

  it("full-fills when the goals table is empty", () => {
    const incoming: GoalExtractSnapshot = {
      goals: [
        goal({ id: "e1", type: "home", label: "購屋", amountUsd: 1_500_000 }),
      ],
      assumptions: {
        ...baseAssumptions,
        annualContributionUsd: 120_000,
      },
    };
    const result = mergeGoalExtract(
      { goals: [], assumptions: DEFAULT_GOAL_ASSUMPTIONS },
      incoming,
      null,
    );
    expect(result.goals).toHaveLength(1);
    expect(result.goals[0].amountUsd).toBe(1_500_000);
    expect(result.assumptions.annualContributionUsd).toBe(120_000);
    expect(result.summary.addedGoals).toBe(1);
    expect(result.baseline.goals).toHaveLength(1);
  });

  it("does not clear the table when extract goals are empty", () => {
    const current: GoalExtractSnapshot = {
      goals: [goal({ id: "c1", type: "education", label: "學費" })],
      assumptions: baseAssumptions,
    };
    const result = mergeGoalExtract(
      current,
      { goals: [], assumptions: { ...baseAssumptions, annualContributionUsd: 99_000 } },
      {
        goals: [goal({ id: "c1", type: "education", label: "學費" })],
        assumptions: baseAssumptions,
      },
    );
    expect(result.goals).toHaveLength(1);
    expect(result.goals[0].id).toBe("c1");
    expect(result.assumptions.annualContributionUsd).toBe(99_000);
  });

  it("keeps dirty fields and updates clean ones", () => {
    const current: GoalExtractSnapshot = {
      goals: [
        goal({
          id: "c1",
          type: "home",
          label: "My home (edited)",
          amountUsd: 2_000_000,
          withinMonths: 12,
        }),
      ],
      assumptions: { ...baseAssumptions, annualContributionUsd: 80_000 },
    };
    const baseline: GoalExtractSnapshot = {
      goals: [
        goal({
          id: "c1",
          type: "home",
          label: "購屋",
          amountUsd: 1_500_000,
          withinMonths: 12,
        }),
      ],
      assumptions: baseAssumptions,
    };
    const incoming: GoalExtractSnapshot = {
      goals: [
        goal({
          id: "e1",
          type: "home",
          label: "House",
          amountUsd: 1_600_000,
          withinMonths: 18,
        }),
      ],
      assumptions: { ...baseAssumptions, annualContributionUsd: 100_000 },
    };
    const result = mergeGoalExtract(current, incoming, baseline);
    expect(result.goals).toHaveLength(1);
    expect(result.goals[0].id).toBe("c1");
    // Dirty: label + amount kept; clean withinMonths takes extract.
    expect(result.goals[0].label).toBe("My home (edited)");
    expect(result.goals[0].amountUsd).toBe(2_000_000);
    expect(result.goals[0].withinMonths).toBe(18);
    // Contribution was dirty vs baseline → keep.
    expect(result.assumptions.annualContributionUsd).toBe(80_000);
    expect(result.summary.keptManualEdits).toBeGreaterThan(0);
    expect(result.summary.updatedFields).toBeGreaterThan(0);
  });

  it("fills empty/zero fields even when dirty vs baseline", () => {
    const current: GoalExtractSnapshot = {
      goals: [
        goal({
          id: "c1",
          type: "home",
          label: "",
          amountUsd: 0,
          withinMonths: 12,
        }),
      ],
      assumptions: { ...baseAssumptions, annualContributionUsd: 0 },
    };
    const baseline: GoalExtractSnapshot = {
      goals: [
        goal({
          id: "c1",
          type: "home",
          label: "old",
          amountUsd: 500_000,
          withinMonths: 12,
        }),
      ],
      assumptions: { ...baseAssumptions, annualContributionUsd: 40_000 },
    };
    const incoming: GoalExtractSnapshot = {
      goals: [
        goal({
          id: "e1",
          type: "home",
          label: "購屋",
          amountUsd: 1_500_000,
          withinMonths: 12,
          mortgage: { loanUsd: 3_000_000, annualRate: 0.03, termMonths: 360 },
        }),
      ],
      assumptions: { ...baseAssumptions, annualContributionUsd: 120_000 },
    };
    const result = mergeGoalExtract(current, incoming, baseline);
    expect(result.goals[0].label).toBe("購屋");
    expect(result.goals[0].amountUsd).toBe(1_500_000);
    expect(result.goals[0].mortgage?.loanUsd).toBe(3_000_000);
    expect(result.assumptions.annualContributionUsd).toBe(120_000);
  });

  it("appends unmatched extract goals and keeps form-only goals", () => {
    const current: GoalExtractSnapshot = {
      goals: [
        goal({ id: "c1", type: "education", label: "Kids tuition", withinMonths: 36 }),
        goal({ id: "c2", type: "liquidity", label: "Emergency", withinMonths: 6 }),
      ],
      assumptions: baseAssumptions,
    };
    const incoming: GoalExtractSnapshot = {
      goals: [
        goal({ id: "e1", type: "education", label: "Tuition", withinMonths: 36 }),
        goal({ id: "e2", type: "retirement", label: "退休", withinMonths: 120 }),
      ],
      assumptions: baseAssumptions,
    };
    const result = mergeGoalExtract(current, incoming, null);
    expect(result.goals).toHaveLength(3);
    expect(result.goals.map((g) => g.type).sort()).toEqual([
      "education",
      "liquidity",
      "retirement",
    ]);
    expect(result.goals.find((g) => g.type === "liquidity")?.id).toBe("c2");
    expect(result.goals.find((g) => g.type === "retirement")?.id).not.toBe("e2");
    expect(result.summary.addedGoals).toBe(1);
  });

  it("matches same type by closest withinMonths then label", () => {
    const current: GoalExtractSnapshot = {
      goals: [
        goal({ id: "a", type: "other", label: "Trip A", withinMonths: 12 }),
        goal({ id: "b", type: "other", label: "Trip B", withinMonths: 48 }),
      ],
      assumptions: baseAssumptions,
    };
    const incoming: GoalExtractSnapshot = {
      goals: [
        goal({ id: "e1", type: "other", label: "Trip B", withinMonths: 50 }),
        goal({ id: "e2", type: "other", label: "Trip A", withinMonths: 14 }),
      ],
      assumptions: baseAssumptions,
    };
    const result = mergeGoalExtract(current, incoming, {
      goals: current.goals,
      assumptions: baseAssumptions,
    });
    const a = result.goals.find((g) => g.id === "a")!;
    const b = result.goals.find((g) => g.id === "b")!;
    // Clean fields take extract; matched by months proximity.
    expect(a.withinMonths).toBe(14);
    expect(b.withinMonths).toBe(50);
  });

  it("respects returnTouched when baseline is null", () => {
    const current: GoalExtractSnapshot = {
      goals: [goal({ id: "c1", type: "other", label: "X" })],
      assumptions: {
        ...baseAssumptions,
        annualReturn: 0.09,
      },
    };
    const incoming: GoalExtractSnapshot = {
      goals: [goal({ id: "e1", type: "other", label: "X", withinMonths: 24 })],
      assumptions: {
        ...baseAssumptions,
        annualReturn: 0.05,
      },
    };
    const kept = mergeGoalExtract(current, incoming, null, {
      returnTouched: new Set(["annualReturn"]),
    });
    expect(kept.assumptions.annualReturn).toBe(0.09);

    const taken = mergeGoalExtract(current, incoming, null, {
      returnTouched: new Set(),
    });
    expect(taken.assumptions.annualReturn).toBe(0.05);
  });
});
