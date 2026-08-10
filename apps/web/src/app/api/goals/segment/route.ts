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
  normalizeGoal,
  projectionHorizonMonths,
  type FinancialGoal,
} from "@/lib/financial-goal";
import {
  buildRuleBasedSegmentation,
  parseGoalSegmentationFromModel,
  RULE_MID_END_MONTHS,
  RULE_SHORT_END_MONTHS,
  type GoalSegmentation,
  type GoalSegmentStrategy,
} from "@/lib/financial-goal-segments";
import { generateTextWithAudit } from "@/lib/llm-audit";
import { parseReportLanguage, type Lang } from "@/lib/universe-filter-locale";

type Body = {
  goals?: unknown;
  horizon_months?: number;
  strategies?: unknown;
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

function sanitizeGoals(raw: unknown): FinancialGoal[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((g) => (g && typeof g === "object" ? (g as FinancialGoal) : null))
    .filter((g): g is FinancialGoal => g != null)
    .filter((g) => Number.isFinite(g.amountUsd) && g.amountUsd > 0)
    .map((g) => normalizeGoal(g))
    .slice(0, 8);
}

function sanitizeStrategies(raw: unknown): GoalSegmentStrategy[] {
  if (!Array.isArray(raw)) return [];
  const out: GoalSegmentStrategy[] = [];
  for (const item of raw.slice(0, 24)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const modelCode =
      typeof o.model_code === "string" && o.model_code.trim()
        ? o.model_code.trim()
        : null;
    const num = (k: string): number | null => {
      const v = o[k];
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    };
    out.push({
      modelCode,
      label:
        (typeof o.label === "string" && o.label.trim()) || modelCode || "Holdings",
      cagr: num("cagr"),
      volatility: num("volatility"),
      maxDrawdown: num("max_drawdown"),
      sharpe: num("sharpe"),
      isRecommended: o.is_recommended === true,
    });
  }
  return out;
}

function pct(v: number | null | undefined): string {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}

function buildPrompt(
  goals: FinancialGoal[],
  strategies: GoalSegmentStrategy[],
  horizonMonths: number,
  lang: Lang,
  client?: Body["client"],
): string {
  const goalLines = goals
    .map(
      (g, i) =>
        `${i + 1}. "${g.label}" type=${g.type}, amount_usd=${Math.round(g.amountUsd)}, due_month=${g.withinMonths}, priority=${g.priority}/5`,
    )
    .join("\n");
  const strategyLines = [
    `- HOLDINGS = client's current portfolio (keep as-is; the baseline backtest).`,
    ...strategies
      .filter((s) => s.modelCode != null)
      .map(
        (s) =>
          `- ${s.modelCode} (${s.label}): CAGR ${pct(s.cagr)}, vol ${pct(s.volatility)}, maxDD ${pct(s.maxDrawdown)}, Sharpe ${s.sharpe?.toFixed(2) ?? "—"}${s.isRecommended ? " [RECOMMENDED]" : ""}`,
      ),
  ].join("\n");
  const clientBlock = client
    ? `Client: age=${client.age ?? "—"}, gender=${client.gender ?? "—"}, risk=${client.risk_profile ?? "—"}, AUM_USD=${client.aum_usd ?? "—"}.`
    : "Client: unknown.";

  return `You are helping a private-bank relationship manager turn financial goals into a segmented investment glide path.
${languageDirective(lang)}
${clientBlock}

Goals (due month = months from today):
${goalLines}

Available strategies (one per segment; HOLDINGS allowed):
${strategyLines}

Task: split the next 1..${horizonMonths} months into up to 3 period segments (short / mid / long) and assign ONE strategy per segment, so each goal is funded by a strategy that fits its timing and priority.

Rules:
- Segments must be contiguous and cover months 1..${horizonMonths} exactly.
- A typical split is short ≤ ${RULE_SHORT_END_MONTHS}m, mid ≤ ${RULE_MID_END_MONTHS}m, long beyond — adjust boundaries to the actual goal dates when that is cleaner.
- Near-term / high-priority goals (home down payment, liquidity) → defensive: low volatility / drawdown.
- Distant goals (retirement, legacy) → higher-growth strategies are acceptable.
- model_code must be one of the listed codes or "HOLDINGS".
- Give a one-sentence rationale per segment referencing the goals it covers.
- Do NOT invent products, tickers, or return numbers.

Return ONLY JSON:
{
  "segments": [
    {
      "label": "short|mid|long",
      "start_month": number,
      "end_month": number,
      "model_code": "HOLDINGS|<code>",
      "rationale": "one sentence"
    }
  ],
  "rationale": "one short paragraph on the overall split"
}`;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const goals = sanitizeGoals(body.goals);
  if (!goals.length) {
    return NextResponse.json(
      { error: "no_goals", message: "At least one structured goal is required." },
      { status: 400 },
    );
  }

  const strategies = sanitizeStrategies(body.strategies);
  const horizonMonths = Math.min(
    600,
    Math.max(
      1,
      Math.round(
        Number.isFinite(body.horizon_months)
          ? Number(body.horizon_months)
          : projectionHorizonMonths(goals),
      ),
    ),
  );
  const lang = parseReportLanguage(body.report_language) ?? "en";
  const allowFallback = process.env.GOAL_SEGMENT_ALLOW_RULES_FALLBACK !== "0";

  const rulesFallback = () =>
    buildRuleBasedSegmentation({ goals, strategies, horizonMonths, lang });

  const respond = (segmentation: GoalSegmentation, source: "gemini" | "rules") =>
    NextResponse.json({ segmentation, source });

  if (!isProviderConfigured(DEFAULT_FLASH_MODEL_ID)) {
    if (!allowFallback) {
      return NextResponse.json({ error: "ai_unavailable" }, { status: 503 });
    }
    return respond(rulesFallback(), "rules");
  }

  try {
    const { result, log } = await generateTextWithAudit({
      model: defaultFlashModel(),
      maxOutputTokens: FLASH_MAX_OUTPUT_TOKENS,
      temperature: 0.2,
      providerOptions: providerOptionsFor(DEFAULT_FLASH_MODEL_ID, {
        jsonMode: true,
      }),
      prompt: buildPrompt(goals, strategies, horizonMonths, lang, body.client),
    });

    try {
      const segmentation = parseGoalSegmentationFromModel(result.text, {
        goals,
        strategies,
        horizonMonths,
      });
      return NextResponse.json({ segmentation, source: "gemini", llm_log: log });
    } catch (parseError) {
      console.warn("[goals/segment] parse failed; rules fallback", parseError);
      if (!allowFallback) {
        return NextResponse.json({ error: "parse_failed" }, { status: 502 });
      }
      return respond(rulesFallback(), "rules");
    }
  } catch (error) {
    console.warn("[goals/segment] AI failed; rules fallback", error);
    if (!allowFallback) {
      return NextResponse.json({ error: "ai_failed" }, { status: 502 });
    }
    return respond(rulesFallback(), "rules");
  }
}
