import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { NextResponse } from "next/server";
import { AI_METRIC_FORMAT_RULES } from "@/lib/ai-metric-format";
import { GEMINI_MAX_OUTPUT_TOKENS, GEMINI_MODEL } from "@/lib/gemini";

type HorizonSnap = {
  sharpe?: number;
  cagr?: number;
  max_drawdown?: number;
  objective_value?: number;
};

type CandidateLite = {
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
  horizons?: {
    in_sample?: HorizonSnap;
    out_of_sample?: HorizonSnap | null;
    full_sample?: HorizonSnap;
    gap?: { sharpe?: number | null; objective?: number | null } | null;
  };
};

type Payload = {
  benchmark: string;
  objective?: string;
  objective_label?: string;
  candidates: CandidateLite[];
};

function buildFallback(payload: Payload): string {
  const top = [...payload.candidates].sort((a, b) => (b.sharpe ?? -999) - (a.sharpe ?? -999))[0];
  if (!top) return "No models to compare.";
  const topCode = top.model_code ?? `M?`;
  return [
    `${payload.candidates.length} models; highest Sharpe: ${topCode}.`,
    `Objective: ${payload.objective_label ?? payload.objective ?? "n/a"}.`,
    `Compare ${topCode} on CAGR, max DD, turnover vs ${payload.benchmark} risk.`,
    "For research and education only — not investment advice.",
  ].join("\n");
}

export async function POST(req: Request) {
  const payload = (await req.json()) as Payload;
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return NextResponse.json({ summary: buildFallback(payload), source: "template" });
  }

  try {
    const { text } = await generateText({
      model: google(GEMINI_MODEL),
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      system: `Institutional quant analyst. English, 2-3 paragraphs. Compare models; champion by model_code using objective.
${AI_METRIC_FORMAT_RULES}
- When horizons.in_sample / out_of_sample / full_sample are present, compare all three (ttl = full_sample) for risk and overfitting — not in-sample alone.
- Root sharpe/cagr are selection-view metrics; use horizons.full_sample for full-period performance.
No invented numbers.`,
      prompt: `Compare vs ${payload.benchmark}. Objective: "${payload.objective_label ?? payload.objective ?? "n/a"}". Use model_code. Fields are decimal fractions for rates — format as % per rules.\n${JSON.stringify(payload, null, 2)}`,
    });
    return NextResponse.json({ summary: text.trim(), source: "gemini" });
  } catch {
    return NextResponse.json({ summary: buildFallback(payload), source: "template" });
  }
}
