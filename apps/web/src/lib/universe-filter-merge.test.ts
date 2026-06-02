import assert from "node:assert/strict";
import {
  buildCombinedFilterPrompt,
  buildPerRuleSupplementResults,
  buildSingleRulePrompt,
  getBasePoolTickers,
  mergeSupplementTickers,
  pinGuaranteedSupplementTickers,
  resolveRuleTickersFullUniverse,
  resolveUniverseFilterPrompts,
  tickersAddedBeyondBase,
} from "./universe-filter-merge";
import { analyzeUniverseFilterFallback } from "./universe-filter-fallback";
import { countUniverse, combinedUniverseFromRequest } from "./universe";

function run() {
  const baseEquityBond = ["equity", "bond"] as const;
  const baseTickers = getBasePoolTickers([...baseEquityBond]);
  assert.ok(baseTickers.length > 0);

  const shortOut = analyzeUniverseFilterFallback("SHORT STOCK MARKET");
  const shortTickers = resolveRuleTickersFullUniverse(shortOut);
  assert.ok(shortTickers.length > 0);
  assert.ok(shortTickers.length < 50, "short market rule should not match whole universe");

  const aiOut = analyzeUniverseFilterFallback("AI INDUSTRY");
  const aiTickers = resolveRuleTickersFullUniverse(aiOut);
  assert.ok(aiTickers.length > 0);
  assert.ok(aiTickers.length < 100);

  const merged = mergeSupplementTickers([shortOut, aiOut]);
  assert.ok(merged.supplement_tickers.length > 0);

  const perRule = buildPerRuleSupplementResults(
    ["SHORT STOCK MARKET", "AI INDUSTRY"],
    [shortOut, aiOut],
    [...baseEquityBond],
  );
  assert.equal(perRule.length, 2);
  assert.ok(perRule[0].matched_tickers.length < 50);
  assert.ok(
    perRule[0].added_tickers.length <= perRule[0].matched_tickers.length,
  );

  const combined = countUniverse(
    combinedUniverseFromRequest({
      asset_classes: [...baseEquityBond],
      universe_supplement_tickers: merged.supplement_tickers,
    }),
  );
  assert.ok(
    combined >= baseTickers.length,
    "combined pool must be base ∪ supplements, not intersection",
  );

  const added = tickersAddedBeyondBase(shortTickers, baseTickers);
  assert.ok(added.every((t) => !baseTickers.map((b) => b.toUpperCase()).includes(t.toUpperCase())));

  assert.deepEqual(
    resolveUniverseFilterPrompts({
      universe_filter_text: "legacy",
      universe_filter_prompts: ["a"],
    }),
    ["legacy", "a"],
  );

  assert.ok(buildSingleRulePrompt("rule 1", ["equity"]).includes("FULL universe"));
  assert.ok(buildCombinedFilterPrompt(["rule 1"], ["equity"]).includes("Supplementary"));

  const refined = ["SPY", "AGG"];
  const pinned = pinGuaranteedSupplementTickers(refined, ["GLD", "SPY"]);
  assert.deepEqual(pinned, ["SPY", "AGG", "GLD"]);

  console.log("universe-filter-merge: ok");
}

run();
