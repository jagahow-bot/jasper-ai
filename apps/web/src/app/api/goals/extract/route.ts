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
  extractGoalsRulesFallback,
  parseGoalExtractFromModel,
  type GoalExtractResult,
} from "@/lib/financial-goal-extract";
import { generateTextWithAudit } from "@/lib/llm-audit";
import { parseReportLanguage, type Lang } from "@/lib/universe-filter-locale";

type Body = {
  notes?: string;
  report_language?: string;
  client?: {
    client_id?: string;
    aum_usd?: number;
    cash_usd?: number;
    risk_profile?: string;
    as_of_date?: string;
  };
};

function buildPrompt(
  notes: string,
  lang: Lang,
  client?: Body["client"],
): string {
  const clientBlock = client
    ? `Client context: id=${client.client_id ?? "—"}, AUM_USD=${client.aum_usd ?? "—"}, cash_USD=${client.cash_usd ?? "—"}, risk=${client.risk_profile ?? "—"}, as_of=${client.as_of_date ?? "—"}.`
    : "Client context: unknown.";

  return `You are helping a private-bank relationship manager structure a financial-goal plan.
${languageDirective(lang)}
${clientBlock}

From the RM notes below, extract:
1) Up to 8 future financial goals (home, retirement, education, liquidity, other).
2) Planning assumptions the RM stated or clearly implied.

Return ONLY JSON:
{
  "goals": [
    {
      "type": "home|retirement|education|liquidity|other",
      "label": "short name",
      "amount_usd": number,
      "within_months": number,
      "priority": 1-5
    }
  ],
  "assumptions": {
    "annual_return": fraction (0.05 = 5%),
    "optimistic_delta": fraction,
    "conservative_delta": fraction,
    "annual_contribution_usd": number,
    "contribution_growth": fraction,
    "inflation": fraction
  },
  "clarification_questions": ["..."],
  "confidence": 0-1,
  "rationale": "one short paragraph"
}

Rules:
- Prefer explicit numbers from the notes; do not invent large goals without evidence.
- If return is given as percent (e.g. 5%), convert to fraction 0.05.
- within_months: convert years to months when needed; clamp 1–360.
- If annual savings / contribution is mentioned, put it in annual_contribution_usd.
- Ask clarification_questions for missing critical fields (amount, timing, return).
- Do NOT recommend products or tickers.

RM notes:
"""
${notes}
"""`;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const notes = body.notes?.trim() ?? "";
  if (notes.length < 8) {
    return NextResponse.json(
      { error: "notes_too_short", message: "Provide longer RM notes." },
      { status: 400 },
    );
  }

  const lang = parseReportLanguage(body.report_language) ?? "en";
  const allowFallback =
    process.env.GOAL_EXTRACT_ALLOW_RULES_FALLBACK !== "0";

  const respond = (extract: GoalExtractResult, source: "gemini" | "rules") =>
    NextResponse.json({ extract, source });

  if (!isProviderConfigured(DEFAULT_FLASH_MODEL_ID)) {
    if (!allowFallback) {
      return NextResponse.json(
        { error: "ai_unavailable" },
        { status: 503 },
      );
    }
    return respond(extractGoalsRulesFallback(notes, lang), "rules");
  }

  try {
    const { result, log } = await generateTextWithAudit({
      model: defaultFlashModel(),
      maxOutputTokens: FLASH_MAX_OUTPUT_TOKENS,
      temperature: 0.2,
      providerOptions: providerOptionsFor(DEFAULT_FLASH_MODEL_ID, {
        jsonMode: true,
      }),
      prompt: buildPrompt(notes, lang, body.client),
    });

    try {
      const extract = parseGoalExtractFromModel(result.text);
      return NextResponse.json({ extract, source: "gemini", llm_log: log });
    } catch (parseError) {
      console.warn("[goals/extract] parse failed; rules fallback", parseError);
      if (!allowFallback) {
        return NextResponse.json({ error: "parse_failed" }, { status: 502 });
      }
      return respond(extractGoalsRulesFallback(notes, lang), "rules");
    }
  } catch (error) {
    console.warn("[goals/extract] AI failed; rules fallback", error);
    if (!allowFallback) {
      return NextResponse.json({ error: "ai_failed" }, { status: 502 });
    }
    return respond(extractGoalsRulesFallback(notes, lang), "rules");
  }
}
