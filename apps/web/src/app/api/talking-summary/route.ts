import { NextResponse } from "next/server";
import { z } from "zod";
import { type AiLang, languageDirective, normalizeAiLang } from "@/lib/ai-language";
import {
  isProviderConfigured,
  KIMI_K3_MODEL_ID,
  providerOptionsFor,
  reasoningModel,
  REASONING_MAX_OUTPUT_TOKENS,
} from "@/lib/ai-provider";
import { generateObjectWithAudit } from "@/lib/llm-audit";
import {
  buildTalkingPoints,
  type HoldingDiffRow,
  type MetricCompareRow,
  type TalkingPointsInput,
} from "@/lib/rm-report-utils";
import type { BacktestResult } from "@/lib/types";
import type { ClientOverlay } from "@/lib/overlay-schema";

const RequestSchema = z.object({
  lang: z.string().optional(),
  metrics: z.array(z.record(z.string(), z.unknown())),
  holdingsDiff: z.array(z.record(z.string(), z.unknown())).optional(),
  overlay: z.record(z.string(), z.unknown()).nullable().optional(),
  adjustedResult: z.record(z.string(), z.unknown()),
  anchorLabel: z.string(),
  objectiveKey: z.string(),
  customizedModelCode: z.string().optional().nullable(),
  benchmark: z.string().optional(),
});

const ResponseSchema = z.object({
  summary: z.array(z.string()).max(8),
  performance_flag: z
    .enum(["poor", "underperforms_benchmark", "acceptable", "good"])
    .nullable(),
  rerun_recommended: z.boolean(),
  rerun_reason: z.string().nullable().optional(),
});

type ApiResponse = {
  summary: string[];
  performance_flag: string | null;
  rerun_recommended: boolean;
  rerun_reason: string | null;
  source: "kimi" | "template";
  llm_log?: unknown;
};

function buildSystem(lang: AiLang): string {
  return `You are a senior wealth-management communication specialist. ${languageDirective(lang)}
Write for a relationship manager (RM) preparing to explain a customized portfolio to a client. Avoid quant jargon; use plain, client-facing language. Keep model codes and tickers verbatim.

Return STRICT JSON matching the schema. Do not include markdown code fences.`;
}

function buildPrompt(payload: z.infer<typeof RequestSchema>): string {
  const c = payload.adjustedResult as unknown as BacktestResult;
  const candidate = c.candidates?.[0];
  const lines = [
    `Benchmark / anchor: ${payload.benchmark || payload.anchorLabel || "benchmark"}.`,
    `Anchor label: ${payload.anchorLabel}.`,
    `Objective key: ${payload.objectiveKey}.`,
    `Customized model: ${payload.customizedModelCode || candidate?.model_code || "selected"}.`,
    "",
    "Metric comparison (customized vs benchmark):",
    JSON.stringify(payload.metrics, null, 2),
    "",
    "Holdings changes vs anchor:",
    JSON.stringify(payload.holdingsDiff || [], null, 2),
    "",
    "Overlay client context:",
    JSON.stringify(payload.overlay || null, null, 2),
    "",
    "Task: produce 5-7 short bullet points for the RM to use in a client conversation. Cover:",
    "1) Portfolio composition and top holdings in plain language.",
    "2) Key adjustments vs the anchor and why they were made.",
    "3) How the customized portfolio performed vs the benchmark (honest; do not sugarcoat).",
    "4) The risk/return trade-off in client-friendly terms.",
    "",
    "Also evaluate whether the backtest result is worth presenting as-is or should be rerun:",
    "- If customized CAGR is lower than benchmark AND drawdown is not clearly better, set performance_flag='poor' and rerun_recommended=true, explaining why.",
    "- If the customized portfolio is meaningfully worse on the primary objective, set performance_flag='underperforms_benchmark' and rerun_recommended=true.",
    "- Otherwise set performance_flag to 'acceptable' or 'good' and rerun_recommended=false.",
    "",
    "JSON format:",
    '{"summary":["bullet 1",...],"performance_flag":"poor|underperforms_benchmark|acceptable|good","rerun_recommended":true|false,"rerun_reason":"... or null"}',
  ];
  return lines.join("\n");
}

function fallbackSummary(payload: z.infer<typeof RequestSchema>): ApiResponse {
  const t = (key: string, values?: Record<string, unknown>) => {
    let s = key;
    if (values) {
      Object.entries(values).forEach(([k, v]) => {
        s = s.replace(new RegExp(`{${k}}`, "g"), String(v));
      });
    }
    return s;
  };
  const input: TalkingPointsInput = {
    metrics: payload.metrics as MetricCompareRow[],
    holdingsDiff: (payload.holdingsDiff || []) as HoldingDiffRow[],
    overlay: (payload.overlay || null) as ClientOverlay | null,
    adjustedResult: payload.adjustedResult as unknown as BacktestResult,
    anchorLabel: payload.anchorLabel,
    objectiveKey: payload.objectiveKey,
    lang: normalizeAiLang(payload.lang),
    t,
    customizedModelCode: payload.customizedModelCode,
  };
  const summary = buildTalkingPoints(input);
  return {
    summary,
    performance_flag: null,
    rerun_recommended: false,
    rerun_reason: null,
    source: "template",
  };
}

export async function POST(req: Request) {
  const body = (await req.json()) as unknown;
  const parseResult = RequestSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: parseResult.error.issues },
      { status: 400 },
    );
  }
  const payload = parseResult.data;
  const lang = normalizeAiLang(payload.lang);

  if (!isProviderConfigured(KIMI_K3_MODEL_ID)) {
    return NextResponse.json(fallbackSummary(payload));
  }

  try {
    const { result, log } = await generateObjectWithAudit({
      model: reasoningModel(),
      maxOutputTokens: REASONING_MAX_OUTPUT_TOKENS,
      providerOptions: providerOptionsFor(KIMI_K3_MODEL_ID, { jsonMode: true }),
      system: buildSystem(lang),
      prompt: buildPrompt(payload),
      schema: ResponseSchema,
      output: "object",
    });
    const obj = result.object as z.infer<typeof ResponseSchema>;
    return NextResponse.json({
      summary: obj.summary.slice(0, 8),
      performance_flag: obj.performance_flag,
      rerun_recommended: obj.rerun_recommended,
      rerun_reason: obj.rerun_reason ?? null,
      source: "kimi",
      llm_log: log,
    } as ApiResponse);
  } catch (err) {
    const log =
      err && typeof err === "object" && "log" in err
        ? (err as { log: unknown }).log
        : undefined;
    const fallback = fallbackSummary(payload);
    fallback.llm_log = log;
    return NextResponse.json(fallback);
  }
}
