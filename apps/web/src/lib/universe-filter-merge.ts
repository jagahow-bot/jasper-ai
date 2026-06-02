import type { AssetClass } from "./constants";
import { getTickers, getUniverseItems } from "./universe";
import type { UniverseFilterOutput } from "./universe-filter-schema";

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

export function mergeSupplementTickers(
  outputs: UniverseFilterOutput[],
): UniverseSupplementMerge {
  if (!outputs.length) {
    return { supplement_tickers: [], rationale: "No AI supplement rules applied." };
  }

  const perRule = outputs.map((o) => resolveRuleTickersFullUniverse(o));
  const supplement_tickers = uniqueTickers(perRule);

  const rationale =
    outputs.length === 1
      ? outputs[0].rationale
      : `Supplement: ${outputs.length} rules matched ${supplement_tickers.length} ETF(s) in the full universe (union).`;

  return { supplement_tickers, rationale };
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
  return [
    "Supplementary universe rule — find ETFs in the FULL universe that match this description.",
    `Rule: ${ruleText.trim()}`,
    "",
    `Context: user already has a base pool from asset classes [${userAssetClasses.join(", ")}].`,
    "Return tickers that match the rule even if they fall outside those classes (漏網之魚).",
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
