import { type AiLang, languageDirective } from "./ai-language";
import { compareModelCode } from "./align-y-axis-zero";
import { AI_METRIC_FORMAT_RULES, formatPctDecimal } from "./ai-metric-format";
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

export type CompareBenchmarkMetrics = {
  sharpe?: number | null;
  sortino?: number | null;
  cagr?: number | null;
  max_drawdown?: number | null;
};

export type CompareSummaryPayload = {
  benchmark: string;
  objective?: string;
  objective_label?: string;
  /** Benchmark metrics (decimal fractions for rates) for honest vs-benchmark framing. */
  benchmark_metrics?: CompareBenchmarkMetrics | null;
  /** Pre-computed: every trial underperformed the benchmark on the objective metric. */
  all_candidates_below_benchmark?: boolean;
  /** Single champion authority (AI round-champion chain → final ai_champion_model_code). */
  champion_model_code?: string | null;
  /** AI-selected champion code; the single source of truth for the ★. */
  ai_champion_model_code?: string | null;
  /** The AI's own reason for selecting the champion (★) during the Pro rounds. */
  champion_rationale?: string | null;
  /** AI-selected champion (★) in slim payload; same as champion_model_code when set. */
  pro_in_sample_champion?: string | null;
  /** When set (e.g. from Gemini compare), overrides ★ for UI alignment. */
  ai_recommended_model_code?: string | null;
  /** Full-period / catalog champion (★ in compare narrative); not the Pro round IS pick. */
  catalog_champion_model_code?: string | null;
  candidates: CompareCandidateLite[];
  candidate_count_total?: number;
};

export type CompareSummaryResult = {
  summary: string;
  recommended_model_code: string | null;
};

export type BenchmarkComparisonMetric = "sharpe" | "cagr" | "max_drawdown";

/** Which metric decides "beat the benchmark" for a given ranking objective. */
export function benchmarkComparisonMetric(
  objective?: string,
): BenchmarkComparisonMetric {
  const o = (objective ?? "").toLowerCase();
  if (o.includes("drawdown") || o.includes("mdd")) return "max_drawdown";
  if (o.includes("return") || o.includes("cagr")) return "cagr";
  return "sharpe";
}

function candidateFullSampleMetric(
  c: CompareCandidateLite,
  metric: BenchmarkComparisonMetric,
): number | undefined {
  const full = c.horizons?.full_sample?.[metric];
  const root = c[metric];
  const v = typeof full === "number" ? full : root;
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** A trial beats the benchmark when its full-period objective metric is better. */
export function candidateBeatsBenchmark(
  c: CompareCandidateLite,
  bm: CompareBenchmarkMetrics,
  metric: BenchmarkComparisonMetric,
): boolean {
  const cv = candidateFullSampleMetric(c, metric);
  const bv = bm[metric];
  if (cv == null || bv == null || !Number.isFinite(bv)) return false;
  // Smaller drawdown magnitude is better; higher is better for sharpe/cagr.
  if (metric === "max_drawdown") return Math.abs(cv) < Math.abs(bv);
  return cv > bv;
}

/**
 * True only when benchmark metrics are present, every trial has a comparable
 * full-period metric, and none of them beat the benchmark on the objective.
 * Conservative by design so the honest "underperformed" framing is trustworthy.
 */
export function computeAllCandidatesBelowBenchmark(
  payload: Pick<
    CompareSummaryPayload,
    "benchmark_metrics" | "objective" | "candidates"
  >,
): boolean {
  const bm = payload.benchmark_metrics;
  const candidates = payload.candidates ?? [];
  if (!bm || candidates.length === 0) return false;
  const metric = benchmarkComparisonMetric(payload.objective);
  if (bm[metric] == null || !Number.isFinite(bm[metric] as number)) return false;
  const allComparable = candidates.every(
    (c) => candidateFullSampleMetric(c, metric) != null,
  );
  if (!allComparable) return false;
  return candidates.every((c) => !candidateBeatsBenchmark(c, bm, metric));
}

export type CompareGenerationAttempt = {
  text: string;
  finishReason?: string;
  rawFinishReason?: string;
};

/** One retry max (2 Gemini calls total) for candidate compare summary. */
export const MAX_COMPARE_RETRIES = 1;
export const MAX_COMPARE_ATTEMPTS = 1 + MAX_COMPARE_RETRIES;

/** Stable key for compare-summary fetch; excludes model dropdown selection. */
export function buildCompareEffectKey(
  resultSelectionEpoch: string,
  benchTicker: string,
  objective: string,
): string {
  return `${resultSelectionEpoch}\0${benchTicker}\0${objective}`;
}

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
    horizons,
  };
}

/** Sort candidates by catalog model code (M0001, M0002, …). */
export function sortCandidatesByModelCode(
  candidates: CompareCandidateLite[],
): CompareCandidateLite[] {
  return [...candidates].sort((a, b) =>
    compareModelCode(
      candidateModelKey(a) || `M?${a.rank ?? 0}`,
      candidateModelKey(b) || `M?${b.rank ?? 0}`,
    ),
  );
}

/** Sort candidates by objective rank (best = rank 1 first). */
export function sortCandidatesByRank(
  candidates: CompareCandidateLite[],
): CompareCandidateLite[] {
  return [...candidates].sort((a, b) => {
    const ra = a.rank ?? Number.MAX_SAFE_INTEGER;
    const rb = b.rank ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return compareModelCode(
      candidateModelKey(a) || `M?${ra}`,
      candidateModelKey(b) || `M?${rb}`,
    );
  });
}

export function buildCompareSystemPrompt(lang: AiLang = "en"): string {
  return `Institutional quant analyst. ${languageDirective(lang)}
${AI_METRIC_FORMAT_RULES}
- When horizons.in_sample / out_of_sample / full_sample are present, compare all three (ttl = full_sample) for risk and overfitting — not in-sample alone.
- Root sharpe/cagr are selection-view metrics; use horizons.full_sample for full-period performance.
- candidates are sorted by objective rank (best first); rank is the score order, not catalog model number.
- catalog_champion_model_code (if present) is the full-period champion (★) — the same model the UI stars on horizons.full_sample. Reference it as the champion; do NOT substitute the Pro round in-sample winner.
- pro_in_sample_champion (if present) is the AI's Pro-round in-sample pick only — context for how rounds evolved, NOT the ★. Round IS winner ≠ final full-period champion.
- champion_rationale (if present) explains why the AI selected the Pro-round IS champion. Reconcile those IS/OOS numbers with horizons.full_sample; the catalog champion (★) is chosen on full-period performance.
- Structure: (1) cross-trial overview naming specific model_code values, (2) catalog champion (★) trade-offs vs rank-1 and at least one runner-up on full_sample, (3) IS/OOS/full-sample and overfitting read, (4) benchmark honesty or iteration guidance when relevant.
- Write narrative comparison prose only; do NOT select or recommend a different champion model than catalog_champion_model_code.
- benchmark_metrics (if present) are the benchmark's own Sharpe/CAGR/max drawdown (decimal fractions) — use them for an honest vs-benchmark read.
- If all_candidates_below_benchmark is true, be objective and candid: state plainly in the opening that NONE of the trials beat the benchmark on the objective over this window and that the run underperformed the benchmark — do NOT spin it as a success. Then note the user can keep iterating on THIS run (adjust factors, constraints, universe, or objective and re-run) rather than starting over, and briefly suggest what to try.
- Open with a balanced cross-trial overview; mention catalog_champion_model_code (full-period ★) when relevant, and never contradict it.
- Return ONLY valid JSON (no markdown): {"summary":"3-4 paragraphs of prose, no bullets or metric dumps"}
No invented numbers.`;
}

export function buildCompareUserPrompt(
  slim: CompareSummaryPayload,
  lang: AiLang = "en",
): string {
  const catalogRef = slim.catalog_champion_model_code ?? slim.champion_model_code;
  const catalogNote =
    catalogRef && catalogRef !== "none"
      ? `Full-period catalog champion ★ (reference only, do not open with this): ${catalogRef}.`
      : "";
  const proRef = slim.pro_in_sample_champion;
  const proNote =
    proRef && proRef !== "none" && proRef !== catalogRef
      ? `Pro-round in-sample AI pick (context only, not ★): ${proRef}.`
      : "";
  const rationaleNote = slim.champion_rationale?.trim()
    ? `Pro-round rationale (why AI selected ${proRef ?? "the round champion"} on IS — not the catalog ★): ${slim.champion_rationale.trim()}`
    : "";
  const benchmarkNote = slim.all_candidates_below_benchmark
    ? `HONEST FRAMING: every trial underperformed ${slim.benchmark} on the objective this run — open by saying so plainly (do not overstate), then tell the user they can keep iterating from this run (tweak factors/constraints/universe/objective and re-run) instead of starting over.`
    : "";
  return (
    `Compare vs ${slim.benchmark}. Objective: "${slim.objective_label ?? slim.objective ?? "n/a"}". ` +
    `${slim.candidate_count_total ?? slim.candidates.length} trials by objective rank. ` +
    `Narrative comparison only — the full-period catalog champion (★) was already chosen; explain that choice with trade-offs vs rank-1 and at least one runner-up on horizons.full_sample (cite model_code), do not re-pick. ` +
    `${catalogNote} ${proNote} ${rationaleNote} ${benchmarkNote} ` +
    `${languageDirective(lang)} ` +
    `Fields are decimal fractions for rates — format as % inside summary per rules.\n${JSON.stringify(slim)}`
  );
}

/** Recommended model when Gemini is unavailable (AI pick > Pro ★ > rank 1). */
export function resolveFallbackRecommendedCode(
  payload: CompareSummaryPayload,
): string | null {
  const sorted = sortCandidatesByRank(payload.candidates);
  const pick = resolveCompareChampion(
    sorted,
    payload.ai_champion_model_code ?? payload.champion_model_code,
    payload.ai_recommended_model_code,
  );
  const code = pick ? candidateModelKey(pick) : null;
  return code && !code.startsWith("M?") ? code : null;
}

/** AI recommendation for compare (AI pick > explicit code > is_champion > first trial). */
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
  const sorted = sortCandidatesByRank(payload.candidates);
  const aiRoundChampion =
    payload.ai_champion_model_code?.trim().toUpperCase() ||
    payload.champion_model_code?.trim().toUpperCase() ||
    null;
  const catalogChampion =
    payload.catalog_champion_model_code?.trim().toUpperCase() ||
    aiRoundChampion;
  const rationale = payload.champion_rationale?.trim();
  const allBelowBenchmark =
    payload.all_candidates_below_benchmark ??
    computeAllCandidatesBelowBenchmark(payload);
  return {
    benchmark: payload.benchmark,
    objective: payload.objective,
    objective_label: payload.objective_label,
    benchmark_metrics: payload.benchmark_metrics ?? null,
    all_candidates_below_benchmark: allBelowBenchmark,
    champion_model_code: catalogChampion,
    ai_champion_model_code: catalogChampion,
    catalog_champion_model_code: catalogChampion,
    champion_rationale: rationale ? rationale.slice(0, 600) : null,
    pro_in_sample_champion: aiRoundChampion,
    candidate_count_total: sorted.length,
    candidates: sorted
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
  const sorted = sortCandidatesByModelCode(payload.candidates);
  if (!sorted.length) return "No models to compare.";
  const obj = payload.objective_label ?? payload.objective ?? "n/a";
  const total = payload.candidate_count_total ?? sorted.length;
  const proStar = sorted.find((c) => c.is_champion === true);
  const catalogCode =
    payload.catalog_champion_model_code?.trim().toUpperCase() ??
    payload.ai_champion_model_code?.trim().toUpperCase() ??
    payload.champion_model_code?.trim().toUpperCase() ??
    (proStar ? candidateModelKey(proStar) : null);
  const focus = resolveCompareChampion(
    sorted,
    catalogCode,
    payload.ai_recommended_model_code,
  ) ?? sorted[0];
  const focusCode = focus.model_code ?? "M?";

  const belowBenchmark =
    payload.all_candidates_below_benchmark ??
    computeAllCandidatesBelowBenchmark(payload);
  const honestNote = belowBenchmark
    ? `Objective read: none of the ${total} trials beat ${payload.benchmark} on the ${obj} objective over this window — the run underperformed the benchmark. You can keep iterating from this run (adjust factors, constraints, universe, or objective and re-run) rather than starting over.`
    : "";

  const p1 = [
    `Across ${total} Optuna trials vs ${payload.benchmark} (${obj}), models are listed by catalog number (M0001, M0002, …).`,
    `${focusCode} — CAGR ${formatPctDecimal(focus.cagr)}, Sharpe ${focus.sharpe ?? "—"}, ` +
      `max drawdown ${formatPctDecimal(focus.max_drawdown)}, turnover ${formatPctDecimal(focus.turnover_avg)}.`,
  ].join(" ");

  const full = focus.horizons?.full_sample;
  const oos = focus.horizons?.out_of_sample;
  const p2Parts: string[] = [];
  if (full) {
    p2Parts.push(horizonLine(focusCode, "full sample", full));
  }
  if (oos && focus.validation_sharpe != null) {
    p2Parts.push(
      `Holdout validation Sharpe ${focus.validation_sharpe}; ` +
        horizonLine(focusCode, "out-of-sample", oos),
    );
  }
  const proRoundCode = payload.pro_in_sample_champion?.trim().toUpperCase()
    ?? payload.ai_champion_model_code?.trim().toUpperCase();
  if (proRoundCode && proRoundCode !== candidateModelKey(focus)) {
    const pro = sorted.find((c) => candidateModelKey(c) === proRoundCode);
    if (pro) {
      p2Parts.push(
        `Pro-round in-sample AI pick was ${proRoundCode} (objective rank ${pro.rank ?? "—"}); catalog full-period champion (★) is ${candidateModelKey(focus)}.`,
      );
    }
  }
  const rationale = payload.champion_rationale?.trim();
  if (rationale) {
    p2Parts.push(`Pro-round IS rationale: ${rationale}`);
  }
  const peers = sorted.filter(
    (c) => candidateModelKey(c) !== candidateModelKey(focus),
  );
  const runner = peers[0];
  const p2 =
    p2Parts.length > 0
      ? p2Parts.join(" ")
      : runner
        ? `Next trial ${runner.model_code ?? "M?"}: Sharpe ${runner.sharpe ?? "—"}, CAGR ${formatPctDecimal(runner.cagr)}.`
        : "";

  const others = peers.slice(0, 3);
  const p3 =
    others.length > 0
      ? `Other trials: ${others
          .map(
            (c) =>
              `${c.model_code ?? "M?"} (Sharpe ${c.sharpe ?? "—"}, CAGR ${formatPctDecimal(c.cagr)})`,
          )
          .join("; ")}.`
      : "";

  return [honestNote, p1, p2, p3, "For research and education only — not investment advice."]
    .filter(Boolean)
    .join("\n\n");
}
