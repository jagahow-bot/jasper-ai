import type { FinancialGoal } from "@/lib/financial-goal";

const KEY_PREFIX = "jasper.financialGoal.v1.";

export type StoredFinancialGoalSession = {
  goal: FinancialGoal | null;
  updatedAt: string;
};

export function loadFinancialGoalSession(
  clientId: string,
): StoredFinancialGoalSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY_PREFIX + clientId);
    if (!raw) return null;
    return JSON.parse(raw) as StoredFinancialGoalSession;
  } catch {
    return null;
  }
}

export function saveFinancialGoalSession(
  clientId: string,
  goal: FinancialGoal | null,
): void {
  if (typeof window === "undefined") return;
  const payload: StoredFinancialGoalSession = {
    goal,
    updatedAt: new Date().toISOString(),
  };
  window.sessionStorage.setItem(KEY_PREFIX + clientId, JSON.stringify(payload));
}

export function clearFinancialGoalSession(clientId: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(KEY_PREFIX + clientId);
}
