import { generateText } from "ai";
import { NextResponse } from "next/server";
import { type AiLang, languageDirective, normalizeAiLang } from "@/lib/ai-language";
import { AI_METRIC_FORMAT_RULES, formatAlpha, formatPctDecimal } from "@/lib/ai-metric-format";
import {
  isProviderConfigured,
  KIMI_K3_MODEL_ID,
  providerOptionsFor,
  reasoningModel,
  REASONING_MAX_OUTPUT_TOKENS,
} from "@/lib/ai-provider";

function buildSystem(lang: AiLang): string {
  return `Institutional quant analyst writing for a retail investor. ${languageDirective(lang)}
3-4 short paragraphs in plain language; briefly explain jargon when used.
${AI_METRIC_FORMAT_RULES}
- Compare to benchmark using fields under candidate and benchmark_metrics / benchmark_relative.
- When report_horizons is present, summarize in_sample, out_of_sample, and full_sample (ttl) together; note IS−OOS gaps if holdout enabled.
- Prefer "alpha" (field alpha or benchmark_relative.alpha) over "annual alpha".
- Describe style from params only; do not invent performance.
- Explain why this trial's rank and metrics matter vs benchmark and vs typical trade-offs (risk vs return).
- End: For research and education only — not investment advice.`;
}

type Payload = {
  rank: number;
  model_code?: string;
  objective?: string;
  objective_label?: string;
  benchmark: string;
  period?: { start?: string; end?: string };
  oos_enabled?: boolean;
  report_horizons?: Record<string, unknown>;
  candidate: Record<string, unknown>;
  benchmark_metrics?: Record<string, unknown>;
};

function buildFallback(p: Payload): string {
  const c = p.candidate;
  const rel = (c.benchmark_relative ?? {}) as Record<string, number>;
  const alpha =
    rel.alpha ?? rel.alpha_annual ?? c.alpha ?? c.alpha_annual;
  const rh = p.report_horizons as
    | {
        in_sample?: Record<string, unknown>;
        out_of_sample?: Record<string, unknown> | null;
        full_sample?: Record<string, unknown>;
      }
    | undefined;
  const lines = [
    `Model ${p.model_code ?? `M?`}${p.rank ? ` (rank ${p.rank})` : ""} vs ${p.benchmark}.`,
    `Objective: ${p.objective_label ?? p.objective ?? "n/a"}.`,
    `Selection view: CAGR ${formatPctDecimal(c.cagr)}, Sharpe ${c.sharpe ?? "—"}, max DD ${formatPctDecimal(c.max_drawdown)}.`,
  ];
  if (rh?.full_sample) {
    const full = rh.full_sample;
    lines.push(
      `Full sample: Sharpe ${full.sharpe ?? "—"}, CAGR ${formatPctDecimal(full.cagr)}, max DD ${formatPctDecimal(full.max_drawdown)}.`,
    );
  }
  if (p.oos_enabled && rh?.in_sample) {
    const is = rh.in_sample;
    const oos = rh.out_of_sample;
    lines.push(
      `In-sample: Sharpe ${is.sharpe ?? "—"}; out-of-sample: Sharpe ${oos?.sharpe ?? "—"}.`,
    );
  }
  if (rel.beta != null || alpha != null) {
    lines.push(
      `vs benchmark: Beta ${rel.beta?.toFixed(2) ?? "—"}, alpha ${formatAlpha(alpha)}, IR ${rel.information_ratio?.toFixed(2) ?? "—"}.`,
    );
  }
  const bm = p.benchmark_metrics;
  if (bm && typeof bm.cagr === "number") {
    lines.push(`Benchmark CAGR ${formatPctDecimal(bm.cagr)}, Sharpe ${bm.sharpe ?? "—"}.`);
  }
  lines.push("For research and education only — not investment advice.");
  return lines.join("\n");
}

export async function POST(req: Request) {
  const body = (await req.json()) as Payload & { lang?: string };
  const lang = normalizeAiLang(body.lang);
  const payload = body;

  if (!isProviderConfigured(KIMI_K3_MODEL_ID)) {
    return NextResponse.json({ summary: buildFallback(payload), source: "template" });
  }

  try {
    const { text } = await generateText({
      model: reasoningModel(),
      maxOutputTokens: REASONING_MAX_OUTPUT_TOKENS,
      providerOptions: providerOptionsFor(KIMI_K3_MODEL_ID),
      system: buildSystem(lang),
      prompt: `Summarize model ${payload.model_code ?? `M?`} vs ${payload.benchmark}. Objective: "${payload.objective_label ?? payload.objective ?? "n/a"}". Use model_code in prose. Compare horizons and benchmark honestly.\n${JSON.stringify(payload, null, 2)}`,
    });
    return NextResponse.json({ summary: text.trim(), source: "kimi" });
  } catch {
    return NextResponse.json({ summary: buildFallback(payload), source: "template" });
  }
}
