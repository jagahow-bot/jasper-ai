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

function parseUsdAmount(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value !== "string") return undefined;

  const compact = value.replace(/,/g, "");
  const match =
    compact.match(/(?:usd|us\$|\$)\s*(\d+(?:\.\d+)?)\s*(million|mn|mm|m|b|billion)\b/i) ??
    compact.match(/(\d+(?:\.\d+)?)\s*(million|mn|mm|m|b|billion)\b/i) ??
    compact.match(/(?:usd|us\$|\$)\s*(\d+(?:\.\d+)?)\s*(thousand|k)\b/i) ??
    compact.match(/(\d+(?:\.\d+)?)\s*(?:萬|万)/) ??
    compact.match(/(\d+(?:\.\d+)?)/);

  if (!match) return undefined;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return undefined;

  const unit = match[2]?.toLowerCase();
  if (unit && ["million", "mn", "mm", "m"].includes(unit)) return amount * 1_000_000;
  if (unit && ["billion", "b"].includes(unit)) return amount * 1_000_000_000;
  if (unit && ["thousand", "k"].includes(unit)) return amount * 1_000;
  if (/萬|万/.test(match[0])) return amount * 10_000;
  return amount;
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
    const amountUsd = parseUsdAmount(raw);
    return {
      ...(amountUsd != null ? { amount_usd: amountUsd } : {}),
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
  const liquidityNeed = normalizeLiquidityNeed(clientProfile.liquidity_need);
  root.client_profile = {
    ...clientProfile,
    ...(liquidityNeed ? { liquidity_need: liquidityNeed } : {}),
  };

  const allocation = asRecord(root.allocation);
  if (allocation) {
    const maxPct = normalizePositionPct(allocation.max_single_position_pct);
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
  }

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
