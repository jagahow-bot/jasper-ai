import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { NextResponse } from "next/server";
import { GEMINI_MAX_OUTPUT_TOKENS, GEMINI_MODEL } from "@/lib/gemini";
import { analyzeScenarioFallback } from "@/lib/scenario-fallback";
import {
  scenarioAnalyzeSchema,
  toScenarioCard,
} from "@/lib/scenario-schema";

export async function POST(req: Request) {
  const { text } = (await req.json()) as { text: string };

  if (!text?.trim()) {
    return NextResponse.json({ error: "Enter a market view" }, { status: 400 });
  }

  const customId = `custom-${Date.now()}`;

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    const output = analyzeScenarioFallback(text);
    return NextResponse.json({
      scenario: toScenarioCard(output, customId),
      source: "rules",
    });
  }

  try {
    const { object } = await generateObject({
      model: google(GEMINI_MODEL),
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      schema: scenarioAnalyzeSchema,
      system: `Senior quant strategist. From the user's macro view, output a structured scenario in English.
Rules:
- Short English title (e.g. "Custom: sticky inflation")
- narrative_points: 2-4 actionable bullets aligned with the view
- max_weight 0.05–0.15; defensive/low vol lower, risk-on slightly higher
- clear risk-off/recession → objective min_max_drawdown; clear risk-on → max_sharpe
- suggested_asset_classes: pick 1–5 from equity,bond,commodity,real_estate,alternative
- dates fixed start_date=2018-01-01, end_date=2024-12-31, backtest_mode=static`,
      prompt: `User market view:\n${text.trim()}`,
    });

    return NextResponse.json({
      scenario: toScenarioCard(object, customId),
      source: "gemini",
    });
  } catch {
    const output = analyzeScenarioFallback(text);
    return NextResponse.json({
      scenario: toScenarioCard(output, customId),
      source: "rules",
    });
  }
}
