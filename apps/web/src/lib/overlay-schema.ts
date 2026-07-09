import { z } from "zod";
import { enforceAllocControlsForClasses } from "@/lib/asset-class-policy";
import { ASSET_CLASSES, type AssetClass } from "@/lib/constants";
import type {
  BacktestRequest,
  ExperimentRequest,
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

export const paramControlSchema = z.object({
  mode: paramControlModeSchema,
  fixed: z.union([z.number(), z.string(), z.null()]).optional(),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  step: z.number().nullable().optional(),
  options: z.array(z.string()).nullable().optional(),
});

export const experimentOverlaySchema = z.object({
  enabled: z.boolean(),
  mode: z.literal("objective_switch"),
  regime_mode: z.enum(["auto", "risk_off", "neutral", "risk_on"]),
  note: z.string().nullable().optional(),
  run_ab_evaluation: z.boolean().optional(),
});

export const overlaySessionAuditSchema = z.object({
  session_id: z.string().min(8),
  rm_id: z.string().optional(),
  client_ref: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  phase: z.enum(OVERLAY_PHASES),
  conversation_turns: z.number().int().min(0),
  source: z.enum(["gemini", "rules", "manual"]),
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

export const clientProfileOverlaySchema = z.object({
  risk_tolerance: riskToleranceSchema.optional(),
  investment_horizon_years: z.number().min(1).max(50).optional(),
  liquidity_need: z
    .object({
      amount_usd: z.number().min(0).optional(),
      within_months: z.number().min(1).max(120).optional(),
      description: z.string().max(300).optional(),
    })
    .optional(),
  esg_preference: esgPreferenceSchema.optional(),
  income_need_pct: z.number().min(0).max(1).optional(),
});

export const marketViewOverlaySchema = z.object({
  stance: marketStanceSchema,
  themes: z.array(z.string().min(1).max(40)).max(8),
  narrative_summary: z.string().min(8).max(400),
});

export const allocationOverlaySchema = z.object({
  asset_classes: z.array(z.enum(ASSET_CLASSES)).min(1).max(5),
  sleeve_targets: z.record(z.string(), z.number().min(0).max(1)).optional(),
  sub_sleeve_targets: z.record(z.string(), z.number().min(0).max(1)).optional(),
  enforce_class_weights: z.boolean().optional(),
  max_single_position_pct: z.number().min(0.05).max(0.25).optional(),
});

export const universeRuleOverlaySchema = z.object({
  prompts: z.array(z.string().min(4).max(200)).max(6),
  supplement_tickers: z.array(z.string().min(1).max(8)).max(30).optional(),
  exclude_tickers: z.array(z.string().min(1).max(8)).max(30).optional(),
});

export const optimizationOverlaySchema = z.object({
  objective: objectiveSchema,
  regime_adaptive: z.boolean().optional(),
  optimization_mode: optimizationModeSchema.optional(),
  trials: z.number().int().min(10).max(500).optional(),
});

/** Gemini structured-extract output (no audit envelope). */
export const overlayExtractSchema = z.object({
  client_profile: clientProfileOverlaySchema,
  market_view: marketViewOverlaySchema,
  allocation: allocationOverlaySchema,
  universe: universeRuleOverlaySchema,
  optimization: optimizationOverlaySchema,
  param_adjustments: z.record(z.string(), paramControlSchema).optional(),
  experiment: experimentOverlaySchema.optional(),
  clarification_questions: z.array(z.string().min(4).max(200)).max(5),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(8).max(600),
});

export const clientOverlaySchema = z.object({
  version: z.literal(OVERLAY_VERSION),
  audit: overlaySessionAuditSchema,
  client_profile: clientProfileOverlaySchema,
  market_view: marketViewOverlaySchema,
  allocation: allocationOverlaySchema,
  universe: universeRuleOverlaySchema,
  optimization: optimizationOverlaySchema,
  param_adjustments: z.record(z.string(), paramControlSchema).optional(),
  experiment: experimentOverlaySchema.optional(),
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
  if (extract.confidence >= 0.7 && extract.clarification_questions.length === 0) {
    return "confirm";
  }
  if (extract.confidence >= 0.4 || extract.clarification_questions.length > 0) {
    return "clarify";
  }
  return "discovery";
}

export function createSessionId(): string {
  return `ovl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function wrapExtractAsOverlay(
  extract: OverlayExtractOutput,
  sessionId: string,
  turns: number,
  source: "gemini" | "rules",
  prior?: ClientOverlay | null,
): ClientOverlay {
  const now = new Date().toISOString();
  return {
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
    client_profile: extract.client_profile,
    market_view: extract.market_view,
    allocation: extract.allocation,
    universe: extract.universe,
    optimization: extract.optimization,
    param_adjustments: extract.param_adjustments,
    experiment: extract.experiment,
    clarification_questions: extract.clarification_questions,
    confidence: extract.confidence,
    rationale: extract.rationale,
  };
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
  const fromAnchorReplay = Boolean(base.static_replay_holdings);

  return {
    ...base,
    scenario_id: opts?.scenarioId ?? `overlay-${overlay.audit.session_id}`,
    asset_classes: assetClasses,
    max_weight: alloc.max_single_position_pct ?? base.max_weight,
    objective: (opt.objective ?? base.objective) as Objective,
    regime_adaptive: opt.regime_adaptive ?? base.regime_adaptive,
    optimization_mode: (opt.optimization_mode ?? base.optimization_mode) as OptimizationMode,
    trials: opt.trials ?? (fromAnchorReplay ? 50 : base.trials),
    top_models: fromAnchorReplay ? 5 : base.top_models,
    max_holdings: fromAnchorReplay ? 30 : base.max_holdings,
    universe_tickers: fromAnchorReplay ? null : base.universe_tickers,
    enforce_class_weights:
      alloc.enforce_class_weights ?? base.enforce_class_weights ?? false,
    universe_filter_prompts: prompts.length ? prompts : base.universe_filter_prompts,
    universe_filter_text: filterText,
    universe_supplement_tickers:
      overlay.universe.supplement_tickers?.length
        ? overlay.universe.supplement_tickers
        : base.universe_supplement_tickers,
    param_controls: enforcedControls,
    experiment: inferExperiment(overlay) ?? base.experiment,
    report_language: opts?.reportLanguage ?? base.report_language,
    static_replay_holdings: null,
  };
}

/** Attach RM sign-off and advance phase to execute. */
export function signOffOverlay(
  overlay: ClientOverlay,
  rmId: string,
  note?: string,
): ClientOverlay {
  const now = new Date().toISOString();
  return {
    ...overlay,
    audit: {
      ...overlay.audit,
      updated_at: now,
      phase: "execute",
      rm_sign_off: { signed_at: now, rm_id: rmId, note },
      source: "manual",
    },
    clarification_questions: [],
  };
}

export function isOverlayReadyForBacktest(overlay: ClientOverlay): boolean {
  return Boolean(overlay.audit.rm_sign_off) && overlay.confidence >= 0.5;
}

export function formatOverlaySummary(overlay: ClientOverlay, lang: "zh" | "en" | "ko"): string {
  const lines: string[] = [];
  const { allocation, optimization, market_view, client_profile } = overlay;

  if (lang === "zh") {
    lines.push(`市場觀點：${market_view.stance} — ${market_view.narrative_summary}`);
    if (client_profile.risk_tolerance) {
      lines.push(`風險取向：${client_profile.risk_tolerance}`);
    }
    if (client_profile.liquidity_need?.within_months) {
      lines.push(
        `流動性：${client_profile.liquidity_need.within_months} 個月內` +
          (client_profile.liquidity_need.amount_usd
            ? ` · USD ${client_profile.liquidity_need.amount_usd.toLocaleString()}`
            : ""),
      );
    }
    lines.push(`資產類別：${allocation.asset_classes.join("、")}`);
    if (allocation.sleeve_targets) {
      const sleeves = Object.entries(allocation.sleeve_targets)
        .map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`)
        .join(" · ");
      lines.push(`槽位目標：${sleeves}`);
    }
    lines.push(`優化目標：${optimization.objective}`);
    if (overlay.universe.prompts.length) {
      lines.push(`Universe 規則：${overlay.universe.prompts.join("；")}`);
    }
    lines.push(`信心度：${(overlay.confidence * 100).toFixed(0)}%`);
    return lines.join("\n");
  }

  lines.push(`View: ${market_view.stance} — ${market_view.narrative_summary}`);
  lines.push(`Asset classes: ${allocation.asset_classes.join(", ")}`);
  lines.push(`Objective: ${optimization.objective}`);
  if (overlay.universe.prompts.length) {
    lines.push(`Universe rules: ${overlay.universe.prompts.join("; ")}`);
  }
  lines.push(`Confidence: ${(overlay.confidence * 100).toFixed(0)}%`);
  return lines.join("\n");
}
