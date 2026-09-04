/**
 * Mechanical overlay feasibility pre-check (design §3.3).
 * Deterministic — no LLM. Used before interpret results become BacktestRequest.
 */

import type {
  CapabilityGap,
  ClientOverlay,
  OverlayConflict,
} from "@/lib/overlay-schema";

/** RM alone may raise customization_drift up to this; above → supervisor (§8). */
export const DRIFT_OVERRIDE_RM_MAX = 0.6;

export type L1DriftCheck = {
  minRequiredDrift: number;
  feasible: boolean;
  declaredDrift: number;
  oneWayTurnover: number;
};

export type AnchorPositionLike = {
  ticker: string;
  weightLabel?: string;
};

const HEDGE_TICKERS = new Set([
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
  "SH",
  "PSQ",
  "DOG",
  "HDGE",
]);

const AI_TICKERS = new Set([
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
  "AVGO",
  "TSM",
  "AMD",
  "ASML",
  "ARM",
  "PLTR",
  "MSFT",
  "GOOGL",
  "GOOG",
  "META",
  "AMZN",
]);

const AI_THEME_RE =
  /ai|artificial\s*intel|tech(?:nology)?|growth|機器人|人工智慧|人工智能|科技|성장|인공지능/i;
const HEDGE_THEME_RE =
  /hedge|hedging|defensive|避險|避险|對沖|对冲|防禦|방어|gold|bond|債券|债券|黃金|黄金/i;
const SECOND_LAYER_RE =
  /第二[層层]|二[層层]|兩[層层]|两层|各自|獨立子|独立子|子配置|two[\s-]?layer|sleeve|50\s*[%％].{0,40}50\s*[%％]|各\s*半/i;

/**
 * customization_drift is one-way L1: 0.5 · ‖w − anchor‖₁.
 * For sleeve targets that share no mass with the anchor, required drift ≈ 1.0
 * when Σ|remove| + Σ|add| = 2.
 */
export function minL1DriftForTarget(
  anchor: Record<string, number>,
  targetSleeves: Record<string, number>,
  sleeveMembership: Record<string, string[]>,
  declaredDrift: number,
): L1DriftCheck {
  const targetWeights: Record<string, number> = {};
  for (const [sleeve, weight] of Object.entries(targetSleeves)) {
    const members = sleeveMembership[sleeve] ?? [];
    const w = Number(weight);
    if (!Number.isFinite(w) || w <= 0 || members.length === 0) continue;
    const each = w / members.length;
    for (const t of members) {
      const key = t.toUpperCase();
      targetWeights[key] = (targetWeights[key] ?? 0) + each;
    }
  }
  const tickers = new Set([
    ...Object.keys(anchor),
    ...Object.keys(targetWeights),
  ]);
  let l1 = 0;
  for (const t of tickers) {
    const a = Number(anchor[t] ?? 0);
    const b = Number(targetWeights[t] ?? 0);
    l1 += Math.abs(a - b);
  }
  const oneWay = 0.5 * l1;
  const declared = Number.isFinite(declaredDrift) ? declaredDrift : 0.5;
  return {
    minRequiredDrift: oneWay,
    feasible: oneWay <= declared + 1e-9,
    declaredDrift: declared,
    oneWayTurnover: oneWay,
  };
}

export function buildInfeasibleDriftConflict(
  check: L1DriftCheck,
  opts: { lang?: "zh" | "en" | "ko" } = {},
): OverlayConflict {
  const lang = opts.lang ?? "zh";
  const needPct = Math.round(check.minRequiredDrift * 100);
  const havePct = Math.round(check.declaredDrift * 100);
  const suggested = Math.min(1, Math.ceil(check.minRequiredDrift * 100) / 100);
  const requiresSupervisor = suggested > DRIFT_OVERRIDE_RM_MAX;
  const titles = {
    zh: "目前的客製化幅度上限無法達成此配置",
    en: "Current customization drift cannot achieve this allocation",
    ko: "현재 커스터마이징 한도로 이 배분을 달성할 수 없습니다",
  };
  const explain = {
    zh: `此需求與基準的差異約需 ${needPct}% 偏離幅度；目前上限為 ${havePct}%，最多只能表達約 ${havePct}% 的差異。請選擇調整方式——系統不會靜默給半套答案。`,
    en: `This request needs about ${needPct}% drift vs the anchor; the current cap is ${havePct}%. Choose an option — the system will not silently half-answer.`,
    ko: `이 요청은 기준 대비 약 ${needPct}% 편차가 필요하지만 현재 한도는 ${havePct}%입니다. 옵션을 선택하세요 — 시스템이 조용히 절반만 응답하지 않습니다.`,
  };
  const gapStub: CapabilityGap = {
    stage: "allocator",
    kind: "infeasible_combination",
    missing_capability: "two_layer_sleeve_allocation",
    summary:
      lang === "zh"
        ? "二層袖珍（如 50% AI / 50% 避險）超出目前單層配置器與漂移上限。"
        : "Two-layer sleeve allocation exceeds single-layer allocator + drift.",
    requested: {
      min_required_drift: check.minRequiredDrift,
      declared_drift: check.declaredDrift,
    },
    nearest_supported: {
      customization_drift: check.declaredDrift,
      note: "partial L1 projection toward sleeves",
    },
    severity: "blocking",
  };
  return {
    id: "conflict-drift",
    code: "INFEASIBLE_DRIFT",
    title: titles[lang],
    explanation: explain[lang],
    suggested_drift: suggested,
    requires_supervisor: requiresSupervisor,
    gap_stub: gapStub,
    options: [
      {
        id: "raise-drift",
        label:
          lang === "zh"
            ? `提高偏離至 ${Math.round(suggested * 100)}%`
            : `Raise drift to ${Math.round(suggested * 100)}%`,
      },
      {
        id: "soften-target",
        label: lang === "zh" ? "縮小配置差異" : "Soften target",
      },
      {
        id: "submit-gap",
        label: lang === "zh" ? "提交能力缺口" : "Submit capability gap",
      },
    ],
  };
}

export function buildTwoLayerStructuralConflict(
  opts: {
    lang?: "zh" | "en" | "ko";
    aiTickers?: string[];
    hedgeTickers?: string[];
  } = {},
): OverlayConflict {
  const lang = opts.lang ?? "zh";
  const ai = (opts.aiTickers ?? []).slice(0, 8).join(", ") || "AI sleeve";
  const hedge = (opts.hedgeTickers ?? []).slice(0, 8).join(", ") || "hedge sleeve";
  const titles = {
    zh: "二層配置需求目前無法誠實表達",
    en: "Two-layer allocation cannot be expressed honestly yet",
    ko: "2계층 배분 요구를 현재 정직하게 표현할 수 없습니다",
  };
  const explain = {
    zh: `偵測到「AI 產業 + 避險」第二層配置意圖（${ai} / ${hedge}）。目前引擎只有單層配置器 + customization_drift，無法保證各自獨立子配置。請選擇——系統不會靜默給半套答案。`,
    en: `Detected a second-layer AI + hedge allocation intent (${ai} / ${hedge}). The engine only has a single-layer allocator + customization_drift and cannot guarantee independent sub-sleeves. Choose an option — no silent half-answer.`,
    ko: `AI + 헤지 2계층 배분 의도를 감지했습니다(${ai} / ${hedge}). 현재는 단층 allocator + customization_drift만 있어 독립 슬리브를 보장할 수 없습니다. 옵션을 선택하세요.`,
  };
  const gapStub: CapabilityGap = {
    stage: "allocator",
    kind: "unsupported_lever",
    missing_capability: "two_layer_sleeve_allocation",
    summary:
      lang === "zh"
        ? "需要二層袖珍配置能力（AI + 避險各自獨立子配置）。"
        : "Need two-layer sleeve allocation (AI + hedge independent sub-portfolios).",
    requested: {
      ai_tickers: opts.aiTickers ?? [],
      hedge_tickers: opts.hedgeTickers ?? [],
    },
    nearest_supported: {
      note: "must_include / supplement_tickers + single-layer L1 drift only",
    },
    severity: "blocking",
  };
  return {
    id: "conflict-two-layer",
    code: "UNSUPPORTED_TWO_LAYER",
    title: titles[lang],
    explanation: explain[lang],
    gap_stub: gapStub,
    options: [
      {
        id: "accept-nearest",
        label:
          lang === "zh"
            ? "接受最接近方案（有限偏離）"
            : "Accept nearest (limited drift)",
      },
      {
        id: "submit-gap",
        label: lang === "zh" ? "提交能力缺口" : "Submit capability gap",
      },
      {
        id: "soften-target",
        label: lang === "zh" ? "改為較小衛星配置" : "Soften to small satellites",
      },
    ],
  };
}

/**
 * Stage attribution: LLM fills stage; BFF validates against the 8-stage enum.
 * Invalid → clarification ask (design §8 decision 1).
 */
export function validateCapabilityGapStages(
  gaps: CapabilityGap[] | undefined,
): { valid: CapabilityGap[]; clarifications: Array<{ id: string; question: string }> } {
  const valid: CapabilityGap[] = [];
  const clarifications: Array<{ id: string; question: string }> = [];
  const allowed = new Set([
    "universe",
    "signals",
    "allocator",
    "constraints",
    "objective",
    "rebalance",
    "cash_schedule",
    "reporting",
  ]);
  for (const g of gaps ?? []) {
    if (!allowed.has(g.stage)) {
      clarifications.push({
        id: `gap-stage-${g.missing_capability}`.slice(0, 40),
        question: `Which engine stage should own capability "${g.missing_capability}"? (universe/signals/allocator/constraints/objective/rebalance/cash_schedule/reporting)`,
      });
      continue;
    }
    valid.push(g);
  }
  return { valid, clarifications };
}

/** Encode §8 drift override policy. */
export function driftOverrideApproval(requestedDrift: number): {
  allowedForRm: boolean;
  requiresSupervisor: boolean;
} {
  const d = Math.max(0, Math.min(1, requestedDrift));
  return {
    allowedForRm: d <= DRIFT_OVERRIDE_RM_MAX + 1e-12,
    requiresSupervisor: d > DRIFT_OVERRIDE_RM_MAX + 1e-12,
  };
}

export function parseWeightLabel(raw?: string): number | null {
  if (!raw) return null;
  const s = raw.trim().replace(/,/g, "");
  const pct = s.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
  if (pct) {
    const n = Number(pct[1]);
    return Number.isFinite(n) ? n / 100 : null;
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}

export function anchorWeightsFromPositions(
  positions?: AnchorPositionLike[] | null,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of positions ?? []) {
    const t = String(p.ticker || "")
      .trim()
      .toUpperCase();
    if (!t) continue;
    const w = parseWeightLabel(p.weightLabel);
    if (w == null || w < 0) continue;
    out[t] = (out[t] ?? 0) + w;
  }
  const sum = Object.values(out).reduce((a, b) => a + b, 0);
  if (sum > 1.01) {
    for (const k of Object.keys(out)) out[k] = out[k]! / sum;
  }
  return out;
}

function uniqTickers(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const t = String(raw || "")
      .trim()
      .toUpperCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function classifyThemeTicker(ticker: string): "ai" | "hedge" | "other" {
  const t = ticker.toUpperCase();
  if (HEDGE_TICKERS.has(t)) return "hedge";
  if (AI_TICKERS.has(t)) return "ai";
  return "other";
}

function overlayCorpus(overlay: ClientOverlay, transcript?: string): string {
  const themes = overlay.market_view.themes ?? [];
  const prompts = overlay.universe.prompts ?? [];
  const askText = (overlay.asks ?? [])
    .map((a) => `${a.title ?? ""} ${a.summary ?? ""}`)
    .join(" ");
  return [
    transcript ?? "",
    overlay.rationale ?? "",
    themes.join(" "),
    prompts.join(" "),
    askText,
  ].join("\n");
}

export function detectSecondLayerAiHedgeIntent(
  overlay: ClientOverlay,
  opts: { transcript?: string; anchorTickers?: Set<string> } = {},
): { detected: boolean; aiTickers: string[]; hedgeTickers: string[] } {
  const anchor = opts.anchorTickers ?? new Set<string>();
  const candidates = uniqTickers([
    ...(overlay.universe.supplement_tickers ?? []),
    ...(overlay.universe.proposed_tickers ?? []).map((p) => p.ticker),
  ]).filter((t) => !anchor.has(t));

  const aiTickers = candidates.filter((t) => classifyThemeTicker(t) === "ai");
  const hedgeTickers = candidates.filter((t) => classifyThemeTicker(t) === "hedge");

  const themes = overlay.market_view.themes ?? [];
  const themePair =
    themes.some((t) => AI_THEME_RE.test(t)) &&
    themes.some((t) => HEDGE_THEME_RE.test(t));
  const corpus = overlayCorpus(overlay, opts.transcript);
  const dualThemeText =
    AI_THEME_RE.test(corpus) && HEDGE_THEME_RE.test(corpus);
  const strongSecondLayer = SECOND_LAYER_RE.test(corpus);

  const detected =
    aiTickers.length > 0 &&
    hedgeTickers.length > 0 &&
    (themePair || (dualThemeText && strongSecondLayer) || strongSecondLayer);

  return { detected, aiTickers, hedgeTickers };
}

function sleeveWeightsFromAsks(
  overlay: ClientOverlay,
): { ai?: number; hedge?: number } {
  const out: { ai?: number; hedge?: number } = {};
  for (const ask of overlay.asks ?? []) {
    const blob = `${ask.title ?? ""} ${ask.summary ?? ""} ${ask.kind ?? ""}`;
    const pct =
      ask.target_pct ??
      ask.min_pct ??
      (ask.max_pct != null && ask.min_pct != null
        ? (ask.max_pct + ask.min_pct) / 2
        : ask.max_pct);
    if (pct == null || !Number.isFinite(pct) || pct <= 0) continue;
    if (HEDGE_THEME_RE.test(blob) && out.hedge == null) out.hedge = pct;
    if (AI_THEME_RE.test(blob) && out.ai == null) out.ai = pct;
  }
  return out;
}

function inferAiHedgeSleevePlan(
  overlay: ClientOverlay,
  aiTickers: string[],
  hedgeTickers: string[],
  transcript?: string,
): {
  targetSleeves: Record<string, number>;
  membership: Record<string, string[]>;
} | null {
  if (!aiTickers.length || !hedgeTickers.length) return null;

  const explicit = overlay.allocation.sleeve_targets;
  if (explicit) {
    const themeKeys = Object.keys(explicit).filter((k) => !k.startsWith("w_"));
    if (themeKeys.length >= 2) {
      const membership: Record<string, string[]> = {};
      const targets: Record<string, number> = {};
      for (const key of themeKeys) {
        const w = Number(explicit[key]);
        if (!Number.isFinite(w) || w <= 0) continue;
        targets[key] = w;
        if (AI_THEME_RE.test(key)) membership[key] = aiTickers;
        else if (HEDGE_THEME_RE.test(key)) membership[key] = hedgeTickers;
        else membership[key] = [...aiTickers, ...hedgeTickers];
      }
      if (Object.keys(targets).length >= 2) {
        return { targetSleeves: targets, membership };
      }
    }
  }

  const fromAsks = sleeveWeightsFromAsks(overlay);
  const corpus = overlayCorpus(overlay, transcript);
  const fiftyFifty = /50\s*[%％].{0,40}50\s*[%％]|各\s*半|一半/.test(corpus);

  let aiW = fromAsks.ai;
  let hedgeW = fromAsks.hedge;
  if (fiftyFifty) {
    aiW = aiW ?? 0.5;
    hedgeW = hedgeW ?? 0.5;
  }
  // Explicit two-layer language without % → treat as 50/50 for feasibility math.
  if (
    (aiW == null || hedgeW == null) &&
    SECOND_LAYER_RE.test(corpus) &&
    aiTickers.length + hedgeTickers.length >= 3
  ) {
    aiW = aiW ?? 0.5;
    hedgeW = hedgeW ?? 0.5;
  }
  if (aiW == null || hedgeW == null) return null;
  if (aiW + hedgeW < 0.35) return null;

  return {
    targetSleeves: { ai: aiW, hedge: hedgeW },
    membership: { ai: aiTickers, hedge: hedgeTickers },
  };
}

function conflictFromBlockingGap(
  gap: CapabilityGap,
  lang: "zh" | "en" | "ko",
): OverlayConflict {
  return {
    id: `conflict-gap-${gap.missing_capability}`.slice(0, 40),
    code: "CAPABILITY_GAP",
    title:
      lang === "zh"
        ? "此需求超出目前可表達能力"
        : "This need exceeds current expressible capabilities",
    explanation: gap.summary,
    gap_stub: gap,
    options: [
      {
        id: "accept-nearest",
        label:
          lang === "zh"
            ? "接受最接近方案（繼續）"
            : "Accept nearest and continue",
      },
      {
        id: "submit-gap",
        label: lang === "zh" ? "提交能力缺口" : "Submit capability gap",
      },
    ],
  };
}

export type MechanicalConflictOpts = {
  lang?: "zh" | "en" | "ko";
  declaredDrift?: number;
  anchorPositions?: AnchorPositionLike[] | null;
  transcript?: string;
};

export type ThemeSleevePlan = {
  targetSleeves: Record<string, number>;
  membership: Record<string, string[]>;
};

/**
 * Build an L1 plan from explicit theme sleeve_targets (non-w_* keys).
 * Membership = supplement ∪ proposed outside the anchor; empty pool falls back
 * to anchor keys (same as the prior inline conflict-card logic).
 */
export function themeSleevePlanFromOverlay(
  overlay: ClientOverlay,
  anchor: Record<string, number>,
): ThemeSleevePlan | null {
  const sleeves = overlay.allocation.sleeve_targets;
  if (!sleeves) return null;
  const themeEntries = Object.entries(sleeves).filter(
    ([k, v]) => !k.startsWith("w_") && Number(v) > 0,
  );
  if (!themeEntries.length) return null;
  const anchorTickers = new Set(Object.keys(anchor));
  const allExtra = uniqTickers([
    ...(overlay.universe.supplement_tickers ?? []),
    ...(overlay.universe.proposed_tickers ?? []).map((p) => p.ticker),
  ]).filter((t) => !anchorTickers.has(t));
  const membership: Record<string, string[]> = {};
  for (const [key] of themeEntries) {
    membership[key] = allExtra.length ? allExtra : Object.keys(anchor);
  }
  return {
    targetSleeves: Object.fromEntries(themeEntries),
    membership,
  };
}

/**
 * Attach mechanical conflicts (and promote blocking LLM gaps) onto an overlay.
 * Idempotent for known conflict ids. Forces phase to clarify when conflicts exist.
 */
export function attachMechanicalOverlayConflicts(
  overlay: ClientOverlay,
  opts: MechanicalConflictOpts = {},
): ClientOverlay {
  const lang = opts.lang ?? "zh";
  const declaredDrift =
    typeof opts.declaredDrift === "number" && Number.isFinite(opts.declaredDrift)
      ? Math.max(0, Math.min(1, opts.declaredDrift))
      : 0.5;
  const anchor = anchorWeightsFromPositions(opts.anchorPositions);
  const anchorTickers = new Set(Object.keys(anchor));

  const conflicts: OverlayConflict[] = [...(overlay.conflicts ?? [])];
  const hasCode = (code: string) => conflicts.some((c) => c.code === code);

  const second = detectSecondLayerAiHedgeIntent(overlay, {
    transcript: opts.transcript,
    anchorTickers,
  });

  if (second.detected && Object.keys(anchor).length > 0) {
    const plan = inferAiHedgeSleevePlan(
      overlay,
      second.aiTickers,
      second.hedgeTickers,
      opts.transcript,
    );
    if (plan) {
      const check = minL1DriftForTarget(
        anchor,
        plan.targetSleeves,
        plan.membership,
        declaredDrift,
      );
      if (!check.feasible && !hasCode("INFEASIBLE_DRIFT")) {
        conflicts.push(buildInfeasibleDriftConflict(check, { lang }));
      }
    }
    if (!hasCode("INFEASIBLE_DRIFT") && !hasCode("UNSUPPORTED_TWO_LAYER")) {
      conflicts.push(
        buildTwoLayerStructuralConflict({
          lang,
          aiTickers: second.aiTickers,
          hedgeTickers: second.hedgeTickers,
        }),
      );
    }
  } else if (Object.keys(anchor).length > 0) {
    const plan = themeSleevePlanFromOverlay(overlay, anchor);
    if (plan) {
      const check = minL1DriftForTarget(
        anchor,
        plan.targetSleeves,
        plan.membership,
        declaredDrift,
      );
      if (!check.feasible && !hasCode("INFEASIBLE_DRIFT")) {
        conflicts.push(buildInfeasibleDriftConflict(check, { lang }));
      }
    }
  }

  for (const gap of overlay.capability_gaps ?? []) {
    if (gap.severity !== "blocking") continue;
    const id = `conflict-gap-${gap.missing_capability}`.slice(0, 40);
    if (conflicts.some((c) => c.id === id)) continue;
    conflicts.push(conflictFromBlockingGap(gap, lang));
  }

  if (!conflicts.length) return overlay;

  return {
    ...overlay,
    conflicts,
    audit: {
      ...overlay.audit,
      phase: "clarify",
    },
  };
}
