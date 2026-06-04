import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { NextResponse } from "next/server";
import { AI_METRIC_FORMAT_RULES } from "@/lib/ai-metric-format";
import {
  buildCompareFallback,
  isAcceptableCompareSummary,
  parseCompareSummaryResponse,
  slimComparePayload,
  type CompareSummaryPayload,
} from "@/lib/compare-summary";
import { GEMINI_MAX_OUTPUT_TOKENS, GEMINI_MODEL } from "@/lib/gemini";

const SYSTEM = `Institutional quant analyst. English only.
${AI_METRIC_FORMAT_RULES}
- When horizons.in_sample / out_of_sample / full_sample are present, compare all three (ttl = full_sample) for risk and overfitting — not in-sample alone.
- Root sharpe/cagr are selection-view metrics; use horizons.full_sample for full-period performance.
- Name models by model_code. champion_model_code (★) is the Pro selection champion; you may recommend a different model_code if holdout/full-sample evidence is stronger.
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
    const { summary, recommended_model_code } = await generateCompareSummary(slim);
    return NextResponse.json({
      summary,
      recommended_model_code,
      source: "gemini",
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

async function generateCompareSummary(
  slim: CompareSummaryPayload,
): Promise<{ summary: string; recommended_model_code: string | null }> {
  let text = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const retryNote =
      attempt === 0
        ? ""
        : "\nPrior reply was invalid. Return ONLY JSON with recommended_model_code and summary (2-3 prose paragraphs inside summary).";
    const { text: draft } = await generateText({
      model: google(GEMINI_MODEL),
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      providerOptions: {
        google: {
          thinkingConfig: {
            thinkingLevel: "minimal",
          },
        },
      },
      system: SYSTEM,
      prompt:
        `Compare vs ${slim.benchmark}. Objective: "${slim.objective_label ?? slim.objective ?? "n/a"}". ` +
        `Pro champion (★): ${slim.champion_model_code ?? "n/a"}. ` +
        `Fields are decimal fractions for rates — format as % inside summary per rules.` +
        `${retryNote}\n${JSON.stringify(slim)}`,
    });
    text = draft.trim();
    const parsed = parseCompareSummaryResponse(text, slim.candidates);
    if (isAcceptableCompareSummary(parsed.summary)) {
      return {
        summary: parsed.summary,
        recommended_model_code: parsed.recommended_model_code,
      };
    }
  }
  const fallback = buildCompareFallback(slim);
  return {
    summary: fallback,
    recommended_model_code: slim.champion_model_code ?? null,
  };
}
