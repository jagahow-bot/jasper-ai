import type { FinancialGoal, GoalAssumptions } from "@/lib/financial-goal";
import { DEFAULT_GOAL_ASSUMPTIONS } from "@/lib/financial-goal";
import type { GoalPathInsight } from "@/lib/financial-goal-insights";

const KEY_PREFIX = "jasper.financialGoals.v2.";
const INSIGHTS_PREFIX = "jasper.financialGoalInsights.v1.";

export type StoredGoalPlan = {
  notes: string;
  goals: FinancialGoal[];
  assumptions: GoalAssumptions;
  updatedAt: string;
};

export function loadGoalPlan(clientId: string): StoredGoalPlan | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY_PREFIX + clientId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredGoalPlan;
    if (!Array.isArray(parsed.goals)) return null;
    return {
      notes: parsed.notes ?? "",
      goals: parsed.goals,
      assumptions: { ...DEFAULT_GOAL_ASSUMPTIONS, ...parsed.assumptions },
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

export function saveGoalPlan(
  clientId: string,
  plan: Omit<StoredGoalPlan, "updatedAt">,
): void {
  if (typeof window === "undefined") return;
  const payload: StoredGoalPlan = {
    ...plan,
    updatedAt: new Date().toISOString(),
  };
  window.sessionStorage.setItem(KEY_PREFIX + clientId, JSON.stringify(payload));
}

export function clearGoalPlan(clientId: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(KEY_PREFIX + clientId);
  clearGoalInsights(clientId);
}

export function saveGoalInsights(
  clientId: string,
  insights: GoalPathInsight[],
): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(
    INSIGHTS_PREFIX + clientId,
    JSON.stringify({ insights, updatedAt: new Date().toISOString() }),
  );
}

export function loadGoalInsights(clientId: string): GoalPathInsight[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(INSIGHTS_PREFIX + clientId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { insights?: GoalPathInsight[] };
    if (!Array.isArray(parsed.insights) || parsed.insights.length === 0) {
      return null;
    }
    return parsed.insights;
  } catch {
    return null;
  }
}

export function clearGoalInsights(clientId: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(INSIGHTS_PREFIX + clientId);
}
