import paramCatalog from "@/data/param-catalog.json";

const GEMINI_METADATA_KEYS = new Set([
  "thoughtSignature",
  "thought_signature",
  "turnToken",
  "usageMetadata",
]);

type ParamCatalogEntry = {
  key: string;
  kind: string;
  overlay_eligible?: boolean;
  bounds?: number[];
  description?: string;
  client_hint?: string;
};

const PARAM_CATALOG_ENTRIES = (
  paramCatalog as { params?: ParamCatalogEntry[] }
).params ?? [];

const OVERLAY_ELIGIBLE_PARAM_KEYS = new Set(
  PARAM_CATALOG_ENTRIES.filter((p) => p.overlay_eligible).map((p) => p.key),
);

const OVERLAY_PARAM_BOUNDS = new Map<string, [number, number]>(
  PARAM_CATALOG_ENTRIES.filter(
    (p) =>
      p.overlay_eligible &&
      Array.isArray(p.bounds) &&
      p.bounds.length >= 2 &&
      Number.isFinite(p.bounds[0]) &&
      Number.isFinite(p.bounds[1]),
  ).map((p) => [p.key, [Number(p.bounds![0]), Number(p.bounds![1])] as [number, number]]),
);

/** Recursively drop Gemini metadata keys from API payloads. */
export function stripGeminiMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripGeminiMetadata);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (GEMINI_METADATA_KEYS.has(key)) continue;
    out[key] = stripGeminiMetadata(child);
  }
  return out;
}

function extractJsonFromMarkdown(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text.trim();
}

/** Pull overlay JSON text from a Gemini generateContent response or plain string. */
export function extractOverlayJsonText(raw: unknown): string | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length ? trimmed : null;
  }
  if (!raw || typeof raw !== "object") return null;

  const stripped = stripGeminiMetadata(raw) as Record<string, unknown>;

  if (typeof stripped.text === "string" && stripped.text.trim()) {
    return stripped.text.trim();
  }

  const candidates = stripped.candidates;
  if (Array.isArray(candidates)) {
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") continue;
      const content = (candidate as { content?: { parts?: unknown[] } }).content;
      const parts = content?.parts;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        if (!part || typeof part !== "object") continue;
        const text = (part as { text?: string }).text;
        if (typeof text === "string" && text.trim()) {
          return text.trim();
        }
      }
    }
  }

  return null;
}

function splitLiquiditySegments(text: string): string[] {
  return text.split(/(?:[。！？\n]|；|;|，|\.(?=\s))/);
}

const WITHDRAWAL_CONTEXT_RE =
  /needs?|require[sd]?|withdraw|liquidity|purchase|tuition|house|mortgage|提領|流動|買房|买房|學費|現金需求|資金需求/i;
const TOTAL_ASSETS_RE = /總資產|总资产|total assets|portfolio size|net worth|aum/i;

function scaleUsdAmount(amount: number, unit?: string, matchedText?: string): number {
  const u = unit?.toLowerCase();
  if (u && ["million", "mn", "mm"].includes(u)) return amount * 1_000_000;
  if (u && ["billion", "b"].includes(u)) return amount * 1_000_000_000;
  if (u && ["thousand", "k"].includes(u)) return amount * 1_000;
  if (matchedText && /萬|万/.test(matchedText)) return amount * 10_000;
  return amount;
}

function parseUsdAmountFromSegment(segment: string): number | undefined {
  const compact = segment.replace(/,/g, "");
  const match =
    compact.match(/(?:usd|us\$|\$)\s*(\d+(?:\.\d+)?)\s*(million|mn|mm|billion|b)\b/i) ??
    compact.match(/(?:usd|us\$|\$)\s*(\d+(?:\.\d+)?)\s*M\b/) ??
    compact.match(/(\d+(?:\.\d+)?)\s*(million|mn|mm|billion|b)\b/i) ??
    compact.match(/(\d+(?:\.\d+)?)\s*M\b/) ??
    compact.match(/(?:usd|us\$|\$)\s*(\d+(?:\.\d+)?)\s*(thousand|k)\b/i) ??
    compact.match(/(\d+(?:\.\d+)?)\s*(?:萬|万)\s*(?:美元|美金|usd)?/i) ??
    compact.match(/(\d+(?:\.\d+)?)\s*(?:萬|万)/);

  if (!match) return undefined;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return undefined;
  if (/\d(?:\.\d+)?\s*M\b/.test(match[0])) return amount * 1_000_000;
  return scaleUsdAmount(amount, match[2], match[0]);
}

function parseUsdAmount(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value !== "string") return undefined;
  return parseUsdAmountFromSegment(value);
}

/** Prefer withdrawal/liquidity amounts over total portfolio size in free text. */
export function parseLiquidityUsdAmount(text: string): number | undefined {
  const segments = splitLiquiditySegments(text);
  const withdrawalAmounts: number[] = [];
  const liquidityAmounts: number[] = [];

  for (const segment of segments) {
    if (!WITHDRAWAL_CONTEXT_RE.test(segment)) continue;
    const amount = parseUsdAmountFromSegment(segment);
    if (amount == null) continue;
    if (TOTAL_ASSETS_RE.test(segment) && !/提領|withdraw|needs?|require[sd]?/i.test(segment)) {
      continue;
    }
    if (/提領|withdraw|needs?|require[sd]?/i.test(segment)) {
      withdrawalAmounts.push(amount);
    } else {
      liquidityAmounts.push(amount);
    }
  }

  if (withdrawalAmounts.length) return Math.min(...withdrawalAmounts);
  if (liquidityAmounts.length) return Math.min(...liquidityAmounts);

  const usdMillions = [
    ...text.matchAll(
      /(?:usd|us\$|\$)\s*(\d+(?:\.\d+)?)\s*(million|mn|mm|billion|b)\b/gi,
    ),
  ]
    .map((m) => Number(m[1]) * 1_000_000)
    .filter((n) => Number.isFinite(n));
  if (usdMillions.length) return Math.min(...usdMillions);

  if (WITHDRAWAL_CONTEXT_RE.test(text)) {
    return parseUsdAmountFromSegment(text);
  }

  return undefined;
}

function parseWithinMonthsFromText(text: string): number | undefined {
  if (/first year|within.*year|一年|12個月|12个月|12\s*mo/i.test(text)) return 12;
  if (/6.?month|半年|6個月|6个月/i.test(text)) return 6;
  const monthMatch = text.match(/within\s+(\d+)\s+months?/i);
  if (monthMatch) {
    const months = Number.parseInt(monthMatch[1], 10);
    if (Number.isFinite(months)) return Math.min(120, Math.max(1, months));
  }
  return undefined;
}

/** Normalize Gemini liquidity_need variants to overlay schema shape. */
export function normalizeLiquidityNeed(
  raw: unknown,
): {
  amount_usd?: number;
  within_months?: number;
  description?: string;
} | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    // Growth / cash-only cases often emit a prose "no withdrawal" string — omit entirely.
    if (
      /no\s+(near[- ]?term\s+)?(liquidity|withdrawal|withdraw)/i.test(trimmed) ||
      /without\s+(near[- ]?term\s+)?(liquidity|withdrawal)/i.test(trimmed) ||
      /無(明確)?(提領|流動性|現金需求)|没有(明确)?(提领|流动性)|不做提領|無需提領/i.test(trimmed)
    ) {
      return undefined;
    }
    const amountUsd = parseLiquidityUsdAmount(trimmed) ?? parseUsdAmount(trimmed);
    const withinMonths = parseWithinMonthsFromText(trimmed);
    return {
      ...(amountUsd != null ? { amount_usd: amountUsd } : {}),
      ...(withinMonths != null ? { within_months: withinMonths } : {}),
      description: trimmed.slice(0, 300),
    };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const src = raw as Record<string, unknown>;
  const amountUsd =
    parseUsdAmount(src.amount_usd) ??
    parseUsdAmount(src.amountUsd) ??
    parseUsdAmount(src.amount) ??
    parseUsdAmount(src.value);

  let withinMonths: number | undefined;
  const monthsRaw = src.within_months ?? src.withinMonths ?? src.months ?? src.horizon_months;
  if (typeof monthsRaw === "number" && Number.isFinite(monthsRaw)) {
    withinMonths = Math.min(120, Math.max(1, Math.round(monthsRaw)));
  } else if (typeof monthsRaw === "string") {
    const parsed = Number.parseInt(monthsRaw, 10);
    if (Number.isFinite(parsed)) {
      withinMonths = Math.min(120, Math.max(1, parsed));
    }
  }

  const description =
    typeof src.description === "string"
      ? src.description.slice(0, 300)
      : typeof src.purpose === "string"
        ? src.purpose.slice(0, 300)
        : undefined;

  if (amountUsd == null && withinMonths == null && !description) return undefined;

  // Empty / zero-need objects with only a "none" description → omit
  if (
    amountUsd == null &&
    withinMonths == null &&
    description &&
    /no\s+(near[- ]?term\s+)?(liquidity|withdrawal)|無(明確)?(提領|流動性)|无需提领/i.test(description)
  ) {
    return undefined;
  }

  return {
    ...(amountUsd != null ? { amount_usd: amountUsd } : {}),
    ...(withinMonths != null ? { within_months: withinMonths } : {}),
    ...(description ? { description } : {}),
  };
}

/** Convert 35 → 0.35 and clamp to schema bounds. */
export function normalizePositionPct(value: unknown): number | undefined {
  if (typeof value === "string") {
    const match = value.trim().match(/(\d+(?:\.\d+)?)\s*%?/);
    if (!match) return undefined;
    value = Number(match[1]);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  let pct = value > 1 ? value / 100 : value;
  pct = Math.min(0.4, Math.max(0.05, pct));
  return pct;
}

function parseInvestmentHorizonYears(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.min(50, Math.max(1, Math.round(raw)));
  }
  if (typeof raw !== "string") return undefined;

  const yearMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:years?|yr|年)/i);
  if (yearMatch) {
    return Math.min(50, Math.max(1, Math.round(Number(yearMatch[1]))));
  }
  if (/multi[- ]?year|長期|多年|long[- ]?term/i.test(raw)) return 5;
  if (/first year|一年|12個月|12个月|within.*year/i.test(raw)) return 1;

  const monthMatch = raw.match(/(\d+)\s*(?:months?|mo|個月|个月)/i);
  if (monthMatch) {
    const years = Math.ceil(Number(monthMatch[1]) / 12);
    return Math.min(50, Math.max(1, years));
  }

  return undefined;
}

function normalizeMarketStance(
  stance: unknown,
): "risk_on" | "neutral" | "risk_off" | undefined {
  if (stance === "risk_on" || stance === "neutral" || stance === "risk_off") return stance;
  if (typeof stance !== "string") return undefined;
  const s = stance.toLowerCase();
  if (/risk.?on|bullish|aggressive|growth/i.test(s)) return "risk_on";
  if (/risk.?off|bearish|defensive|preservation|cautious/i.test(s)) return "risk_off";
  return "neutral";
}

function normalizeRiskTolerance(
  raw: unknown,
): "conservative" | "moderate" | "aggressive" | undefined {
  if (raw === "conservative" || raw === "moderate" || raw === "aggressive") return raw;
  if (typeof raw !== "string") return undefined;
  const s = raw.toLowerCase();
  if (/aggress|growth|high.?risk|進取|積極|공격/i.test(s)) return "aggressive";
  if (/conserv|defensive|low.?risk|保守|안정/i.test(s)) return "conservative";
  if (/moderat|balanced|中等|穩健|보통/i.test(s)) return "moderate";
  return undefined;
}

function normalizeEsgPreference(
  raw: unknown,
): "none" | "light" | "strict" | undefined {
  if (raw === "none" || raw === "light" || raw === "strict") return raw;
  if (typeof raw !== "string") return undefined;
  const s = raw.toLowerCase().trim();
  if (/^(no|none|n\/a|false|0|無|无|不要|拒絕|거부)/i.test(s) || /no\s*esg|not\s*esg|without\s*esg/i.test(s)) {
    return "none";
  }
  if (/strict|strong|mandat|嚴格|엄격/i.test(s)) return "strict";
  if (/light|prefer|soft|輕度|선호/i.test(s)) return "light";
  return undefined;
}

const VALID_ASSET_CLASSES = new Set([
  "equity",
  "bond",
  "commodity",
  "real_estate",
  "alternative",
]);

function normalizeAssetClasses(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.toLowerCase().trim())
    .filter((v) => VALID_ASSET_CLASSES.has(v));
  return out.length ? out.slice(0, 5) : undefined;
}

function normalizeClarificationQuestions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    let text: string | undefined;
    if (typeof item === "string") {
      text = item.trim();
    } else if (item && typeof item === "object" && !Array.isArray(item)) {
      const obj = item as Record<string, unknown>;
      const candidate = obj.question ?? obj.text ?? obj.prompt ?? obj.content;
      if (typeof candidate === "string") text = candidate.trim();
    }
    if (!text) continue;
    const clipped = text.slice(0, 200);
    if (clipped.length >= 4) out.push(clipped);
    if (out.length >= 5) break;
  }
  return out;
}

function normalizeUniversePrompts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().slice(0, 200))
    .filter((v) => v.length >= 4)
    .slice(0, 6);
}

function normalizeTickerList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().toUpperCase().slice(0, 8))
    .filter((v) => v.length >= 1)
    .slice(0, 50);
  return out.length ? out : undefined;
}

type ProposedTicker = {
  ticker: string;
  name?: string;
  category?: string;
  rationale?: string;
};

function normalizeProposedTickers(raw: unknown): ProposedTicker[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ProposedTicker[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const src = item as Record<string, unknown>;
    const ticker =
      typeof src.ticker === "string" ? src.ticker.trim().toUpperCase().slice(0, 8) : "";
    if (!ticker) continue;
    const name =
      typeof src.name === "string" ? src.name.trim().slice(0, 120) : undefined;
    const category =
      typeof src.category === "string" ? src.category.trim().slice(0, 60) : undefined;
    const rationale =
      typeof src.rationale === "string" ? src.rationale.trim().slice(0, 200) : undefined;
    out.push({ ticker, ...(name ? { name } : {}), ...(category ? { category } : {}), ...(rationale ? { rationale } : {}) });
    if (out.length >= 50) break;
  }
  return out.length ? out : undefined;
}

function normalizeOptimization(
  raw: unknown,
  stance: "risk_on" | "neutral" | "risk_off",
): Record<string, unknown> {
  const opt = asRecord(raw) ?? {};
  const objectiveRaw = opt.objective;
  const validObjectives = new Set([
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
  let objective =
    typeof objectiveRaw === "string" && validObjectives.has(objectiveRaw)
      ? objectiveRaw
      : undefined;
  if (!objective) {
    objective = stance === "risk_off" ? "min_max_drawdown" : "max_sharpe";
  }
  const out: Record<string, unknown> = { objective };
  if (typeof opt.regime_adaptive === "boolean") out.regime_adaptive = opt.regime_adaptive;
  if (opt.optimization_mode === "standard" || opt.optimization_mode === "pro_auto") {
    out.optimization_mode = opt.optimization_mode;
  }
  if (typeof opt.trials === "number" && Number.isFinite(opt.trials)) {
    out.trials = Math.min(500, Math.max(10, Math.round(opt.trials)));
  }
  return out;
}

function pickKeys(
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (allowed.has(key)) out[key] = val;
  }
  return out;
}

const OVERLAY_EXTRACT_KEYS = new Set([
  "client_profile",
  "market_view",
  "allocation",
  "universe",
  "optimization",
  "deployment_schedule",
  "param_adjustments",
  "experiment",
  "asks",
  "clarification_questions",
  "confidence",
  "rationale",
]);

const OVERLAY_ASK_KINDS = new Set([
  "group_weight_band",
  "ticker_max",
  "exclude_ticker",
  "ticker_min",
  "objective",
  "cash_reserve",
  "direct_index",
  "other",
]);

const ASK_KEYS = new Set([
  "id",
  "title",
  "summary",
  "kind",
  "group_id",
  "tickers",
  "min_pct",
  "max_pct",
  "target_pct",
  "objective",
  "cash_reserve_pct",
  "status",
]);

const CLIENT_PROFILE_KEYS = new Set([
  "risk_tolerance",
  "investment_horizon_years",
  "liquidity_need",
  "esg_preference",
  "income_need_pct",
]);

const LIQUIDITY_NEED_KEYS = new Set(["amount_usd", "within_months", "description"]);

const MARKET_VIEW_KEYS = new Set(["stance", "themes", "narrative_summary"]);

const ALLOCATION_KEYS = new Set([
  "asset_classes",
  "sleeve_targets",
  "sub_sleeve_targets",
  "enforce_class_weights",
  "max_single_position_pct",
]);

const UNIVERSE_KEYS = new Set(["prompts", "supplement_tickers", "exclude_tickers", "proposed_tickers", "construction"]);

const OPTIMIZATION_KEYS = new Set([
  "objective",
  "regime_adaptive",
  "optimization_mode",
  "trials",
]);

/** Drop Gemini-invented keys before Zod validation. */
export function stripOverlayExtractKeys(root: Record<string, unknown>): Record<string, unknown> {
  const out = pickKeys(root, OVERLAY_EXTRACT_KEYS);

  const clientProfile = asRecord(out.client_profile);
  if (clientProfile) {
    const profile = pickKeys(clientProfile, CLIENT_PROFILE_KEYS);
    const liquidity = asRecord(profile.liquidity_need);
    if (liquidity) {
      profile.liquidity_need = pickKeys(liquidity, LIQUIDITY_NEED_KEYS);
    }
    out.client_profile = profile;
  }

  const marketView = asRecord(out.market_view);
  if (marketView) out.market_view = pickKeys(marketView, MARKET_VIEW_KEYS);

  const allocation = asRecord(out.allocation);
  if (allocation) out.allocation = pickKeys(allocation, ALLOCATION_KEYS);

  const universe = asRecord(out.universe);
  if (universe) out.universe = pickKeys(universe, UNIVERSE_KEYS);

  const optimization = asRecord(out.optimization);
  if (optimization) out.optimization = pickKeys(optimization, OPTIMIZATION_KEYS);

  if (Array.isArray(out.asks)) {
    out.asks = out.asks
      .map((row) => {
        const rec = asRecord(row);
        return rec ? pickKeys(rec, ASK_KEYS) : null;
      })
      .filter(Boolean);
    if (!(out.asks as unknown[]).length) delete out.asks;
  }

  return out;
}

function normalizeWeightRecord(
  raw: unknown,
): Record<string, number> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof val !== "number" || !Number.isFinite(val)) continue;
    out[key] = val > 1 ? val / 100 : val;
  }
  return Object.keys(out).length ? out : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function synthesizeMarketView(root: Record<string, unknown>): Record<string, unknown> {
  const existing = asRecord(root.market_view);
  const clientProfile = asRecord(root.client_profile) ?? {};
  const riskTolerance = normalizeRiskTolerance(clientProfile.risk_tolerance);
  const rationale = typeof root.rationale === "string" ? root.rationale : "";

  const themesFromExisting =
    existing && Array.isArray(existing.themes)
      ? existing.themes
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim().slice(0, 40))
          .filter((t) => t.length >= 1)
          .slice(0, 8)
      : [];

  if (
    existing &&
    normalizeMarketStance(existing.stance) &&
    themesFromExisting.length > 0 &&
    typeof existing.narrative_summary === "string" &&
    existing.narrative_summary.length >= 8
  ) {
    return {
      stance: normalizeMarketStance(existing.stance) ?? "neutral",
      themes: themesFromExisting,
      narrative_summary: existing.narrative_summary.slice(0, 400),
    };
  }

  const themes: string[] = [...themesFromExisting];
  if (clientProfile.liquidity_need || clientProfile.liquidity_needs) themes.push("liquidity");
  if (riskTolerance === "aggressive") themes.push("growth");
  if (/concentrat|diversif|分散|集中|QQQ|nasdaq/i.test(rationale)) {
    themes.push("concentration_reduction");
  }
  if (/esg/i.test(rationale) || clientProfile.esg_preference) themes.push("esg");
  if (/drawdown|defensive|preservation|liquidity/i.test(rationale)) {
    themes.push("capital_preservation");
  }
  if (/phased|gradual|dca|分批|逐步|달러코스트/i.test(rationale)) {
    themes.push("phased_deployment");
  }
  if (!themes.length) themes.push(riskTolerance === "aggressive" ? "growth" : "balanced");

  const stance =
    normalizeMarketStance(existing?.stance) ??
    (riskTolerance === "aggressive"
      ? "risk_on"
      : riskTolerance === "conservative"
        ? "risk_off"
        : "neutral");

  const narrativeSummary =
    (typeof existing?.narrative_summary === "string" && existing.narrative_summary.length >= 8
      ? existing.narrative_summary
      : rationale.length >= 8
        ? rationale
        : "Structured overlay from RM conversation pending confirmation."
    ).slice(0, 400);

  return {
    stance,
    themes: themes.slice(0, 8),
    narrative_summary: narrativeSummary,
  };
}

function normalizeParamAdjustments(
  raw: unknown,
): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!OVERLAY_ELIGIBLE_PARAM_KEYS.has(key)) continue;
    const bounds = OVERLAY_PARAM_BOUNDS.get(key);
    let ctl: Record<string, unknown> | null = null;
    if (val && typeof val === "object" && !Array.isArray(val) && "mode" in val) {
      ctl = { ...(val as Record<string, unknown>) };
    } else if (typeof val === "number" && Number.isFinite(val)) {
      ctl = { mode: "fixed", fixed: val };
    }
    if (!ctl) continue;
    const mode = String(ctl.mode ?? "fixed");
    if (mode !== "fixed" && mode !== "search" && mode !== "off") continue;
    ctl.mode = mode;
    if (bounds) {
      const [lo, hi] = bounds;
      if (mode === "fixed" && typeof ctl.fixed === "number" && Number.isFinite(ctl.fixed)) {
        ctl.fixed = Math.min(hi, Math.max(lo, ctl.fixed));
      }
      if (mode === "search") {
        const minRaw = typeof ctl.min === "number" ? ctl.min : lo;
        const maxRaw = typeof ctl.max === "number" ? ctl.max : hi;
        let min = Math.min(hi, Math.max(lo, minRaw));
        let max = Math.min(hi, Math.max(lo, maxRaw));
        if (min > max) [min, max] = [max, min];
        ctl.min = min;
        ctl.max = max;
      }
    }
    out[key] = ctl;
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeAskPct(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  const v = raw > 1 ? raw / 100 : raw;
  return Math.min(1, Math.max(0, v));
}

function normalizeAsks(raw: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < Math.min(raw.length, 12); i++) {
    const row = asRecord(raw[i]);
    if (!row) continue;
    const kindRaw = typeof row.kind === "string" ? row.kind.trim() : "other";
    const kind = OVERLAY_ASK_KINDS.has(kindRaw) ? kindRaw : "other";
    const title =
      typeof row.title === "string" && row.title.trim()
        ? row.title.trim().slice(0, 120)
        : `Ask ${i + 1}`;
    const summary =
      typeof row.summary === "string" && row.summary.trim()
        ? row.summary.trim().slice(0, 400)
        : title;
    const id =
      typeof row.id === "string" && row.id.trim()
        ? row.id.trim().slice(0, 40)
        : `ask-${i + 1}`;
    const tickers = normalizeTickerList(row.tickers);
    const ask: Record<string, unknown> = {
      id,
      title,
      summary,
      kind,
      ...(typeof row.group_id === "string" && row.group_id.trim()
        ? { group_id: row.group_id.trim().slice(0, 80) }
        : {}),
      ...(tickers ? { tickers } : {}),
    };
    const minPct = normalizeAskPct(row.min_pct);
    const maxPct = normalizeAskPct(row.max_pct);
    const targetPct = normalizeAskPct(row.target_pct);
    const cashPct = normalizeAskPct(row.cash_reserve_pct);
    if (minPct != null) ask.min_pct = minPct;
    if (maxPct != null) ask.max_pct = maxPct;
    if (targetPct != null) ask.target_pct = targetPct;
    if (cashPct != null) ask.cash_reserve_pct = Math.min(0.4, cashPct);
    if (typeof row.objective === "string" && row.objective.trim()) {
      const obj = row.objective.trim();
      const validObjectives = new Set([
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
      if (validObjectives.has(obj)) ask.objective = obj;
    }
    if (row.status === "proposed" || row.status === "signed") {
      ask.status = row.status;
    }
    out.push(pickKeys(ask, ASK_KEYS));
  }
  return out.length ? out : undefined;
}

function normalizeExperiment(raw: unknown): Record<string, unknown> | undefined {
  const exp = asRecord(raw);
  if (!exp) return undefined;
  if (typeof exp.enabled === "boolean" && exp.mode === "objective_switch") {
    return exp;
  }
  if ("trigger" in exp) {
    const trigger = exp.trigger;
    const enabled =
      trigger === true || trigger === "true" || trigger === 1 || trigger === "1";
    if (!enabled) return undefined;
    return {
      enabled: true,
      mode: "objective_switch",
      regime_mode: typeof exp.regime_mode === "string" ? exp.regime_mode : "auto",
    };
  }
  return undefined;
}

/** Coerce Gemini overlay JSON into schema-compatible shape before Zod validation. */
export function normalizeOverlayExtractRaw(raw: unknown): unknown {
  const text = extractOverlayJsonText(raw);
  let parsed: unknown = raw;
  if (text != null) {
    parsed = JSON.parse(extractJsonFromMarkdown(text));
  }
  parsed = stripGeminiMetadata(parsed);
  const root = asRecord(parsed);
  if (!root) return parsed;

  const clientProfile = asRecord(root.client_profile) ?? {};
  const liquidityRaw =
    clientProfile.liquidity_need ??
    clientProfile.liquidity_needs ??
    clientProfile.liquidityNeeds;
  const liquidityNeed = normalizeLiquidityNeed(liquidityRaw);
  const horizonRaw = clientProfile.investment_horizon_years ?? clientProfile.investment_horizon;
  const investmentHorizonYears = parseInvestmentHorizonYears(horizonRaw);
  const riskTolerance = normalizeRiskTolerance(clientProfile.risk_tolerance);
  const esgPreference = normalizeEsgPreference(clientProfile.esg_preference);

  let incomeNeedPct: number | undefined;
  const incomeRaw = clientProfile.income_need_pct;
  if (typeof incomeRaw === "number" && Number.isFinite(incomeRaw)) {
    incomeNeedPct = incomeRaw > 1 ? incomeRaw / 100 : incomeRaw;
    incomeNeedPct = Math.min(1, Math.max(0, incomeNeedPct));
  }

  root.client_profile = {
    ...(riskTolerance ? { risk_tolerance: riskTolerance } : {}),
    ...(investmentHorizonYears != null ? { investment_horizon_years: investmentHorizonYears } : {}),
    ...(liquidityNeed ? { liquidity_need: liquidityNeed } : {}),
    ...(esgPreference ? { esg_preference: esgPreference } : {}),
    ...(incomeNeedPct != null ? { income_need_pct: incomeNeedPct } : {}),
  };

  const universe = asRecord(root.universe);
  const allocation = asRecord(root.allocation) ?? {};
  const universeConstraints = asRecord(universe?.constraints);
  const maxFromUniverse =
    universeConstraints?.max_single_weight ?? universeConstraints?.max_single_position_pct;
  const maxPct = normalizePositionPct(
    allocation.max_single_position_pct ??
      allocation.max_single_weight ??
      maxFromUniverse,
  );
  const sleeveTargets = normalizeWeightRecord(allocation.sleeve_targets);
  const subSleeveTargets = normalizeWeightRecord(allocation.sub_sleeve_targets);
  const assetClasses =
    normalizeAssetClasses(allocation.asset_classes) ??
    (riskTolerance === "aggressive" ? ["equity", "bond"] : ["equity", "bond", "commodity"]);

  root.allocation = {
    asset_classes: assetClasses,
    ...(typeof allocation.enforce_class_weights === "boolean"
      ? { enforce_class_weights: allocation.enforce_class_weights }
      : {}),
    ...(maxPct != null ? { max_single_position_pct: maxPct } : {}),
    ...(sleeveTargets ? { sleeve_targets: sleeveTargets } : {}),
    ...(subSleeveTargets ? { sub_sleeve_targets: subSleeveTargets } : {}),
  };

  if (universe) {
    const { constraints, ...universeRest } = universe;
    void constraints;
    const prompts = normalizeUniversePrompts(universeRest.prompts);
    const supplement = normalizeTickerList(universeRest.supplement_tickers);
    const exclude = normalizeTickerList(universeRest.exclude_tickers);
    const proposed = normalizeProposedTickers(universeRest.proposed_tickers);
    const construction =
      universeRest.construction === "direct_index" ? "direct_index" : undefined;
    root.universe = {
      prompts,
      ...(supplement ? { supplement_tickers: supplement } : {}),
      ...(exclude ? { exclude_tickers: exclude } : {}),
      ...(proposed ? { proposed_tickers: proposed } : {}),
      ...(construction ? { construction } : {}),
    };
  } else {
    root.universe = { prompts: [] };
  }

  const paramAdjustments = normalizeParamAdjustments(root.param_adjustments);
  if (paramAdjustments) {
    root.param_adjustments = paramAdjustments;
  } else {
    delete root.param_adjustments;
  }

  const experiment = normalizeExperiment(root.experiment);
  if (experiment) {
    root.experiment = experiment;
  } else {
    delete root.experiment;
  }

  const asks = normalizeAsks(root.asks);
  if (asks) {
    root.asks = asks;
  } else {
    delete root.asks;
  }

  root.market_view = synthesizeMarketView(root);
  const stance = (root.market_view as { stance: "risk_on" | "neutral" | "risk_off" }).stance;
  root.optimization = normalizeOptimization(root.optimization, stance);

  if (typeof root.confidence === "string") {
    const confidence = Number.parseFloat(root.confidence);
    if (Number.isFinite(confidence)) root.confidence = confidence;
  }
  if (typeof root.confidence === "number" && Number.isFinite(root.confidence)) {
    let confidence = root.confidence;
    if (confidence > 1) confidence = confidence / 100;
    root.confidence = Math.min(1, Math.max(0, confidence));
  } else {
    root.confidence = 0.5;
  }

  root.clarification_questions = normalizeClarificationQuestions(root.clarification_questions);

  if (typeof root.rationale !== "string" || root.rationale.trim().length < 8) {
    const narrative =
      typeof (root.market_view as { narrative_summary?: string }).narrative_summary === "string"
        ? (root.market_view as { narrative_summary: string }).narrative_summary
        : "";
    root.rationale =
      narrative.length >= 8
        ? narrative.slice(0, 600)
        : "Structured overlay extracted from RM conversation; please confirm with the client.";
  } else {
    root.rationale = root.rationale.trim().slice(0, 600);
  }

  // Infer DCA schedule from existing field or phased_deployment language.
  const existingDeploy = root.deployment_schedule;
  if (
    existingDeploy &&
    typeof existingDeploy === "object" &&
    typeof (existingDeploy as { months?: unknown }).months === "number"
  ) {
    const months = Math.min(
      24,
      Math.max(1, Math.round(Number((existingDeploy as { months: number }).months))),
    );
    const tranchesRaw = (existingDeploy as { tranches?: unknown }).tranches;
    const tranches =
      typeof tranchesRaw === "number"
        ? Math.min(24, Math.max(1, Math.round(Number(tranchesRaw))))
        : months;
    const bufRaw = (existingDeploy as { liquidity_buffer_pct?: unknown }).liquidity_buffer_pct;
    root.deployment_schedule = {
      months,
      tranches,
      ...(typeof bufRaw === "number"
        ? { liquidity_buffer_pct: Math.min(0.4, Math.max(0, Number(bufRaw))) }
        : {}),
    };
  } else {
    const rationaleText = String(root.rationale || "");
    const themes = ((root.market_view as { themes?: string[] } | undefined)?.themes ||
      []) as string[];
    const phased =
      themes.includes("phased_deployment") ||
      /phased|gradual|dca|分批|逐步|달러코스트/i.test(rationaleText);
    if (phased) {
      const monthMatch = rationaleText.match(
        /(\d+)\s*(?:[-–]?\s*)?(?:month|months|個月|개월)/i,
      );
      const months = monthMatch
        ? Math.min(24, Math.max(1, Number.parseInt(monthMatch[1], 10)))
        : 6;
      root.deployment_schedule = { months, tranches: months };
    }
  }

  return stripOverlayExtractKeys(root);
}

/** Coerce Gemini overlay JSON into schema-compatible shape (validate with overlayExtractSchema in route). */
export function parseOverlayExtractFromGemini(raw: unknown): unknown {
  return normalizeOverlayExtractRaw(raw);
}
