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

/** Amortizing mortgage that starts the month after a home purchase. */
export type HomeMortgage = {
  /** Loan principal at purchase (purchase price − down payment). */
  loanUsd: number;
  /** Annual mortgage rate as fraction (e.g. 0.03 = 3%). */
  annualRate: number;
  /** Amortizing term in months. */
  termMonths: number;
};

export type FinancialGoal = {
  id: string;
  type: FinancialGoalType;
  label: string;
  /**
   * Cash at the goal event (today's dollars unless inflation applied).
   * - home: down payment / cash at purchase
   * - retirement: annual living spend (withdrawn monthly after retirement)
   * - other types: lump-sum need at the event month
   */
  amountUsd: number;
  /** Months from as-of until the goal event. */
  withinMonths: number;
  /** Higher = more important when cash is scarce (1–5). */
  priority: number;
  /** Optional home mortgage; ignored unless type === "home". */
  mortgage?: HomeMortgage | null;
  /**
   * Retirement only: years of monthly spending after retirement starts.
   * Defaults to 20 when omitted.
   */
  retirementSpendYears?: number | null;
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
  /**
   * Current annual living spend drawn from portfolio (today's dollars).
   * Deducted monthly until retirement starts; then retirement goal spend takes over.
   */
  annualLivingSpendUsd: number;
  /** Optional inflation for goal amounts and living spend (0 = off). */
  inflation: number;
};

export type GoalScenarioId = "conservative" | "base" | "optimistic";

export type GoalPathPoint = {
  month: number;
  /** Wealth after contributions / returns / withdrawals this month. */
  wealth: number;
  contributed: number;
  withdrawn: number;
  mortgagePaid: number;
  retirementPaid: number;
  /** Current lifestyle draw (pre-retirement) this month. */
  livingPaid: number;
  /** Goal ids that fire this month (cash events / retirement start). */
  goalIds: string[];
};

export type GoalEventKind =
  | "goal"
  | "mortgage_start"
  | "mortgage_end"
  | "retirement_start"
  | "inheritance";

export type GoalEventOutcome = {
  kind: GoalEventKind;
  goal: FinancialGoal;
  month: number;
  neededUsd: number;
  fundedUsd: number;
  shortfallUsd: number;
  covered: boolean;
  /** For mortgage_start / retirement_start: scheduled monthly payment. */
  monthlyPaymentUsd?: number;
};

export type GoalScenarioResult = {
  id: GoalScenarioId;
  annualReturn: number;
  path: GoalPathPoint[];
  events: GoalEventOutcome[];
  endingWealth: number;
  totalContributed: number;
  totalWithdrawn: number;
  totalMortgagePaid: number;
  totalRetirementPaid: number;
  totalLivingPaid: number;
  totalShortfall: number;
};

export type GoalProjectionResult = {
  assumptions: GoalAssumptions;
  goals: FinancialGoal[];
  startingWealth: number;
  cashUsd: number;
  /** Full projection length (goals and/or life expectancy). */
  horizonMonths: number;
  /** Planning life expectancy age used for path end (if age known). */
  lifeExpectancyAge: number | null;
  /** Month index where path ends at LE (same as horizon when LE drives end). */
  lifeExpectancyMonth: number | null;
  /** Base-path wealth at life-expectancy end — treated as estate / inheritance. */
  inheritanceUsd: number;
  scenarios: Record<GoalScenarioId, GoalScenarioResult>;
  /** Earliest uncovered goal/mortgage event on the base path (if any). */
  firstShortfall: GoalEventOutcome | null;
};

export type GoalChartPoint = {
  month: number;
  base: number;
  optimistic: number;
  conservative: number;
  goalMarkers: string;
  eventLabel: string | null;
};

/** Preset chart windows (months). `"max"` = full projection horizon. */
export const GOAL_CHART_HORIZON_OPTIONS = [
  12, 36, 60, 120, 240, 360, "max",
] as const;

export type GoalChartHorizonOption = (typeof GOAL_CHART_HORIZON_OPTIONS)[number];

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
  annualLivingSpendUsd: 0,
  inflation: 0,
};

export const DEFAULT_HOME_MORTGAGE: HomeMortgage = {
  loanUsd: 0,
  annualRate: 0.03,
  termMonths: 360,
};

export const DEFAULT_RETIREMENT_SPEND_YEARS = 20;

/** Planning defaults (illustrative period LE at birth — not formal actuarial advice). */
export const PLANNING_LIFE_EXPECTANCY_YEARS = {
  male: 78,
  female: 85,
  unisex: 82,
} as const;

export type ClientGender = "male" | "female";

export function lifeExpectancyYears(
  gender?: ClientGender | null,
): number {
  if (gender === "male") return PLANNING_LIFE_EXPECTANCY_YEARS.male;
  if (gender === "female") return PLANNING_LIFE_EXPECTANCY_YEARS.female;
  return PLANNING_LIFE_EXPECTANCY_YEARS.unisex;
}

/**
 * Years of retirement spending ≈ life expectancy − retirement age.
 * Clamped to the simulator's 1–40 year spend window.
 */
export function retirementSpendYearsFromLongevity(
  retirementAge: number,
  gender?: ClientGender | null,
): number {
  const age = Math.min(85, Math.max(40, Math.round(retirementAge) || 60));
  return clampRetirementSpendYears(lifeExpectancyYears(gender) - age);
}

/** Months from now until planning life expectancy; null if age unknown or already past LE. */
export function monthsUntilLifeExpectancy(
  age: number | null | undefined,
  gender?: ClientGender | null,
): number | null {
  if (age == null || !Number.isFinite(age) || age < 0) return null;
  const le = lifeExpectancyYears(gender);
  const yearsLeft = le - age;
  if (yearsLeft <= 0) return null;
  return Math.min(600, Math.max(1, Math.round(yearsLeft * 12)));
}

export function createGoalId(): string {
  return `goal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function clampAssumptions(a: GoalAssumptions): GoalAssumptions {
  // Soft engine bounds only — goal-compare may pass higher sample means;
  // keep paths finite without a “planning philosophy” ceiling.
  const annualReturn = Math.min(0.35, Math.max(-0.15, a.annualReturn));
  const optimisticDelta = Math.min(0.2, Math.max(0, a.optimisticDelta));
  const conservativeDelta = Math.min(0.2, Math.max(0, a.conservativeDelta));
  return {
    annualReturn,
    optimisticDelta,
    conservativeDelta,
    annualContributionUsd: Math.max(0, a.annualContributionUsd),
    contributionGrowth: Math.min(0.2, Math.max(-0.05, a.contributionGrowth)),
    annualLivingSpendUsd: Math.max(0, a.annualLivingSpendUsd ?? 0),
    inflation: Math.min(0.15, Math.max(0, a.inflation)),
  };
}

export function clampMortgage(
  m: HomeMortgage | null | undefined,
): HomeMortgage | null {
  if (!m || !(m.loanUsd > 0)) return null;
  return {
    loanUsd: Math.max(0, m.loanUsd),
    annualRate: Math.min(0.2, Math.max(0, m.annualRate)),
    termMonths: Math.min(480, Math.max(12, Math.round(m.termMonths) || 12)),
  };
}

export function clampRetirementSpendYears(
  years: number | null | undefined,
): number {
  if (years == null || !Number.isFinite(years)) {
    return DEFAULT_RETIREMENT_SPEND_YEARS;
  }
  return Math.min(40, Math.max(1, Math.round(years)));
}

function monthlyRate(annual: number): number {
  return (1 + annual) ** (1 / 12) - 1;
}

/** Standard amortizing monthly payment. */
export function monthlyMortgagePayment(m: HomeMortgage): number {
  const clamped = clampMortgage(m);
  if (!clamped) return 0;
  const { loanUsd: loan, annualRate, termMonths: n } = clamped;
  const r = monthlyRate(annualRate);
  if (r <= 0) return loan / n;
  const factor = (1 + r) ** n;
  return (loan * r * factor) / (factor - 1);
}

function inflatedGoalAmount(goal: FinancialGoal, inflation: number): number {
  if (!(inflation > 0) || goal.withinMonths <= 0) return goal.amountUsd;
  const years = goal.withinMonths / 12;
  return goal.amountUsd * (1 + inflation) ** years;
}

export function projectionHorizonMonths(
  goals: FinancialGoal[],
  longevityMonths?: number | null,
): number {
  let h = 12;
  for (const g of goals) {
    h = Math.max(h, g.withinMonths);
    if (g.type === "home") {
      const mort = clampMortgage(g.mortgage);
      if (mort) h = Math.max(h, g.withinMonths + mort.termMonths);
    }
    if (g.type === "retirement") {
      const years = clampRetirementSpendYears(g.retirementSpendYears);
      h = Math.max(h, g.withinMonths + years * 12);
    }
  }
  // Prefer ending at planning life expectancy when known (remaining wealth = estate).
  if (longevityMonths != null && longevityMonths > 0) {
    h = longevityMonths;
  }
  return Math.min(600, Math.max(1, h));
}

export function resolveChartHorizonMonths(
  option: GoalChartHorizonOption,
  fullHorizon: number,
): number {
  if (option === "max") return Math.max(1, fullHorizon);
  return Math.max(1, Math.min(fullHorizon, option));
}

type ActiveMortgage = {
  goal: FinancialGoal;
  payment: number;
  endMonth: number;
};

type ActiveRetirementSpend = {
  goal: FinancialGoal;
  /** Monthly spend at retirement start (already inflation-adjusted to start). */
  monthly0: number;
  startMonth: number;
  endMonth: number;
};

/** Earliest retirement start month, or null if none. */
export function earliestRetirementMonth(
  goals: FinancialGoal[],
): number | null {
  let earliest: number | null = null;
  for (const g of goals) {
    if (g.type !== "retirement") continue;
    const m = Math.max(1, Math.round(g.withinMonths));
    if (earliest == null || m < earliest) earliest = m;
  }
  return earliest;
}

/**
 * Project wealth month-by-month. Goals withdraw in priority order when due.
 * - Home mortgages: amortizing payment each month after purchase.
 * - Current living: annualLivingSpendUsd/12 (inflated) until retirement starts.
 * - Retirement: amountUsd is annual living spend → withdrawn monthly over spend years.
 * Contributions are applied monthly as annualContribution/12 with YoY growth,
 * and stop from the earliest retirement start month onward (no fixed saving while retired).
 *
 * `returnForMonth` (optional, 1-indexed) overrides the constant annual return
 * per month — used by segmented goal planning to chain period segments, each
 * with its own planning rate, into one continuous wealth path.
 */
export function projectGoalScenario(
  goals: FinancialGoal[],
  startingWealth: number,
  assumptions: GoalAssumptions,
  annualReturn: number,
  scenarioId: GoalScenarioId,
  horizonOverride?: number,
  returnForMonth?: (month: number) => number,
): GoalScenarioResult {
  const a = clampAssumptions(assumptions);
  const horizon = Math.max(
    1,
    horizonOverride ?? projectionHorizonMonths(goals),
  );
  const rMonth = monthlyRate(annualReturn);
  const retireStartMonth = earliestRetirementMonth(goals);
  const sortedGoals = [...goals].sort((x, y) => {
    if (x.withinMonths !== y.withinMonths) {
      return x.withinMonths - y.withinMonths;
    }
    return y.priority - x.priority;
  });

  let wealth = Math.max(0, startingWealth);
  let totalContributed = 0;
  let totalWithdrawn = 0;
  let totalMortgagePaid = 0;
  let totalRetirementPaid = 0;
  let totalLivingPaid = 0;
  let totalShortfall = 0;
  const path: GoalPathPoint[] = [
    {
      month: 0,
      wealth: Math.round(wealth),
      contributed: 0,
      withdrawn: 0,
      mortgagePaid: 0,
      retirementPaid: 0,
      livingPaid: 0,
      goalIds: [],
    },
  ];
  const events: GoalEventOutcome[] = [];
  const activeMortgages: ActiveMortgage[] = [];
  const activeRetirement: ActiveRetirementSpend[] = [];

  for (let m = 1; m <= horizon; m++) {
    const r = returnForMonth ? monthlyRate(returnForMonth(m)) : rMonth;
    wealth = Math.max(0, wealth * (1 + r));

    const beforeRetirement =
      retireStartMonth == null || m < retireStartMonth;
    const yearIndex = Math.floor((m - 1) / 12);
    const annualContrib = beforeRetirement
      ? a.annualContributionUsd * (1 + a.contributionGrowth) ** yearIndex
      : 0;
    const monthContrib = annualContrib / 12;
    wealth += monthContrib;
    totalContributed += monthContrib;

    let livingPaid = 0;
    if (beforeRetirement && a.annualLivingSpendUsd > 0) {
      const annualLiving =
        a.annualLivingSpendUsd * (1 + a.inflation) ** yearIndex;
      const dueLiving = annualLiving / 12;
      const pay = Math.min(wealth, dueLiving);
      const short = Math.max(0, dueLiving - pay);
      wealth -= pay;
      livingPaid = pay;
      totalLivingPaid += pay;
      totalWithdrawn += pay;
      totalShortfall += short;
    }

    const due = sortedGoals.filter((g) => g.withinMonths === m);
    let withdrawn = 0;
    const goalIds: string[] = [];
    for (const goal of due) {
      goalIds.push(goal.id);

      if (goal.type === "retirement") {
        const years = clampRetirementSpendYears(goal.retirementSpendYears);
        const annualAtStart = inflatedGoalAmount(goal, a.inflation);
        const monthly0 = annualAtStart / 12;
        activeRetirement.push({
          goal,
          monthly0,
          startMonth: m,
          endMonth: m + years * 12 - 1,
        });
        events.push({
          kind: "retirement_start",
          goal,
          month: m,
          neededUsd: Math.round(annualAtStart * years),
          fundedUsd: 0,
          shortfallUsd: 0,
          covered: true,
          monthlyPaymentUsd: Math.round(monthly0),
        });
        continue;
      }

      const needed = inflatedGoalAmount(goal, a.inflation);
      const funded = Math.min(wealth, needed);
      const shortfall = Math.max(0, needed - funded);
      wealth -= funded;
      withdrawn += funded;
      totalWithdrawn += funded;
      totalShortfall += shortfall;
      events.push({
        kind: "goal",
        goal,
        month: m,
        neededUsd: Math.round(needed),
        fundedUsd: Math.round(funded),
        shortfallUsd: Math.round(shortfall),
        covered: shortfall <= 0.5,
      });

      if (goal.type === "home") {
        const mort = clampMortgage(goal.mortgage);
        if (mort) {
          const payment = monthlyMortgagePayment(mort);
          const endMonth = m + mort.termMonths;
          activeMortgages.push({
            goal,
            payment,
            endMonth,
          });
          events.push({
            kind: "mortgage_start",
            goal,
            month: m,
            neededUsd: Math.round(mort.loanUsd),
            fundedUsd: Math.round(mort.loanUsd),
            shortfallUsd: 0,
            covered: true,
            monthlyPaymentUsd: Math.round(payment),
          });
          events.push({
            kind: "mortgage_end",
            goal,
            month: endMonth,
            neededUsd: 0,
            fundedUsd: 0,
            shortfallUsd: 0,
            covered: true,
          });
        }
      }
    }

    let mortgagePaid = 0;
    for (const mort of activeMortgages) {
      if (m <= mort.goal.withinMonths || m > mort.endMonth) continue;
      const pay = Math.min(wealth, mort.payment);
      const short = Math.max(0, mort.payment - pay);
      wealth -= pay;
      mortgagePaid += pay;
      totalMortgagePaid += pay;
      totalShortfall += short;
    }

    let retirementPaid = 0;
    for (const r of activeRetirement) {
      if (m < r.startMonth || m > r.endMonth) continue;
      const yearIdx = Math.floor((m - r.startMonth) / 12);
      const duePay = r.monthly0 * (1 + a.inflation) ** yearIdx;
      const pay = Math.min(wealth, duePay);
      const short = Math.max(0, duePay - pay);
      wealth -= pay;
      retirementPaid += pay;
      totalRetirementPaid += pay;
      totalWithdrawn += pay;
      totalShortfall += short;
    }

    path.push({
      month: m,
      wealth: Math.round(wealth),
      contributed: Math.round(monthContrib),
      withdrawn: Math.round(withdrawn + retirementPaid + livingPaid),
      mortgagePaid: Math.round(mortgagePaid),
      retirementPaid: Math.round(retirementPaid),
      livingPaid: Math.round(livingPaid),
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
    totalMortgagePaid: Math.round(totalMortgagePaid),
    totalRetirementPaid: Math.round(totalRetirementPaid),
    totalLivingPaid: Math.round(totalLivingPaid),
    totalShortfall: Math.round(totalShortfall),
  };
}

export function projectFinancialGoals(
  goals: FinancialGoal[],
  client: {
    aum_usd: number;
    cash_usd: number;
    age?: number | null;
    gender?: ClientGender | null;
  },
  assumptions: GoalAssumptions,
): GoalProjectionResult {
  const a = clampAssumptions(assumptions);
  const startingWealth = Math.max(0, client.aum_usd);
  const lifeExpectancyAge =
    client.age != null && Number.isFinite(client.age)
      ? lifeExpectancyYears(client.gender)
      : null;
  const lifeExpectancyMonth = monthsUntilLifeExpectancy(
    client.age,
    client.gender,
  );
  const horizonMonths = projectionHorizonMonths(goals, lifeExpectancyMonth);
  const baseR = a.annualReturn;
  const scenarios = {
    conservative: projectGoalScenario(
      goals,
      startingWealth,
      a,
      Math.max(-0.05, baseR - a.conservativeDelta),
      "conservative",
      horizonMonths,
    ),
    base: projectGoalScenario(
      goals,
      startingWealth,
      a,
      baseR,
      "base",
      horizonMonths,
    ),
    optimistic: projectGoalScenario(
      goals,
      startingWealth,
      a,
      Math.min(0.25, baseR + a.optimisticDelta),
      "optimistic",
      horizonMonths,
    ),
  } as const;

  const inheritanceUsd = scenarios.base.endingWealth;
  if (lifeExpectancyMonth != null) {
    const inheritanceGoal: FinancialGoal = {
      id: "inheritance-le",
      type: "other",
      label: "Inheritance",
      amountUsd: inheritanceUsd,
      withinMonths: horizonMonths,
      priority: 1,
    };
    for (const s of Object.values(scenarios)) {
      s.events.push({
        kind: "inheritance",
        goal: {
          ...inheritanceGoal,
          amountUsd: s.endingWealth,
        },
        month: horizonMonths,
        neededUsd: 0,
        fundedUsd: Math.round(s.endingWealth),
        shortfallUsd: 0,
        covered: true,
      });
    }
  }

  const firstShortfall =
    scenarios.base.events.find(
      (e) =>
        !e.covered && e.kind !== "mortgage_end" && e.kind !== "inheritance",
    ) ?? null;

  return {
    assumptions: a,
    goals,
    startingWealth,
    cashUsd: Math.max(0, client.cash_usd),
    horizonMonths,
    lifeExpectancyAge,
    lifeExpectancyMonth,
    inheritanceUsd,
    scenarios,
    firstShortfall,
  };
}

function eventLabelForGoal(goal: FinancialGoal): string {
  return goal.label?.trim() || goal.type;
}

export type GoalChartEventMarker = {
  month: number;
  kind: GoalEventKind;
  goalId: string;
  goalType: FinancialGoalType;
  goalLabel: string;
  monthlyPaymentUsd?: number;
};

/** Distinct vertical markers for the chart (goals / mortgage / retirement / payoff). */
export function buildGoalChartEventMarkers(
  result: GoalProjectionResult,
  horizonMonths?: number,
): GoalChartEventMarker[] {
  const limit = horizonMonths ?? result.horizonMonths;
  const markers: GoalChartEventMarker[] = [];
  const mortgageKeys = new Set(
    result.scenarios.base.events
      .filter((e) => e.kind === "mortgage_start")
      .map((e) => `${e.goal.id}@${e.month}`),
  );
  const seenStart = new Set<string>();

  for (const ev of result.scenarios.base.events) {
    if (ev.month > limit) continue;
    if (ev.kind === "goal") {
      // Home lump + mortgage: only show the mortgage marker (avoids duplicate labels).
      if (mortgageKeys.has(`${ev.goal.id}@${ev.month}`)) continue;
      markers.push({
        month: ev.month,
        kind: "goal",
        goalId: ev.goal.id,
        goalType: ev.goal.type,
        goalLabel: eventLabelForGoal(ev.goal),
      });
      continue;
    }
    if (
      ev.kind === "mortgage_start" ||
      ev.kind === "mortgage_end" ||
      ev.kind === "retirement_start" ||
      ev.kind === "inheritance"
    ) {
      const key = `${ev.kind}:${ev.goal.id}@${ev.month}`;
      if (seenStart.has(key)) continue;
      seenStart.add(key);
      markers.push({
        month: ev.month,
        kind: ev.kind,
        goalId: ev.goal.id,
        goalType: ev.goal.type,
        goalLabel: eventLabelForGoal(ev.goal),
        monthlyPaymentUsd: ev.monthlyPaymentUsd,
      });
    }
  }
  return markers.sort((a, b) => a.month - b.month || a.kind.localeCompare(b.kind));
}

/** Chart rows: one point per month with three scenario wealths + goal markers. */
export function buildGoalChartSeries(
  result: GoalProjectionResult,
  horizonMonths?: number,
): GoalChartPoint[] {
  const limit = horizonMonths ?? result.horizonMonths;
  const base = result.scenarios.base.path;
  const opt = result.scenarios.optimistic.path;
  const cons = result.scenarios.conservative.path;
  const labelById = new Map(
    result.goals.map((g) => [g.id, eventLabelForGoal(g)]),
  );
  const markerLabels = new Map<number, string>();
  for (const m of buildGoalChartEventMarkers(result, limit)) {
    const piece =
      m.kind === "mortgage_start"
        ? `${m.goalLabel} (mortgage)`
        : m.kind === "mortgage_end"
          ? `${m.goalLabel} (paid off)`
          : m.kind === "retirement_start"
            ? `${m.goalLabel} (retire spend)`
            : m.kind === "inheritance"
              ? "Inheritance"
              : m.goalLabel;
    const prev = markerLabels.get(m.month);
    markerLabels.set(m.month, prev ? `${prev} · ${piece}` : piece);
  }

  return base
    .filter((p) => p.month <= limit)
    .map((p, i) => ({
      month: p.month,
      base: p.wealth,
      optimistic: opt[i]?.wealth ?? p.wealth,
      conservative: cons[i]?.wealth ?? p.wealth,
      goalMarkers: p.goalIds.map((id) => labelById.get(id) ?? id).join(", "),
      eventLabel: markerLabels.get(p.month) ?? null,
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
          goals: parsed.goals.map(normalizeGoal),
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
      normalizeGoal({
        id: createGoalId(),
        type,
        label: params.get("goalDesc")?.trim() || type,
        amountUsd: amount,
        withinMonths: Math.min(360, Math.max(1, Math.round(months))),
        priority: 3,
      }),
    ],
    assumptions: clampAssumptions({
      ...DEFAULT_GOAL_ASSUMPTIONS,
      annualReturn: Number(params.get("goalReturn")) || DEFAULT_GOAL_ASSUMPTIONS.annualReturn,
      annualContributionUsd:
        Number(params.get("goalContribute")) || 0,
    }),
  };
}

export function normalizeGoal(g: FinancialGoal): FinancialGoal {
  const mortgage =
    g.type === "home" ? clampMortgage(g.mortgage) : null;
  return {
    ...g,
    amountUsd: Math.max(0, g.amountUsd),
    withinMonths: Math.min(360, Math.max(1, Math.round(g.withinMonths) || 1)),
    priority: Math.min(5, Math.max(1, Math.round(g.priority) || 3)),
    mortgage,
    retirementSpendYears:
      g.type === "retirement"
        ? clampRetirementSpendYears(g.retirementSpendYears)
        : null,
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
  const maxMonths = projectionHorizonMonths(goals);
  return Math.min(50, Math.max(1, Math.ceil(maxMonths / 12)));
}
