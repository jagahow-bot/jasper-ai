import { describe, expect, it } from "vitest";
import {
  applyScopeToBacktestRequest,
  buildScopeHoldings,
  MAX_CASH_RESERVE_PCT,
  scopeCashWeight,
  type ClientHoldingsGroup,
} from "./clients";
import { overlayToBacktestRequest, type ClientOverlay } from "./overlay-schema";
import type { BacktestRequest } from "./types";

function thematicAndCashGroups(): ClientHoldingsGroup[] {
  return [
    {
      id: "grp-thematic",
      type: "model",
      model_id: "thematic-ai",
      holdings: [
        { ticker: "QQQ", name: "Nasdaq 100", asset_class: "equity", weight: 0.45 },
        { ticker: "SMH", name: "Semis", asset_class: "equity", weight: 0.15 },
      ],
    },
    {
      id: "grp-cash",
      type: "cash",
      holdings: [
        { ticker: "CASH", name: "Cash", asset_class: "cash", weight: 0.4 },
      ],
    },
    {
      id: "grp-unselected",
      type: "individual",
      holdings: [
        { ticker: "AGG", name: "Bonds", asset_class: "bond", weight: 0.0 },
      ],
    },
  ];
}

function baseAnchorRequest(): BacktestRequest {
  return {
    scenario_id: "anchor-current-holdings",
    start_date: "2018-01-01",
    end_date: "2024-12-31",
    asset_classes: ["equity"],
    max_weight: 0.4,
    objective: "max_sharpe",
    trials: 5,
    top_models: 1,
    max_holdings: 2,
    universe_tickers: ["QQQ", "SMH"],
    universe_supplement_tickers: ["QQQ", "SMH"],
    static_replay_holdings: { QQQ: 0.75, SMH: 0.25 },
    optimization_mode: "standard",
    regime_adaptive: false,
    enable_oos: true,
    train_ratio: 0.7,
    fee_bps: 10,
    rebalance_freq: "QE",
    enforce_class_weights: false,
  };
}

function minimalOverlay(): ClientOverlay {
  return {
    version: "1.0",
    audit: {
      session_id: "ovl-cash-test",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      phase: "execute",
      conversation_turns: 1,
      source: "manual",
      rm_sign_off: { signed_at: "2026-01-01T00:00:00.000Z", rm_id: "rm-1" },
    },
    client_profile: {},
    market_view: { stance: "neutral", themes: [], narrative_summary: "test" },
    allocation: { asset_classes: ["equity"], max_single_position_pct: 0.4 },
    universe: { prompts: [] },
    optimization: { objective: "max_sharpe", trials: 25 },
    confidence: 0.9,
    rationale: "cash scope test",
  };
}

describe("scope cash sleeve", () => {
  it("keeps CASH in buildScopeHoldings at its renormalized weight", () => {
    const scope = buildScopeHoldings(thematicAndCashGroups(), [
      "grp-thematic",
      "grp-cash",
    ]);
    const cash = scope.find((h) => h.ticker === "CASH");
    expect(cash).toBeDefined();
    expect(cash!.weight).toBeCloseTo(0.4, 9);
    expect(scopeCashWeight(scope)).toBeCloseTo(0.4, 9);
  });

  it("turns scope cash into cash_reserve_pct, never a universe ticker", () => {
    const scope = buildScopeHoldings(thematicAndCashGroups(), [
      "grp-thematic",
      "grp-cash",
    ]);
    const req = applyScopeToBacktestRequest(baseAnchorRequest(), scope);
    expect(req.cash_reserve_pct).toBeCloseTo(0.4, 9);
    expect(req.universe_tickers).not.toContain("CASH");
    expect(req.universe_supplement_tickers).not.toContain("CASH");
    // max_holdings counts tradable names only (not the cash line).
    expect(req.max_holdings).toBe(2);
  });

  it("leaves cash_reserve_pct untouched when scope has no cash", () => {
    const req = applyScopeToBacktestRequest(
      baseAnchorRequest(),
      buildScopeHoldings(thematicAndCashGroups(), ["grp-thematic"]),
    );
    expect(req.cash_reserve_pct).toBeUndefined();
  });

  it("cash-only scope sets a clamped reserve without touching the universe", () => {
    const req = applyScopeToBacktestRequest(
      baseAnchorRequest(),
      buildScopeHoldings(thematicAndCashGroups(), ["grp-cash"]),
    );
    expect(req.cash_reserve_pct).toBe(MAX_CASH_RESERVE_PCT);
    expect(req.universe_tickers).toEqual(["QQQ", "SMH"]);
  });

  it("overlay mapping does not reset the scope cash reserve to 0", () => {
    const scope = buildScopeHoldings(thematicAndCashGroups(), [
      "grp-thematic",
      "grp-cash",
    ]);
    const scoped = applyScopeToBacktestRequest(baseAnchorRequest(), scope);
    const mapped = overlayToBacktestRequest(scoped, minimalOverlay());
    expect(mapped.cash_reserve_pct).toBeCloseTo(0.4, 9);
  });

  it("overlay liquidity_buffer_pct becomes cash_reserve_pct on the request", () => {
    const overlay = minimalOverlay();
    overlay.deployment_schedule = {
      months: 1,
      liquidity_buffer_pct: 0.05,
    };
    const mapped = overlayToBacktestRequest(baseAnchorRequest(), overlay);
    expect(mapped.cash_reserve_pct).toBeCloseTo(0.05, 9);
    expect(mapped.client_context?.cash_reserve_pct).toBeCloseTo(0.05, 9);
  });

  it("overlay cash raises but does not wipe a larger scope cash reserve", () => {
    const scope = buildScopeHoldings(thematicAndCashGroups(), [
      "grp-thematic",
      "grp-cash",
    ]);
    const scoped = applyScopeToBacktestRequest(baseAnchorRequest(), scope);
    const overlay = minimalOverlay();
    overlay.deployment_schedule = {
      months: 1,
      liquidity_buffer_pct: 0.05,
    };
    const mapped = overlayToBacktestRequest(scoped, overlay);
    expect(mapped.cash_reserve_pct).toBeCloseTo(0.4, 9);
    expect(mapped.client_context?.cash_reserve_pct).toBeCloseTo(0.05, 9);
  });

  it("client liquidity_need + risk alone does not invent a cash reserve floor", () => {
    const overlay = minimalOverlay();
    overlay.client_profile = {
      risk_tolerance: "moderate",
      liquidity_need: { amount_usd: 50_000, within_months: 12 },
    };
    const mapped = overlayToBacktestRequest(baseAnchorRequest(), overlay);
    expect(mapped.cash_reserve_pct ?? 0).toBe(0);
    expect(mapped.client_context?.cash_reserve_pct ?? null).toBeNull();
  });
});
