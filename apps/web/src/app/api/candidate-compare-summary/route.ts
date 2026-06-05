import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { NextResponse } from "next/server";
import { AI_METRIC_FORMAT_RULES } from "@/lib/ai-metric-format";
import {
  buildCompareFallback,
  isAcceptableCompareSummary,
  MAX_COMPARE_ATTEMPTS,
  parseCompareSummaryResponse,
  shouldRetryCompareGeneration,
  slimComparePayload,
  type CompareSummaryPayload,
} from "@/lib/compare-summary";
import { GEMINI_MAX_OUTPUT_TOKENS, GEMINI_MODEL } from "@/lib/gemini";

const SYSTEM = `Institutional quant analyst. English only.
${AI_METRIC_FORMAT_RULES}
- When horizons.in_sample / out_of_sample / full_sample are present, compare all three (ttl = full_sample) for risk and overfitting — not in-sample alone.
- Root sharpe/cagr are selection-view metrics; use horizons.full_sample for full-period performance.
- candidates are in Optuna trial order (M0001 = first trial); rank is objective score, not list order.
- champion_model_code (if present) is the Pro in-sample selection (★), separate from your AI recommendation.
- Do not call any model a "designated Pro champion"; use neutral phrasing. Put your pick in recommended_model_code.
- Return ONLY valid JSON (no markdown): {"recommended_model_code":"Mxxxx","summary":"2-3 paragraphs of prose, no bullets or metric dumps"}
- recommended_model_code MUST be one of the candidate model_code values in the payload.
No invented numbers.`;

export async function POST(req: Request) {
  const payload = (await req.json()) as CompareSummaryPayload;
  const slim = slimComparePayload(payload);

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    const fallback = buildCompareFallback(slim);
    return NextResponse.json({
      summary: fallback,
      recommended_model_code: slim.champion_model_code ?? null,
      source: "template",
    });
  }

  try {
    const result = await generateCompareSummary(payload);
    return NextResponse.json({
      summary: result.summary,
      recommended_model_code: result.recommended_model_code,
      source: result.source,
      ...(result.retried_due_to_token_limit
        ? { retried_due_to_token_limit: true }
        : {}),
    });
  } catch {
    const fallback = buildCompareFallback(slim);
    return NextResponse.json({
      summary: fallback,
      recommended_model_code: slim.champion_model_code ?? null,
      source: "template",
    });
  }
}

type CompareSummaryOutcome = {
  summary: string;
  recommended_model_code: string | null;
  source: "gemini" | "template";
  retried_due_to_token_limit?: boolean;
};

async function generateCompareSummary(
  payload: CompareSummaryPayload,
): Promise<CompareSummaryOutcome> {
  let retriedDueToTokenLimit = false;
  const slim = slimComparePayload(payload);
  const prompt =
    `Compare vs ${slim.benchmark}. Objective: "${slim.objective_label ?? slim.objective ?? "n/a"}". ` +
    `${slim.candidate_count_total ?? slim.candidates.length} trials in Optuna order. ` +
    `Pro in-sample ★ (reference only): ${slim.champion_model_code ?? "none"}. ` +
    `Fields are decimal fractions for rates — format as % inside summary per rules.\n${JSON.stringify(slim)}`;

  const generateRequest = {
    model: google(GEMINI_MODEL),
    maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
    providerOptions: {
      google: {
        thinkingConfig: {
          thinkingLevel: "minimal" as const,
        },
      },
    },
    system: SYSTEM,
    prompt,
  };

  for (let attempt = 0; attempt < MAX_COMPARE_ATTEMPTS; attempt++) {
    const { text: draft, finishReason, rawFinishReason } =
      await generateText(generateRequest);

    const text = draft.trim();
    const parsed = parseCompareSummaryResponse(text, slim.candidates);
    const generationAttempt = { text, finishReason, rawFinishReason };

    if (
      shouldRetryCompareGeneration(generationAttempt, parsed) &&
      attempt < MAX_COMPARE_ATTEMPTS - 1
    ) {
      if (
        finishReason === "length" ||
        (rawFinishReason ?? "").toUpperCase().includes("MAX_TOKEN")
      ) {
        retriedDueToTokenLimit = true;
      }
      continue;
    }

    if (isAcceptableCompareSummary(parsed.summary)) {
      return {
        summary: parsed.summary,
        recommended_model_code: parsed.recommended_model_code,
        source: "gemini",
        ...(retriedDueToTokenLimit
          ? { retried_due_to_token_limit: true }
          : {}),
      };
    }
  }

  const fallbackSlim = slimComparePayload(payload);
  return {
    summary: buildCompareFallback(fallbackSlim),
    recommended_model_code: fallbackSlim.champion_model_code ?? null,
    source: "template",
    ...(retriedDueToTokenLimit
      ? { retried_due_to_token_limit: true }
      : {}),
  };
}
