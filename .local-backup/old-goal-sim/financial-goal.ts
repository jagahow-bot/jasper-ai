/**
 * Financial Goal Simulator — pure types + deterministic gap math (MVP).
 * AI narrative stays out of this module; numbers are rule-based.
 */

export type FinancialGoalType =
  | "home"
  | "retirement"
  | "education"
  | "other";

export type FinancialGoal = {
  type: FinancialGoalType;
  /** Target amount in USD. */
  amountUsd: number;
  /** Horizon in months (1–120). */
  withinMonths: number;
  description?: string;
};

export type GoalCoverageStatus = "covered" | "partial" | "shortfall";

export type FinancialGoalGapResult = {
  goal: FinancialGoal;
  cashUsd: number;
  aumUsd: number;
  /** max(0, goal − cash) — primary near-term liquidity gap. */
  cashShortfallUsd: number;
  /** max(0, cash − goal) — cash left after reserving the goal. */
  surplusCashUsd: number;
  /** Share of goal covered by cash alone (0–1+). */
  cashCoverageRatio: number;
  status: GoalCoverageStatus;
  /**
   * Illustrative terminal AUM if surplus (or full AUM when covered) compounds
   * at assumedAnnualReturn for withinMonths. Not a forecast.
   */
  projectedInvestableUsd: number;
  assumedAnnualReturn: number;
  /** Simple path for charts: months from 0 → horizon. */
  timeline: { month: number; reservedCash: number; investable: number; goalLine: number }[];
};

/** PoC default growth assumption for the investable remainder (disclose in UI). */
export const GOAL_ASSUMED_ANNUAL_RETURN = 0.05;

export const FINANCIAL_GOAL_TYPES: readonly FinancialGoalType[] = [
  "home",
  "retirement",
  "education",
  "other",
] as const;

export type GoalCollectStep =
  | "type"
  | "amount"
  | "months"
  | "description"
  | "confirm"
  | "result";

export function nextGoalCollectStep(step: GoalCollectStep): GoalCollectStep {
  const order: GoalCollectStep[] = [
    "type",
    "amount",
    "months",
    "description",
    "confirm",
    "result",
  ];
  const i = order.indexOf(step);
  return order[Math.min(i + 1, order.length - 1)];
}

export function parseGoalAmountUsd(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, "").replace(/US\$|USD|\$/gi, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

export function parseGoalMonths(raw: string): number | null {
  const m = Number(String(raw).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(m) || m < 1) return null;
  return Math.min(120, Math.max(1, Math.round(m)));
}

function coverageStatus(
  cashUsd: number,
  goalUsd: number,
): GoalCoverageStatus {
  if (cashUsd >= goalUsd) return "covered";
  if (cashUsd >= goalUsd * 0.5) return "partial";
  return "shortfall";
}

/**
 * Deterministic liquidity-style gap vs cash, plus a simple compound path for
 * the investable remainder (or full book when already covered).
 */
export function computeFinancialGoalGap(
  goal: FinancialGoal,
  client: { cash_usd: number; aum_usd: number },
  opts?: { assumedAnnualReturn?: number },
): FinancialGoalGapResult {
  const cashUsd = Math.max(0, client.cash_usd);
  const aumUsd = Math.max(0, client.aum_usd);
  const goalUsd = Math.max(0, goal.amountUsd);
  const months = Math.min(120, Math.max(1, goal.withinMonths));
  const assumedAnnualReturn =
    opts?.assumedAnnualReturn ?? GOAL_ASSUMED_ANNUAL_RETURN;

  const cashShortfallUsd = Math.max(0, goalUsd - cashUsd);
  const surplusCashUsd = Math.max(0, cashUsd - goalUsd);
  const cashCoverageRatio = goalUsd > 0 ? cashUsd / goalUsd : 1;
  const status = coverageStatus(cashUsd, goalUsd);

  // Capital that can stay invested / be deployed after reserving the goal.
  const investableSeed =
    status === "covered"
      ? Math.max(surplusCashUsd, aumUsd - goalUsd)
      : Math.max(0, aumUsd - cashUsd);

  const years = months / 12;
  const projectedInvestableUsd =
    investableSeed * (1 + assumedAnnualReturn) ** years;

  const reservedAtStart = Math.min(cashUsd, goalUsd);
  const timeline: FinancialGoalGapResult["timeline"] = [];
  const steps = Math.min(months, 24);
  for (let i = 0; i <= steps; i++) {
    const month = Math.round((i / steps) * months);
    const tYears = month / 12;
    const investable =
      investableSeed * (1 + assumedAnnualReturn) ** tYears;
    timeline.push({
      month,
      reservedCash: reservedAtStart,
      investable: Math.round(investable),
      goalLine: goalUsd,
    });
  }

  return {
    goal,
    cashUsd,
    aumUsd,
    cashShortfallUsd,
    surplusCashUsd,
    cashCoverageRatio,
    status,
    projectedInvestableUsd: Math.round(projectedInvestableUsd),
    assumedAnnualReturn,
    timeline,
  };
}

export type GoalHandoffParams = {
  goalType: FinancialGoalType;
  goalAmount: number;
  goalMonths: number;
  goalDesc?: string;
};

export function goalToHandoffParams(goal: FinancialGoal): GoalHandoffParams {
  return {
    goalType: goal.type,
    goalAmount: Math.round(goal.amountUsd),
    goalMonths: goal.withinMonths,
    ...(goal.description?.trim()
      ? { goalDesc: goal.description.trim().slice(0, 300) }
      : {}),
  };
}

export function parseGoalHandoffFromSearch(
  params: URLSearchParams,
): FinancialGoal | null {
  const type = params.get("goalType") as FinancialGoalType | null;
  const amount = Number(params.get("goalAmount"));
  const months = Number(params.get("goalMonths"));
  const desc = params.get("goalDesc")?.trim();
  if (
    !type ||
    !FINANCIAL_GOAL_TYPES.includes(type) ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isFinite(months) ||
    months < 1
  ) {
    return null;
  }
  return {
    type,
    amountUsd: amount,
    withinMonths: Math.min(120, Math.max(1, Math.round(months))),
    ...(desc ? { description: desc.slice(0, 300) } : {}),
  };
}

/** Horizon years for Overlay client_profile (ceil months/12, min 1). */
export function goalHorizonYears(goal: FinancialGoal): number {
  return Math.min(50, Math.max(1, Math.ceil(goal.withinMonths / 12)));
}
