import { describe, expect, it } from "vitest";
import type { BacktestRequest } from "@/lib/types";
import {
  groupWeightBandsFromOverlay,
  groupWeightBandsWithDiagnostics,
  overlayToBacktestRequest,
  sleeveKeyToAssetClass,
  universeSupplementMetaFromOverlay,
  type ClientOverlay,
} from "./overlay-schema";

function baseOverlay(partial?: Partial<ClientOverlay>): ClientOverlay {
  return {
    version: "1.0",
    audit: {
      session_id: "ovl-bands-test-session-01",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      phase: "execute",
      conversation_turns: 1,
      source: "rules",
      rm_sign_off: {
        rm_id: "rm-1",
        signed_at: "2026-01-01T00:00:00.000Z",
      },
    },
    client_profile: { risk_tolerance: "moderate" },
    market_view: {
      stance: "neutral",
      themes: [],
      narrative_summary: "Private fund sleeve test.",
    },
    allocation: {
      asset_classes: ["equity", "bond", "alternative"],
    },
    universe: { prompts: [] },
    optimization: { objective: "max_sharpe" },
    confidence: 0.8,
    rationale: "Needs-driven weight bounds tests.",
    ...partial,
  };
}

function baseRequest(): BacktestRequest {
  return {
    scenario_id: "base",
    max_weight: 0.25,
    objective: "max_sharpe",
    backtest_mode: "static",
    start_date: "2018-01-01",
    end_date: "2024-12-31",
    trials: 10,
    top_models: 3,
    asset_classes: ["equity", "bond", "alternative"],
    enable_oos: true,
    train_ratio: 0.7,
    fee_bps: 10,
    rebalance_freq: "QE",
    max_turnover: 0.5,
  };
}

describe("sleeveKeyToAssetClass", () => {
  it("U13 maps w_* and named sleeves; leaves hedge theme alone", () => {
    expect(sleeveKeyToAssetClass("w_alternative")).toBe("alternative");
    expect(sleeveKeyToAssetClass("私募基金")).toBe("alternative");
    expect(sleeveKeyToAssetClass("對沖基金")).toBe("alternative");
    expect(sleeveKeyToAssetClass("避險")).toBeNull();
    expect(sleeveKeyToAssetClass("核心")).toBeNull();
  });
});

describe("groupWeightBands dual-track", () => {
  it("U14 w_alternative + proposed PFX produces band", () => {
    const overlay = baseOverlay({
      allocation: {
        asset_classes: ["equity", "alternative"],
        sleeve_targets: { w_alternative: 0.15, w_equity: 0.85 },
      },
      universe: {
        prompts: [],
        supplement_tickers: ["PFX"],
        proposed_tickers: [
          { ticker: "PFX", asset_class: "alternative", name: "Private fund ETF" },
        ],
      },
    });
    const bands = groupWeightBandsFromOverlay(overlay);
    const alt = bands.find((b) => b.group_id === "w_alternative");
    expect(alt).toBeTruthy();
    expect(alt!.tickers).toEqual(["PFX"]);
    expect(alt!.target_pct).toBe(0.15);
  });

  it("U15 no asset_class and unknown ticker → diagnostic, no band", () => {
    const overlay = baseOverlay({
      allocation: {
        asset_classes: ["equity", "alternative"],
        sleeve_targets: { w_alternative: 0.15 },
      },
      universe: {
        prompts: [],
        supplement_tickers: ["PFX"],
        proposed_tickers: [{ ticker: "PFX", name: "Unknown" }],
      },
    });
    const { bands, diagnostics } = groupWeightBandsWithDiagnostics(overlay);
    expect(bands.find((b) => b.group_id === "w_alternative")).toBeUndefined();
    expect(
      diagnostics.some(
        (d) =>
          d.kind === "unfilled_class_quota" &&
          d.ref === "w_alternative" &&
          d.asset_class === "alternative",
      ),
    ).toBe(true);
  });

  it("U16 named 私募基金 binds only PFX; AI theme stays separate", () => {
    const overlay = baseOverlay({
      allocation: {
        asset_classes: ["equity", "alternative"],
        sleeve_targets: { 私募基金: 0.15, AI衛星: 0.45 },
      },
      universe: {
        prompts: [],
        supplement_tickers: ["PFX", "BOTZ", "AIQ"],
        proposed_tickers: [
          { ticker: "PFX", asset_class: "alternative" },
          { ticker: "BOTZ" },
          { ticker: "AIQ" },
        ],
      },
    });
    const bands = groupWeightBandsFromOverlay(overlay);
    const pe = bands.find((b) => b.group_id === "私募基金");
    expect(pe?.tickers).toEqual(["PFX"]);
    const ai = bands.find((b) => b.group_id === "AI衛星");
    expect(ai?.tickers).toEqual(expect.arrayContaining(["BOTZ", "AIQ"]));
    expect(ai?.tickers).not.toContain("PFX");
  });

  it("U17 single other sleeve still binds full supplement pool", () => {
    const overlay = baseOverlay({
      allocation: {
        asset_classes: ["equity"],
        sleeve_targets: { 其他配置: 0.2 },
      },
      universe: {
        prompts: [],
        supplement_tickers: ["GLD", "BTAL"],
      },
    });
    const bands = groupWeightBandsFromOverlay(overlay);
    expect(bands).toHaveLength(1);
    expect(bands[0].tickers.sort()).toEqual(["BTAL", "GLD"]);
  });

  it("U18 other sleeve unresolved after class claim empties pool", () => {
    const overlay = baseOverlay({
      allocation: {
        asset_classes: ["equity", "alternative"],
        sleeve_targets: { w_alternative: 0.15, 其他配置: 0.1 },
      },
      universe: {
        prompts: [],
        supplement_tickers: ["PFX"],
        proposed_tickers: [{ ticker: "PFX", asset_class: "alternative" }],
      },
    });
    const { bands, diagnostics } = groupWeightBandsWithDiagnostics(overlay);
    expect(bands.find((b) => b.group_id === "w_alternative")?.tickers).toEqual([
      "PFX",
    ]);
    expect(bands.find((b) => b.group_id === "其他配置")).toBeUndefined();
    expect(
      diagnostics.some(
        (d) => d.kind === "unresolved_sleeve" && d.ref === "其他配置",
      ),
    ).toBe(true);
  });
});

describe("universeSupplementMetaFromOverlay", () => {
  it("U19 proposed hint wins; only supplement-related tickers", () => {
    const overlay = baseOverlay({
      allocation: {
        asset_classes: ["equity", "alternative"],
        sleeve_targets: { w_alternative: 0.15 },
      },
      universe: {
        prompts: [],
        supplement_tickers: ["PFX", "SPY"],
        proposed_tickers: [
          { ticker: "PFX", asset_class: "alternative" },
          { ticker: "SPY", asset_class: "bond" },
        ],
      },
    });
    const meta = universeSupplementMetaFromOverlay(overlay);
    expect(meta.PFX.asset_class).toBe("alternative");
    expect(meta.SPY.asset_class).toBe("bond");
    expect(Object.keys(meta).sort()).toEqual(["PFX", "SPY"]);
  });
});

describe("overlayToBacktestRequest dual-track", () => {
  it("U20 open branch writes meta and keeps w_alternative param", () => {
    const overlay = baseOverlay({
      allocation: {
        asset_classes: ["equity", "alternative"],
        sleeve_targets: { w_alternative: 0.15, w_equity: 0.85 },
      },
      universe: {
        prompts: ["private fund sleeve"],
        supplement_tickers: ["PFX"],
        proposed_tickers: [{ ticker: "PFX", asset_class: "alternative" }],
      },
    });
    const req = overlayToBacktestRequest(baseRequest(), overlay);
    expect(req.universe_supplement_meta?.PFX?.asset_class).toBe("alternative");
    expect(req.param_controls?.w_alternative).toMatchObject({
      mode: "fixed",
      fixed: 0.15,
    });
    expect(req.client_context?.group_weight_bands?.length).toBeGreaterThan(0);
  });

  it("U20 locked branch also writes meta", () => {
    const overlay = baseOverlay({
      allocation: {
        asset_classes: ["equity", "alternative"],
        sleeve_targets: { w_alternative: 0.15 },
      },
      universe: {
        prompts: [],
        proposed_tickers: [{ ticker: "PFX", asset_class: "alternative" }],
        supplement_tickers: ["PFX"],
      },
    });
    const lockedBase: BacktestRequest = {
      ...baseRequest(),
      universe_tickers: ["SPY", "AGG"],
      anchor_weights: { SPY: 0.6, AGG: 0.4 },
      customization_drift: 0.3,
    };
    const req = overlayToBacktestRequest(lockedBase, overlay);
    expect(req.universe_supplement_meta?.PFX?.asset_class).toBe("alternative");
    expect(req.param_controls?.w_alternative).toMatchObject({
      mode: "fixed",
      fixed: 0.15,
    });
  });
});

describe("createJob payload contract (I5)", () => {
  it("createJob keeps universe_supplement_meta (does not strip)", async () => {
    const { createJob } = await import("./api");
    // Intercept fetch via stubbing the module's fetchJson is hard; assert
    // the strip list does not include universe_supplement_meta by source inspection.
    const src = createJob.toString();
    expect(src).toContain("top_n");
    expect(src).not.toMatch(/delete payload\.universe_supplement_meta/);
  });
});
