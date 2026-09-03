import { z } from "zod";
import { enforceAllocControlsForClasses } from "@/lib/asset-class-policy";
import { ASSET_CLASSES, type AssetClass } from "@/lib/constants";
import {
  detectDirectIndexing,
  filterTickersForDirectIndex,
  isUniverseStock,
  MAX_DIRECT_INDEX_SLEEVE,
  pickDirectIndexStocks,
  resolveDirectIndexSleeveCount,
} from "@/lib/direct-indexing";
import {
  buildLockedCustomUniverse,
  isLockedModelUniverse,
  maxWeightForLockedUniverse,
  resolveStrictLockedAdds,
} from "@/lib/locked-universe";
import type {
  BacktestRequest,
  ClientContext,
  ExperimentRequest,
  GroupWeightBand,
  Objective,
  OptimizationMode,
  ParamControl,
} from "@/lib/types";

export const OVERLAY_VERSION = "1.0" as const;

export const OVERLAY_PHASES = [
  "discovery",
  "clarify",
  "confirm",
  "execute",
  "review",
] as const;

export type OverlayPhase = (typeof OVERLAY_PHASES)[number];

const riskToleranceSchema = z.enum(["conservative", "moderate", "aggressive"]);
const esgPreferenceSchema = z.enum(["none", "light", "strict"]);
const marketStanceSchema = z.enum(["risk_on", "neutral", "risk_off"]);
const objectiveSchema = z.enum([
  "max_sharpe",
  "max_return",
  "min_max_drawdown",
  "max_sortino",
  "min_cvar",
  "risk_parity_erc",
  "max_diversification",
  "mean_variance_utility",
  "custom",
  "dynamic",
]);
const optimizationModeSchema = z.enum(["standard", "pro_auto"]);
const paramControlModeSchema = z.enum(["fixed", "search", "off"]);

export const paramControlSchema = z
  .object({
    mode: paramControlModeSchema,
    fixed: z.union([z.number(), z.string(), z.null()]).optional(),
    min: z.number().nullable().optional(),
    max: z.number().nullable().optional(),
    step: z.number().nullable().optional(),
    options: z.array(z.string()).nullable().optional(),
  })
  .strip();

export const experimentOverlaySchema = z
  .object({
    enabled: z.boolean(),
    mode: z.literal("objective_switch"),
    regime_mode: z.enum(["auto", "risk_off", "neutral", "risk_on"]),
    note: z.string().nullable().optional(),
    run_ab_evaluation: z.boolean().optional(),
  })
  .strip();

export const overlaySessionAuditSchema = z.object({
  session_id: z.string().min(8),
  rm_id: z.string().optional(),
  client_ref: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  phase: z.enum(OVERLAY_PHASES),
  conversation_turns: z.number().int().min(0),
  source: z.enum(["gemini", "kimi", "rules", "manual"]),
  rm_sign_off: z
    .object({
      signed_at: z.string(),
      rm_id: z.string(),
      note: z.string().optional(),
    })
    .optional(),
  base_scenario_id: z.string().optional(),
  base_job_id: z.string().optional(),
  adjusted_job_id: z.string().optional(),
});

export const clientProfileOverlaySchema = z
  .object({
    risk_tolerance: riskToleranceSchema.optional(),
    investment_horizon_years: z.number().min(1).max(50).optional(),
    liquidity_need: z
      .object({
        amount_usd: z.number().min(0).optional(),
        within_months: z.number().min(1).max(120).optional(),
        description: z.string().max(300).optional(),
      })
      .strip()
      .optional(),
    esg_preference: esgPreferenceSchema.optional(),
    income_need_pct: z.number().min(0).max(1).optional(),
  })
  .strip();

export const marketViewOverlaySchema = z
  .object({
    stance: marketStanceSchema,
    themes: z.array(z.string().min(1).max(40)).max(8),
    narrative_summary: z.string().min(8).max(400),
  })
  .strip();

export const deploymentScheduleSchema = z
  .object({
    months: z.number().int().min(1).max(24),
    tranches: z.number().int().min(1).max(24).optional(),
    liquidity_buffer_pct: z.number().min(0).max(0.4).optional(),
  })
  .strip()
  .optional();

export const allocationOverlaySchema = z
  .object({
    asset_classes: z.array(z.enum(ASSET_CLASSES)).min(1).max(5),
    sleeve_targets: z.record(z.string(), z.number().min(0).max(1)).optional(),
    sub_sleeve_targets: z.record(z.string(), z.number().min(0).max(1)).optional(),
    enforce_class_weights: z.boolean().optional(),
    max_single_position_pct: z.number().min(0.05).max(0.40).optional(),
  })
  .strip();

export const overlayProposedTickerSchema = z
  .object({
    ticker: z.string().min(1).max(8),
    name: z.string().max(120).optional(),
    category: z.string().max(60).optional(),
    rationale: z.string().max(200).optional(),
  })
  .strip();

export type OverlayProposedTicker = z.infer<typeof overlayProposedTickerSchema>;

export const universeRuleOverlaySchema = z
  .object({
    prompts: z.array(z.string().min(4).max(200)).max(6),
    supplement_tickers: z.array(z.string().min(1).max(8)).max(MAX_DIRECT_INDEX_SLEEVE).optional(),
    exclude_tickers: z.array(z.string().min(1).max(8)).max(30).optional(),
    proposed_tickers: z.array(overlayProposedTickerSchema).max(MAX_DIRECT_INDEX_SLEEVE).optional(),
    /** Stock-sleeve construction around a benchmark ETF (not thematic ETF swaps). */
    construction: z.enum(["direct_index"]).optional(),
  })
  .strip();

export const optimizationOverlaySchema = z
  .object({
    objective: objectiveSchema,
    regime_adaptive: z.boolean().optional(),
    optimization_mode: optimizationModeSchema.optional(),
    trials: z.number().int().min(10).max(500).optional(),
  })
  .strip();

/** Soft client asks extracted from the RM brief (not hard job constraints). */
export const OVERLAY_ASK_KINDS = [
  "group_weight_band",
  "ticker_max",
  "exclude_ticker",
  "ticker_min",
  "objective",
  "cash_reserve",
  "direct_index",
  "other",
] as const;

export type OverlayAskKind = (typeof OVERLAY_ASK_KINDS)[number];

export const overlayAskSchema = z
  .object({
    id: z.string().min(1).max(40),
    title: z.string().min(1).max(120),
    summary: z.string().min(1).max(400),
    kind: z.enum(OVERLAY_ASK_KINDS),
    group_id: z.string().max(80).optional(),
    tickers: z.array(z.string().min(1).max(12)).max(MAX_DIRECT_INDEX_SLEEVE).optional(),
    min_pct: z.number().min(0).max(1).optional(),
    max_pct: z.number().min(0).max(1).optional(),
    target_pct: z.number().min(0).max(1).optional(),
    objective: objectiveSchema.optional(),
    cash_reserve_pct: z.number().min(0).max(0.4).optional(),
    status: z.enum(["proposed", "signed"]).optional(),
  })
  .strip();

export type OverlayAsk = z.infer<typeof overlayAskSchema>;

export const overlayClarificationOptionSchema = z
  .object({
    id: z.string().min(1).max(40),
    label: z.string().min(1).max(40),
  })
  .strip();

export type OverlayClarificationOption = z.infer<
  typeof overlayClarificationOptionSchema
>;

export const overlayClarificationSchema = z
  .object({
    id: z.string().min(1).max(40),
    question: z.string().min(4).max(200),
    options: z.array(overlayClarificationOptionSchema).max(5).default([]),
    allow_free_text: z.boolean().optional(),
    allow_multiple: z.boolean().optional(),
  })
  .strip();

export type OverlayClarification = z.infer<typeof overlayClarificationSchema>;

/** Pipeline stages a capability gap may attach to (design §3.1). */
export const CAPABILITY_GAP_STAGES = [
  "universe",
  "signals",
  "allocator",
  "constraints",
  "objective",
  "rebalance",
  "cash_schedule",
  "reporting",
] as const;

export type CapabilityGapStage = (typeof CAPABILITY_GAP_STAGES)[number];

export const capabilityGapSchema = z
  .object({
    stage: z.enum(CAPABILITY_GAP_STAGES),
    kind: z.enum([
      "unsupported_lever",
      "infeasible_combination",
      "bounds_exceeded",
    ]),
    missing_capability: z.string().min(3).max(80),
    summary: z.string().min(8).max(600),
    requested: z.record(z.string(), z.unknown()),
    nearest_supported: z.record(z.string(), z.unknown()).optional(),
    severity: z.enum(["blocking", "degradable"]),
  })
  .strip();

export type CapabilityGap = z.infer<typeof capabilityGapSchema>;

/** Conflict card when mechanical feasibility fails (design §3.4). */
export const overlayConflictSchema = z
  .object({
    id: z.string().min(1).max(40),
    code: z.string().min(1).max(60),
    title: z.string().min(4).max(120),
    explanation: z.string().min(8).max(800),
    options: z.array(overlayClarificationOptionSchema).max(5).default([]),
    /** When raising drift, values ≤0.6 are RM-alone; >0.6 need supervisor (§8). */
    suggested_drift: z.number().min(0).max(1).optional(),
    requires_supervisor: z.boolean().optional(),
    gap_stub: capabilityGapSchema.optional(),
  })
  .strip();

export type OverlayConflict = z.infer<typeof overlayConflictSchema>;

/** Gemini structured-extract output (no audit envelope). */
export const overlayExtractSchema = z
  .object({
    client_profile: clientProfileOverlaySchema,
    market_view: marketViewOverlaySchema,
    allocation: allocationOverlaySchema,
    universe: universeRuleOverlaySchema,
    optimization: optimizationOverlaySchema,
    deployment_schedule: deploymentScheduleSchema,
    param_adjustments: z.record(z.string(), paramControlSchema).optional(),
    experiment: experimentOverlaySchema.optional(),
    asks: z.array(overlayAskSchema).max(12).optional(),
    clarifications: z.array(overlayClarificationSchema).max(5).optional(),
    capability_gaps: z.array(capabilityGapSchema).max(5).optional(),
    conflicts: z.array(overlayConflictSchema).max(5).optional(),
    clarification_questions: z.array(z.string().min(4).max(200)).max(5),
    confidence: z.number().min(0).max(1),
    rationale: z.string().min(8).max(600),
  })
  .strip();

export const clientOverlaySchema = z.object({
  version: z.literal(OVERLAY_VERSION),
  audit: overlaySessionAuditSchema,
  client_profile: clientProfileOverlaySchema,
  market_view: marketViewOverlaySchema,
  allocation: allocationOverlaySchema,
  universe: universeRuleOverlaySchema,
  optimization: optimizationOverlaySchema,
  deployment_schedule: deploymentScheduleSchema,
  param_adjustments: z.record(z.string(), paramControlSchema).optional(),
  experiment: experimentOverlaySchema.optional(),
  asks: z.array(overlayAskSchema).max(12).optional(),
  clarifications: z.array(overlayClarificationSchema).max(5).optional(),
  capability_gaps: z.array(capabilityGapSchema).max(5).optional(),
  conflicts: z.array(overlayConflictSchema).max(5).optional(),
  clarification_questions: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(8),
});

export type OverlayExtractOutput = z.infer<typeof overlayExtractSchema>;
export type ClientOverlay = z.infer<typeof clientOverlaySchema>;
export type OverlaySessionAudit = z.infer<typeof overlaySessionAuditSchema>;

export type OverlayConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export function validateOverlay(value: unknown): ClientOverlay {
  return clientOverlaySchema.parse(value);
}

export function validateOverlayExtract(value: unknown): OverlayExtractOutput {
  return overlayExtractSchema.parse(value);
}

export function inferPhaseFromExtract(extract: OverlayExtractOutput): OverlayPhase {
  const pending =
    (extract.clarifications?.length ?? 0) > 0 ||
    (extract.conflicts?.length ?? 0) > 0 ||
    (extract.capability_gaps?.some((g) => g.severity === "blocking") ?? false) ||
    extract.clarification_questions.length > 0;
  if (extract.confidence >= 0.7 && !pending) {
    return "confirm";
  }
  if (extract.confidence >= 0.4 || pending) {
    return "clarify";
  }
  return "discovery";
}

export function createSessionId(): string {
  return `ovl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function mergeTickerLists(
  a?: string[] | null,
  b?: string[] | null,
): string[] | undefined {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...(a ?? []), ...(b ?? [])]) {
    const t = String(raw || "")
      .trim()
      .toUpperCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.length ? out : undefined;
}

/**
 * Map soft asks onto existing overlay levers (max weight, excludes, objective,
 * cash buffer, supplements). Does not invent hard job-failing constraints.
 */
export function applyAsksToOverlayLevers(overlay: ClientOverlay): ClientOverlay {
  const asks = overlay.asks ?? [];
  if (!asks.length) return overlay;

  let maxSingle = overlay.allocation.max_single_position_pct;
  let objective = overlay.optimization.objective;
  let excludes = overlay.universe.exclude_tickers;
  let supplements = overlay.universe.supplement_tickers;
  let deploy = overlay.deployment_schedule;
  const prompts = [...(overlay.universe.prompts ?? [])];

  for (const ask of asks) {
    if (ask.kind === "ticker_max" && ask.max_pct != null) {
      const capped = Math.min(0.4, Math.max(0.05, ask.max_pct));
      maxSingle = maxSingle == null ? capped : Math.min(maxSingle, capped);
    }
    if (ask.kind === "objective" && ask.objective) {
      objective = ask.objective;
    }
    if (ask.kind === "exclude_ticker" && ask.tickers?.length) {
      excludes = mergeTickerLists(excludes, ask.tickers);
    }
    if (ask.kind === "ticker_min" && ask.tickers?.length) {
      // Soft: keep preferred names eligible / pinned via supplements.
      supplements = mergeTickerLists(supplements, ask.tickers);
    }
    if (ask.kind === "direct_index" && ask.tickers?.length) {
      supplements = mergeTickerLists(supplements, ask.tickers);
    }
    if (ask.kind === "cash_reserve") {
      const cash =
        ask.cash_reserve_pct ?? ask.target_pct ?? ask.min_pct ?? null;
      if (cash != null && Number.isFinite(cash) && deploy) {
        const buf = Math.min(0.4, Math.max(0, cash));
        deploy = {
          ...deploy,
          liquidity_buffer_pct: Math.max(deploy.liquidity_buffer_pct ?? 0, buf),
        };
      }
      // Otherwise cash stays on the ask; clientContextFromOverlay reads it.
    }
    if (ask.kind === "group_weight_band") {
      const lo = ask.min_pct != null ? `${(ask.min_pct * 100).toFixed(0)}%` : null;
      const hi = ask.max_pct != null ? `${(ask.max_pct * 100).toFixed(0)}%` : null;
      const band =
        lo && hi ? `${lo}–${hi}` : lo ? `≥${lo}` : hi ? `≤${hi}` : null;
      if (band) {
        const hint = `Soft sleeve target${ask.group_id ? ` (${ask.group_id})` : ""}: ${band}`;
        if (!prompts.some((p) => p.includes(band))) prompts.push(hint);
      }
    }
  }

  return {
    ...overlay,
    allocation: {
      ...overlay.allocation,
      ...(maxSingle != null ? { max_single_position_pct: maxSingle } : {}),
    },
    universe: {
      ...overlay.universe,
      prompts,
      ...(excludes ? { exclude_tickers: excludes } : {}),
      ...(supplements ? { supplement_tickers: supplements } : {}),
    },
    optimization: {
      ...overlay.optimization,
      objective,
    },
    deployment_schedule: deploy ?? overlay.deployment_schedule,
  };
}

export function wrapExtractAsOverlay(
  extract: OverlayExtractOutput,
  sessionId: string,
  turns: number,
  source: "gemini" | "kimi" | "rules",
  prior?: ClientOverlay | null,
): ClientOverlay {
  const now = new Date().toISOString();
  const clientProfile = {
    ...prior?.client_profile,
    ...extract.client_profile,
    liquidity_need:
      prior?.client_profile.liquidity_need || extract.client_profile.liquidity_need
        ? {
            ...prior?.client_profile.liquidity_need,
            ...extract.client_profile.liquidity_need,
          }
        : undefined,
  };
  const allocation = {
    ...prior?.allocation,
    ...extract.allocation,
    sleeve_targets:
      prior?.allocation.sleeve_targets || extract.allocation.sleeve_targets
        ? {
            ...prior?.allocation.sleeve_targets,
            ...extract.allocation.sleeve_targets,
          }
        : undefined,
    sub_sleeve_targets:
      prior?.allocation.sub_sleeve_targets || extract.allocation.sub_sleeve_targets
        ? {
            ...prior?.allocation.sub_sleeve_targets,
            ...extract.allocation.sub_sleeve_targets,
          }
        : undefined,
  };

  const asks =
    extract.asks?.length
      ? extract.asks.map((a) => ({ ...a, status: a.status ?? ("proposed" as const) }))
      : prior?.asks;

  const base: ClientOverlay = {
    version: OVERLAY_VERSION,
    audit: {
      session_id: sessionId,
      rm_id: prior?.audit.rm_id,
      client_ref: prior?.audit.client_ref,
      created_at: prior?.audit.created_at ?? now,
      updated_at: now,
      phase: inferPhaseFromExtract(extract),
      conversation_turns: turns,
      source,
      base_scenario_id: prior?.audit.base_scenario_id,
      base_job_id: prior?.audit.base_job_id,
      adjusted_job_id: prior?.audit.adjusted_job_id,
      rm_sign_off: prior?.audit.rm_sign_off,
    },
    client_profile: clientProfile,
    market_view: extract.market_view,
    allocation,
    universe: extract.universe,
    optimization: extract.optimization,
    deployment_schedule:
      extract.deployment_schedule ?? prior?.deployment_schedule,
    param_adjustments: extract.param_adjustments,
    experiment: extract.experiment,
    ...(asks?.length ? { asks } : {}),
    clarifications: extract.clarifications,
    capability_gaps: extract.capability_gaps,
    conflicts: extract.conflicts,
    clarification_questions: extract.clarification_questions,
    confidence: extract.confidence,
    rationale: extract.rationale,
  };

  return applyAsksToOverlayLevers(base);
}

export function formatOverlayAssistantReply(overlay: ClientOverlay): string {
  return overlay.rationale;
}

export type ClarificationAnswerPair = {
  question: string;
  answer: string;
};

/**
 * Build one RM user message that binds each filled answer to its exact question.
 * Qn/An tokens stay English in all locales; section headers are localized.
 */
export function formatClarificationUserReply(opts: {
  answers: ClarificationAnswerPair[];
  notes?: string;
  lang: "zh" | "en" | "ko";
}): string {
  const { answers, notes, lang } = opts;
  const filled = answers.filter((a) => a.question.trim() && a.answer.trim());
  const notesText = notes?.trim() ?? "";

  const answersHeader =
    lang === "zh" ? "澄清回答：" : lang === "ko" ? "확인 답변:" : "Clarification answers:";
  const notesHeader =
    lang === "zh" ? "其他補充：" : lang === "ko" ? "추가 메모:" : "Additional notes:";

  const lines: string[] = [];
  if (filled.length) {
    lines.push(answersHeader);
    filled.forEach((pair, i) => {
      const n = i + 1;
      lines.push(`Q${n}: ${pair.question.trim()}`);
      lines.push(`A${n}: ${pair.answer.trim()}`);
    });
  }
  if (notesText) {
    if (lines.length) lines.push("");
    lines.push(notesHeader);
    lines.push(notesText);
  }
  return lines.join("\n");
}

function sleeveTargetsToParamControls(
  sleeve?: Record<string, number>,
): Record<string, ParamControl> {
  if (!sleeve) return {};
  const out: Record<string, ParamControl> = {};
  for (const [key, val] of Object.entries(sleeve)) {
    if (!key.startsWith("w_")) continue;
    out[key] = { mode: "fixed", fixed: val, min: 0, max: 1 };
  }
  return out;
}

function mergeParamControls(
  base: Record<string, ParamControl> | undefined,
  overlay: Record<string, ParamControl> | undefined,
  sleeves: Record<string, number> | undefined,
  subSleeves: Record<string, number> | undefined,
): Record<string, ParamControl> {
  return {
    ...(base ?? {}),
    ...sleeveTargetsToParamControls(sleeves),
    ...sleeveTargetsToParamControls(subSleeves),
    ...(overlay ?? {}),
  };
}

function inferExperiment(
  overlay: ClientOverlay,
): ExperimentRequest | undefined {
  if (overlay.experiment) return overlay.experiment;
  if (overlay.market_view.stance === "risk_off") {
    return {
      enabled: true,
      mode: "objective_switch",
      regime_mode: "risk_off",
    };
  }
  if (overlay.market_view.stance === "risk_on") {
    return {
      enabled: true,
      mode: "objective_switch",
      regime_mode: "risk_on",
    };
  }
  return undefined;
}

export type OverlayToBacktestOptions = {
  /** Scenario for adjusted run; defaults to `overlay-{session_id}`. */
  scenarioId?: string;
  reportLanguage?: string;
};

/**
 * Explicit theme-sleeve cap/limit language only.
 * Do NOT include bare "cap" / "reduce" / "trim" / "concentration" — those match
 * single-name trims (e.g. "Reduce excess NVDA", "Cap NVDA", "Trim NVDA
 * Concentration") and must not invent a 25% theme floor.
 */
const THEME_CAP_REDUCE_HINTS = [
  "theme cap",
  "theme exposure cap",
  "cap theme",
  "cap theme risk",
  "cap theme exposure",
  "reduce theme",
  "reduce theme exposure",
  "reduce theme risk",
  "reduce tech concentration",
  "reduce growth concentration",
  "cap tech exposure",
  "cap growth exposure",
  "limit theme",
  "limit tech exposure",
  "limit growth exposure",
  "limit tech concentration",
  "limit growth concentration",
  "de-risk theme",
  "主題上限",
  "主題曝險上限",
  "限制主題",
  "降低主題",
  "限制科技曝險",
  "테마 상한",
  "테마 노출 상한",
  "테마 축소",
];

/** Explicit drawdown limit/floor language — never invent from risk_tolerance alone. */
const DRAWDOWN_FLOOR_HINTS = [
  "drawdown floor",
  "drawdown limit",
  "drawdown tolerance",
  "max drawdown",
  "maximum drawdown",
  "dd floor",
  "dd limit",
  "dd tolerance",
  "最大回撤",
  "回撤上限",
  "回撤下限",
  "回撤容忍",
  "回撤地板",
  "최대 낙폭",
  "낙폭 한도",
  "낙폭 하한",
];

function overlayNeedsHaystack(overlay: ClientOverlay): string {
  const asks = overlay.asks ?? [];
  return [
    ...(overlay.market_view?.themes ?? []),
    overlay.market_view?.narrative_summary ?? "",
    overlay.rationale ?? "",
    ...asks.map((a) => `${a.title} ${a.summary}`),
  ]
    .join(" ")
    .toLowerCase();
}

/** Word-aware match so "cap" does not hit "capital" / "capacity". */
function haystackHasHint(haystack: string, hint: string): boolean {
  const h = hint.toLowerCase();
  if (!h) return false;
  // CJK / spaced phrases: substring is fine.
  if (/[^\x00-\x7f]/.test(h) || h.includes(" ") || h.includes("_")) {
    return haystack.includes(h);
  }
  const re = new RegExp(`(?:^|[^a-z0-9])${h}(?:[^a-z0-9]|$)`, "i");
  return re.test(haystack);
}

/**
 * True when the brief wants to *keep* an aggressive AI/tech/satellite sleeve
 * (structured band ask and/or narrative like "preserving … satellite … 40-45%").
 */
function wantsKeepAggressiveThemeTilt(overlay: ClientOverlay): boolean {
  const asks = overlay.asks ?? [];
  if (
    asks.some(
      (a) =>
        a.kind === "group_weight_band" &&
        ((a.min_pct != null && a.min_pct >= 0.3) ||
          (a.target_pct != null && a.target_pct >= 0.3)),
    )
  ) {
    return true;
  }

  const haystack = overlayNeedsHaystack(overlay);
  // "preserving/keeping/maintain … satellite/theme/ai/tech … 40-45%" style.
  const keepVerb =
    /\b(keep(?:ing)?|preserv(?:e|ing)|maintain(?:ing)?|retain(?:ing)?)\b/.test(
      haystack,
    ) || /保留|維持|保持|유지|보존/.test(haystack);
  const themeNoun =
    /\b(satellite|theme|ai|tech|growth)\b/.test(haystack) ||
    /衛星|主題|科技|테마|위성/.test(haystack);
  const highBand =
    /(?:3[0-9]|4[0-9]|5[0-9])\s*[%％]?\s*[-–—~to到至]\s*(?:3[0-9]|4[0-9]|5[0-9])\s*[%％]?/.test(
      haystack,
    ) ||
    /(?:around|about|near|約|大约|대략)\s*(?:3[0-9]|4[0-9]|5[0-9])\s*[%％]/.test(
      haystack,
    );
  return keepVerb && themeNoun && highBand;
}

/**
 * Theme exposure soft-cap only when the brief/asks explicitly want to *cap or
 * reduce* theme risk — never when the client wants to *keep* an aggressive
 * AI/tech tilt (e.g. satellite 40–45%), and never from mere theme tags,
 * single-name trims, or bare "reduce"/"cap"/"concentration" wording.
 */
export function shouldApplyThemeExposureCap(overlay: ClientOverlay): boolean {
  if (wantsKeepAggressiveThemeTilt(overlay)) return false;

  const haystack = overlayNeedsHaystack(overlay);
  return THEME_CAP_REDUCE_HINTS.some((h) => haystackHasHint(haystack, h));
}

/**
 * Parse an explicit drawdown % from overlay text only when drawdown-limit
 * language is present. Returns null when risk profile alone is all we have.
 */
export function explicitDrawdownToleranceFromOverlay(
  overlay: ClientOverlay,
): number | null {
  const haystack = overlayNeedsHaystack(overlay);
  if (!DRAWDOWN_FLOOR_HINTS.some((h) => haystackHasHint(haystack, h))) {
    return null;
  }
  // Prefer a % near a drawdown hint (e.g. "max drawdown 20%", "最大回撤15%").
  for (const hint of DRAWDOWN_FLOOR_HINTS) {
    const h = hint.toLowerCase();
    const idx = haystack.indexOf(h);
    if (idx < 0) continue;
    const window = haystack.slice(Math.max(0, idx - 24), idx + h.length + 24);
    const m = window.match(/(\d+(?:\.\d+)?)\s*%/);
    if (m) {
      const raw = Number(m[1]);
      if (!Number.isFinite(raw)) continue;
      const pct = raw > 1 ? raw / 100 : raw;
      if (pct > 0 && pct < 1) return pct;
    }
  }
  // Explicit floor language without a number — still no invent from risk.
  return null;
}

function asksNeedsSummary(overlay: ClientOverlay): string | null {
  const asks = overlay.asks ?? [];
  if (!asks.length) return null;
  const bits = asks.map((a, i) => `${i + 1}. ${a.title}: ${a.summary}`);
  return bits.join(" ").slice(0, 300);
}

const OVERLAY_HEDGE_TICKERS = new Set([
  "GLD",
  "IAU",
  "GLDM",
  "TLT",
  "IEF",
  "IEI",
  "SHY",
  "AGG",
  "BND",
  "BNDX",
  "TIP",
  "BTAL",
  "TAIL",
  "BIL",
  "SGOV",
]);

const OVERLAY_AI_TICKERS = new Set([
  "BOTZ",
  "AIQ",
  "IRBO",
  "ROBO",
  "THNQ",
  "WTAI",
  "CHAT",
  "SMH",
  "SOXX",
  "NVDA",
  "GOOGL",
  "GOOG",
  "META",
  "MSFT",
]);

function overlayThemeClass(ticker: string): "ai" | "hedge" | "other" {
  const t = ticker.toUpperCase();
  if (OVERLAY_HEDGE_TICKERS.has(t)) return "hedge";
  if (OVERLAY_AI_TICKERS.has(t)) return "ai";
  return "other";
}

function sleeveKeyTheme(key: string): "ai" | "hedge" | "other" {
  const k = key.toLowerCase();
  if (/ai|theme|tech|satellite|growth|主題|科技|機器人/.test(k)) return "ai";
  if (/hedge|defensive|避險|对冲|gold|bond|債券|黃金/.test(k)) return "hedge";
  return "other";
}

function bandTargetFromAsk(ask: OverlayAsk): number | null {
  if (ask.target_pct != null && Number.isFinite(ask.target_pct)) return ask.target_pct;
  if (ask.min_pct != null && ask.max_pct != null) return (ask.min_pct + ask.max_pct) / 2;
  if (ask.min_pct != null) return ask.min_pct;
  if (ask.max_pct != null) return ask.max_pct;
  return null;
}

/** Compile signed overlay group_weight_band asks + theme sleeve_targets for the engine. */
export function groupWeightBandsFromOverlay(overlay: ClientOverlay): GroupWeightBand[] {
  const signedOff = Boolean(overlay.audit.rm_sign_off);
  const bands: GroupWeightBand[] = [];
  const seen = new Set<string>();

  // Pool tickers from supplements, proposed, AND group_weight_band asks so
  // sleeve_targets and ticker-less asks can resolve tickers via theme classification.
  const askTickers = (overlay.asks ?? [])
    .filter((a) => a.kind === "group_weight_band" && a.tickers?.length)
    .flatMap((a) => a.tickers!);
  const supplementTickers = [
    ...(overlay.universe.supplement_tickers ?? []),
    ...(overlay.universe.proposed_tickers ?? []).map((p) => p.ticker),
    ...askTickers,
  ]
    .map((t) => String(t).toUpperCase())
    .filter(Boolean);

  const pushBand = (band: GroupWeightBand) => {
    const tickers = [...new Set(band.tickers.map((t) => t.toUpperCase()).filter(Boolean))];
    if (!tickers.length) return;
    const target = band.target_pct ?? band.min_pct ?? band.max_pct;
    if (target == null || !Number.isFinite(target) || target <= 0) return;
    const key = `${band.group_id ?? ""}|${tickers.join(",")}|${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    bands.push({ ...band, tickers });
  };

  for (const ask of overlay.asks ?? []) {
    if (ask.kind !== "group_weight_band") continue;
    if (!signedOff && ask.status !== "signed") continue;
    let tickers = ask.tickers ?? [];
    // When the ask specifies a group_id but no tickers, infer from the
    // supplement/proposed pool using theme classification so Gemini doesn't
    // need to duplicate ticker lists on every ask.
    if (!tickers.length && ask.group_id) {
      const theme = sleeveKeyTheme(ask.group_id);
      tickers =
        theme === "other"
          ? supplementTickers
          : supplementTickers.filter((t) => overlayThemeClass(t) === theme);
    }
    if (!tickers.length) continue;
    const target = bandTargetFromAsk(ask);
    pushBand({
      group_id: ask.group_id ?? ask.id,
      tickers,
      target_pct: ask.target_pct ?? target,
      min_pct: ask.min_pct ?? null,
      max_pct: ask.max_pct ?? null,
    });
  }

  const sleeves = overlay.allocation.sleeve_targets;
  if (sleeves) {
    for (const [key, raw] of Object.entries(sleeves)) {
      if (key.startsWith("w_")) continue;
      const target = Number(raw);
      if (!Number.isFinite(target) || target <= 0) continue;
      const theme = sleeveKeyTheme(key);
      const tickers =
        theme === "other"
          ? supplementTickers
          : supplementTickers.filter((t) => overlayThemeClass(t) === theme);
      if (tickers.length) {
        pushBand({ group_id: key, tickers, target_pct: target });
      }
    }
  }

  const subSleeves = overlay.allocation.sub_sleeve_targets;
  if (subSleeves && sleeves) {
    for (const [key, raw] of Object.entries(subSleeves)) {
      const target = Number(raw);
      if (!Number.isFinite(target) || target <= 0) continue;
      const parentTheme = sleeveKeyTheme(key);
      let parentTickers: string[] = [];
      for (const [sKey] of Object.entries(sleeves)) {
        if (sKey.startsWith("w_")) continue;
        if (sleeveKeyTheme(sKey) === parentTheme || sKey.toLowerCase() === key.toLowerCase()) {
          parentTickers = supplementTickers.filter((t) => overlayThemeClass(t) === parentTheme);
          break;
        }
      }
      const member = supplementTickers.filter(
        (t) => t.includes(key.toUpperCase()) || key.toUpperCase().includes(t),
      );
      const tickers = member.length ? member : parentTickers.filter((t) => t === key.toUpperCase());
      if (tickers.length) {
        pushBand({ group_id: `${key}-sub`, tickers, target_pct: target });
      }
    }
  }

  return bands;
}

/**
 * Compile the overlay's client profile + market view into the engine's
 * ClientContext. Returns null when nothing usable was captured, so legacy
 * runs without a profile keep their exact previous behavior.
 *
 * Caps/floors (theme, drawdown, cash, single-name) are set only when the
 * signed overlay / asks / deployment fields explicitly mention them — never
 * invented from risk_tolerance or liquidity_need alone.
 */
export function clientContextFromOverlay(
  overlay: ClientOverlay,
): ClientContext | null {
  const profile = overlay.client_profile;
  const risk = profile.risk_tolerance ?? null;
  const horizon = profile.investment_horizon_years ?? null;
  const income = profile.income_need_pct ?? null;
  const summary =
    asksNeedsSummary(overlay) ||
    overlay.market_view?.narrative_summary?.trim() ||
    null;
  const tolerance = explicitDrawdownToleranceFromOverlay(overlay);
  // Single-name Needs cap only when allocation (or Ask ticker_max → allocation)
  // set it — never invent a default here.
  const singleCap = overlay.allocation?.max_single_position_pct ?? null;
  const themeCap = shouldApplyThemeExposureCap(overlay) ? 0.25 : null;
  const groupBands = groupWeightBandsFromOverlay(overlay);
  const scheduleBuffer = overlay.deployment_schedule?.liquidity_buffer_pct;
  const cashAsk = (overlay.asks ?? []).find((a) => a.kind === "cash_reserve");
  const cashFromAsk =
    cashAsk?.cash_reserve_pct ?? cashAsk?.target_pct ?? cashAsk?.min_pct ?? null;
  let cashReserve: number | null = null;
  if (typeof scheduleBuffer === "number") {
    cashReserve = scheduleBuffer;
  } else if (cashFromAsk != null && Number.isFinite(cashFromAsk)) {
    cashReserve = Math.min(0.4, Math.max(0, cashFromAsk));
  }
  const stance = overlay.market_view?.stance ?? null;
  const themes = (overlay.market_view?.themes ?? [])
    .map((t) => String(t).trim())
    .filter(Boolean)
    .slice(0, 5);
  // Do not invent cash from liquidity_need + risk_tolerance alone.
  if (
    !risk &&
    !horizon &&
    !income &&
    !summary &&
    singleCap == null &&
    themeCap == null &&
    cashReserve == null &&
    tolerance == null &&
    !stance &&
    themes.length === 0 &&
    groupBands.length === 0
  ) {
    return null;
  }
  return {
    risk_tolerance: risk,
    investment_horizon_years: horizon,
    max_drawdown_tolerance: tolerance,
    income_need_pct: income,
    max_single_name_pct: singleCap,
    theme_exposure_cap_pct: themeCap,
    cash_reserve_pct: cashReserve,
    needs_summary: summary ? summary.slice(0, 300) : null,
    market_stance: stance,
    market_themes: themes.length ? themes : null,
    group_weight_bands: groupBands.length ? groupBands : null,
  };
}

export function resolveLockedAddsForOverlay(overlay: ClientOverlay): string[] {
  const prompts = overlay.universe.prompts.filter(Boolean);
  const baseAdds = resolveStrictLockedAdds({
    explicitSupplements: overlay.universe.supplement_tickers,
    prompts,
  });
  const haystack = overlayDirectIndexHaystack(overlay);
  const isDi =
    overlay.universe.construction === "direct_index" || detectDirectIndexing(haystack);
  if (!isDi) return baseAdds;

  const proposed = (overlay.universe.proposed_tickers ?? []).map((p) => p.ticker);
  const stocks = pickDirectIndexStocks(haystack);
  return filterTickersForDirectIndex([...baseAdds, ...proposed, ...stocks]);
}

function overlayDirectIndexHaystack(overlay: ClientOverlay): string {
  return [
    ...overlay.universe.prompts,
    overlay.market_view.narrative_summary,
    ...(overlay.market_view.themes ?? []),
    overlay.rationale,
    ...(overlay.asks ?? []).flatMap((a) => [a.title, a.summary, ...(a.tickers ?? [])]),
  ]
    .filter(Boolean)
    .join("\n");
}

function directIndexHoldingsFloor(overlay: ClientOverlay): number {
  const haystack = overlayDirectIndexHaystack(overlay);
  const isDi =
    overlay.universe.construction === "direct_index" || detectDirectIndexing(haystack);
  if (!isDi) return 0;
  const fromSup = (overlay.universe.supplement_tickers ?? []).filter(isUniverseStock).length;
  const fromProposed = (overlay.universe.proposed_tickers ?? []).filter((p) =>
    isUniverseStock(p.ticker),
  ).length;
  return Math.max(resolveDirectIndexSleeveCount(haystack), fromSup, fromProposed);
}

/**
 * Map a confirmed ClientOverlay onto a base BacktestRequest (adjusted run).
 * Call after RM sign-off; does not mutate the overlay.
 */
export function overlayToBacktestRequest(
  base: BacktestRequest,
  overlay: ClientOverlay,
  opts?: OverlayToBacktestOptions,
): BacktestRequest {
  const alloc = overlay.allocation;
  const opt = overlay.optimization;
  const assetClasses = alloc.asset_classes as AssetClass[];
  const mergedControls = mergeParamControls(
    base.param_controls,
    overlay.param_adjustments,
    alloc.sleeve_targets,
    alloc.sub_sleeve_targets,
  );
  const enforcedControls = enforceAllocControlsForClasses(mergedControls, assetClasses);

  const prompts = overlay.universe.prompts.filter(Boolean);
  const filterText = prompts.length ? prompts.join("; ") : base.universe_filter_text;
  const fromAnchor = isLockedModelUniverse(base);
  // Anchored customization: commit the RM drift slider as Fixed unless the
  // overlay already set an explicit search range for customization_drift_actual.
  const driftCtrl = enforcedControls.customization_drift_actual;
  const driftMode = driftCtrl?.mode ?? "search";
  const explicitDriftSearch =
    driftMode === "search" &&
    (driftCtrl?.min != null || driftCtrl?.max != null);
  const anchoredDriftControls =
    fromAnchor && driftMode === "search" && !explicitDriftSearch
      ? {
          ...enforcedControls,
          customization_drift_actual: {
            mode: "fixed" as const,
            fixed: base.customization_drift ?? 0.5,
          },
        }
      : enforcedControls;
  const clientContext = clientContextFromOverlay(overlay);
  // Scope-selected cash sleeve (already on base via applyScopeToBacktestRequest)
  // is a floor: overlay cash settings can only raise it, never drop it to 0.
  const cashReserve = Math.max(
    base.cash_reserve_pct ?? 0,
    clientContext?.cash_reserve_pct ??
      overlay.deployment_schedule?.liquidity_buffer_pct ??
      0,
  );
  const deployMonths = overlay.deployment_schedule?.months ?? null;
  const deployTranches =
    overlay.deployment_schedule?.tranches ?? deployMonths;

  // Target model portfolio present → lock searchable universe to
  // (model holdings − excludes) ∪ explicit adds. Never open the fund pool.
  if (fromAnchor) {
    const adds = resolveLockedAddsForOverlay(overlay);
    const locked = buildLockedCustomUniverse(base, {
      addTickers: adds,
      excludeTickers: overlay.universe.exclude_tickers,
    });
    const preferredMax =
      alloc.max_single_position_pct ?? base.max_weight ?? 0.25;
    return {
      ...base,
      scenario_id: opts?.scenarioId ?? `overlay-${overlay.audit.session_id}`,
      benchmark_ticker: base.benchmark_ticker ?? null,
      asset_classes: assetClasses,
      max_weight: maxWeightForLockedUniverse(locked.length, preferredMax),
      objective: (opt.objective ?? base.objective) as Objective,
      regime_adaptive: opt.regime_adaptive ?? base.regime_adaptive,
      optimization_mode: (opt.optimization_mode ??
        base.optimization_mode) as OptimizationMode,
      trials: opt.trials ?? 25,
      top_models: 5,
      max_holdings: (() => {
        const floor = directIndexHoldingsFloor(overlay);
        const n = Math.max(locked.length, floor, 1);
        return floor > 0 ? Math.min(MAX_DIRECT_INDEX_SLEEVE, n) : n;
      })(),
      // Full eligible set on BOTH fields so API whitelist-early-return and
      // supplement-pin agree (holdings stay eligible; unrelated pool never enters).
      universe_tickers: locked,
      universe_supplement_tickers: locked,
      enforce_class_weights:
        alloc.enforce_class_weights ?? base.enforce_class_weights ?? false,
      universe_filter_prompts: prompts.length
        ? prompts
        : base.universe_filter_prompts,
      universe_filter_text: filterText,
      param_controls: anchoredDriftControls,
      experiment: inferExperiment(overlay) ?? base.experiment,
      report_language: opts?.reportLanguage ?? base.report_language,
      static_replay_holdings: null,
      client_context: clientContext,
      cash_reserve_pct: cashReserve,
      deployment_months: deployMonths,
      deployment_tranches: deployTranches,
    };
  }

  return {
    ...base,
    scenario_id: opts?.scenarioId ?? `overlay-${overlay.audit.session_id}`,
    benchmark_ticker: base.benchmark_ticker ?? null,
    asset_classes: assetClasses,
    max_weight: alloc.max_single_position_pct ?? base.max_weight,
    objective: (opt.objective ?? base.objective) as Objective,
    regime_adaptive: opt.regime_adaptive ?? base.regime_adaptive,
    optimization_mode: (opt.optimization_mode ?? base.optimization_mode) as OptimizationMode,
    trials: opt.trials ?? base.trials,
    top_models: base.top_models,
    max_holdings: (() => {
      const floor = directIndexHoldingsFloor(overlay);
      if (floor <= 0) return base.max_holdings;
      return Math.min(
        MAX_DIRECT_INDEX_SLEEVE,
        Math.max(base.max_holdings ?? 30, floor),
      );
    })(),
    universe_tickers: base.universe_tickers,
    enforce_class_weights:
      alloc.enforce_class_weights ?? base.enforce_class_weights ?? false,
    universe_filter_prompts: prompts.length ? prompts : base.universe_filter_prompts,
    universe_filter_text: filterText,
    universe_supplement_tickers: overlay.universe.supplement_tickers?.length
      ? overlay.universe.supplement_tickers
      : base.universe_supplement_tickers,
    param_controls: anchoredDriftControls,
    experiment: inferExperiment(overlay) ?? base.experiment,
    report_language: opts?.reportLanguage ?? base.report_language,
    static_replay_holdings: null,
    client_context: clientContext,
    cash_reserve_pct: cashReserve,
    deployment_months: deployMonths,
    deployment_tranches: deployTranches,
  };
}

/** Attach RM sign-off and advance phase to execute. */
export function signOffOverlay(
  overlay: ClientOverlay,
  rmId: string,
  note?: string,
): ClientOverlay {
  const now = new Date().toISOString();
  const withLevers = applyAsksToOverlayLevers(overlay);
  return {
    ...withLevers,
    asks: withLevers.asks?.map((a) => ({ ...a, status: "signed" as const })),
    audit: {
      ...withLevers.audit,
      updated_at: now,
      phase: "execute",
      rm_sign_off: { signed_at: now, rm_id: rmId, note },
      source: "manual",
    },
    clarification_questions: [],
    clarifications: [],
  };
}

export function isOverlayReadyForBacktest(overlay: ClientOverlay): boolean {
  return Boolean(overlay.audit.rm_sign_off) && overlay.confidence >= 0.5;
}

/** Localized display for machine enum values in the overlay summary. */
function stanceLabel(v: string, lang: "zh" | "en" | "ko"): string {
  const map: Record<string, { zh: string; en: string; ko: string }> = {
    risk_on: { zh: "偏多（Risk-on）", en: "Risk-on", ko: "리스크온" },
    risk_off: { zh: "偏防禦（Risk-off）", en: "Risk-off", ko: "리스크오프" },
    neutral: { zh: "中性", en: "Neutral", ko: "중립" },
  };
  return map[v]?.[lang] ?? v;
}

function riskLabel(v: string, lang: "zh" | "en" | "ko"): string {
  const map: Record<string, { zh: string; en: string; ko: string }> = {
    conservative: { zh: "保守", en: "Conservative", ko: "보수적" },
    moderate: { zh: "穩健", en: "Moderate", ko: "중간" },
    aggressive: { zh: "積極", en: "Aggressive", ko: "공격적" },
  };
  return map[v]?.[lang] ?? v;
}

function assetClassLabel(v: string, lang: "zh" | "en" | "ko"): string {
  const map: Record<string, { zh: string; en: string; ko: string }> = {
    equity: { zh: "股票", en: "Equity", ko: "주식" },
    bond: { zh: "債券", en: "Bond", ko: "채권" },
    real_estate: { zh: "不動產", en: "Real estate", ko: "부동산" },
    commodity: { zh: "商品", en: "Commodity", ko: "원자재" },
    cash: { zh: "現金", en: "Cash", ko: "현금" },
    alternative: { zh: "另類", en: "Alternative", ko: "대체" },
  };
  return map[v]?.[lang] ?? v;
}

function objectiveLabel(v: string, lang: "zh" | "en" | "ko"): string {
  const map: Record<string, { zh: string; en: string; ko: string }> = {
    max_sharpe: { zh: "最大夏普", en: "Max Sharpe", ko: "최대 샤프" },
    min_vol: { zh: "最低波動", en: "Min volatility", ko: "최소 변동성" },
    max_return: { zh: "最大報酬", en: "Max return", ko: "최대 수익" },
    income: { zh: "收益導向", en: "Income", ko: "인컴" },
  };
  return map[v]?.[lang] ?? v;
}

function sleeveLabel(v: string, lang: "zh" | "en" | "ko"): string {
  const map: Record<string, { zh: string; en: string; ko: string }> = {
    core: { zh: "核心", en: "Core", ko: "코어" },
    satellite: { zh: "衛星", en: "Satellite", ko: "새틀라이트" },
    cash: { zh: "現金", en: "Cash", ko: "현금" },
    defensive: { zh: "防禦", en: "Defensive", ko: "디펜시브" },
    theme: { zh: "主題", en: "Theme", ko: "테마" },
  };
  return map[v]?.[lang] ?? v;
}

export function formatOverlaySummary(overlay: ClientOverlay, lang: "zh" | "en" | "ko"): string {
  const lines: string[] = [];
  const { allocation, optimization, market_view, client_profile } = overlay;

  const liquidityLine = (() => {
    const liq = client_profile.liquidity_need;
    if (!liq?.amount_usd && !liq?.within_months) return null;
    const parts: string[] = [];
    if (liq.within_months) {
      parts.push(
        lang === "zh"
          ? `${liq.within_months} 個月內`
          : lang === "ko"
            ? `${liq.within_months}개월 이내`
            : `within ${liq.within_months} months`,
      );
    }
    if (liq.amount_usd) {
      parts.push(`USD ${liq.amount_usd.toLocaleString()}`);
    }
    if (!parts.length) return null;
    if (lang === "zh") return `流動性：${parts.join(" · ")}`;
    if (lang === "ko") return `유동성: ${parts.join(" · ")}`;
    return `Liquidity: ${parts.join(" · ")}`;
  })();

  if (lang === "zh") {
    lines.push(`市場觀點：${stanceLabel(market_view.stance, lang)} — ${market_view.narrative_summary}`);
    if (client_profile.risk_tolerance) {
      lines.push(`風險取向：${riskLabel(client_profile.risk_tolerance, lang)}`);
    }
    if (liquidityLine) lines.push(liquidityLine);
    lines.push(`資產類別：${allocation.asset_classes.map((a) => assetClassLabel(a, lang)).join("、")}`);
    if (allocation.sleeve_targets) {
      const sleeves = Object.entries(allocation.sleeve_targets)
        .map(([k, v]) => `${sleeveLabel(k, lang)} ${(v * 100).toFixed(0)}%`)
        .join(" · ");
      lines.push(`槽位目標：${sleeves}`);
    }
    lines.push(`優化目標：${objectiveLabel(optimization.objective, lang)}`);
    if (overlay.universe.prompts.length) {
      lines.push(`投資標的規則：${overlay.universe.prompts.join("；")}`);
    }
    if (overlay.universe.supplement_tickers?.length) {
      lines.push(`新增標的：${overlay.universe.supplement_tickers.join("、")}`);
    }
    if (overlay.universe.exclude_tickers?.length) {
      lines.push(`排除標的：${overlay.universe.exclude_tickers.join("、")}`);
    }
    if (overlay.universe.proposed_tickers?.length) {
      const list = overlay.universe.proposed_tickers
        .map((p) => (p.name ? `${p.ticker}（${p.name}）` : p.ticker))
        .join("、");
      lines.push(`建議參考標的：${list}`);
    }
    lines.push(`信心度：${(overlay.confidence * 100).toFixed(0)}%`);
    return lines.join("\n");
  }

  if (lang === "ko") {
    lines.push(`시장 관점: ${stanceLabel(market_view.stance, lang)} — ${market_view.narrative_summary}`);
    if (client_profile.risk_tolerance) {
      lines.push(`위험 성향: ${riskLabel(client_profile.risk_tolerance, lang)}`);
    }
    if (liquidityLine) lines.push(liquidityLine);
    lines.push(`자산군: ${allocation.asset_classes.map((a) => assetClassLabel(a, lang)).join(", ")}`);
    if (allocation.sleeve_targets) {
      const sleeves = Object.entries(allocation.sleeve_targets)
        .map(([k, v]) => `${sleeveLabel(k, lang)} ${(v * 100).toFixed(0)}%`)
        .join(" · ");
      lines.push(`슬리브 목표: ${sleeves}`);
    }
    lines.push(`최적화 목표: ${objectiveLabel(optimization.objective, lang)}`);
    if (overlay.universe.prompts.length) {
      lines.push(`투자 유니버스 규칙: ${overlay.universe.prompts.join("; ")}`);
    }
    if (overlay.universe.supplement_tickers?.length) {
      lines.push(`추가 종목: ${overlay.universe.supplement_tickers.join(", ")}`);
    }
    if (overlay.universe.exclude_tickers?.length) {
      lines.push(`제외 종목: ${overlay.universe.exclude_tickers.join(", ")}`);
    }
    if (overlay.universe.proposed_tickers?.length) {
      const list = overlay.universe.proposed_tickers
        .map((p) => (p.name ? `${p.ticker} (${p.name})` : p.ticker))
        .join(", ");
      lines.push(`제안 종목: ${list}`);
    }
    lines.push(`신뢰도: ${(overlay.confidence * 100).toFixed(0)}%`);
    return lines.join("\n");
  }

  lines.push(`View: ${stanceLabel(market_view.stance, lang)} — ${market_view.narrative_summary}`);
  if (client_profile.risk_tolerance) {
    lines.push(`Risk tolerance: ${riskLabel(client_profile.risk_tolerance, lang)}`);
  }
  if (liquidityLine) lines.push(liquidityLine);
  lines.push(`Asset classes: ${allocation.asset_classes.map((a) => assetClassLabel(a, lang)).join(", ")}`);
  lines.push(`Objective: ${objectiveLabel(optimization.objective, lang)}`);
  if (overlay.universe.prompts.length) {
    lines.push(`Universe rules: ${overlay.universe.prompts.join("; ")}`);
  }
  if (overlay.universe.supplement_tickers?.length) {
    lines.push(`Add tickers: ${overlay.universe.supplement_tickers.join(", ")}`);
  }
  if (overlay.universe.exclude_tickers?.length) {
    lines.push(`Exclude tickers: ${overlay.universe.exclude_tickers.join(", ")}`);
  }
  if (overlay.universe.proposed_tickers?.length) {
    const list = overlay.universe.proposed_tickers
      .map((p) => (p.name ? `${p.ticker} (${p.name})` : p.ticker))
      .join(", ");
    lines.push(`Suggested tickers: ${list}`);
  }
  lines.push(`Confidence: ${(overlay.confidence * 100).toFixed(0)}%`);
  return lines.join("\n");
}
