import { NextResponse } from "next/server";
import { generateTextWithAudit } from "@/lib/llm-audit";
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
import {
  isProviderConfigured,
  KIMI_K3_MODEL_ID,
  providerOptionsFor,
  reasoningModel,
  REASONING_MAX_OUTPUT_TOKENS,
} from "@/lib/ai-provider";

export async function POST(req: Request) {
  const body = (await req.json()) as CompareSummaryPayload & { lang?: string };
  const lang = normalizeAiLang(body.lang);
  const payload = body;

  if (!isProviderConfigured(KIMI_K3_MODEL_ID)) {
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
      llm_log: result.llm_log,
      ...(result.retried_due_to_token_limit
        ? { retried_due_to_token_limit: true }
        : {}),
    });
  } catch (err) {
    const log = (err && typeof err === "object" && "log" in err) ? (err as { log: unknown }).log : undefined;
    const fallback = buildCompareFallback(payload);
    return NextResponse.json({
      summary: fallback,
      recommended_model_code: null,
      source: "template",
      llm_log: log,
    });
  }
}

type CompareSummaryOutcome = {
  summary: string;
  recommended_model_code: string | null;
  source: "kimi" | "gemini" | "template";
  retried_due_to_token_limit?: boolean;
  llm_log?: import("@/lib/llm-audit").LlmAuditEntry;
};

async function generateCompareSummary(
  payload: CompareSummaryPayload,
  lang: AiLang,
): Promise<CompareSummaryOutcome> {
  let retriedDueToTokenLimit = false;
  const slim = slimComparePayload(payload);
  const prompt = buildCompareUserPrompt(slim, lang);
  let lastLog: import("@/lib/llm-audit").LlmAuditEntry | undefined;

  const generateRequest = (attempt: number) => ({
    model: reasoningModel(),
    maxOutputTokens: REASONING_MAX_OUTPUT_TOKENS + attempt * 2048,
    providerOptions: providerOptionsFor(KIMI_K3_MODEL_ID),
    system: buildCompareSystemPrompt(lang),
    prompt,
  });

  for (let attempt = 0; attempt < MAX_COMPARE_ATTEMPTS; attempt++) {
    const { result, log } = await generateTextWithAudit(generateRequest(attempt));
    lastLog = log;
    const { text: draft, finishReason, rawFinishReason } = result;

    const text = draft.trim();
    const parsed = parseCompareSummaryResponse(text, slim.candidates);
    const generationAttempt = {
      text,
      finishReason: finishReason as string | undefined,
      rawFinishReason: rawFinishReason as string | undefined,
    };

    if (
      shouldRetryCompareGeneration(generationAttempt, parsed) &&
      attempt < MAX_COMPARE_ATTEMPTS - 1
    ) {
      if (
        finishReason === "length" ||
        String(rawFinishReason ?? "").toUpperCase().includes("MAX_TOKEN")
      ) {
        retriedDueToTokenLimit = true;
      }
      continue;
    }

    if (isAcceptableCompareSummary(parsed.summary)) {
      return {
        summary: parsed.summary,
        recommended_model_code: parsed.recommended_model_code,
        source: "kimi",
        llm_log: log,
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
    llm_log: lastLog,
    ...(retriedDueToTokenLimit
      ? { retried_due_to_token_limit: true }
      : {}),
  };
}
