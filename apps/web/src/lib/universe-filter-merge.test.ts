import assert from "node:assert/strict";
import {
  buildCombinedFilterPrompt,
  constrainUniverseFilterOutput,
  intersectAssetClasses,
  mergeUniverseFilterOutputs,
  resolveUniverseFilterPrompts,
} from "./universe-filter-merge";
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

  assert.ok(buildCombinedFilterPrompt(["rule 1"], ["equity"]).includes("rule 1"));
  console.log("universe-filter-merge: ok");
}

run();
