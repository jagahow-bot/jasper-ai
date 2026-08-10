import { z } from "zod";
import { enforceAllocControlsForClasses } from "@/lib/asset-class-policy";
import { ASSET_CLASSES, type AssetClass } from "@/lib/constants";
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
    supplement_tickers: z.array(z.string().min(1).max(8)).max(30).optional(),
    exclude_tickers: z.array(z.string().min(1).max(8)).max(30).optional(),
    proposed_tickers: z.array(overlayProposedTickerSchema).max(12).optional(),
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
    client_profile: clientProfile,
    market_view: extract.market_view,
    allocation,
    universe: extract.universe,
    optimization: extract.optimization,
    deployment_schedule:
      extract.deployment_schedule ?? prior?.deployment_schedule,
    param_adjustments: extract.param_adjustments,
    experiment: extract.experiment,
    clarification_questions: extract.clarification_questions,
    confidence: extract.confidence,
    rationale: extract.rationale,
  };
}

export function formatOverlayAssistantReply(
  overlay: ClientOverlay,
  lang: "zh" | "en" | "ko",
): string {
  const questions = overlay.clarification_questions ?? [];
  const parts = [overlay.rationale];

  if (questions.length) {
    const header =
      lang === "zh" ? "待澄清：" : lang === "ko" ? "확인 필요:" : "Open questions:";
    parts.push(`${header}\n${questions.map((q) => `• ${q}`).join("\n")}`);
  }

  return parts.join("\n\n");
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

const DEFAULT_DRAWDOWN_TOLERANCE: Record<string, number> = {
  conservative: 0.1,
  moderate: 0.18,
  aggressive: 0.3,
};

const DEFAULT_CASH_RESERVE: Record<string, number> = {
  conservative: 0.1,
  moderate: 0.05,
  aggressive: 0.0,
};

const THEME_CAP_HINTS = [
  "tech",
  "growth",
  "concentration",
  "nasdaq",
  "semi",
  "ai",
  "科技",
  "成長",
  "集中",
];

/**
 * Compile the overlay's client profile + market view into the engine's
 * ClientContext. Returns null when nothing usable was captured, so legacy
 * runs without a profile keep their exact previous behavior.
 */
export function clientContextFromOverlay(
  overlay: ClientOverlay,
): ClientContext | null {
  const profile = overlay.client_profile;
  const risk = profile.risk_tolerance ?? null;
  const horizon = profile.investment_horizon_years ?? null;
  const income = profile.income_need_pct ?? null;
  const summary = overlay.market_view?.narrative_summary?.trim() || null;
  const tolerance = risk ? DEFAULT_DRAWDOWN_TOLERANCE[risk] : null;
  const singleCap = overlay.allocation?.max_single_position_pct ?? null;
  const themes = overlay.market_view?.themes ?? [];
  const themeHit = themes.some((t) =>
    THEME_CAP_HINTS.some((h) => t.toLowerCase().includes(h)),
  );
  const themeCap = themeHit ? 0.25 : null;
  const hasLiquidity = Boolean(profile.liquidity_need);
  const scheduleBuffer = overlay.deployment_schedule?.liquidity_buffer_pct;
  let cashReserve: number | null = null;
  if (typeof scheduleBuffer === "number") {
    cashReserve = scheduleBuffer;
  } else if (hasLiquidity && risk) {
    cashReserve = DEFAULT_CASH_RESERVE[risk] ?? 0.05;
  }
  if (
    !risk &&
    !horizon &&
    !income &&
    !summary &&
    singleCap == null &&
    themeCap == null &&
    cashReserve == null
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
  };
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
    const adds = resolveStrictLockedAdds({
      explicitSupplements: overlay.universe.supplement_tickers,
      prompts,
    });
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
      max_holdings: Math.max(locked.length, 1),
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
    max_holdings: base.max_holdings,
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
