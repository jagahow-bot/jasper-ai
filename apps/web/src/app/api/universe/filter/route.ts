import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { NextResponse } from "next/server";
import { GEMINI_MAX_OUTPUT_TOKENS, GEMINI_MODEL } from "@/lib/gemini";
import { ASSET_CLASSES, type AssetClass } from "@/lib/constants";
import { getUniverseMeta } from "@/lib/universe";
import { analyzeUniverseFilterFallback } from "@/lib/universe-filter-fallback";
import {
  buildCombinedFilterPrompt,
  buildPerRuleFilterResults,
  constrainUniverseFilterOutput,
  mergeUniverseFilterOutputs,
} from "@/lib/universe-filter-merge";
import { universeFilterSchema } from "@/lib/universe-filter-schema";

type FilterBody = {
  text?: string;
  texts?: string[];
  asset_classes?: AssetClass[];
};

function parsePrompts(body: FilterBody): string[] {
  const raw =
    body.texts?.length && body.texts.some((t) => t?.trim())
      ? body.texts
      : body.text?.trim()
        ? [body.text]
        : [];
  return raw.map((t) => t.trim()).filter(Boolean);
}

function parseConstrainClasses(body: FilterBody): AssetClass[] {
  const allowed = new Set(ASSET_CLASSES);
  const picked = (body.asset_classes ?? []).filter((c): c is AssetClass =>
    allowed.has(c as AssetClass),
  );
  return picked.length ? picked : [...ASSET_CLASSES];
}

export async function POST(req: Request) {
  const body = (await req.json()) as FilterBody;
  const prompts = parsePrompts(body);
  const constrainClasses = parseConstrainClasses(body);

  if (!prompts.length) {
    return NextResponse.json({ error: "Enter at least one universe filter rule" }, { status: 400 });
  }

  const meta = getUniverseMeta();
  const combinedPrompt = buildCombinedFilterPrompt(prompts, constrainClasses);

  const applyFallback = () => {
    const outputs = prompts.map((p) => analyzeUniverseFilterFallback(p));
    const merged = mergeUniverseFilterOutputs(outputs, constrainClasses);
    const per_rule = buildPerRuleFilterResults(prompts, outputs, constrainClasses);
    return { ...merged, per_rule };
  };

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    const output = applyFallback();
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
- Multiple numbered rules are ANDed: each must narrow or refine the pool; never widen beyond earlier rules.
- User pre-selected asset classes are a hard ceiling: output asset_classes MUST be a subset of [${constrainClasses.join(", ")}].
- "no bonds" / "equity only" → exclude bond from asset_classes (within ceiling)
- "US tech and healthcare sectors only" → asset_classes=["equity"], categories=["us_sector","us_industry"], tickers=matching sector ETFs (XLK,XLV,VGT,VHT,XBI,IBB,IGV,SMH,etc.)
- Broad requests like "balanced multi-asset" → multiple asset_classes within ceiling, omit categories/tickers when not needed
- categories: only when user narrows by sleeve type (sectors, treasuries, REITs, thematic)
- tickers: optional whitelist when user names specific sectors/industries; must be valid US ETF tickers from the universe
- rationale: one concise English sentence explaining the combined filter`,
      prompt: combinedPrompt,
    });

    const output = constrainUniverseFilterOutput(object, constrainClasses);
    const fallbackOutputs = prompts.map((p) => analyzeUniverseFilterFallback(p));
    const per_rule = buildPerRuleFilterResults(
      prompts,
      fallbackOutputs,
      constrainClasses,
    );
    return NextResponse.json({ ...output, per_rule, source: "gemini" });
  } catch {
    const output = applyFallback();
    return NextResponse.json({ ...output, source: "rules" });
  }
}
