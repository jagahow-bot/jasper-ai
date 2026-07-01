import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { NextResponse } from "next/server";
import { type AiLang, normalizeAiLang } from "@/lib/ai-language";
import {
  buildCompareFallback,
  buildCompareSystemPrompt,
  buildCompareUserPrompt,
  isAcceptableCompareSummary,
  MAX_COMPARE_ATTEMPTS,
  parseCompareSummaryResponse,
  resolveFallbackRecommendedCode,
  shouldRetryCompareGeneration,
  slimComparePayload,
  type CompareSummaryPayload,
} from "@/lib/compare-summary";
import { GEMINI_MAX_OUTPUT_TOKENS, GEMINI_MODEL } from "@/lib/gemini";

export async function POST(req: Request) {
  const body = (await req.json()) as CompareSummaryPayload & { lang?: string };
  const lang = normalizeAiLang(body.lang);
  const payload = body;

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    const fallback = buildCompareFallback(payload);
    return NextResponse.json({
      summary: fallback,
      recommended_model_code: null,
      source: "template",
    });
  }

  try {
    const result = await generateCompareSummary(payload, lang);
    return NextResponse.json({
      summary: result.summary,
      recommended_model_code: null,
      source: result.source,
      ...(result.retried_due_to_token_limit
        ? { retried_due_to_token_limit: true }
        : {}),
    });
  } catch {
    const fallback = buildCompareFallback(payload);
    return NextResponse.json({
      summary: fallback,
      recommended_model_code: null,
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
  lang: AiLang,
): Promise<CompareSummaryOutcome> {
  let retriedDueToTokenLimit = false;
  const slim = slimComparePayload(payload);
  const prompt = buildCompareUserPrompt(slim, lang);

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
    system: buildCompareSystemPrompt(lang),
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

  return {
    summary: buildCompareFallback(payload),
    recommended_model_code: resolveFallbackRecommendedCode(payload),
    source: "template",
    ...(retriedDueToTokenLimit
      ? { retried_due_to_token_limit: true }
      : {}),
  };
}
