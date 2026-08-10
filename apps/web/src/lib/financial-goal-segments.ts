/**
 * AI-driven financial-goal segmentation + chained curve generation.
 *
 * Flow:
 * 1) Segmentation — AI (see /api/goals/segment) or rule-based fallback splits
 *    the projection horizon into short / mid / long period segments and picks
 *    one strategy (model_code from the current run, or the client's current
 *    holdings) per segment based on goal amount / timing / description.
 * 2) Return bands — each segment's strategy equity curve is fed through the
 *    shared planning-returns layer (financial-goal-planning-returns.ts) to get
 *    base + floor/ceiling at the selected confidence. The curve resolver is
 *    injected, so the holdings backcast/realized series from track A can slot
 *    in without changing this module.
 * 3) Projection — one continuous month-by-month wealth path per confidence
 *    track (P10 = per-segment floor, P50 = base, P90 = ceiling); the annual
 *    return switches at segment boundaries (chaining) while goal withdrawals,
 *    mortgages, and retirement spend keep the single-path semantics of
 *    projectGoalScenario.
 */

import {
  buildGoalChartEventMarkers,
  clampAssumptions,
  monthsUntilLifeExpectancy,
  projectGoalScenario,
  projectionHorizonMonths,
  type ClientGender,
  type FinancialGoal,
  type GoalAssumptions,
  type GoalChartEventMarker,
  type GoalEventOutcome,
  type GoalProjectionResult,
  type GoalScenarioResult,
} from "@/lib/financial-goal";
import {
  planningReturnBandFromAnnualReturns,
  planningReturnBandFromEquityCurve,
  type EquityPoint,
  type PlanningReturnBand,
} from "@/lib/financial-goal-planning-returns";

export const GOAL_SEGMENT_LABELS = ["short", "mid", "long"] as const;
export type GoalSegmentLabel = (typeof GOAL_SEGMENT_LABELS)[number];

/** modelCode null = keep the client's current holdings (baseline backtest). */
export type GoalSegmentStrategy = {
  modelCode: string | null;
  label: string;
  cagr?: number | null;
  volatility?: number | null;
  maxDrawdown?: number | null;
  sharpe?: number | null;
  isRecommended?: boolean;
};

export type GoalSegment = {
  id: string;
  label: GoalSegmentLabel;
  /** Inclusive month bounds, 1-indexed (month 0 = today, start of path). */
  startMonth: number;
  endMonth: number;
  goalIds: string[];
  modelCode: string | null;
  rationale: string;
};

export type GoalSegmentation = {
  segments: GoalSegment[];
  horizonMonths: number;
  source: "ai" | "rules";
  rationale: string;
};

/** Rule fallback window bounds (months): short ≤ 3y, mid 3–10y, long > 10y. */
export const RULE_SHORT_END_MONTHS = 36;
export const RULE_MID_END_MONTHS = 120;

type Lang = "en" | "zh" | "ko";

function segmentId(label: GoalSegmentLabel): string {
  return `seg-${label}`;
}

function goalsInRange(
  goals: FinancialGoal[],
  startMonth: number,
  endMonth: number,
): string[] {
  return goals
    .filter((g) => g.withinMonths >= startMonth && g.withinMonths <= endMonth)
    .map((g) => g.id);
}

/**
 * Rule-based strategy pick per segment label (used as the fallback when AI is
 * unavailable, and to repair unknown model codes in AI output):
 * - short: most defensive available model (lowest volatility, tie-break on
 *   smallest drawdown) — near-term goals cannot wait out drawdowns.
 * - mid: the run's recommended/champion model (balanced default).
 * - long: highest-CAGR model — long horizons can ride out vol for growth.
 * Falls back to current holdings (null) when no candidate matches.
 */
export function ruleBasedStrategyPick(
  label: GoalSegmentLabel,
  strategies: GoalSegmentStrategy[],
): string | null {
  const models = strategies.filter((s) => s.modelCode != null);
  if (!models.length) return null;
  if (label === "short") {
    const byDefensive = [...models].sort((a, b) => {
      const va = a.volatility ?? Number.POSITIVE_INFINITY;
      const vb = b.volatility ?? Number.POSITIVE_INFINITY;
      if (va !== vb) return va - vb;
      return (
        Math.abs(a.maxDrawdown ?? Number.NEGATIVE_INFINITY) -
        Math.abs(b.maxDrawdown ?? Number.NEGATIVE_INFINITY)
      );
    });
    return byDefensive[0]?.modelCode ?? null;
  }
  if (label === "long") {
    const byGrowth = [...models].sort(
      (a, b) => (b.cagr ?? Number.NEGATIVE_INFINITY) - (a.cagr ?? Number.NEGATIVE_INFINITY),
    );
    return byGrowth[0]?.modelCode ?? null;
  }
  const recommended = models.find((s) => s.isRecommended);
  return (recommended ?? models[0])?.modelCode ?? null;
}

function ruleRationale(
  label: GoalSegmentLabel,
  modelCode: string | null,
  lang: Lang,
): string {
  const model = modelCode ?? (lang === "zh" ? "目前持倉" : lang === "ko" ? "현재 보유" : "current holdings");
  if (label === "short") {
    return lang === "zh"
      ? `近期目標無法承受大幅回檔，規則選擇波動最低的防禦策略（${model}）。`
      : lang === "ko"
        ? `단기 목표는 하락을 견딜 시간이 없어 변동성이 가장 낮은 방어 전략(${model})을 선택했습니다.`
        : `Near-term goals cannot wait out drawdowns — rule picks the lowest-volatility defensive strategy (${model}).`;
  }
  if (label === "long") {
    return lang === "zh"
      ? `長期目標可承受波動換取成長，規則選擇歷史 CAGR 最高的策略（${model}）。`
      : lang === "ko"
        ? `장기 목표는 변동성을 감내하고 성장을 추구할 수 있어 역사적 CAGR이 가장 높은 전략(${model})을 선택했습니다.`
        : `Long horizons can trade volatility for growth — rule picks the highest-CAGR strategy (${model}).`;
  }
  return lang === "zh"
    ? `中期目標採用本次回測建議（冠軍）模型作為均衡預設（${model}）。`
    : lang === "ko"
      ? `중기 목표는 이번 백테스트 추천(챔피언) 모델을 균형 기본값으로 사용합니다(${model}).`
      : `Mid-term goals default to this run's recommended (champion) model as the balanced choice (${model}).`;
}

/**
 * Fallback segmentation when AI is unavailable: fixed short/mid/long windows
 * (≤3y / 3–10y / >10y) covering the full horizon, strategies picked by
 * ruleBasedStrategyPick. Documented here and surfaced in the UI as "rules".
 */
export function buildRuleBasedSegmentation(args: {
  goals: FinancialGoal[];
  strategies: GoalSegmentStrategy[];
  horizonMonths: number;
  lang?: Lang;
}): GoalSegmentation {
  const lang = args.lang ?? "en";
  const horizon = Math.max(1, Math.round(args.horizonMonths));
  const segments: GoalSegment[] = [];

  const push = (
    label: GoalSegmentLabel,
    startMonth: number,
    endMonth: number,
  ) => {
    if (endMonth < startMonth) return;
    const modelCode = ruleBasedStrategyPick(label, args.strategies);
    segments.push({
      id: segmentId(label),
      label,
      startMonth,
      endMonth,
      goalIds: goalsInRange(args.goals, startMonth, endMonth),
      modelCode,
      rationale: ruleRationale(label, modelCode, lang),
    });
  };

  push("short", 1, Math.min(RULE_SHORT_END_MONTHS, horizon));
  if (horizon > RULE_SHORT_END_MONTHS) {
    push("mid", RULE_SHORT_END_MONTHS + 1, Math.min(RULE_MID_END_MONTHS, horizon));
  }
  if (horizon > RULE_MID_END_MONTHS) {
    push("long", RULE_MID_END_MONTHS + 1, horizon);
  }

  return {
    segments,
    horizonMonths: horizon,
    source: "rules",
    rationale:
      lang === "zh"
        ? "AI 未使用時以規則分段：短期 ≤3 年（防禦）、中期 3–10 年（建議模型）、長期 >10 年（成長）。"
        : lang === "ko"
          ? "AI 미사용 시 규칙으로 구간을 나눕니다: 단기 ≤3년(방어), 중기 3–10년(추천 모델), 장기 >10년(성장)."
          : "Rule-based segmentation (AI not used): short ≤3y (defensive), mid 3–10y (recommended model), long >10y (growth).",
  };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[,%\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const HOLDINGS_ALIASES = new Set([
  "holdings",
  "current",
  "current_holdings",
  "baseline",
  "client_holdings",
]);

function normalizeSegmentLabel(raw: unknown): GoalSegmentLabel | null {
  const s = String(raw ?? "").toLowerCase();
  if (!s) return null;
  if (s.includes("short") || s.includes("短期") || s.includes("단기")) return "short";
  if (s.includes("mid") || s.includes("中期") || s.includes("중기")) return "mid";
  if (s.includes("long") || s.includes("長期") || s.includes("长期") || s.includes("장기")) {
    return "long";
  }
  return null;
}

function normalizeModelCode(
  raw: unknown,
  strategies: GoalSegmentStrategy[],
): { modelCode: string | null; matched: boolean } {
  const s = asString(raw);
  if (!s) return { modelCode: null, matched: true };
  if (HOLDINGS_ALIASES.has(s.toLowerCase())) {
    return { modelCode: null, matched: true };
  }
  const upper = s.toUpperCase();
  const hit = strategies.find(
    (x) => (x.modelCode ?? "").toUpperCase() === upper,
  );
  return hit ? { modelCode: hit.modelCode, matched: true } : { modelCode: null, matched: false };
}

/**
 * Force segments into contiguous [1, horizon] coverage: clamp to the horizon,
 * drop empty ranges, bridge gaps by extending the previous segment, and trim
 * overlaps in favor of the earlier segment. Goal ids are (re)assigned by
 * withinMonths after normalization.
 */
export function normalizeSegmentCoverage(
  segments: GoalSegment[],
  goals: FinancialGoal[],
  horizonMonths: number,
): GoalSegment[] {
  const horizon = Math.max(1, Math.round(horizonMonths));
  const sorted = [...segments]
    .map((s) => ({
      ...s,
      startMonth: Math.round(s.startMonth),
      endMonth: Math.round(s.endMonth),
    }))
    .sort((a, b) => a.startMonth - b.startMonth || a.endMonth - b.endMonth);

  const out: GoalSegment[] = [];
  let cursor = 1;
  for (const seg of sorted) {
    if (cursor > horizon) break;
    // Fully overlapped by an earlier segment — skip rather than emit a
    // degenerate 1-month sliver with a different strategy.
    if (seg.endMonth < cursor) continue;
    const start = Math.max(cursor, Math.min(seg.startMonth, horizon));
    const end = Math.min(horizon, Math.max(seg.endMonth, start));
    if (end < start) continue;
    // Bridge a leading gap by extending the previous segment to meet this one.
    if (start > cursor && out.length) {
      const prev = out[out.length - 1]!;
      prev.endMonth = start - 1;
      prev.goalIds = goalsInRange(goals, prev.startMonth, prev.endMonth);
    }
    const clampedStart = out.length ? Math.max(cursor, start) : 1;
    out.push({
      ...seg,
      startMonth: clampedStart,
      endMonth: Math.max(end, clampedStart),
      goalIds: goalsInRange(goals, clampedStart, Math.max(end, clampedStart)),
    });
    cursor = Math.max(end, clampedStart) + 1;
  }
  // AI stopped early → extend the last segment to the horizon so the whole
  // path always has a return assumption.
  if (out.length && out[out.length - 1]!.endMonth < horizon) {
    const last = out[out.length - 1]!;
    last.endMonth = horizon;
    last.goalIds = goalsInRange(goals, last.startMonth, last.endMonth);
  }
  return out;
}

/**
 * Parse the AI segmentation response. Unknown model codes are repaired with
 * the rule-based pick for that segment label; structural failure throws so the
 * caller can fall back to buildRuleBasedSegmentation.
 */
export function parseGoalSegmentationFromModel(
  text: string,
  ctx: {
    goals: FinancialGoal[];
    strategies: GoalSegmentStrategy[];
    horizonMonths: number;
  },
): GoalSegmentation {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const slice =
    start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  const root = asRecord(JSON.parse(slice) as unknown);
  if (!root) throw new Error("Segmentation root is not an object");
  const rawSegments = Array.isArray(root.segments) ? root.segments : null;
  if (!rawSegments?.length) throw new Error("No segments in AI response");

  const horizon = Math.max(1, Math.round(ctx.horizonMonths));
  const segments: GoalSegment[] = [];
  const usedLabels = new Set<GoalSegmentLabel>();

  for (const raw of rawSegments.slice(0, 6)) {
    const o = asRecord(raw);
    if (!o) continue;
    let label = normalizeSegmentLabel(o.label ?? o.period ?? o.bucket);
    const startMonth = asNumber(o.start_month) ?? asNumber(o.startMonth);
    const endMonth = asNumber(o.end_month) ?? asNumber(o.endMonth);
    if (startMonth == null || endMonth == null) continue;
    if (!label) {
      // Infer the bucket from the window midpoint when the label is missing.
      const mid = (startMonth + endMonth) / 2;
      label =
        mid <= RULE_SHORT_END_MONTHS
          ? "short"
          : mid <= RULE_MID_END_MONTHS
            ? "mid"
            : "long";
    }
    // One segment per bucket keeps boundary markers unambiguous.
    if (usedLabels.has(label)) continue;
    usedLabels.add(label);

    const code = normalizeModelCode(o.model_code ?? o.modelCode ?? o.strategy, ctx.strategies);
    const modelCode = code.matched
      ? code.modelCode
      : ruleBasedStrategyPick(label, ctx.strategies);
    segments.push({
      id: segmentId(label),
      label,
      startMonth: Math.max(1, Math.round(startMonth)),
      endMonth: Math.min(horizon, Math.round(endMonth)),
      goalIds: [],
      modelCode,
      rationale:
        asString(o.rationale)?.slice(0, 400) ??
        ruleRationale(label, modelCode, "en"),
    });
  }

  const normalized = normalizeSegmentCoverage(segments, ctx.goals, horizon);
  if (!normalized.length) throw new Error("AI segments did not cover the horizon");

  return {
    segments: normalized,
    horizonMonths: horizon,
    source: "ai",
    rationale:
      asString(root.rationale)?.slice(0, 600) ??
      "AI segmented goals into short/mid/long periods with per-segment strategies.",
  };
}

/** Segment covering month m (1-indexed); edges clamp to first/last segment. */
export function segmentForMonth(
  segments: GoalSegment[],
  month: number,
): GoalSegment | null {
  if (!segments.length) return null;
  for (const s of segments) {
    if (month >= s.startMonth && month <= s.endMonth) return s;
  }
  return month < segments[0]!.startMonth ? segments[0]! : segments.at(-1)!;
}

export type SegmentBandSource = "equity_curve" | "prior_fallback";

export type ResolvedSegmentBand = {
  segment: GoalSegment;
  band: PlanningReturnBand;
  /** Where the band came from (equity curve vs prior-only fallback). */
  bandSource: SegmentBandSource;
};

/**
 * Derive per-segment planning bands from the strategy equity curves.
 * `curveForModel(null)` must return the client holdings backtest series
 * (priority source); A's backcast/realized series can replace it later.
 */
export function resolveSegmentBands(
  segmentation: GoalSegmentation,
  opts: {
    curveForModel: (modelCode: string | null) => EquityPoint[] | null;
    priorReturn: number;
    confidence: number;
  },
): ResolvedSegmentBand[] {
  return segmentation.segments.map((segment) => {
    const curve = opts.curveForModel(segment.modelCode);
    if (curve && curve.length >= 2) {
      return {
        segment,
        band: planningReturnBandFromEquityCurve(
          curve,
          opts.priorReturn,
          opts.confidence,
        ),
        bandSource: "equity_curve" as const,
      };
    }
    return {
      segment,
      band: planningReturnBandFromAnnualReturns(
        [],
        opts.priorReturn,
        opts.confidence,
      ),
      bandSource: "prior_fallback" as const,
    };
  });
}

export type SegmentedGoalClient = {
  aum_usd: number;
  cash_usd: number;
  age?: number | null;
  gender?: ClientGender | null;
};

export type SegmentedGoalProjection = {
  segments: ResolvedSegmentBand[];
  horizonMonths: number;
  startingWealth: number;
  cashUsd: number;
  lifeExpectancyMonth: number | null;
  /** P50 (base per segment) — the median planning line. */
  p50: GoalScenarioResult;
  /** P10-ish conservative track (per-segment floor at chosen confidence). */
  p10: GoalScenarioResult;
  /** P90-ish optimistic track (per-segment ceiling at chosen confidence). */
  p90: GoalScenarioResult;
  /** Base-path wealth at life-expectancy end (estate). */
  inheritanceUsd: number;
  events: GoalEventOutcome[];
  firstShortfall: GoalEventOutcome | null;
};

/**
 * Chain per-segment return assumptions into one continuous wealth path per
 * confidence track. Withdrawals/mortgages/retirement behave exactly like the
 * single-rate simulator; only the monthly growth rate switches at segment
 * boundaries, so the path itself is the "rolled" goal curve.
 */
export function projectSegmentedGoals(args: {
  goals: FinancialGoal[];
  client: SegmentedGoalClient;
  assumptions: GoalAssumptions;
  segmentBands: ResolvedSegmentBand[];
  horizonMonths?: number;
}): SegmentedGoalProjection | null {
  const goals = args.goals.filter((g) => g.amountUsd > 0 && g.withinMonths >= 1);
  if (!goals.length || !args.segmentBands.length) return null;

  const a = clampAssumptions(args.assumptions);
  const startingWealth = Math.max(0, args.client.aum_usd);
  const lifeExpectancyMonth = monthsUntilLifeExpectancy(
    args.client.age,
    args.client.gender,
  );
  const horizonMonths = Math.max(
    1,
    args.horizonMonths ?? projectionHorizonMonths(goals, lifeExpectancyMonth),
  );

  const segments = args.segmentBands.map((sb) => sb.segment);
  const bandBySegmentId = new Map(
    args.segmentBands.map((sb) => [sb.segment.id, sb.band] as const),
  );
  const rateFor =
    (pick: (band: PlanningReturnBand) => number) =>
    (month: number): number => {
      const seg = segmentForMonth(segments, month);
      const band = seg ? bandBySegmentId.get(seg.id) : null;
      return band ? pick(band) : a.annualReturn;
    };

  const p10 = projectGoalScenario(
    goals,
    startingWealth,
    a,
    0,
    "conservative",
    horizonMonths,
    rateFor((b) => b.floorReturn),
  );
  const p50 = projectGoalScenario(
    goals,
    startingWealth,
    a,
    0,
    "base",
    horizonMonths,
    rateFor((b) => b.baseReturn),
  );
  const p90 = projectGoalScenario(
    goals,
    startingWealth,
    a,
    0,
    "optimistic",
    horizonMonths,
    rateFor((b) => b.ceilingReturn),
  );

  const inheritanceUsd = p50.endingWealth;
  const events = p50.events;
  if (lifeExpectancyMonth != null) {
    const inheritanceGoal: FinancialGoal = {
      id: "inheritance-le",
      type: "other",
      label: "Inheritance",
      amountUsd: inheritanceUsd,
      withinMonths: horizonMonths,
      priority: 1,
    };
    for (const s of [p10, p50, p90]) {
      s.events.push({
        kind: "inheritance",
        goal: { ...inheritanceGoal, amountUsd: s.endingWealth },
        month: horizonMonths,
        neededUsd: 0,
        fundedUsd: Math.round(s.endingWealth),
        shortfallUsd: 0,
        covered: true,
      });
    }
  }

  const firstShortfall =
    p50.events.find(
      (e) =>
        !e.covered && e.kind !== "mortgage_end" && e.kind !== "inheritance",
    ) ?? null;

  return {
    segments: args.segmentBands,
    horizonMonths,
    startingWealth,
    cashUsd: Math.max(0, args.client.cash_usd),
    lifeExpectancyMonth,
    p10,
    p50,
    p90,
    inheritanceUsd,
    events,
    firstShortfall,
  };
}

/** Event markers (goal / mortgage / retirement / inheritance) from the P50 path. */
export function segmentedEventMarkers(
  projection: SegmentedGoalProjection,
  goals: FinancialGoal[],
  assumptions: GoalAssumptions,
  horizonMonths?: number,
): GoalChartEventMarker[] {
  // Reuse the single-rate marker builder with the three tracks mapped onto
  // the conservative/base/optimistic slots it expects.
  const adapter: GoalProjectionResult = {
    assumptions,
    goals,
    startingWealth: projection.startingWealth,
    cashUsd: projection.cashUsd,
    horizonMonths: projection.horizonMonths,
    lifeExpectancyAge: null,
    lifeExpectancyMonth: projection.lifeExpectancyMonth,
    inheritanceUsd: projection.inheritanceUsd,
    scenarios: {
      conservative: projection.p10,
      base: projection.p50,
      optimistic: projection.p90,
    },
    firstShortfall: projection.firstShortfall,
  };
  return buildGoalChartEventMarkers(adapter, horizonMonths);
}

export type SegmentedChartPoint = {
  month: number;
  /** Median planning line (per-segment base). */
  median: number;
  p10: number;
  p90: number;
  /** p90 − p10, stacked on p10 by the chart to draw the shaded band. */
  bandRange: number;
  segmentLabel: GoalSegmentLabel | null;
  segmentModelCode: string | null;
  eventLabel: string | null;
};

export function buildSegmentedChartSeries(
  projection: SegmentedGoalProjection,
  goals: FinancialGoal[],
  assumptions: GoalAssumptions,
  horizonMonths?: number,
): SegmentedChartPoint[] {
  const limit = horizonMonths ?? projection.horizonMonths;
  const markers = segmentedEventMarkers(projection, goals, assumptions, limit);
  const labelByMonth = new Map<number, string>();
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
    const prev = labelByMonth.get(m.month);
    labelByMonth.set(m.month, prev ? `${prev} · ${piece}` : piece);
  }

  const segments = projection.segments.map((sb) => sb.segment);
  const points: SegmentedChartPoint[] = [];
  const n = Math.min(
    projection.p50.path.length,
    projection.p10.path.length,
    projection.p90.path.length,
  );
  for (let i = 0; i < n; i++) {
    const month = projection.p50.path[i]?.month ?? i;
    if (month > limit) break;
    const seg = segmentForMonth(segments, Math.max(1, month));
    points.push({
      month,
      median: projection.p50.path[i]!.wealth,
      p10: projection.p10.path[i]!.wealth,
      p90: projection.p90.path[i]!.wealth,
      bandRange: Math.max(
        0,
        projection.p90.path[i]!.wealth - projection.p10.path[i]!.wealth,
      ),
      segmentLabel: seg?.label ?? null,
      segmentModelCode: seg?.modelCode ?? null,
      eventLabel: labelByMonth.get(month) ?? null,
    });
  }
  return points;
}
