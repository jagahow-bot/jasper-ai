const GEMINI_METADATA_KEYS = new Set([
  "thoughtSignature",
  "thought_signature",
  "turnToken",
  "usageMetadata",
]);

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
    const amountUsd = parseLiquidityUsdAmount(raw) ?? parseUsdAmount(raw);
    const withinMonths = parseWithinMonthsFromText(raw);
    return {
      ...(amountUsd != null ? { amount_usd: amountUsd } : {}),
      ...(withinMonths != null ? { within_months: withinMonths } : {}),
      description: raw.slice(0, 300),
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

  return {
    ...(amountUsd != null ? { amount_usd: amountUsd } : {}),
    ...(withinMonths != null ? { within_months: withinMonths } : {}),
    ...(description ? { description } : {}),
  };
}

/** Convert 35 → 0.35 and clamp to schema bounds. */
export function normalizePositionPct(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  let pct = value > 1 ? value / 100 : value;
  pct = Math.min(0.25, Math.max(0.05, pct));
  return pct;
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
  if (
    existing &&
    typeof existing.stance === "string" &&
    Array.isArray(existing.themes) &&
    existing.themes.length > 0 &&
    typeof existing.narrative_summary === "string" &&
    existing.narrative_summary.length >= 8
  ) {
    return existing;
  }

  const rationale = typeof root.rationale === "string" ? root.rationale : "";
  const clientProfile = asRecord(root.client_profile) ?? {};
  const themes: string[] = [];
  if (clientProfile.liquidity_need || clientProfile.liquidity_needs) themes.push("liquidity");
  if (/esg/i.test(rationale) || clientProfile.esg_preference) themes.push("esg");
  if (/drawdown|defensive|preservation|liquidity/i.test(rationale)) {
    themes.push("capital_preservation");
  }
  if (!themes.length) themes.push("balanced");

  const narrativeSummary =
    rationale.length >= 8
      ? rationale.slice(0, 400)
      : "Structured overlay from RM conversation pending confirmation.";

  return {
    stance: "neutral",
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
    if (val && typeof val === "object" && !Array.isArray(val) && "mode" in val) {
      out[key] = val;
      continue;
    }
    if (typeof val === "number" && Number.isFinite(val)) {
      out[key] = { mode: "fixed", fixed: val };
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeExperiment(raw: unknown): Record<string, unknown> | undefined {
  const exp = asRecord(raw);
  if (!exp) return undefined;
  if (typeof exp.enabled === "boolean" && exp.mode === "objective_switch") {
    return exp;
  }
  if ("trigger" in exp) {
    if (!exp.trigger) return undefined;
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
  let investmentHorizonYears: number | undefined;
  if (typeof horizonRaw === "number" && Number.isFinite(horizonRaw)) {
    investmentHorizonYears = Math.min(50, Math.max(1, Math.round(horizonRaw)));
  }

  root.client_profile = {
    ...clientProfile,
    ...(liquidityNeed ? { liquidity_need: liquidityNeed } : {}),
    ...(investmentHorizonYears != null ? { investment_horizon_years: investmentHorizonYears } : {}),
  };
  delete (root.client_profile as Record<string, unknown>).liquidity_needs;
  delete (root.client_profile as Record<string, unknown>).liquidityNeeds;
  delete (root.client_profile as Record<string, unknown>).investment_horizon;

  const universe = asRecord(root.universe);
  const allocation = asRecord(root.allocation) ?? {};
  const universeConstraints = asRecord(universe?.constraints);
  const maxFromUniverse =
    universeConstraints?.max_single_weight ?? universeConstraints?.max_single_position_pct;
  const maxPct = normalizePositionPct(
    allocation.max_single_position_pct ?? maxFromUniverse,
  );
  root.allocation = {
    ...allocation,
    ...(maxPct != null ? { max_single_position_pct: maxPct } : {}),
    ...(normalizeWeightRecord(allocation.sleeve_targets)
      ? { sleeve_targets: normalizeWeightRecord(allocation.sleeve_targets) }
      : {}),
    ...(normalizeWeightRecord(allocation.sub_sleeve_targets)
      ? { sub_sleeve_targets: normalizeWeightRecord(allocation.sub_sleeve_targets) }
      : {}),
  };

  if (universe) {
    const { constraints: _constraints, ...universeRest } = universe;
    root.universe = universeRest;
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

  root.market_view = synthesizeMarketView(root);

  if (typeof root.confidence === "string") {
    const confidence = Number.parseFloat(root.confidence);
    if (Number.isFinite(confidence)) root.confidence = confidence;
  }

  if (!Array.isArray(root.clarification_questions)) {
    root.clarification_questions = [];
  }

  return root;
}

/** Coerce Gemini overlay JSON into schema-compatible shape (validate with overlayExtractSchema in route). */
export function parseOverlayExtractFromGemini(raw: unknown): unknown {
  return normalizeOverlayExtractRaw(raw);
}
