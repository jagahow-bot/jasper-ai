/**
 * Before/after wealth-path compare: same goals & non-return assumptions,
 * with customized planning return from annual-return CI (not raw CAGR).
 */

import {
  buildGoalChartEventMarkers,
  clampAssumptions,
  projectFinancialGoals,
  projectionHorizonMonths,
  resolveChartHorizonMonths,
  type FinancialGoal,
  type GoalAssumptions,
  type GoalChartEventMarker,
  type GoalChartHorizonOption,
  type GoalProjectionResult,
  type ClientGender,
} from "@/lib/financial-goal";
import type { PlanningReturnBand } from "@/lib/financial-goal-planning-returns";

export type GoalPathCompareClient = {
  aum_usd: number;
  cash_usd: number;
  age?: number | null;
  gender?: ClientGender | null;
};

export type GoalPathCompareChartPoint = {
  month: number;
  before: number;
  after: number;
  afterOptimistic: number;
  afterConservative: number;
  eventLabel: string | null;
};

export type GoalPathCompareSummary = {
  beforeEndingUsd: number;
  afterEndingUsd: number;
  endingDeltaUsd: number;
  beforeShortfallUsd: number;
  afterShortfallUsd: number;
  shortfallDeltaUsd: number;
  beforeInheritanceUsd: number;
  afterInheritanceUsd: number;
  shortfallImproved: boolean;
  endingImproved: boolean;
  firstShortfallMonthBefore: number | null;
  firstShortfallMonthAfter: number | null;
  beforeAtGoalsHorizonUsd: number;
  afterAtGoalsHorizonUsd: number;
};

export type GoalPathCompareResult = {
  before: GoalProjectionResult;
  after: GoalProjectionResult;
  chart: GoalPathCompareChartPoint[];
  eventMarkers: GoalChartEventMarker[];
  beforeReturn: number;
  afterReturn: number;
  /** Raw sample geometric mean (before shrink / cap). */
  afterReturnRaw: number;
  planningBand: PlanningReturnBand;
  summary: GoalPathCompareSummary;
  surplusGlide: {
    suggest: boolean;
    surplusMultiple: number;
    totalGoalNeedUsd: number;
  };
  horizonMonths: number;
  goalsHorizonMonths: number;
  fullHorizonMonths: number;
};

/** @deprecated Prefer planningReturnBandFromEquityCurve. */
export function planningReturnFromCagr(cagr: number): number {
  if (!Number.isFinite(cagr)) return 0.05;
  return Math.min(0.35, Math.max(-0.15, cagr));
}

export function goalsPlanningHorizonMonths(goals: FinancialGoal[]): number {
  return projectionHorizonMonths(goals, null);
}

/** Min ending-wealth / goal-need ratio before suggesting a cash glide. */
export const SURPLUS_GLIDE_MIN_MULTIPLE = 2.5;
/**
 * Above this, surplus is so extreme the banner looks broken in a client
 * meeting (e.g. 1000× from long compounding + small listed goals) — suppress.
 */
export const SURPLUS_GLIDE_MAX_MULTIPLE = 25;

/**
 * When the customized path covers goals and ending wealth is meaningfully
 * above what goals require (but not absurdly so), suggest gliding risk into cash.
 */
export function detectSurplusGlideSuggestion(args: {
  startingWealth: number;
  goals: FinancialGoal[];
  afterEndingUsd: number;
  afterShortfallUsd: number;
  beforeEndingUsd: number;
}): {
  suggest: boolean;
  surplusMultiple: number;
  totalGoalNeedUsd: number;
} {
  const totalGoalNeedUsd = Math.round(
    args.goals.reduce((s, g) => s + Math.max(0, g.amountUsd), 0),
  );
  const needFloor = Math.max(
    totalGoalNeedUsd,
    args.startingWealth * 0.5,
    1,
  );
  const surplusMultiple = args.afterEndingUsd / needFloor;
  const suggest =
    args.afterShortfallUsd <= 0 &&
    args.afterEndingUsd > args.beforeEndingUsd &&
    surplusMultiple >= SURPLUS_GLIDE_MIN_MULTIPLE &&
    surplusMultiple <= SURPLUS_GLIDE_MAX_MULTIPLE;
  return { suggest, surplusMultiple, totalGoalNeedUsd };
}

function wealthAtMonth(result: GoalProjectionResult, month: number): number {
  const path = result.scenarios.base.path;
  if (path.length === 0) return 0;
  const hit = path.find((p) => p.month === month);
  if (hit) return hit.wealth;
  const last = path.filter((p) => p.month <= month).at(-1);
  return last?.wealth ?? path[0]!.wealth;
}

function endingWealth(result: GoalProjectionResult): number {
  return result.lifeExpectancyMonth != null
    ? result.inheritanceUsd
    : result.scenarios.base.endingWealth;
}

function eventLabelMap(
  markers: GoalChartEventMarker[],
): Map<number, string> {
  const map = new Map<number, string>();
  for (const m of markers) {
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
    const prev = map.get(m.month);
    map.set(m.month, prev ? `${prev} · ${piece}` : piece);
  }
  return map;
}

/**
 * Reproject goals: before = original plan assumptions;
 * after = planning band from customized annual returns (CI deltas).
 */
export function buildGoalPathCompare(args: {
  goals: FinancialGoal[];
  assumptions: GoalAssumptions;
  client: GoalPathCompareClient;
  /** Preferred: annual-return CI band from equity curve. */
  planningBand?: PlanningReturnBand | null;
  /** Fallback when no curve/band: raw CAGR (shrunk via planningReturnFromCagr). */
  afterAnnualReturnRaw?: number;
  chartHorizonMonths?: GoalChartHorizonOption;
}): GoalPathCompareResult | null {
  const goals = args.goals.filter((g) => g.amountUsd > 0 && g.withinMonths >= 1);
  if (!goals.length) return null;

  const baseAssumptions = clampAssumptions(args.assumptions);
  const prior = baseAssumptions.annualReturn;

  let band: PlanningReturnBand;
  if (args.planningBand) {
    band = args.planningBand;
  } else {
    const raw = args.afterAnnualReturnRaw ?? prior;
    const base = planningReturnFromCagr(raw);
    band = {
      baseReturn: base,
      floorReturn: base - baseAssumptions.conservativeDelta,
      ceilingReturn: base + baseAssumptions.optimisticDelta,
      optimisticDelta: baseAssumptions.optimisticDelta,
      conservativeDelta: baseAssumptions.conservativeDelta,
      confidenceLevel: 0.6,
      geometricMean: raw,
      winsorizedGeometricMean: base,
      arithmeticMean: base,
      planningCeiling: base,
      annualVol: 0,
      sampleYears: 0,
      p10Return: base - baseAssumptions.conservativeDelta,
      p50Return: base,
      p90Return: base + baseAssumptions.optimisticDelta,
      shrinkWeight: 0,
      priorReturn: prior,
      method: "prior_fallback",
    };
  }

  const afterReturn = band.baseReturn;
  const afterAssumptions = clampAssumptions({
    ...baseAssumptions,
    annualReturn: afterReturn,
    optimisticDelta: band.optimisticDelta,
    conservativeDelta: band.conservativeDelta,
  });

  const before = projectFinancialGoals(goals, args.client, baseAssumptions);
  const after = projectFinancialGoals(goals, args.client, afterAssumptions);

  const goalsHorizonMonths = goalsPlanningHorizonMonths(goals);
  const fullHorizonMonths = Math.max(
    before.horizonMonths,
    after.horizonMonths,
  );
  const defaultWindow = Math.min(
    fullHorizonMonths,
    Math.max(60, Math.min(240, goalsHorizonMonths + 24)),
  );
  const horizonOption = args.chartHorizonMonths ?? defaultWindow;
  const horizonMonths = resolveChartHorizonMonths(
    horizonOption === "max"
      ? "max"
      : ((typeof horizonOption === "number"
          ? horizonOption
          : defaultWindow) as GoalChartHorizonOption),
    fullHorizonMonths,
  );

  const markers = buildGoalChartEventMarkers(after, horizonMonths);
  const labels = eventLabelMap(markers);

  const chart: GoalPathCompareChartPoint[] = [];
  const beforePath = before.scenarios.base.path;
  const afterBase = after.scenarios.base.path;
  const afterOpt = after.scenarios.optimistic.path;
  const afterCons = after.scenarios.conservative.path;
  const n = Math.min(beforePath.length, afterBase.length);
  for (let i = 0; i < n; i++) {
    const month = beforePath[i]?.month ?? i;
    if (month > horizonMonths) break;
    chart.push({
      month,
      before: beforePath[i]!.wealth,
      after: afterBase[i]!.wealth,
      afterOptimistic: afterOpt[i]?.wealth ?? afterBase[i]!.wealth,
      afterConservative: afterCons[i]?.wealth ?? afterBase[i]!.wealth,
      eventLabel: labels.get(month) ?? null,
    });
  }

  const beforeEnding = endingWealth(before);
  const afterEnding = endingWealth(after);
  const beforeShortfall = before.scenarios.base.totalShortfall;
  const afterShortfall = after.scenarios.base.totalShortfall;
  const goalsCut = Math.min(goalsHorizonMonths, fullHorizonMonths);
  const summary = {
    beforeEndingUsd: Math.round(beforeEnding),
    afterEndingUsd: Math.round(afterEnding),
    endingDeltaUsd: Math.round(afterEnding - beforeEnding),
    beforeShortfallUsd: Math.round(beforeShortfall),
    afterShortfallUsd: Math.round(afterShortfall),
    shortfallDeltaUsd: Math.round(afterShortfall - beforeShortfall),
    beforeInheritanceUsd: Math.round(before.inheritanceUsd),
    afterInheritanceUsd: Math.round(after.inheritanceUsd),
    shortfallImproved: afterShortfall < beforeShortfall - 1,
    endingImproved: afterEnding > beforeEnding + 1,
    firstShortfallMonthBefore: before.firstShortfall?.month ?? null,
    firstShortfallMonthAfter: after.firstShortfall?.month ?? null,
    beforeAtGoalsHorizonUsd: Math.round(wealthAtMonth(before, goalsCut)),
    afterAtGoalsHorizonUsd: Math.round(wealthAtMonth(after, goalsCut)),
  };

  return {
    before,
    after,
    chart,
    eventMarkers: markers,
    beforeReturn: baseAssumptions.annualReturn,
    afterReturn,
    afterReturnRaw: band.geometricMean,
    planningBand: band,
    horizonMonths,
    goalsHorizonMonths,
    fullHorizonMonths,
    summary,
    surplusGlide: detectSurplusGlideSuggestion({
      startingWealth: args.client.aum_usd,
      goals,
      afterEndingUsd: summary.afterEndingUsd,
      afterShortfallUsd: summary.afterShortfallUsd,
      beforeEndingUsd: summary.beforeEndingUsd,
    }),
  };
}
