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
  enrichGoalExtractWithClientContext,
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
    age?: number;
    gender?: "male" | "female" | null;
    display_name?: string;
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
  const age =
    typeof client?.age === "number" && Number.isFinite(client.age)
      ? String(client.age)
      : "—";
  const gender = client?.gender ?? "—";
  const clientBlock = client
    ? `Client context: id=${client.client_id ?? "—"}, age_years=${age}, gender=${gender}, display_name=${client.display_name ?? "—"}, AUM_USD=${client.aum_usd ?? "—"}, cash_USD=${client.cash_usd ?? "—"}, risk=${client.risk_profile ?? "—"}, as_of=${client.as_of_date ?? "—"}.`
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
      "priority": 1-5,
      "retirement_spend_years": number,
      "mortgage": {
        "loan_usd": number,
        "annual_rate": fraction,
        "term_months": number
      }
    }
  ],
  "assumptions": {
    "annual_return": fraction (0.05 = 5%),
    "optimistic_delta": fraction,
    "conservative_delta": fraction,
    "annual_contribution_usd": number,
    "contribution_growth": fraction,
    "annual_living_spend_usd": number,
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
- Retirement timing: when notes say retire at / after age N (e.g. 60) AND client age_years is known, set within_months = max(1, round((N - age_years) * 12)). Do NOT ask for current age if age_years is provided.
- For retirement goals: amount_usd is ANNUAL living spend (not a lump sum).
- retirement_spend_years: set from planning life expectancy minus retirement age. Use male=78, female=85, unknown/unisex=82 (illustrative). Example: male retire at 60 → 18 years. Prefer client gender; else infer from notes/name (Mr/Ms). Do NOT ask how many years to fund if this can be computed.
- For home goals: amount_usd is the down payment / cash at purchase (not full price).
- If mortgage / loan / LTV is mentioned for a home goal, fill mortgage.loan_usd, annual_rate, term_months (years×12).
- If annual savings / contribution is mentioned, put it in annual_contribution_usd. That is working-years saving only; the simulator stops contributions at retirement start — say so in rationale when both contribution and a retirement goal are present.
- annual_living_spend_usd: leave at 0 by default (working lifestyle is paid from salary, not drawn from AUM). Only set a positive value if notes explicitly say current living expenses are withdrawn from the portfolio before retirement. Do NOT copy retirement annual spend into this field.
- Ask clarification_questions only for fields still missing after using client context.
- Do NOT recommend products or tickers.

RM notes:
"""
${notes}
"""`;
}

function finalizeExtract(
  extract: GoalExtractResult,
  notes: string,
  lang: Lang,
  client?: Body["client"],
): GoalExtractResult {
  return enrichGoalExtractWithClientContext(extract, notes, client, lang);
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
    NextResponse.json({
      extract: finalizeExtract(extract, notes, lang, body.client),
      source,
    });

  if (!isProviderConfigured(DEFAULT_FLASH_MODEL_ID)) {
    if (!allowFallback) {
      return NextResponse.json(
        { error: "ai_unavailable" },
        { status: 503 },
      );
    }
    return respond(extractGoalsRulesFallback(notes, lang, body.client), "rules");
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
      return NextResponse.json({
        extract: finalizeExtract(extract, notes, lang, body.client),
        source: "gemini",
        llm_log: log,
      });
    } catch (parseError) {
      console.warn("[goals/extract] parse failed; rules fallback", parseError);
      if (!allowFallback) {
        return NextResponse.json({ error: "parse_failed" }, { status: 502 });
      }
      return respond(extractGoalsRulesFallback(notes, lang, body.client), "rules");
    }
  } catch (error) {
    console.warn("[goals/extract] AI failed; rules fallback", error);
    if (!allowFallback) {
      return NextResponse.json({ error: "ai_failed" }, { status: 502 });
    }
    return respond(extractGoalsRulesFallback(notes, lang, body.client), "rules");
  }
}
