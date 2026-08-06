/**
 * Financial Goal Simulator — multi-goal projection + assumptions (deterministic).
 * AI extracts into this shape; the engine owns all path math.
 */

export type FinancialGoalType =
  | "home"
  | "retirement"
  | "education"
  | "liquidity"
  | "other";

export type FinancialGoal = {
  id: string;
  type: FinancialGoalType;
  label: string;
  /** Target amount in USD (today's dollars unless inflation applied). */
  amountUsd: number;
  /** Months from as-of until the goal event. */
  withinMonths: number;
  /** Higher = more important when cash is scarce (1–5). */
  priority: number;
};

export type GoalAssumptions = {
  /** Base expected annual return on investable wealth (e.g. 0.05). */
  annualReturn: number;
  /** Optimistic / conservative deltas around base (absolute, e.g. 0.02). */
  optimisticDelta: number;
  conservativeDelta: number;
  /** Extra USD contributed at the end of each year (then monthly-smoothed). */
  annualContributionUsd: number;
  /** YoY growth of annual contribution (e.g. 0.03). */
  contributionGrowth: number;
  /** Optional inflation for goal amounts (0 = off). */
  inflation: number;
};

export type GoalScenarioId = "conservative" | "base" | "optimistic";

export type GoalPathPoint = {
  month: number;
  /** Wealth after contributions / returns / withdrawals this month. */
  wealth: number;
  contributed: number;
  withdrawn: number;
  /** Goal ids that fire this month. */
  goalIds: string[];
};

export type GoalEventOutcome = {
  goal: FinancialGoal;
  month: number;
  neededUsd: number;
  fundedUsd: number;
  shortfallUsd: number;
  covered: boolean;
};

export type GoalScenarioResult = {
  id: GoalScenarioId;
  annualReturn: number;
  path: GoalPathPoint[];
  events: GoalEventOutcome[];
  endingWealth: number;
  totalContributed: number;
  totalWithdrawn: number;
  totalShortfall: number;
};

export type GoalProjectionResult = {
  assumptions: GoalAssumptions;
  goals: FinancialGoal[];
  startingWealth: number;
  cashUsd: number;
  scenarios: Record<GoalScenarioId, GoalScenarioResult>;
  /** Earliest uncovered goal event on the base path (if any). */
  firstShortfall: GoalEventOutcome | null;
};

export const FINANCIAL_GOAL_TYPES: readonly FinancialGoalType[] = [
  "home",
  "retirement",
  "education",
  "liquidity",
  "other",
] as const;

export const DEFAULT_GOAL_ASSUMPTIONS: GoalAssumptions = {
  annualReturn: 0.05,
  optimisticDelta: 0.02,
  conservativeDelta: 0.02,
  annualContributionUsd: 0,
  contributionGrowth: 0,
  inflation: 0,
};

export function createGoalId(): string {
  return `goal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function clampAssumptions(a: GoalAssumptions): GoalAssumptions {
  const annualReturn = Math.min(0.2, Math.max(-0.05, a.annualReturn));
  const optimisticDelta = Math.min(0.1, Math.max(0, a.optimisticDelta));
  const conservativeDelta = Math.min(0.1, Math.max(0, a.conservativeDelta));
  return {
    annualReturn,
    optimisticDelta,
    conservativeDelta,
    annualContributionUsd: Math.max(0, a.annualContributionUsd),
    contributionGrowth: Math.min(0.2, Math.max(-0.05, a.contributionGrowth)),
    inflation: Math.min(0.15, Math.max(0, a.inflation)),
  };
}

function inflatedGoalAmount(
  goal: FinancialGoal,
  inflation: number,
): number {
  if (!(inflation > 0) || goal.withinMonths <= 0) return goal.amountUsd;
  const years = goal.withinMonths / 12;
  return goal.amountUsd * (1 + inflation) ** years;
}

function monthlyRate(annual: number): number {
  return (1 + annual) ** (1 / 12) - 1;
}

/**
 * Project wealth month-by-month. Goals withdraw in priority order when due.
 * Contributions are applied monthly as annualContribution/12 with YoY growth.
 */
export function projectGoalScenario(
  goals: FinancialGoal[],
  startingWealth: number,
  assumptions: GoalAssumptions,
  annualReturn: number,
  scenarioId: GoalScenarioId,
): GoalScenarioResult {
  const a = clampAssumptions(assumptions);
  const horizon = Math.max(
    1,
    ...goals.map((g) => g.withinMonths),
    12,
  );
  const rMonth = monthlyRate(annualReturn);
  const sortedGoals = [...goals].sort((x, y) => {
    if (x.withinMonths !== y.withinMonths) {
      return x.withinMonths - y.withinMonths;
    }
    return y.priority - x.priority;
  });

  let wealth = Math.max(0, startingWealth);
  let totalContributed = 0;
  let totalWithdrawn = 0;
  let totalShortfall = 0;
  const path: GoalPathPoint[] = [
    {
      month: 0,
      wealth: Math.round(wealth),
      contributed: 0,
      withdrawn: 0,
      goalIds: [],
    },
  ];
  const events: GoalEventOutcome[] = [];

  for (let m = 1; m <= horizon; m++) {
    wealth = Math.max(0, wealth * (1 + rMonth));

    const yearIndex = Math.floor((m - 1) / 12);
    const annualContrib =
      a.annualContributionUsd * (1 + a.contributionGrowth) ** yearIndex;
    const monthContrib = annualContrib / 12;
    wealth += monthContrib;
    totalContributed += monthContrib;

    const due = sortedGoals.filter((g) => g.withinMonths === m);
    let withdrawn = 0;
    const goalIds: string[] = [];
    for (const goal of due) {
      const needed = inflatedGoalAmount(goal, a.inflation);
      const funded = Math.min(wealth, needed);
      const shortfall = Math.max(0, needed - funded);
      wealth -= funded;
      withdrawn += funded;
      totalWithdrawn += funded;
      totalShortfall += shortfall;
      goalIds.push(goal.id);
      events.push({
        goal,
        month: m,
        neededUsd: Math.round(needed),
        fundedUsd: Math.round(funded),
        shortfallUsd: Math.round(shortfall),
        covered: shortfall <= 0.5,
      });
    }

    path.push({
      month: m,
      wealth: Math.round(wealth),
      contributed: Math.round(monthContrib),
      withdrawn: Math.round(withdrawn),
      goalIds,
    });
  }

  return {
    id: scenarioId,
    annualReturn,
    path,
    events,
    endingWealth: Math.round(wealth),
    totalContributed: Math.round(totalContributed),
    totalWithdrawn: Math.round(totalWithdrawn),
    totalShortfall: Math.round(totalShortfall),
  };
}

export function projectFinancialGoals(
  goals: FinancialGoal[],
  client: { aum_usd: number; cash_usd: number },
  assumptions: GoalAssumptions,
): GoalProjectionResult {
  const a = clampAssumptions(assumptions);
  const startingWealth = Math.max(0, client.aum_usd);
  const baseR = a.annualReturn;
  const scenarios = {
    conservative: projectGoalScenario(
      goals,
      startingWealth,
      a,
      Math.max(-0.05, baseR - a.conservativeDelta),
      "conservative",
    ),
    base: projectGoalScenario(
      goals,
      startingWealth,
      a,
      baseR,
      "base",
    ),
    optimistic: projectGoalScenario(
      goals,
      startingWealth,
      a,
      Math.min(0.25, baseR + a.optimisticDelta),
      "optimistic",
    ),
  } as const;

  const firstShortfall =
    scenarios.base.events.find((e) => !e.covered) ?? null;

  return {
    assumptions: a,
    goals,
    startingWealth,
    cashUsd: Math.max(0, client.cash_usd),
    scenarios,
    firstShortfall,
  };
}

/** Chart rows: one point per month with three scenario wealths + goal markers. */
export function buildGoalChartSeries(
  result: GoalProjectionResult,
): {
  month: number;
  base: number;
  optimistic: number;
  conservative: number;
  goalMarkers: string;
}[] {
  const base = result.scenarios.base.path;
  const opt = result.scenarios.optimistic.path;
  const cons = result.scenarios.conservative.path;
  const labelById = new Map(result.goals.map((g) => [g.id, g.label || g.type]));

  return base.map((p, i) => ({
    month: p.month,
    base: p.wealth,
    optimistic: opt[i]?.wealth ?? p.wealth,
    conservative: cons[i]?.wealth ?? p.wealth,
    goalMarkers: p.goalIds.map((id) => labelById.get(id) ?? id).join(", "),
  }));
}

export type GoalHandoffPayload = {
  goals: FinancialGoal[];
  assumptions: GoalAssumptions;
};

export function goalsToSearchParams(
  goals: FinancialGoal[],
  assumptions: GoalAssumptions,
): URLSearchParams {
  const qs = new URLSearchParams();
  // Near-term liquidity handoff: earliest high-priority withdrawal-like goal.
  const liquidity = [...goals]
    .filter((g) =>
      g.type === "home" || g.type === "liquidity" || g.type === "education",
    )
    .sort((a, b) => a.withinMonths - b.withinMonths || b.priority - a.priority)[0];
  if (liquidity) {
    qs.set("goalType", liquidity.type);
    qs.set("goalAmount", String(Math.round(liquidity.amountUsd)));
    qs.set("goalMonths", String(liquidity.withinMonths));
    if (liquidity.label) qs.set("goalDesc", liquidity.label.slice(0, 300));
  }
  qs.set("goalReturn", String(assumptions.annualReturn));
  qs.set("goalContribute", String(Math.round(assumptions.annualContributionUsd)));
  qs.set("goalJson", JSON.stringify({ goals, assumptions }));
  return qs;
}

export function parseGoalHandoffFromSearch(
  params: URLSearchParams,
): GoalHandoffPayload | null {
  const raw = params.get("goalJson");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as GoalHandoffPayload;
      if (Array.isArray(parsed.goals) && parsed.assumptions) {
        return {
          goals: parsed.goals,
          assumptions: clampAssumptions(parsed.assumptions),
        };
      }
    } catch {
      /* fall through */
    }
  }
  const type = params.get("goalType") as FinancialGoalType | null;
  const amount = Number(params.get("goalAmount"));
  const months = Number(params.get("goalMonths"));
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
    goals: [
      {
        id: createGoalId(),
        type,
        label: params.get("goalDesc")?.trim() || type,
        amountUsd: amount,
        withinMonths: Math.min(360, Math.max(1, Math.round(months))),
        priority: 3,
      },
    ],
    assumptions: clampAssumptions({
      ...DEFAULT_GOAL_ASSUMPTIONS,
      annualReturn: Number(params.get("goalReturn")) || DEFAULT_GOAL_ASSUMPTIONS.annualReturn,
      annualContributionUsd:
        Number(params.get("goalContribute")) || 0,
    }),
  };
}

export function nearestLiquidityGoal(
  goals: FinancialGoal[],
): FinancialGoal | null {
  const candidates = goals.filter(
    (g) =>
      g.type === "home" ||
      g.type === "liquidity" ||
      g.type === "education" ||
      g.withinMonths <= 60,
  );
  if (!candidates.length) return goals[0] ?? null;
  return [...candidates].sort(
    (a, b) => a.withinMonths - b.withinMonths || b.priority - a.priority,
  )[0];
}

export function goalHorizonYears(goals: FinancialGoal[]): number {
  const maxMonths = Math.max(12, ...goals.map((g) => g.withinMonths));
  return Math.min(50, Math.max(1, Math.ceil(maxMonths / 12)));
}
