import assert from "node:assert/strict";
import {
  buildCombinedFilterPrompt,
  buildPerRuleFilterResults,
  constrainUniverseFilterOutput,
  intersectAssetClasses,
  mergeUniverseFilterOutputs,
  resolveUniverseFilterPrompts,
} from "./universe-filter-merge";
import { analyzeUniverseFilterFallback } from "./universe-filter-fallback";
import type { UniverseFilterOutput } from "./universe-filter-schema";

function run() {
  assert.deepEqual(
    intersectAssetClasses(["equity", "bond", "commodity"], ["equity", "bond"]),
    ["equity", "bond"],
  );
  assert.deepEqual(
    intersectAssetClasses(["commodity"], ["equity", "bond"]),
    ["equity", "bond"],
  );

  const a: UniverseFilterOutput = {
    asset_classes: ["equity"],
    categories: ["us_sector"],
    tickers: ["XLK", "XLV"],
    rationale: "a",
  };
  const b: UniverseFilterOutput = {
    asset_classes: ["equity"],
    categories: ["us_sector", "us_industry"],
    tickers: ["XLK"],
    rationale: "b",
  };
  const merged = mergeUniverseFilterOutputs([a, b], ["equity", "bond"]);
  assert.deepEqual(merged.asset_classes, ["equity"]);
  assert.deepEqual(merged.categories, ["us_sector"]);
  assert.deepEqual(merged.tickers, ["XLK"]);

  const constrained = constrainUniverseFilterOutput(
    {
      asset_classes: ["equity", "bond", "commodity"],
      rationale: "wide",
    },
    ["equity"],
  );
  assert.deepEqual(constrained.asset_classes, ["equity"]);

  assert.deepEqual(
    resolveUniverseFilterPrompts({
      universe_filter_text: "legacy",
      universe_filter_prompts: ["a"],
    }),
    ["legacy", "a"],
  );

  assert.deepEqual(
    resolveUniverseFilterPrompts({
      universe_filter_text: "rule a; rule b",
      universe_filter_prompts: ["rule a", "rule b"],
    }),
    ["rule a", "rule b"],
  );

  assert.deepEqual(
    resolveUniverseFilterPrompts({
      universe_filter_text: "only legacy",
    }),
    ["only legacy"],
  );

  const techOut = analyzeUniverseFilterFallback("US technology sector only");
  const perRule = buildPerRuleFilterResults(
    ["US technology sector only"],
    [techOut],
    ["equity", "bond"],
  );
  assert.equal(perRule.length, 1);
  assert.equal(perRule[0].rule_text, "US technology sector only");
  assert.ok(perRule[0].tickers.includes("XLK"));

  assert.ok(buildCombinedFilterPrompt(["rule 1"], ["equity"]).includes("rule 1"));
  console.log("universe-filter-merge: ok");
}

run();
