import type { AssetClass } from "./constants";
import { ASSET_CLASSES } from "./constants";
import { filterUniverse, getTickers, getUniverseItems } from "./universe";
import type { UniverseFilterOutput } from "./universe-filter-schema";

export type UniverseFilterRuleResult = {
  rule_index: number;
  rule_text: string;
  asset_classes: AssetClass[];
  categories?: string[];
  tickers: string[];
  rationale?: string;
};

function intersectSets<T>(sets: Set<T>[]): Set<T> {
  if (!sets.length) return new Set();
  let acc = new Set(sets[0]);
  for (let i = 1; i < sets.length; i++) {
    const next = sets[i];
    acc = new Set([...acc].filter((x) => next.has(x)));
  }
  return acc;
}

function intersectOptionalLists<T>(lists: (T[] | undefined)[]): T[] | undefined {
  const defined = lists.filter((x): x is T[] => Boolean(x?.length));
  if (!defined.length) return undefined;
  if (defined.length === 1) return [...defined[0]];
  const sets = defined.map((arr) => new Set(arr));
  return [...intersectSets(sets)];
}

export function intersectAssetClasses(
  fromAi: AssetClass[],
  userSelected: AssetClass[],
): AssetClass[] {
  const userSet = new Set(userSelected);
  const narrowed = fromAi.filter((c) => userSet.has(c));
  return narrowed.length ? narrowed : [...userSelected];
}

export function mergeUniverseFilterOutputs(
  outputs: UniverseFilterOutput[],
  userAssetClasses: AssetClass[],
): UniverseFilterOutput {
  if (!outputs.length) {
    return {
      asset_classes: [...userAssetClasses],
      rationale: "No AI rules applied.",
    };
  }

  const classSets = outputs.map((o) => new Set(o.asset_classes));
  let asset_classes = [...intersectSets(classSets)] as AssetClass[];
  asset_classes = intersectAssetClasses(asset_classes, userAssetClasses);

  const categories = intersectOptionalLists(outputs.map((o) => o.categories));
  let tickers = intersectOptionalLists(outputs.map((o) => o.tickers));

  if (tickers?.length) {
    const pool = filterUniverse(getUniverseItems(), {
      assetClasses: asset_classes,
      categories,
    });
    const allowed = new Set(pool.map((u) => u.ticker.toUpperCase()));
    tickers = tickers.filter((t) => allowed.has(t.toUpperCase()));
    if (!tickers.length) tickers = undefined;
  }

  const rationale =
    outputs.length === 1
      ? outputs[0].rationale
      : `Applied ${outputs.length} stacked rules within ${userAssetClasses.join(", ")}.`;

  return { asset_classes, categories, tickers, rationale };
}

export function constrainUniverseFilterOutput(
  output: UniverseFilterOutput,
  userAssetClasses: AssetClass[],
): UniverseFilterOutput {
  return mergeUniverseFilterOutputs([output], userAssetClasses);
}

export function buildCombinedFilterPrompt(
  prompts: string[],
  userAssetClasses: AssetClass[],
): string {
  const lines = prompts.map((p, i) => `${i + 1}. ${p.trim()}`).join("\n");
  return [
    "Stacked universe filter rules (apply ALL; each rule narrows the pool):",
    lines,
    "",
    `User-selected asset class ceiling (output asset_classes must be a subset of): ${userAssetClasses.join(", ")}`,
    `Valid asset_classes: ${ASSET_CLASSES.join(", ")}`,
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

export function buildPerRuleFilterResults(
  prompts: string[],
  outputs: UniverseFilterOutput[],
  userAssetClasses: AssetClass[],
): UniverseFilterRuleResult[] {
  return prompts.map((rule_text, rule_index) => {
    const constrained = constrainUniverseFilterOutput(
      outputs[rule_index] ?? outputs[outputs.length - 1],
      userAssetClasses,
    );
    const tickers = getTickers({
      assetClasses: constrained.asset_classes,
      categories: constrained.categories,
      tickers: constrained.tickers,
    });
    return {
      rule_index,
      rule_text,
      asset_classes: constrained.asset_classes,
      categories: constrained.categories,
      tickers,
      rationale: constrained.rationale,
    };
  });
}
