import type { AssetClass } from "./constants";
import {
  detectDirectIndexing,
  filterTickersForDirectIndex,
  pickDirectIndexStocks,
} from "./direct-indexing";
import { getTickers, getUniverseItems } from "./universe";
import type { UniverseFilterOutput } from "./universe-filter-schema";
import {
  localizedMergeRationale,
  localizedNoRulesRationale,
  type Lang,
} from "./universe-filter-locale";

export type UniverseFilterRuleResult = {
  rule_index: number;
  rule_text: string;
  /** All tickers matching this rule in the full universe */
  matched_tickers: string[];
  /** Tickers this rule adds beyond the user's asset-class base pool */
  added_tickers: string[];
  categories?: string[];
  rationale?: string;
};

export type UniverseSupplementMerge = {
  supplement_tickers: string[];
  rationale: string;
};

function uniqueTickers(lists: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const t of list) {
      const key = t.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

/** Resolve rule output to tickers searched across the full ETF universe (no asset-class ceiling). */
export function resolveRuleTickersFullUniverse(
  output: UniverseFilterOutput,
): string[] {
  const universeSet = new Set(getUniverseItems().map((u) => u.ticker.toUpperCase()));

  if (output.tickers?.length) {
    const fromList = output.tickers.filter((t) => universeSet.has(t.toUpperCase()));
    if (fromList.length) return fromList;
  }

  if (output.categories?.length) {
    return getTickers({ categories: output.categories });
  }

  if (output.asset_classes?.length) {
    return getTickers({ assetClasses: output.asset_classes });
  }

  return [];
}

/**
 * Strict resolution: only keep AI-suggested tickers that are also named as
 * symbols in the rule text. Never expand categories / asset classes.
 */
export function resolveRuleTickersStrictExplicit(
  output: UniverseFilterOutput,
  ruleText: string,
): string[] {
  const named = new Set(
    // Lazy import avoided — callers should prefer locked-universe extract;
    // here we only intersect output.tickers with tokens in ruleText.
    (ruleText.match(/\b[A-Za-z][A-Za-z0-9]{0,4}\b/g) ?? []).map((t) =>
      t.toUpperCase(),
    ),
  );
  if (!output.tickers?.length) return [];
  const universeSet = new Set(getUniverseItems().map((u) => u.ticker.toUpperCase()));
  return output.tickers
    .map((t) => t.toUpperCase())
    .filter((t) => named.has(t) && universeSet.has(t));
}

export function getBasePoolTickers(userAssetClasses: AssetClass[]): string[] {
  return getTickers({ assetClasses: userAssetClasses });
}

export function tickersAddedBeyondBase(
  matched: string[],
  baseTickers: string[],
): string[] {
  const base = new Set(baseTickers.map((t) => t.toUpperCase()));
  return matched.filter((t) => !base.has(t.toUpperCase()));
}

/** Re-union pinned supplement tickers after a refine/dedupe step drops them. */
export function pinGuaranteedSupplementTickers(
  refinedTickers: string[],
  guaranteedSupplements: string[],
): string[] {
  if (!guaranteedSupplements.length) return refinedTickers;
  const seen = new Set(refinedTickers.map((t) => t.toUpperCase()));
  const out = [...refinedTickers];
  for (const t of guaranteedSupplements) {
    const key = t.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export function mergeSupplementTickers(
  outputs: UniverseFilterOutput[],
  lang: Lang = "en",
  opts?: { strictExplicitOnly?: boolean; prompts?: string[] },
): UniverseSupplementMerge {
  if (!outputs.length) {
    return { supplement_tickers: [], rationale: localizedNoRulesRationale(lang) };
  }

  const perRule = outputs.map((o, i) => {
    if (opts?.strictExplicitOnly) {
      const ruleText = opts.prompts?.[i] ?? "";
      return resolveRuleTickersStrictExplicit(o, ruleText);
    }
    return resolveRuleTickersFullUniverse(o);
  });
  const supplement_tickers = uniqueTickers(perRule);
  const haystack = (opts?.prompts ?? []).join("\n");
  const rewritten =
    !opts?.strictExplicitOnly && detectDirectIndexing(haystack)
      ? uniqueTickers([
          [filterTickersForDirectIndex(supplement_tickers)],
          [pickDirectIndexStocks(haystack)],
        ].flat())
      : supplement_tickers;

  const rationale =
    outputs.length === 1
      ? outputs[0].rationale
      : localizedMergeRationale(lang, outputs.length, rewritten.length);

  return { supplement_tickers: rewritten, rationale };
}

export function buildPerRuleSupplementResults(
  prompts: string[],
  outputs: UniverseFilterOutput[],
  userAssetClasses: AssetClass[],
): UniverseFilterRuleResult[] {
  const baseTickers = getBasePoolTickers(userAssetClasses);

  return prompts.map((rule_text, rule_index) => {
    const output = outputs[rule_index] ?? outputs[outputs.length - 1];
    const matched_tickers = resolveRuleTickersFullUniverse(output);
    const added_tickers = tickersAddedBeyondBase(matched_tickers, baseTickers);
    return {
      rule_index,
      rule_text,
      matched_tickers,
      added_tickers,
      categories: output.categories,
      rationale: output.rationale,
    };
  });
}

export function buildSingleRulePrompt(ruleText: string, userAssetClasses: AssetClass[]): string {
  const diHint = /direct[\s-]*index|直接索引|直接指數|직접\s*인덱싱|다이렉트\s*인덱싱|직접지수/i.test(
    ruleText,
  )
    ? "This rule is DIRECT INDEXING: return individual STOCK tickers (NVDA, MSFT, …), not thematic ETFs (AIQ, BOTZ, IRBO)."
    : "Return tickers that match the rule even if they fall outside those classes (漏網之魚).";
  return [
    "Supplementary universe rule — find instruments in the FULL universe that match this description.",
    `Rule: ${ruleText.trim()}`,
    "",
    `Context: user already has a base pool from asset classes [${userAssetClasses.join(", ")}].`,
    diHint,
    "Prefer a focused ticker list over broad asset_class-only filters.",
  ].join("\n");
}

export function buildCombinedFilterPrompt(
  prompts: string[],
  userAssetClasses: AssetClass[],
): string {
  const lines = prompts.map((p, i) => `${i + 1}. ${p.trim()}`).join("\n");
  return [
    "Supplementary universe rules (each rule is evaluated separately; results are unioned):",
    lines,
    "",
    `Context: user base pool from asset classes: ${userAssetClasses.join(", ")}.`,
    "Search the FULL ETF universe for each rule; do not restrict to those classes.",
  ].join("\n");
}

export function resolveUniverseFilterPrompts(req: {
  universe_filter_prompts?: string[] | null;
  universe_filter_text?: string | null;
}): string[] {
  const fromList = (req.universe_filter_prompts ?? [])
    .map((p) => p.trim())
    .filter(Boolean);
  const legacy = req.universe_filter_text?.trim();
  if (!fromList.length) return legacy ? [legacy] : [];
  if (!legacy) return fromList;
  const joined = fromList.join("; ");
  if (legacy === joined) return fromList;
  if (fromList.includes(legacy)) return fromList;
  return [legacy, ...fromList];
}
