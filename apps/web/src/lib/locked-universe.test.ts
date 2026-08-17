import assert from "node:assert/strict";
import {
  buildLockedCustomUniverse,
  extractExplicitTickersFromTexts,
  isLockedModelUniverse,
  maxWeightForLockedUniverse,
  resolveStrictLockedAdds,
  uniqueTickers,
} from "./locked-universe";
import { overlayToBacktestRequest, type ClientOverlay } from "./overlay-schema";
import { combinedUniverseFromRequest, countUniverse } from "./universe";
import type { BacktestRequest } from "./types";

function baseAnchorRequest(): BacktestRequest {
  return {
    scenario_id: "anchor-classic-60-40",
    start_date: "2018-01-01",
    end_date: "2024-12-31",
    asset_classes: ["equity", "bond"],
    max_weight: 0.4,
    objective: "max_sharpe",
    trials: 5,
    top_models: 1,
    max_holdings: 2,
    universe_tickers: ["IVV", "AGG"],
    universe_supplement_tickers: ["IVV", "AGG"],
    static_replay_holdings: { IVV: 0.6, AGG: 0.4 },
    optimization_mode: "standard",
    regime_adaptive: false,
    enable_oos: true,
    train_ratio: 0.7,
    fee_bps: 10,
    rebalance_freq: "QE",
    enforce_class_weights: true,
  };
}

function minimalOverlay(
  partial: Partial<ClientOverlay["universe"]> & {
    supplement_tickers?: string[];
    exclude_tickers?: string[];
  },
): ClientOverlay {
  return {
    version: "1.0",
    audit: {
      session_id: "ovl-test-session-01",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      phase: "execute",
      conversation_turns: 1,
      source: "manual",
      rm_sign_off: {
        signed_at: "2026-01-01T00:00:00.000Z",
        rm_id: "rm-1",
      },
    },
    client_profile: {},
    market_view: {
      stance: "neutral",
      themes: [],
      narrative_summary: "Neutral stance for test overlay mapping.",
    },
    allocation: {
      asset_classes: ["equity", "bond"],
      max_single_position_pct: 0.4,
    },
    universe: {
      prompts: partial.prompts ?? [],
      supplement_tickers: partial.supplement_tickers,
      exclude_tickers: partial.exclude_tickers,
      construction: partial.construction,
    },
    optimization: {
      objective: "max_sharpe",
      trials: 25,
    },
    confidence: 0.9,
    rationale: "Test overlay for locked model-portfolio universe.",
  };
}

function run() {
  assert.deepEqual(uniqueTickers(["spy", "SPY", " agg ", ""]), ["SPY", "AGG"]);
  assert.equal(isLockedModelUniverse(baseAnchorRequest()), true);
  assert.equal(
    isLockedModelUniverse({
      universe_tickers: null,
      static_replay_holdings: null,
    }),
    false,
  );

  const locked = buildLockedCustomUniverse(baseAnchorRequest(), {
    addTickers: ["GLD", "IVV"],
    excludeTickers: ["AGG"],
  });
  assert.deepEqual(locked, ["IVV", "GLD"]);

  assert.equal(maxWeightForLockedUniverse(2, 0.25), 1);
  assert.equal(maxWeightForLockedUniverse(4, 0.4), 0.4);
  // AI-suggested 10% with 10 names must not stay at equal-weight-only 10%.
  assert.equal(maxWeightForLockedUniverse(10, 0.1), 0.2);
  assert.ok(maxWeightForLockedUniverse(10, 0.08) >= 0.2);

  // Thematic NL must NOT invent ARKW/ACWI/etc. — only named symbols.
  const thematicAdds = resolveStrictLockedAdds({
    prompts: [
      "US multi-cap equity ETFs as core anchor",
      "Broad market equity ETFs to diversify away from Nasdaq-100 concentration",
      "add tech and utilities and emerging markets",
    ],
    filterCandidates: ["ARKW", "ACWI", "EIDO", "VPU", "IDU", "SPHD", "GDXJ"],
  });
  assert.deepEqual(thematicAdds, []);
  assert.ok(!thematicAdds.includes("ARKW"));
  assert.ok(!thematicAdds.includes("ACWI"));

  assert.deepEqual(
    resolveStrictLockedAdds({
      explicitSupplements: ["GLD"],
      prompts: ["Also include BTAL for downside hedge"],
    }),
    ["GLD", "BTAL"],
  );

  assert.deepEqual(
    extractExplicitTickersFromTexts(["Please add GLD and BTAL"], ["GLD", "BTAL", "SPY"]),
    ["GLD", "BTAL"],
  );

  const mapped = overlayToBacktestRequest(
    baseAnchorRequest(),
    minimalOverlay({
      supplement_tickers: ["GLD"],
      exclude_tickers: ["AGG"],
      prompts: ["US multi-cap equity ETFs", "add emerging markets basket"],
    }),
  );
  assert.equal(mapped.static_replay_holdings, null);
  assert.deepEqual(mapped.universe_tickers, ["IVV", "GLD"]);
  assert.deepEqual(mapped.universe_supplement_tickers, ["IVV", "GLD"]);
  assert.ok(
    !(mapped.universe_supplement_tickers ?? []).includes("ARKW"),
    "thematic prompts must not expand locked universe",
  );
  assert.ok(
    !(mapped.universe_supplement_tickers ?? []).includes("ACWI"),
    "thematic prompts must not expand locked universe",
  );
  assert.ok(
    (mapped.universe_supplement_tickers?.length ?? 0) < 10,
    "must not seed mainstream demo / full pool",
  );
  assert.equal(mapped.max_holdings, 2);
  assert.ok((mapped.max_weight ?? 0) >= 0.5);

  // Model holdings remain available unless explicitly excluded.
  const noExclude = overlayToBacktestRequest(
    baseAnchorRequest(),
    minimalOverlay({
      prompts: ["diversify with sector ETFs"],
    }),
  );
  assert.deepEqual(noExclude.universe_tickers, ["IVV", "AGG"]);
  assert.deepEqual(noExclude.universe_supplement_tickers, ["IVV", "AGG"]);

  // Chen / 美國大型股核心 case: thematic AI pool names must not leak in.
  const chenBase: BacktestRequest = {
    ...baseAnchorRequest(),
    scenario_id: "anchor-us-multi-cap-equity",
    asset_classes: ["equity"],
    universe_tickers: ["SPY", "XLF", "XLV"],
    universe_supplement_tickers: ["SPY", "XLF", "XLV"],
    static_replay_holdings: { SPY: 0.4, XLF: 0.3, XLV: 0.3 },
    max_holdings: 3,
    max_weight: 0.25,
  };
  const chenMapped = overlayToBacktestRequest(
    chenBase,
    minimalOverlay({
      supplement_tickers: ["SMH", "SOXX", "BOTZ", "EWT", "EWY"],
      prompts: ["增加AI主題、半導體產業、台灣與韓國配置，並由量化模型決定權重"],
    }),
  );
  const chenSet = new Set(chenMapped.universe_tickers ?? []);
  assert.deepEqual(
    [...chenSet].sort(),
    ["BOTZ", "EWT", "EWY", "SMH", "SOXX", "SPY", "XLF", "XLV"],
  );
  assert.deepEqual(
    chenMapped.universe_tickers,
    chenMapped.universe_supplement_tickers,
  );
  for (const leak of ["EPI", "ITA", "IYW", "ARKW", "ACWI", "QQQ"]) {
    assert.ok(!chenSet.has(leak), `must not include pool leak ${leak}`);
  }
  assert.equal(countUniverse(combinedUniverseFromRequest(chenMapped)), 8);

  const openPoolBase: BacktestRequest = {
    ...baseAnchorRequest(),
    static_replay_holdings: null,
    universe_tickers: null,
    universe_supplement_tickers: null,
    max_holdings: 30,
  };
  assert.equal(isLockedModelUniverse(openPoolBase), false);
  const openMapped = overlayToBacktestRequest(
    openPoolBase,
    minimalOverlay({
      supplement_tickers: ["BTAL"],
      prompts: ["add defensive"],
    }),
  );
  assert.deepEqual(openMapped.universe_supplement_tickers, ["BTAL"]);
  assert.equal(openMapped.universe_tickers, null);

  const uiCount = countUniverse(
    combinedUniverseFromRequest({
      asset_classes: ["equity", "bond"],
      universe_tickers: ["IVV"],
      universe_supplement_tickers: ["IVV", "GLD"],
    }),
  );
  assert.equal(uiCount, 2, "UI count must use locked whitelist ∪ supplements");

  const spyBase: BacktestRequest = {
    ...baseAnchorRequest(),
    scenario_id: "anchor-spy-benchmark",
    asset_classes: ["equity"],
    universe_tickers: ["SPY"],
    universe_supplement_tickers: ["SPY"],
    static_replay_holdings: { SPY: 1 },
    max_holdings: 1,
    max_weight: 1,
  };
  const diMapped = overlayToBacktestRequest(
    spyBase,
    minimalOverlay({
      construction: "direct_index",
      prompts: ["實施 SPY 標普 500 指數直接索引策略，並適度提高 AI 產業配置權重"],
    }),
  );
  const diSet = new Set(diMapped.universe_tickers ?? []);
  assert.ok(diSet.has("SPY"), "core ETF sleeve remains");
  assert.ok(diSet.has("NVDA"), "DI must add AI stocks");
  assert.ok(diSet.has("MSFT"), "DI must add AI stocks");
  for (const t of ["AIQ", "BOTZ", "IRBO"]) {
    assert.ok(!diSet.has(t), `DI must not swap in ${t}`);
  }

  console.log("locked-universe: ok");
}

run();
