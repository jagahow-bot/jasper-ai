/**
 * AI / engine parameter disclosure helpers.
 * Layer 1: card summary knobs · Layer 2: grouped + diff · Layer 3: Pro round timeline.
 */

import type {
  PortfolioCandidate,
  ProRoundSnapshot,
  ProposalCard,
} from "@/lib/types";
import { resolvePrimaryRecommendationCode } from "@/lib/proposal-set";

export type ParamCategoryId =
  | "objective"
  | "risk"
  | "universe"
  | "allocation"
  | "rebalance"
  | "other";

export type SummaryKnobId =
  | "scenario"
  | "objective"
  | "allocator"
  | "holdings"
  | "customization"
  | "mustInclude";

export type ParamSummaryKnob = {
  id: SummaryKnobId;
  /** i18n key for the knob label (friendly, not raw param key). */
  labelKey: string;
  /** Raw value token for objective/allocator (localized by UI). */
  valueCode?: string;
  /** Preformatted display when not a code. */
  displayValue?: string;
};

export type GroupedParamRow = {
  key: string;
  category: ParamCategoryId;
  value: unknown;
  displayValue: string;
  changed: boolean;
  baselineDisplayValue?: string;
};

export type ParamCategoryGroup = {
  category: ParamCategoryId;
  rows: GroupedParamRow[];
};

export type RoundTimelineEntry = {
  round: number;
  improved: boolean;
  objectiveMode: string | null;
  allocatorMode: string | null;
  championCode: string | null;
  winnerCode: string | null;
  keyChanges: { key: string; from: string; to: string }[];
  score: number | null;
  sharpe: number | null;
  cagr: number | null;
  maxDrawdown: number | null;
  trialsInRound: number;
};

/** Keys never shown in disclosure UI (scores, bookkeeping). */
export const INTERNAL_PARAM_KEYS = new Set([
  "adjusted_score",
  "raw_score",
  "gap_objective",
  "in_sample_objective",
  "out_of_sample_objective",
  "param_source",
  "pro_round_index",
  "pro_round_role",
  "optuna_trial_number",
  "model_code",
  "allocator_mode", // prefer `mode`
  "must_include_tickers", // shown via needs summary knob
]);

const CATEGORY_ORDER: ParamCategoryId[] = [
  "objective",
  "risk",
  "universe",
  "allocation",
  "rebalance",
  "other",
];

const CATEGORY_BY_KEY: Record<string, ParamCategoryId> = {
  scenario_style: "objective",
  objective_mode: "objective",
  mode: "allocation",
  allocator_mode: "allocation",
  lookback_days: "universe",
  shrinkage: "risk",
  risk_aversion: "risk",
  max_weight_actual: "risk",
  top_n_actual: "universe",
  max_holdings_actual: "universe",
  no_trade_tol: "rebalance",
  turnover_penalty_mult: "rebalance",
  max_turnover_actual: "risk",
  customization_drift_actual: "risk",
  rebalance_freq: "rebalance",
  factor_lookback_days: "universe",
  reversal_lookback_days: "universe",
  value_lookback_days: "universe",
  w_mom: "allocation",
  w_reversal: "allocation",
  w_value: "allocation",
  w_lowvol: "allocation",
  w_trend: "allocation",
  w_drawdown: "allocation",
  w_income: "allocation",
  w_equity: "allocation",
  w_bond: "allocation",
  w_commodity: "allocation",
  w_real_estate: "allocation",
  w_alternative: "allocation",
  mom_indicator: "allocation",
  reversal_indicator: "allocation",
  value_indicator: "allocation",
  lowvol_indicator: "allocation",
  trend_indicator: "allocation",
  drawdown_indicator: "allocation",
  income_indicator: "allocation",
};

const SUMMARY_KEYS_PRIORITY: SummaryKnobId[] = [
  "scenario",
  "objective",
  "allocator",
  "holdings",
  "customization",
  "mustInclude",
];

/** Keys compared across Pro rounds for the timeline “what changed” strip. */
const ROUND_DIFF_KEYS = [
  "mode",
  "objective_mode",
  "top_n_actual",
  "max_holdings_actual",
  "max_weight_actual",
  "customization_drift_actual",
  "max_turnover_actual",
  "lookback_days",
  "risk_aversion",
  "shrinkage",
  "rebalance_freq",
  "no_trade_tol",
] as const;

function asParams(
  params: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return params && typeof params === "object" ? params : {};
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

export function categorizeParamKey(key: string): ParamCategoryId {
  if (CATEGORY_BY_KEY[key]) return CATEGORY_BY_KEY[key];
  if (key.startsWith("w_")) return "allocation";
  if (key.endsWith("_indicator")) return "allocation";
  if (key.includes("lookback")) return "universe";
  if (key.includes("turnover") || key.includes("trade")) return "rebalance";
  if (key.includes("weight") || key.includes("drift") || key.includes("risk"))
    return "risk";
  return "other";
}

/** Format a param value for tables (no i18n). */
export function formatParamRawValue(key: string, value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (
      key.includes("weight") ||
      key.includes("turnover") ||
      key.includes("drift") ||
      key.includes("shrinkage") ||
      key === "no_trade_tol" ||
      key.startsWith("w_")
    ) {
      if (Math.abs(value) <= 1.5) return `${(value * 100).toFixed(1)}%`;
    }
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(3).replace(/\.?0+$/, "");
  }
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function holdingsCount(
  params: Record<string, unknown>,
  weights?: Record<string, number> | null,
): number | null {
  const mh = num(params.max_holdings_actual);
  if (mh != null) return Math.round(mh);
  if (weights) {
    const n = Object.values(weights).filter(
      (w) => Number.isFinite(w) && Math.abs(w) > 1e-6,
    ).length;
    if (n > 0) return n;
  }
  const top = num(params.top_n_actual);
  return top != null ? Math.round(top) : null;
}

/**
 * Build 3–5 human-readable summary knobs for a candidate / proposal card.
 * Never exposes raw keys like `customization_drift_actual` as labels.
 */
export function buildParamSummaryKnobs(
  params: Record<string, unknown> | null | undefined,
  needs?: PortfolioCandidate["needs_attainment"] | null,
  weights?: Record<string, number> | null,
): ParamSummaryKnob[] {
  const p = asParams(params);
  const knobs: ParamSummaryKnob[] = [];

  const scenario = str(p.scenario_style);
  if (scenario) {
    knobs.push({
      id: "scenario",
      labelKey: "params.summary.scenario",
      valueCode: scenario,
    });
  }

  const objective = str(p.objective_mode);
  if (objective) {
    knobs.push({
      id: "objective",
      labelKey: "params.summary.objective",
      valueCode: objective,
    });
  }

  const allocator = str(p.mode) ?? str(p.allocator_mode);
  if (allocator) {
    knobs.push({
      id: "allocator",
      labelKey: "params.summary.allocator",
      valueCode: allocator,
    });
  }

  const holdings = holdingsCount(p, weights);
  const topN = num(p.top_n_actual);
  if (holdings != null) {
    const display =
      topN != null && Math.round(topN) !== holdings
        ? `${holdings} / Top-${Math.round(topN)}`
        : String(holdings);
    knobs.push({
      id: "holdings",
      labelKey: "params.summary.holdings",
      displayValue: display,
    });
  }

  const driftActual =
    num(p.customization_drift_actual) ??
    num(needs?.customization_drift_l1) ??
    null;
  const driftCap = num(needs?.customization_drift_cap);
  if (driftActual != null || driftCap != null) {
    const actualPct =
      driftActual != null ? `${(driftActual * 100).toFixed(0)}%` : "—";
    const capPct = driftCap != null ? `${(driftCap * 100).toFixed(0)}%` : null;
    knobs.push({
      id: "customization",
      labelKey: "params.summary.customization",
      displayValue: capPct ? `${actualPct} / ${capPct}` : actualPct,
    });
  }

  const must = needs?.must_include_tickers;
  if (Array.isArray(must) && must.length > 0) {
    knobs.push({
      id: "mustInclude",
      labelKey: "params.summary.mustInclude",
      displayValue: String(must.length),
    });
  }

  return SUMMARY_KEYS_PRIORITY.map((id) => knobs.find((k) => k.id === id)).filter(
    (k): k is ParamSummaryKnob => Boolean(k),
  ).slice(0, 5);
}

function isDisplayableParam(key: string, value: unknown): boolean {
  if (INTERNAL_PARAM_KEYS.has(key)) return false;
  if (key.startsWith("_")) return false;
  if (value == null) return false;
  if (typeof value === "object" && !Array.isArray(value)) return false;
  return true;
}

/** Group candidate params into taxonomy categories (no baseline diff). */
export function groupCandidateParams(
  params: Record<string, unknown> | null | undefined,
): ParamCategoryGroup[] {
  const p = asParams(params);
  const buckets = new Map<ParamCategoryId, GroupedParamRow[]>();
  for (const cat of CATEGORY_ORDER) buckets.set(cat, []);

  for (const [key, value] of Object.entries(p)) {
    if (!isDisplayableParam(key, value)) continue;
    const category = categorizeParamKey(key);
    buckets.get(category)!.push({
      key,
      category,
      value,
      displayValue: formatParamRawValue(key, value),
      changed: false,
    });
  }

  for (const rows of buckets.values()) {
    rows.sort((a, b) => a.key.localeCompare(b.key));
  }

  return CATEGORY_ORDER.map((category) => ({
    category,
    rows: buckets.get(category) ?? [],
  })).filter((g) => g.rows.length > 0);
}

/**
 * Diff current params vs a baseline (recommended / primary).
 * Marks changed rows; when `diffOnly`, drops identical rows.
 */
export function diffGroupedParams(
  current: Record<string, unknown> | null | undefined,
  baseline: Record<string, unknown> | null | undefined,
  opts?: { diffOnly?: boolean },
): ParamCategoryGroup[] {
  const cur = asParams(current);
  const base = asParams(baseline);
  const diffOnly = Boolean(opts?.diffOnly) && Object.keys(base).length > 0;
  const keys = new Set([
    ...Object.keys(cur).filter((k) => isDisplayableParam(k, cur[k])),
    ...Object.keys(base).filter((k) => isDisplayableParam(k, base[k])),
  ]);

  const buckets = new Map<ParamCategoryId, GroupedParamRow[]>();
  for (const cat of CATEGORY_ORDER) buckets.set(cat, []);

  for (const key of [...keys].sort()) {
    const cv = cur[key];
    const bv = base[key];
    const hasCur = isDisplayableParam(key, cv) || cv !== undefined;
    if (!hasCur && bv === undefined) continue;
    const displayValue = formatParamRawValue(key, cv);
    const baselineDisplayValue =
      bv !== undefined ? formatParamRawValue(key, bv) : undefined;
    const changed =
      Object.keys(base).length > 0 && displayValue !== (baselineDisplayValue ?? "—");
    if (diffOnly && !changed) continue;
    if (cv === undefined && !changed) continue;

    const category = categorizeParamKey(key);
    buckets.get(category)!.push({
      key,
      category,
      value: cv,
      displayValue: cv === undefined ? "—" : displayValue,
      changed,
      baselineDisplayValue,
    });
  }

  return CATEGORY_ORDER.map((category) => ({
    category,
    rows: buckets.get(category) ?? [],
  })).filter((g) => g.rows.length > 0);
}

/** Resolve baseline candidate params for proposal comparison. */
export function resolveBaselineParams(
  candidates: PortfolioCandidate[] | null | undefined,
  proposals?: ProposalCard[] | null,
  preferredCode?: string | null,
): { code: string | null; params: Record<string, unknown> } {
  const code =
    preferredCode?.trim().toUpperCase() ||
    resolvePrimaryRecommendationCode(proposals, candidates);
  if (!code) {
    const first = candidates?.[0];
    return {
      code: first?.model_code?.toUpperCase() ?? null,
      params: asParams(first?.params),
    };
  }
  const match =
    candidates?.find(
      (c) => (c.model_code || "").toUpperCase() === code,
    ) ?? null;
  return { code, params: asParams(match?.params) };
}

function setupSnapshot(round: ProRoundSnapshot): Record<string, unknown> {
  const setup = { ...(round.round_setup ?? {}) };
  // Prefer winner candidate params for objective_mode / rebalance when missing on setup.
  const winnerCode = round.round_winner_model_code?.toUpperCase();
  const winner =
    round.candidates.find(
      (c) => (c.model_code || "").toUpperCase() === winnerCode,
    ) ?? round.candidates[0];
  const wp = asParams(winner?.params);
  if (setup.objective_mode == null && wp.objective_mode != null) {
    setup.objective_mode = wp.objective_mode;
  }
  if (setup.rebalance_freq == null && wp.rebalance_freq != null) {
    setup.rebalance_freq = wp.rebalance_freq;
  }
  return setup;
}

function pickWinnerMetrics(round: ProRoundSnapshot): {
  sharpe: number | null;
  cagr: number | null;
  maxDrawdown: number | null;
} {
  const code = (
    round.round_winner_model_code ??
    round.incoming_champion_model_code ??
    ""
  ).toUpperCase();
  const c =
    round.candidates.find((x) => (x.model_code || "").toUpperCase() === code) ??
    round.candidates[0];
  return {
    sharpe: c?.sharpe ?? null,
    cagr: c?.cagr ?? null,
    maxDrawdown: c?.max_drawdown ?? null,
  };
}

/** Build Pro multi-round timeline rows from existing `pro_rounds` snapshots. */
export function buildRoundTimeline(
  rounds: ProRoundSnapshot[] | null | undefined,
): RoundTimelineEntry[] {
  if (!rounds?.length) return [];
  const sorted = [...rounds].sort((a, b) => a.round - b.round);
  const out: RoundTimelineEntry[] = [];
  let prevSetup: Record<string, unknown> | null = null;

  for (const round of sorted) {
    const setup = setupSnapshot(round);
    const keyChanges: RoundTimelineEntry["keyChanges"] = [];
    if (prevSetup) {
      for (const key of ROUND_DIFF_KEYS) {
        const from = formatParamRawValue(key, prevSetup[key]);
        const to = formatParamRawValue(key, setup[key]);
        if (from !== to && (prevSetup[key] != null || setup[key] != null)) {
          keyChanges.push({ key, from, to });
        }
      }
    }
    const metrics = pickWinnerMetrics(round);
    out.push({
      round: round.round,
      improved: Boolean(round.improved),
      objectiveMode: str(setup.objective_mode),
      allocatorMode: str(setup.mode),
      championCode: round.incoming_champion_model_code ?? null,
      winnerCode: round.round_winner_model_code ?? null,
      keyChanges: keyChanges.slice(0, 6),
      score:
        round.round_best_adjusted_score != null &&
        Number.isFinite(Number(round.round_best_adjusted_score))
          ? Number(round.round_best_adjusted_score)
          : null,
      sharpe: metrics.sharpe,
      cagr: metrics.cagr,
      maxDrawdown: metrics.maxDrawdown,
      trialsInRound: round.trials_in_round,
    });
    prevSetup = setup;
  }
  return out;
}

export function paramCategoryLabelKey(category: ParamCategoryId): string {
  return `params.category.${category}`;
}

/** Prefer friendly `pro.param.*` / `config.control.*` keys for a param. */
export function paramFriendlyLabelKey(key: string): string {
  return `pro.param.${key}`;
}
