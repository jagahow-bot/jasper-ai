import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { NextResponse } from "next/server";
import { AI_METRIC_FORMAT_RULES } from "@/lib/ai-metric-format";
import {
  buildCompareFallback,
  isAcceptableCompareSummary,
  slimComparePayload,
  type CompareSummaryPayload,
} from "@/lib/compare-summary";
import { GEMINI_MAX_OUTPUT_TOKENS, GEMINI_MODEL } from "@/lib/gemini";

const SYSTEM = `Institutional quant analyst. English, 2-3 paragraphs of prose only.
${AI_METRIC_FORMAT_RULES}
- When horizons.in_sample / out_of_sample / full_sample are present, compare all three (ttl = full_sample) for risk and overfitting — not in-sample alone.
- Root sharpe/cagr are selection-view metrics; use horizons.full_sample for full-period performance.
- Name models by model_code. The Pro champion is champion_model_code (★), not necessarily rank 1.
- Do NOT output bullet lists, line-by-line metric dumps, or per-model field inventories.
No invented numbers.`;

export async function POST(req: Request) {
  const payload = (await req.json()) as CompareSummaryPayload;
  const slim = slimComparePayload(payload);

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return NextResponse.json({
      summary: buildCompareFallback(slim),
      source: "template",
    });
  }

  try {
    const summary = await generateCompareSummary(slim);
    return NextResponse.json({ summary, source: "gemini" });
  } catch {
    return NextResponse.json({
      summary: buildCompareFallback(slim),
      source: "template",
    });
  }
}

async function generateCompareSummary(slim: CompareSummaryPayload): Promise<string> {
  let text = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const retryNote =
      attempt === 0
        ? ""
        : "\nPrior reply was a metric list or too short. Write 2-3 English paragraphs only; no bullets or M00xx field dumps.";
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
        `Use model_code. Fields are decimal fractions for rates — format as % per rules.` +
        `${retryNote}\n${JSON.stringify(slim)}`,
    });
    text = draft.trim();
    if (isAcceptableCompareSummary(text)) return text;
  }
  return buildCompareFallback(slim);
}
