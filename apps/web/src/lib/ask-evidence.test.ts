import { describe, expect, it } from "vitest";
import {
  evaluateAskEvidence,
  formatAskTarget,
  groupTickerMapFromHoldingsGroups,
} from "./ask-evidence";
import { interpretOverlayFallback } from "./overlay-fallback";
import {
  applyAsksToOverlayLevers,
  clientContextFromOverlay,
  explicitDrawdownToleranceFromOverlay,
  shouldApplyThemeExposureCap,
  type ClientOverlay,
  type OverlayAsk,
} from "./overlay-schema";

function baseOverlay(partial?: Partial<ClientOverlay>): ClientOverlay {
  return {
    version: "1.0",
    audit: {
      session_id: "ovl-ask-test-session-01",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      phase: "confirm",
      conversation_turns: 1,
      source: "rules",
    },
    client_profile: { risk_tolerance: "aggressive" },
    market_view: {
      stance: "risk_on",
      themes: ["ai", "tech", "growth"],
      narrative_summary: "Keep aggressive AI/tech satellite tilt.",
    },
    allocation: {
      asset_classes: ["equity", "bond"],
      max_single_position_pct: 0.25,
    },
    universe: { prompts: [] },
    optimization: { objective: "max_sharpe" },
    confidence: 0.8,
    rationale: "Aggressive growth with AI satellite and cash buffer.",
    ...partial,
  };
}

const chenAsks: OverlayAsk[] = [
  {
    id: "ask-1",
    title: "Trim NVDA; keep AI satellite",
    summary: "Trim NVDA concentration while keeping AI/tech satellite at 40–45%.",
    kind: "group_weight_band",
    group_id: "chen-tech-satellite",
        tickers: ["NVDA", "AAPL", "MSFT", "META", "FDGRX"],
        min_pct: 0.4,
        max_pct: 0.45,
      },
      {
        id: "ask-1b",
        title: "NVDA single-name trim",
        summary: "Cap NVDA weight after satellite rebalance.",
        kind: "ticker_max",
        tickers: ["NVDA"],
        max_pct: 0.18,
      },
      {
        id: "ask-2",
        title: "Core consolidation",
        summary: "Reduce SPY/FXAIX overlap; prefer XLV/XLF.",
        kind: "exclude_ticker",
        tickers: ["FXAIX"],
      },
      {
        id: "ask-2b",
        title: "Prefer sector ETFs",
        summary: "Keep XLV and XLF in the book.",
        kind: "ticker_min",
        tickers: ["XLV", "XLF"],
      },
      {
        id: "ask-3",
        title: "Max Sharpe + cash",
        summary: "Max Sharpe with ~5% cash buffer.",
        kind: "cash_reserve",
        cash_reserve_pct: 0.05,
      },
      {
        id: "ask-3b",
        title: "Objective",
        summary: "Target maximum Sharpe ratio.",
        kind: "objective",
        objective: "max_sharpe",
      },
    ];

describe("overlay ask soft mapping", () => {
  it("does not auto theme-cap when keeping aggressive AI tilt", () => {
    const overlay = baseOverlay({ asks: chenAsks });
    expect(shouldApplyThemeExposureCap(overlay)).toBe(false);
    const ctx = clientContextFromOverlay(overlay);
    expect(ctx?.theme_exposure_cap_pct).toBeNull();
    expect(ctx?.cash_reserve_pct).toBeCloseTo(0.05, 5);
  });

  it("applies theme cap only when brief asks to reduce/cap theme", () => {
    const overlay = baseOverlay({
      asks: [],
      market_view: {
        stance: "neutral",
        themes: ["tech", "defensive"],
        narrative_summary: "Reduce tech concentration and cap theme risk.",
      },
      rationale: "Client wants to reduce theme exposure below 25%.",
    });
    expect(shouldApplyThemeExposureCap(overlay)).toBe(true);
    expect(clientContextFromOverlay(overlay)?.theme_exposure_cap_pct).toBe(0.25);
  });

  it("does not theme-cap from mere theme tags without cap/reduce language", () => {
    const overlay = baseOverlay({
      asks: [],
      allocation: { asset_classes: ["equity", "bond"] },
      market_view: {
        stance: "risk_on",
        themes: ["ai", "tech", "growth", "concentration_reduction"],
        narrative_summary: "Aggressive AI and tech growth preference.",
      },
      rationale: "Client wants growth via AI and tech themes.",
    });
    expect(shouldApplyThemeExposureCap(overlay)).toBe(false);
    expect(clientContextFromOverlay(overlay)?.theme_exposure_cap_pct).toBeNull();
  });

  it("does not theme-cap from NVDA trim / Cap NVDA / Reduce single-name wording", () => {
    // Mirrors a real interpret→run path: asks mention Reduce/Cap/Trim
    // Concentration but keep the AI satellite at 40–45% — no theme floor.
    const overlay = baseOverlay({
      asks: [
        {
          id: "ask-1",
          title: "Trim NVDA Concentration",
          summary:
            "Reduce excess NVDA position size while preserving overall tech satellite exposure around 40-45%.",
          kind: "ticker_max",
          tickers: ["NVDA"],
          max_pct: 0.18,
        },
        {
          id: "ask-1b",
          title: "NVDA single-name trim",
          summary: "Cap NVDA weight after satellite rebalance.",
          kind: "ticker_max",
          tickers: ["NVDA"],
          max_pct: 0.18,
        },
        {
          id: "ask-2",
          title: "Core consolidation",
          summary: "Reduce SPY/FXAIX overlap; prefer XLV/XLF.",
          kind: "exclude_ticker",
          tickers: ["FXAIX"],
        },
      ],
      market_view: {
        stance: "risk_on",
        themes: ["ai", "tech", "concentration_reduction"],
        narrative_summary:
          "Trim NVDA while keeping the AI/tech satellite around 40-45%.",
      },
      rationale: "Aggressive client trimming NVDA concentration, not the theme sleeve.",
    });
    expect(shouldApplyThemeExposureCap(overlay)).toBe(false);
    expect(clientContextFromOverlay(overlay)?.theme_exposure_cap_pct).toBeNull();
  });

  it("does not invent drawdown tolerance from aggressive risk alone", () => {
    const overlay = baseOverlay({
      asks: [],
      allocation: { asset_classes: ["equity", "bond"] },
    });
    expect(explicitDrawdownToleranceFromOverlay(overlay)).toBeNull();
    expect(clientContextFromOverlay(overlay)?.max_drawdown_tolerance).toBeNull();
  });

  it("sets drawdown tolerance only when overlay states an explicit max drawdown %", () => {
    const overlay = baseOverlay({
      asks: [],
      allocation: { asset_classes: ["equity", "bond"] },
      market_view: {
        stance: "neutral",
        themes: ["capital_preservation"],
        narrative_summary: "Keep max drawdown within 15% over the training window.",
      },
      rationale: "Client asked for a 15% maximum drawdown floor.",
    });
    expect(explicitDrawdownToleranceFromOverlay(overlay)).toBeCloseTo(0.15, 5);
    expect(clientContextFromOverlay(overlay)?.max_drawdown_tolerance).toBeCloseTo(
      0.15,
      5,
    );
  });

  it("sets cash reserve only from Ask or deployment buffer, not liquidity_need alone", () => {
    const noCash = baseOverlay({
      asks: [],
      allocation: { asset_classes: ["equity", "bond"] },
      client_profile: {
        risk_tolerance: "moderate",
        liquidity_need: { amount_usd: 50_000, within_months: 12 },
      },
    });
    expect(clientContextFromOverlay(noCash)?.cash_reserve_pct ?? null).toBeNull();

    const fromAsk = baseOverlay({
      asks: [
        {
          id: "ask-cash",
          title: "Cash buffer",
          summary: "Keep about 5% cash.",
          kind: "cash_reserve",
          cash_reserve_pct: 0.05,
        },
      ],
      allocation: { asset_classes: ["equity", "bond"] },
    });
    expect(clientContextFromOverlay(fromAsk)?.cash_reserve_pct).toBeCloseTo(0.05, 5);

    const fromDeploy = baseOverlay({
      asks: [],
      allocation: { asset_classes: ["equity", "bond"] },
      deployment_schedule: { months: 6, liquidity_buffer_pct: 0.08 },
    });
    expect(clientContextFromOverlay(fromDeploy)?.cash_reserve_pct).toBeCloseTo(
      0.08,
      5,
    );
  });

  it("maps asks onto excludes, cash buffer, and ticker max", () => {
    const mapped = applyAsksToOverlayLevers(baseOverlay({ asks: chenAsks }));
    expect(mapped.universe.exclude_tickers).toContain("FXAIX");
    expect(mapped.universe.supplement_tickers).toEqual(
      expect.arrayContaining(["XLV", "XLF"]),
    );
    expect(clientContextFromOverlay(mapped)?.cash_reserve_pct).toBeCloseTo(
      0.05,
      5,
    );
    expect(mapped.allocation.max_single_position_pct).toBeLessThanOrEqual(0.18);
    expect(mapped.optimization.objective).toBe("max_sharpe");
  });
});

describe("ask-evidence", () => {
  it("formats targets and evaluates met / partial / missed honestly", () => {
    expect(formatAskTarget(chenAsks[0]!)).toContain("40");
    const groups = groupTickerMapFromHoldingsGroups([
      {
        id: "chen-tech-satellite",
        holdings: [
          { ticker: "NVDA" },
          { ticker: "AAPL" },
          { ticker: "MSFT" },
          { ticker: "META" },
          { ticker: "FDGRX" },
        ],
      },
    ]);

    const met = evaluateAskEvidence(chenAsks, {
      weights: {
        NVDA: 0.12,
        AAPL: 0.08,
        MSFT: 0.08,
        META: 0.07,
        FDGRX: 0.07,
        SPY: 0.25,
        XLV: 0.1,
        XLF: 0.1,
        CASH: 0.05,
      },
      objective: "max_sharpe",
      groupTickers: groups,
      needs: { cash_weight_actual: 0.05, cash_reserve_pct: 0.05 },
    });

    expect(met.find((r) => r.ask.id === "ask-1")?.status).toBe("met");
    expect(met.find((r) => r.ask.id === "ask-1b")?.status).toBe("met");
    expect(met.find((r) => r.ask.id === "ask-2")?.status).toBe("met");
    expect(met.find((r) => r.ask.id === "ask-2b")?.status).toBe("met");
    expect(met.find((r) => r.ask.id === "ask-3")?.status).toBe("met");
    expect(met.find((r) => r.ask.id === "ask-3b")?.status).toBe("met");

    const missed = evaluateAskEvidence(
      [
        {
          id: "ask-1",
          title: "AI satellite band",
          summary: "Keep satellite 40–45%.",
          kind: "group_weight_band",
          group_id: "chen-tech-satellite",
          min_pct: 0.4,
          max_pct: 0.45,
        },
      ],
      {
        weights: { NVDA: 0.1, AAPL: 0.05, MSFT: 0.05, META: 0.05, FDGRX: 0.05 },
        groupTickers: groups,
      },
    );
    expect(missed[0]?.status).toBe("missed");
    expect(missed[0]?.actualLabel).toMatch(/30/);
  });
});

describe("Chen brief rules fallback", () => {
  it("extracts soft asks without theme-capping the AI tilt", () => {
    const brief = [
      "Client Ms. Chen (38yo, Aggressive) customize portfolio.",
      "1. Trim NVDA while keeping AI/tech satellite at 40%-45%.",
      "2. Reduce SPY/FXAIX redundancy into XLV/XLF.",
      "3. Max Sharpe with cash buffer around 5%.",
    ].join("\n");
    const ov = interpretOverlayFallback(brief, "en", "ovl-chen-demo-01", 1);
    expect(ov.asks?.length).toBeGreaterThanOrEqual(3);
    expect(ov.asks?.some((a) => a.kind === "group_weight_band")).toBe(true);
    expect(ov.universe.exclude_tickers).toContain("FXAIX");
    expect(clientContextFromOverlay(ov)?.theme_exposure_cap_pct).toBeNull();
    expect(clientContextFromOverlay(ov)?.max_drawdown_tolerance).toBeNull();
    expect(clientContextFromOverlay(ov)?.cash_reserve_pct).toBeCloseTo(0.05, 5);
    expect(ov.optimization.objective).toBe("max_sharpe");
  });
});
