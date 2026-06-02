import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { NextResponse } from "next/server";
import { GEMINI_MAX_OUTPUT_TOKENS, GEMINI_MODEL } from "@/lib/gemini";
import { ASSET_CLASSES, type AssetClass } from "@/lib/constants";
import { getUniverseMeta } from "@/lib/universe";
import { analyzeUniverseFilterFallback } from "@/lib/universe-filter-fallback";
import {
  buildPerRuleSupplementResults,
  buildSingleRulePrompt,
  mergeSupplementTickers,
} from "@/lib/universe-filter-merge";
import { universeFilterSchema } from "@/lib/universe-filter-schema";

type FilterBody = {
  text?: string;
  texts?: string[];
  asset_classes?: AssetClass[];
  search_full_universe?: boolean;
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

function parseUserAssetClasses(body: FilterBody): AssetClass[] {
  const allowed = new Set(ASSET_CLASSES);
  const picked = (body.asset_classes ?? []).filter((c): c is AssetClass =>
    allowed.has(c as AssetClass),
  );
  return picked.length ? picked : [...ASSET_CLASSES];
}

const supplementSystem = (meta: ReturnType<typeof getUniverseMeta>, userClasses: AssetClass[]) =>
  `Quant ETF universe supplement assistant. For each rule, find ETFs in the FULL universe that match the user's description.

Universe metadata:
- total tickers: ${meta.count}
- asset_class_breakdown: ${JSON.stringify(meta.asset_class_breakdown)}
- category_breakdown: ${JSON.stringify(meta.category_breakdown)}

User base pool (asset classes — do NOT remove or replace): ${userClasses.join(", ")}

Rules:
- Search ALL ${meta.count} ETFs; ignore the user's asset-class selection as a search ceiling.
- Return a focused "tickers" list of valid US ETF symbols that match the rule (required when possible).
- Use "categories" only to support ticker selection; never return only broad asset_classes without tickers.
- asset_classes in output are optional context only — they do NOT constrain which tickers you may include.
- For bear/short equity themes, prefer inverse, hedged, managed-futures, or low-beta alts (e.g. BTAL, PUTW, CTA, DBMF) — not the entire equity sleeve.
- For sector/thematic rules, list specific sector ETFs (XLK, SMH, etc.), not every equity fund.
- rationale: one concise English sentence for this rule's supplement intent`;

async function analyzeRuleWithGemini(
  ruleText: string,
  userClasses: AssetClass[],
  meta: ReturnType<typeof getUniverseMeta>,
) {
  const { object } = await generateObject({
    model: google(GEMINI_MODEL),
    maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
    schema: universeFilterSchema,
    system: supplementSystem(meta, userClasses),
    prompt: buildSingleRulePrompt(ruleText, userClasses),
  });
  return object;
}

export async function POST(req: Request) {
  const body = (await req.json()) as FilterBody;
  const prompts = parsePrompts(body);
  const userClasses = parseUserAssetClasses(body);

  if (!prompts.length) {
    return NextResponse.json({ error: "Enter at least one universe filter rule" }, { status: 400 });
  }

  const meta = getUniverseMeta();

  const runFallback = () => {
    const outputs = prompts.map((p) => analyzeUniverseFilterFallback(p));
    const { supplement_tickers, rationale } = mergeSupplementTickers(outputs);
    const per_rule = buildPerRuleSupplementResults(prompts, outputs, userClasses);
    return {
      asset_classes: userClasses,
      supplement_tickers,
      rationale,
      per_rule,
    };
  };

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    const output = runFallback();
    return NextResponse.json({ ...output, source: "rules" });
  }

  try {
    const outputs = await Promise.all(
      prompts.map((p) => analyzeRuleWithGemini(p, userClasses, meta)),
    );
    const { supplement_tickers, rationale } = mergeSupplementTickers(outputs);
    const per_rule = buildPerRuleSupplementResults(prompts, outputs, userClasses);
    return NextResponse.json({
      asset_classes: userClasses,
      supplement_tickers,
      rationale,
      per_rule,
      source: "gemini",
    });
  } catch {
    const output = runFallback();
    return NextResponse.json({ ...output, source: "rules" });
  }
}
