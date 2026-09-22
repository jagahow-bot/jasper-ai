import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { overlayToBacktestRequest, type ClientOverlay } from "./overlay-schema";
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

function minimalOverlay(): ClientOverlay {
  return {
    version: "1.0",
    audit: {
      session_id: "ovl-pro-default-01",
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
      narrative_summary: "Neutral stance for Pro default test.",
    },
    allocation: {
      asset_classes: ["equity", "bond"],
      max_single_position_pct: 0.4,
    },
    universe: {
      prompts: [],
      supplement_tickers: [],
      exclude_tickers: [],
    },
    optimization: {
      objective: "max_sharpe",
      trials: 25,
    },
    confidence: 0.9,
    rationale: "Test overlay for customization Pro default.",
  };
}

describe("customization defaults to Pro multi-round", () => {
  it("locked overlay request uses pro_auto and does not send search mode", () => {
    const req = overlayToBacktestRequest(baseAnchorRequest(), minimalOverlay());
    assert.equal(req.optimization_mode, "pro_auto");
    assert.equal(req.enable_iterative_refinement, true);
    assert.equal(req.customization_search_mode, undefined);
  });

  it("respects explicit optimization_mode on overlay", () => {
    const overlay = minimalOverlay();
    overlay.optimization = {
      ...overlay.optimization,
      objective: "max_sharpe",
      trials: 25,
      optimization_mode: "standard",
    };
    const req = overlayToBacktestRequest(baseAnchorRequest(), overlay);
    assert.equal(req.optimization_mode, "standard");
    assert.equal(req.enable_iterative_refinement, false);
  });
});
