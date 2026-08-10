import { NextResponse } from "next/server";
import {
  DEFAULT_FLASH_MODEL_ID,
  defaultFlashModel,
  FLASH_MAX_OUTPUT_TOKENS,
  isProviderConfigured,
  providerOptionsFor,
} from "@/lib/ai-provider";
import { languageDirective } from "@/lib/ai-language";
import {
  parseGoalPathInsightsFromModel,
  type GoalPathInsightSeed,
} from "@/lib/financial-goal-insights";
import { generateTextWithAudit } from "@/lib/llm-audit";
import { parseReportLanguage, type Lang } from "@/lib/universe-filter-locale";

type Body = {
  report_language?: string;
  summary?: unknown;
  insight_seeds?: GoalPathInsightSeed[];
  client?: {
    client_id?: string;
    display_name?: string;
    risk_profile?: string;
  };
};

function buildPrompt(
  lang: Lang,
  summaryJson: string,
  seeds: GoalPathInsightSeed[],
  client?: Body["client"],
): string {
  const ids = seeds.map((s) => s.id).join(", ");
  const clientBlock = client
    ? `Client: id=${client.client_id ?? "—"}, name=${client.display_name ?? "—"}, risk=${client.risk_profile ?? "—"}.`
    : "Client: unknown.";

  return `You are advising a private-bank relationship manager from a financial-goal wealth-path projection.
${languageDirective(lang)}
${clientBlock}

The projection summary JSON below is ground truth. Do NOT invent amounts or dates.
Rule-selected insight ids you MUST cover (and only these): ${ids}.

For each id, write RM-facing insight copy that:
1) States the issue/opportunity clearly using the provided numbers.
2) Suggests what portfolio customization should solve next (hooks already listed per seed).

Return ONLY JSON:
{
  "insights": [
    {
      "id": "one of: ${ids}",
      "title": "short headline",
      "detail": "2-3 sentences with concrete numbers from the summary",
      "talking_point": "one sentence RM can say to the client",
      "customization_hooks": ["liquidity_buffer"|"horizon"|"contribution"|"deployment"|"min_drawdown"|"risk"|"return"|"refine_risk"]
    }
  ]
}

Projection summary:
"""
${summaryJson}
"""`;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const seeds = Array.isArray(body.insight_seeds) ? body.insight_seeds : [];
  if (seeds.length === 0) {
    return NextResponse.json(
      { error: "no_seeds", message: "insight_seeds required" },
      { status: 400 },
    );
  }
  if (body.summary == null) {
    return NextResponse.json(
      { error: "no_summary", message: "summary required" },
      { status: 400 },
    );
  }

  const lang = parseReportLanguage(body.report_language) ?? "en";
  const summaryJson = JSON.stringify(body.summary);

  if (!isProviderConfigured(DEFAULT_FLASH_MODEL_ID)) {
    return NextResponse.json(
      {
        error: "ai_unavailable",
        message: "AI provider is not configured.",
      },
      { status: 503 },
    );
  }

  try {
    const { result, log } = await generateTextWithAudit({
      model: defaultFlashModel(),
      maxOutputTokens: FLASH_MAX_OUTPUT_TOKENS,
      temperature: 0.3,
      providerOptions: providerOptionsFor(DEFAULT_FLASH_MODEL_ID, {
        jsonMode: true,
      }),
      prompt: buildPrompt(lang, summaryJson, seeds, body.client),
    });

    try {
      const insights = parseGoalPathInsightsFromModel(result.text, seeds);
      return NextResponse.json({
        insights,
        source: "gemini",
        llm_log: log,
      });
    } catch (parseError) {
      console.warn("[goals/insights] parse failed", parseError);
      return NextResponse.json(
        {
          error: "parse_failed",
          message: "AI response could not be parsed. Please retry.",
        },
        { status: 502 },
      );
    }
  } catch (error) {
    console.warn("[goals/insights] AI failed", error);
    return NextResponse.json(
      {
        error: "ai_failed",
        message: "AI request failed. Please retry.",
      },
      { status: 502 },
    );
  }
}
