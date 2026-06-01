import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { NextResponse } from "next/server";
import { GEMINI_MAX_OUTPUT_TOKENS, GEMINI_MODEL } from "@/lib/gemini";
import { ASSET_CLASSES } from "@/lib/constants";
import { getUniverseMeta } from "@/lib/universe";
import { analyzeUniverseFilterFallback } from "@/lib/universe-filter-fallback";
import { universeFilterSchema } from "@/lib/universe-filter-schema";

export async function POST(req: Request) {
  const { text } = (await req.json()) as { text: string };

  if (!text?.trim()) {
    return NextResponse.json({ error: "Enter a universe filter" }, { status: 400 });
  }

  const meta = getUniverseMeta();

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    const output = analyzeUniverseFilterFallback(text);
    return NextResponse.json({ ...output, source: "rules" });
  }

  try {
    const { object } = await generateObject({
      model: google(GEMINI_MODEL),
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      schema: universeFilterSchema,
      system: `Quant ETF universe filter assistant. Map the user's natural-language universe request to structured filters.

Available asset_classes (pick 1–5): ${ASSET_CLASSES.join(", ")}

Universe metadata:
- total tickers: ${meta.count}
- asset_class_breakdown: ${JSON.stringify(meta.asset_class_breakdown)}
- category_breakdown: ${JSON.stringify(meta.category_breakdown)}

Category tags include: us_sector (GICS sector SPDRs), us_industry (sub-industry), us_broad, us_factor, us_thematic, treasury, aggregate, credit_ig, credit_hy, inflation, muni, precious, energy, broad, reit, alt_managed_futures, etc.

Rules:
- "no bonds" / "equity only" → exclude bond from asset_classes
- "US tech and healthcare sectors only" → asset_classes=["equity"], categories=["us_sector","us_industry"], tickers=matching sector ETFs (XLK,XLV,VGT,VHT,XBI,IBB,IGV,SMH,etc.)
- Broad requests like "balanced multi-asset" → multiple asset_classes, omit categories/tickers
- categories: only when user narrows by sleeve type (sectors, treasuries, REITs, thematic)
- tickers: optional whitelist when user names specific sectors/industries; must be valid US ETF tickers from the universe
- rationale: one concise English sentence explaining the filter`,
      prompt: `User universe filter request:\n${text.trim()}`,
    });

    return NextResponse.json({ ...object, source: "gemini" });
  } catch {
    const output = analyzeUniverseFilterFallback(text);
    return NextResponse.json({ ...output, source: "rules" });
  }
}
