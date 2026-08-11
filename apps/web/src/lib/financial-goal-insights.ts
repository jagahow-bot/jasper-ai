/**
 * Goal-path insights: rules select which findings matter (codes + numbers);
 * prose always comes from Gemini. No rules-copy fallback for the UI.
 */

import {
  nearestLiquidityGoal,
  type GoalProjectionResult,
} from "@/lib/financial-goal";
import type { Lang } from "@/lib/i18n";

/** Month counts at/above this prefer year wording in insight copy. */
const YEAR_DURATION_THRESHOLD = 12;

/** Rewrite raw month phrases in AI prose once they get this large. */
const REWRITE_MONTH_PHRASE_THRESHOLD = 24;

/**
 * Human-readable horizon / duration for goal-sim insight narratives.
 * Whole years → "N-year" / "N 年" / "N년"; otherwise years + remaining months.
 * Short horizons (< 12 months) stay in months.
 * Use `style: "noun"` for bare "N years" (e.g. rewriting "564 months").
 */
export function formatGoalHorizonDuration(
  months: number,
  lang: Lang = "en",
  style: "compact" | "noun" = "compact",
): string {
  const m = Math.max(0, Math.round(Number(months) || 0));
  if (m < YEAR_DURATION_THRESHOLD) {
    if (lang === "zh") return `${m} 個月`;
    if (lang === "ko") return `${m}개월`;
    if (style === "noun") return m === 1 ? "1 month" : `${m} months`;
    return m === 1 ? "1-month" : `${m}-month`;
  }
  const years = Math.floor(m / 12);
  const rem = m % 12;
  if (rem === 0) {
    if (lang === "zh") return `${years} 年`;
    if (lang === "ko") return `${years}년`;
    if (style === "noun") return years === 1 ? "1 year" : `${years} years`;
    return years === 1 ? "1-year" : `${years}-year`;
  }
  if (lang === "zh") return `${years} 年 ${rem} 個月`;
  if (lang === "ko") return `${years}년 ${rem}개월`;
  const yWord = years === 1 ? "1 year" : `${years} years`;
  const mWord = rem === 1 ? "1 month" : `${rem} months`;
  return `${yWord} ${mWord}`;
}

/**
 * Replace large month-count duration phrases in insight prose with year form.
 * Leaves small counts alone (e.g. "12-month liquidity").
 */
export function rewriteLargeMonthDurationsInText(
  text: string,
  lang: Lang = "en",
): string {
  if (!text) return text;
  const labelFor = (raw: string, style: "compact" | "noun"): string | null => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < REWRITE_MONTH_PHRASE_THRESHOLD) return null;
    return formatGoalHorizonDuration(n, lang, style);
  };

  let out = text;
  // "564-month" / "564-months"
  out = out.replace(/(\d+)\s*-\s*months?\b/gi, (full, n: string) => {
    return labelFor(n, "compact") ?? full;
  });
  // "564 months"
  out = out.replace(/(\d+)\s+months?\b/gi, (full, n: string) => {
    return labelFor(n, "noun") ?? full;
  });
  // "564個月" / "564 個月"
  out = out.replace(/(\d+)\s*個\s*月/g, (full, n: string) => {
    return labelFor(n, "compact") ?? full;
  });
  // "564개월"
  out = out.replace(/(\d+)\s*개월/g, (full, n: string) => {
    return labelFor(n, "compact") ?? full;
  });
  return out;
}

export const GOAL_PATH_INSIGHT_IDS = [
  "near_term_shortfall",
  "cash_vs_liquidity",
  "scenario_fragile",
  "thin_estate",
  "on_track",
] as const;

export type GoalPathInsightId = (typeof GOAL_PATH_INSIGHT_IDS)[number];

export type GoalPathInsightSeverity =
  | "critical"
  | "warning"
  | "opportunity"
  | "info";

export type GoalPathCustomizationHook =
  | "liquidity_buffer"
  | "horizon"
  | "contribution"
  | "deployment"
  | "min_drawdown"
  | "risk"
  | "return"
  | "refine_risk";

/** Rule-selected finding — grounding for the LLM, not display copy. */
export type GoalPathInsightSeed = {
  id: GoalPathInsightId;
  severity: GoalPathInsightSeverity;
  customization_hooks: GoalPathCustomizationHook[];
  /** Numeric / short string facts the model must reuse verbatim. */
  facts: Record<string, string | number>;
};

/** AI-authored insight shown in the simulator. */
export type GoalPathInsight = {
  id: GoalPathInsightId;
  severity: GoalPathInsightSeverity;
  title: string;
  detail: string;
  talking_point: string;
  customization_hooks: GoalPathCustomizationHook[];
};

export type GoalPathInsightsResult = {
  insights: GoalPathInsight[];
  source: "gemini";
};

const SEVERITY_RANK: Record<GoalPathInsightSeverity, number> = {
  critical: 0,
  warning: 1,
  opportunity: 2,
  info: 3,
};

const MAX_INSIGHTS = 4;

function roundUsd(n: number): number {
  return Math.round(n);
}

function isInsightId(raw: unknown): raw is GoalPathInsightId {
  return (
    typeof raw === "string" &&
    (GOAL_PATH_INSIGHT_IDS as readonly string[]).includes(raw)
  );
}

function isHook(raw: unknown): raw is GoalPathCustomizationHook {
  return (
    raw === "liquidity_buffer" ||
    raw === "horizon" ||
    raw === "contribution" ||
    raw === "deployment" ||
    raw === "min_drawdown" ||
    raw === "risk" ||
    raw === "return" ||
    raw === "refine_risk"
  );
}

/**
 * Derive up to 4 insight seeds from the wealth-path projection (same math as the chart).
 */
export function deriveGoalPathInsightSeeds(
  projection: GoalProjectionResult,
  lang: Lang = "en",
): GoalPathInsightSeed[] {
  const seeds: GoalPathInsightSeed[] = [];
  const base = projection.scenarios.base;
  const cons = projection.scenarios.conservative;
  const opt = projection.scenarios.optimistic;
  const shortfall = projection.firstShortfall;
  const near = nearestLiquidityGoal(projection.goals);

  if (shortfall && shortfall.shortfallUsd > 0) {
    seeds.push({
      id: "near_term_shortfall",
      severity: "critical",
      customization_hooks: ["liquidity_buffer", "horizon", "contribution"],
      facts: {
        goal_label: shortfall.goal.label || shortfall.goal.type,
        goal_type: shortfall.goal.type,
        month: shortfall.month,
        month_label: formatGoalHorizonDuration(shortfall.month, lang),
        needed_usd: roundUsd(shortfall.neededUsd),
        funded_usd: roundUsd(shortfall.fundedUsd),
        shortfall_usd: roundUsd(shortfall.shortfallUsd),
        kind: shortfall.kind,
      },
    });
  }

  if (near && near.amountUsd > 0) {
    const cash = projection.cashUsd;
    const gap = near.amountUsd - cash;
    if (gap > near.amountUsd * 0.25 && near.withinMonths <= 60) {
      seeds.push({
        id: "cash_vs_liquidity",
        severity: shortfall ? "warning" : "critical",
        customization_hooks: ["liquidity_buffer", "deployment"],
        facts: {
          goal_label: near.label || near.type,
          goal_type: near.type,
          within_months: near.withinMonths,
          within_label: formatGoalHorizonDuration(near.withinMonths, lang),
          need_usd: roundUsd(near.amountUsd),
          cash_usd: roundUsd(cash),
          gap_usd: roundUsd(Math.max(0, gap)),
        },
      });
    }
  }

  const baseOk = base.totalShortfall <= 0 && !projection.firstShortfall;
  const consGap = cons.totalShortfall > 0;
  const endSpread =
    opt.endingWealth > 0
      ? (opt.endingWealth - cons.endingWealth) / Math.max(1, opt.endingWealth)
      : 0;
  if ((baseOk && consGap) || endSpread >= 0.35) {
    seeds.push({
      id: "scenario_fragile",
      severity: "warning",
      customization_hooks: ["min_drawdown", "risk"],
      facts: {
        base_ending_usd: roundUsd(base.endingWealth),
        conservative_ending_usd: roundUsd(cons.endingWealth),
        optimistic_ending_usd: roundUsd(opt.endingWealth),
        conservative_shortfall_usd: roundUsd(cons.totalShortfall),
        end_spread_pct: Math.round(endSpread * 1000) / 10,
      },
    });
  }

  const estate = projection.inheritanceUsd;
  const start = Math.max(1, projection.startingWealth);
  if (estate <= 0 || estate / start < 0.5) {
    seeds.push({
      id: "thin_estate",
      severity: estate <= 0 ? "warning" : "opportunity",
      customization_hooks: ["return", "contribution"],
      facts: {
        inheritance_usd: roundUsd(estate),
        starting_wealth_usd: roundUsd(projection.startingWealth),
        life_expectancy_age: projection.lifeExpectancyAge ?? "",
        horizon_months: projection.horizonMonths,
        horizon_label: formatGoalHorizonDuration(projection.horizonMonths, lang),
      },
    });
  }

  if (seeds.length === 0) {
    seeds.push({
      id: "on_track",
      severity: "info",
      customization_hooks: ["refine_risk"],
      facts: {
        base_ending_usd: roundUsd(base.endingWealth),
        inheritance_usd: roundUsd(estate),
        goals_count: projection.goals.length,
      },
    });
  }

  return seeds
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        a.id.localeCompare(b.id),
    )
    .slice(0, MAX_INSIGHTS);
}

/** Compact JSON for the insights LLM (no full monthly path). */
export function projectionSummaryForLlm(
  projection: GoalProjectionResult,
  lang: Lang = "en",
): {
  starting_wealth_usd: number;
  cash_usd: number;
  horizon_months: number;
  /** Prefer this in prose instead of raw month counts. */
  horizon_label: string;
  life_expectancy_age: number | null;
  inheritance_usd: number;
  assumptions: {
    annual_return: number;
    annual_contribution_usd: number;
    inflation: number;
    annual_living_spend_usd: number;
  };
  goals: Array<{
    type: string;
    label: string;
    amount_usd: number;
    within_months: number;
    within_label: string;
  }>;
  scenarios: Record<
    string,
    {
      annual_return: number;
      ending_wealth_usd: number;
      total_shortfall_usd: number;
    }
  >;
  first_shortfall: {
    kind: string;
    goal_label: string;
    month: number;
    month_label: string;
    shortfall_usd: number;
    needed_usd: number;
  } | null;
  insight_seeds: GoalPathInsightSeed[];
} {
  const seeds = deriveGoalPathInsightSeeds(projection, lang);
  const fs = projection.firstShortfall;
  return {
    starting_wealth_usd: roundUsd(projection.startingWealth),
    cash_usd: roundUsd(projection.cashUsd),
    horizon_months: projection.horizonMonths,
    horizon_label: formatGoalHorizonDuration(projection.horizonMonths, lang),
    life_expectancy_age: projection.lifeExpectancyAge,
    inheritance_usd: roundUsd(projection.inheritanceUsd),
    assumptions: {
      annual_return: projection.assumptions.annualReturn,
      annual_contribution_usd: roundUsd(
        projection.assumptions.annualContributionUsd,
      ),
      inflation: projection.assumptions.inflation,
      annual_living_spend_usd: roundUsd(
        projection.assumptions.annualLivingSpendUsd,
      ),
    },
    goals: projection.goals.map((g) => ({
      type: g.type,
      label: g.label || g.type,
      amount_usd: roundUsd(g.amountUsd),
      within_months: g.withinMonths,
      within_label: formatGoalHorizonDuration(g.withinMonths, lang),
    })),
    scenarios: {
      base: {
        annual_return: projection.scenarios.base.annualReturn,
        ending_wealth_usd: roundUsd(projection.scenarios.base.endingWealth),
        total_shortfall_usd: roundUsd(projection.scenarios.base.totalShortfall),
      },
      conservative: {
        annual_return: projection.scenarios.conservative.annualReturn,
        ending_wealth_usd: roundUsd(
          projection.scenarios.conservative.endingWealth,
        ),
        total_shortfall_usd: roundUsd(
          projection.scenarios.conservative.totalShortfall,
        ),
      },
      optimistic: {
        annual_return: projection.scenarios.optimistic.annualReturn,
        ending_wealth_usd: roundUsd(
          projection.scenarios.optimistic.endingWealth,
        ),
        total_shortfall_usd: roundUsd(
          projection.scenarios.optimistic.totalShortfall,
        ),
      },
    },
    first_shortfall: fs
      ? {
          kind: fs.kind,
          goal_label: fs.goal.label || fs.goal.type,
          month: fs.month,
          month_label: formatGoalHorizonDuration(fs.month, lang),
          shortfall_usd: roundUsd(fs.shortfallUsd),
          needed_usd: roundUsd(fs.neededUsd),
        }
      : null,
    insight_seeds: seeds,
  };
}

function clampText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, max);
}

/**
 * Parse Gemini JSON into display insights. Throws if invalid / empty.
 * Only allows ids present in `allowedIds` (from rule seeds).
 */
export function parseGoalPathInsightsFromModel(
  text: string,
  allowedSeeds: GoalPathInsightSeed[],
  lang: Lang = "en",
): GoalPathInsight[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("insights_json_missing");
  const root = JSON.parse(text.slice(start, end + 1)) as unknown;
  if (!root || typeof root !== "object") throw new Error("insights_not_object");
  const list = (root as { insights?: unknown }).insights;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("insights_empty");
  }

  const byId = new Map(allowedSeeds.map((s) => [s.id, s]));
  const allowed = new Set(allowedSeeds.map((s) => s.id));
  const out: GoalPathInsight[] = [];

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (!isInsightId(rec.id) || !allowed.has(rec.id)) continue;
    const seed = byId.get(rec.id)!;
    const title = rewriteLargeMonthDurationsInText(
      clampText(rec.title, 120),
      lang,
    );
    const detail = rewriteLargeMonthDurationsInText(
      clampText(rec.detail, 400),
      lang,
    );
    const talking = rewriteLargeMonthDurationsInText(
      clampText(rec.talking_point, 280),
      lang,
    );
    if (!title || !detail) continue;

    const hooksRaw = Array.isArray(rec.customization_hooks)
      ? rec.customization_hooks.filter(isHook)
      : [];
    const hooks =
      hooksRaw.length > 0 ? hooksRaw : seed.customization_hooks;

    out.push({
      id: rec.id,
      severity: seed.severity,
      title,
      detail,
      talking_point: talking || detail,
      customization_hooks: [...new Set(hooks)].slice(0, 4),
    });
  }

  if (out.length === 0) throw new Error("insights_none_valid");

  // Preserve seed severity order; drop duplicates by id.
  const seen = new Set<string>();
  const ordered: GoalPathInsight[] = [];
  for (const seed of allowedSeeds) {
    const hit = out.find((i) => i.id === seed.id);
    if (hit && !seen.has(hit.id)) {
      seen.add(hit.id);
      ordered.push(hit);
    }
  }
  for (const i of out) {
    if (!seen.has(i.id)) {
      seen.add(i.id);
      ordered.push(i);
    }
  }
  return ordered.slice(0, MAX_INSIGHTS);
}
