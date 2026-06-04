import { formatPctDecimal } from "./ai-metric-format";
import { candidateModelKey } from "./performance-compare-chart";

type HorizonSnap = {
  sharpe?: number;
  cagr?: number;
  max_drawdown?: number;
  objective_value?: number;
};

export type CompareCandidateLite = {
  model_code?: string;
  rank: number;
  sharpe?: number;
  cagr?: number;
  max_drawdown?: number;
  volatility?: number;
  turnover_avg?: number;
  beta?: number | null;
  alpha?: number | null;
  alpha_annual?: number | null;
  information_ratio?: number | null;
  train_sharpe?: number | null;
  validation_sharpe?: number | null;
  is_champion?: boolean;
  horizons?: {
    in_sample?: HorizonSnap;
    out_of_sample?: HorizonSnap | null;
    full_sample?: HorizonSnap;
    gap?: { sharpe?: number | null; objective?: number | null } | null;
  };
};

export type CompareSummaryPayload = {
  benchmark: string;
  objective?: string;
  objective_label?: string;
  champion_model_code?: string | null;
  /** When set (e.g. from Gemini compare), overrides Pro ★ for UI alignment. */
  ai_recommended_model_code?: string | null;
  candidates: CompareCandidateLite[];
  candidate_count_total?: number;
};

export type CompareSummaryResult = {
  summary: string;
  recommended_model_code: string | null;
};

export type CompareGenerationAttempt = {
  text: string;
  finishReason?: string;
  rawFinishReason?: string;
};

/** One retry max (2 Gemini calls total) for candidate compare summary. */
export const MAX_COMPARE_RETRIES = 1;
export const MAX_COMPARE_ATTEMPTS = 1 + MAX_COMPARE_RETRIES;

/** Gemini / AI SDK signals that output was cut off by the token budget. */
export function isGeminiMaxTokensFinish(
  finishReason?: string,
  rawFinishReason?: string,
): boolean {
  const raw = (rawFinishReason ?? "").trim().toUpperCase();
  if (raw === "MAX_TOKENS" || raw.includes("MAX_TOKEN")) return true;
  return finishReason === "length";
}

/** Detect incomplete JSON or wrong-schema dumps (e.g. round seed JSON under compare prompt). */
export function looksLikeTruncatedCompareJson(text: string): boolean {
  const t = text.trim();
  if (!t) return false;

  const lower = t.toLowerCase();
  const looksJson = t.startsWith("{") || /```(?:json)?/i.test(t);
  const hasCompareKeys =
    lower.includes("recommended_model_code") || lower.includes("recommended_model");
  const hasWrongSchema =
    lower.includes("round_setup") ||
    lower.includes("regime_setups") ||
    lower.includes("factor_choices") ||
    lower.includes("param_sets");

  if (hasWrongSchema && !hasCompareKeys) return true;

  const repetitive =
    /(.{24,})\1{4,}/.test(t) ||
    (t.match(/winsorized_by_sector/gi)?.length ?? 0) >= 3 ||
    (t.match(/neutralized_by_sector/gi)?.length ?? 0) >= 3;

  if (repetitive) return true;

  if (!looksJson) return false;

  const brace = t.match(/\{[\s\S]*/);
  if (!brace) return false;

  const snippet = brace[0];
  try {
    JSON.parse(snippet);
    return false;
  } catch {
    const open = (snippet.match(/\{/g) ?? []).length;
    const close = (snippet.match(/\}/g) ?? []).length;
    if (open > close) return true;
    if (snippet.length > 400 && !hasCompareKeys) return true;
    if (/[^\\]"[^"]*$/.test(snippet) && open > close) return true;
  }

  return false;
}

export function shouldRetryCompareGeneration(
  attempt: CompareGenerationAttempt,
  parsed: CompareSummaryResult,
): boolean {
  if (isGeminiMaxTokensFinish(attempt.finishReason, attempt.rawFinishReason)) {
    return true;
  }
  if (looksLikeTruncatedCompareJson(attempt.text)) return true;
  if (looksLikeMetricDump(attempt.text)) return true;
  if (!isAcceptableCompareSummary(parsed.summary)) return true;
  if (
    attempt.text.trim().startsWith("{") &&
    !parsed.recommended_model_code &&
    attempt.text.includes("recommended_model")
  ) {
    return true;
  }
  return false;
}

export type SlimCompareHorizonMode = "all" | "full_only" | "none";

const MODEL_CODE_RE = /\bM\d{3,5}\b/gi;

/** Parse structured Gemini JSON or fall back to first model_code mention in prose. */
export function parseCompareSummaryResponse(
  text: string,
  candidates: CompareCandidateLite[],
): CompareSummaryResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { summary: "", recommended_model_code: null };
  }

  const allowed = new Set(
    candidates
      .map((c) => candidateModelKey(c))
      .filter((code) => code && !code.startsWith("M?")),
  );

  const tryJson = (raw: string): CompareSummaryResult | null => {
    try {
      const obj = JSON.parse(raw) as {
        summary?: string;
        recommended_model_code?: string;
        recommended_model?: string;
      };
      const codeRaw =
        obj.recommended_model_code ?? obj.recommended_model ?? "";
      const code = String(codeRaw).trim().toUpperCase();
      const summary = String(obj.summary ?? "").trim() || trimmed;
      if (code && allowed.has(code)) {
        return { summary, recommended_model_code: code };
      }
      if (code && /^M\d{3,5}$/i.test(code)) {
        return { summary, recommended_model_code: code };
      }
      if (summary) return { summary, recommended_model_code: null };
    } catch {
      return null;
    }
    return null;
  };

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = tryJson(fenced[1].trim());
    if (parsed) return parsed;
  }

  const brace = trimmed.match(/\{[\s\S]*\}/);
  if (brace) {
    const parsed = tryJson(brace[0]);
    if (parsed) return parsed;
  }

  const parsed = tryJson(trimmed);
  if (parsed) return parsed;

  const mentions = [...trimmed.matchAll(MODEL_CODE_RE)].map((m) =>
    m[0].toUpperCase(),
  );
  const pick = mentions.find((code) => allowed.has(code)) ?? mentions[0] ?? null;
  return { summary: trimmed, recommended_model_code: pick };
}

const SLIM_HORIZON_KEYS = [
  "sharpe",
  "cagr",
  "max_drawdown",
  "objective_value",
] as const;

function slimHorizon(h?: HorizonSnap): HorizonSnap | undefined {
  if (!h) return undefined;
  const out: HorizonSnap = {};
  for (const k of SLIM_HORIZON_KEYS) {
    if (h[k] != null) out[k] = h[k];
  }
  return Object.keys(out).length ? out : undefined;
}

function slimCandidate(
  c: CompareCandidateLite,
  horizonMode: SlimCompareHorizonMode = "all",
): CompareCandidateLite {
  const h = c.horizons;
  let horizons: CompareCandidateLite["horizons"];
  if (h && horizonMode !== "none") {
    horizons =
      horizonMode === "full_only"
        ? { full_sample: slimHorizon(h.full_sample) }
        : {
            in_sample: slimHorizon(h.in_sample),
            out_of_sample: slimHorizon(h.out_of_sample ?? undefined),
            full_sample: slimHorizon(h.full_sample),
            gap: h.gap,
          };
    if (horizons && !Object.values(horizons).some(Boolean)) {
      horizons = undefined;
    }
  }
  return {
    model_code: c.model_code,
    rank: c.rank,
    sharpe: c.sharpe,
    cagr: c.cagr,
    max_drawdown: c.max_drawdown,
    volatility: c.volatility,
    turnover_avg: c.turnover_avg,
    beta: c.beta,
    alpha: c.alpha ?? c.alpha_annual,
    information_ratio: c.information_ratio,
    validation_sharpe: c.validation_sharpe,
    is_champion: c.is_champion,
    horizons,
  };
}

/** Pro/final ★ champion for compare narrative (AI pick > explicit code > is_champion). */
export function resolveCompareChampion(
  candidates: CompareCandidateLite[],
  championModelCode?: string | null,
  aiRecommendedModelCode?: string | null,
): CompareCandidateLite | undefined {
  for (const code of [aiRecommendedModelCode, championModelCode]) {
    if (!code?.trim()) continue;
    const byCode = candidates.find(
      (c) => candidateModelKey(c) === code.trim().toUpperCase(),
    );
    if (byCode) return byCode;
  }
  const flagged = candidates.find((c) => c.is_champion === true);
  if (flagged) return flagged;
  return candidates.find((c) => c.rank === 1) ?? candidates[0];
}

export type SlimComparePayloadOptions = {
  horizonMode?: SlimCompareHorizonMode;
};

/** Cap prompt size for multi-trial runs; full count echoed for the model. */
export function slimComparePayload(
  payload: CompareSummaryPayload,
  maxCandidates = 10,
  options?: SlimComparePayloadOptions,
): CompareSummaryPayload {
  const horizonMode = options?.horizonMode ?? "all";
  const sorted = [...payload.candidates].sort(
    (a, b) => (a.rank ?? 999) - (b.rank ?? 999),
  );
  const champ = resolveCompareChampion(
    sorted,
    payload.champion_model_code,
    payload.ai_recommended_model_code,
  );
  const champKey = champ ? candidateModelKey(champ) : null;
  const ordered = champKey
    ? [
        champ!,
        ...sorted.filter((c) => candidateModelKey(c) !== champKey),
      ]
    : sorted;
  return {
    benchmark: payload.benchmark,
    objective: payload.objective,
    objective_label: payload.objective_label,
    champion_model_code:
      payload.champion_model_code ??
      (champ?.model_code ? candidateModelKey(champ) : null),
    candidate_count_total: sorted.length,
    candidates: ordered
      .slice(0, maxCandidates)
      .map((c) => slimCandidate(c, horizonMode)),
  };
}

/** Detect truncated Gemini metric bullet dumps (not narrative prose). */
export function looksLikeMetricDump(text: string): boolean {
  const lines = text.trim().split(/\n+/).filter((l) => l.trim());
  if (lines.length < 2) return false;
  const metricish = lines.filter(
    (l) =>
      /^M\d{3,5}\s+(Volatility|Sharpe|CAGR|Max DD|Turnover)/i.test(l.trim()) ||
      /^-\s*(Full sample|In-sample|Out-of-sample|Turnover)/i.test(l.trim()),
  ).length;
  if (metricish >= 2) return true;
  if (lines.length >= 4 && metricish / lines.length >= 0.35) return true;
  return /^of-sample\b/i.test(lines[0]?.trim() ?? "");
}

export function isAcceptableCompareSummary(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 100) return false;
  if (looksLikeMetricDump(t)) return false;
  const sentences = t.split(/[.!?]+/).filter((s) => s.trim().length > 24);
  return sentences.length >= 2;
}

function horizonLine(code: string, label: string, h?: HorizonSnap): string {
  if (!h) return "";
  return (
    `${code} ${label}: Sharpe ${h.sharpe ?? "—"}, CAGR ${formatPctDecimal(h.cagr)}, ` +
    `max DD ${formatPctDecimal(h.max_drawdown)}.`
  );
}

export function buildCompareFallback(payload: CompareSummaryPayload): string {
  const sorted = [...payload.candidates].sort(
    (a, b) => (a.rank ?? 999) - (b.rank ?? 999),
  );
  const champ = resolveCompareChampion(
    sorted,
    payload.champion_model_code,
    payload.ai_recommended_model_code,
  );
  if (!champ) return "No models to compare.";
  const champCode = champ.model_code ?? "M?";
  const obj = payload.objective_label ?? payload.objective ?? "n/a";
  const total = payload.candidate_count_total ?? sorted.length;

  const p1 = [
    `Across ${total} models vs ${payload.benchmark} (${obj}), ${champCode} is the Pro champion (★) on the selection objective.`,
    `Selection view: CAGR ${formatPctDecimal(champ.cagr)}, Sharpe ${champ.sharpe ?? "—"}, ` +
      `max drawdown ${formatPctDecimal(champ.max_drawdown)}, turnover ${formatPctDecimal(champ.turnover_avg)}.`,
  ].join(" ");

  const full = champ.horizons?.full_sample;
  const oos = champ.horizons?.out_of_sample;
  const p2Parts: string[] = [];
  if (full) {
    p2Parts.push(horizonLine(champCode, "full sample", full));
  }
  if (oos && champ.validation_sharpe != null) {
    p2Parts.push(
      `Holdout validation Sharpe ${champ.validation_sharpe}; ` +
        horizonLine(champCode, "out-of-sample", oos),
    );
  }
  const peers = sorted.filter(
    (c) => candidateModelKey(c) !== candidateModelKey(champ),
  );
  const runner = peers[0];
  const p2 =
    p2Parts.length > 0
      ? p2Parts.join(" ")
      : runner
        ? `Next ranked ${runner.model_code ?? "M?"}: Sharpe ${runner.sharpe ?? "—"}, CAGR ${formatPctDecimal(runner.cagr)}.`
        : "";

  const others = peers.slice(0, 3);
  const p3 =
    others.length > 0
      ? `Peers to watch: ${others
          .map(
            (c) =>
              `${c.model_code ?? "M?"} (Sharpe ${c.sharpe ?? "—"}, CAGR ${formatPctDecimal(c.cagr)})`,
          )
          .join("; ")}.`
      : "";

  return [p1, p2, p3, "For research and education only — not investment advice."]
    .filter(Boolean)
    .join("\n\n");
}
