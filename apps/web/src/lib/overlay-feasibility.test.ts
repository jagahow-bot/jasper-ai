import { describe, expect, it } from "vitest";
import {
  DRIFT_OVERRIDE_RM_MAX,
  attachMechanicalOverlayConflicts,
  buildInfeasibleDriftConflict,
  detectSecondLayerAiHedgeIntent,
  driftOverrideApproval,
  minL1DriftForTarget,
  validateCapabilityGapStages,
} from "./overlay-feasibility";
import type { ClientOverlay } from "./overlay-schema";

function baseOverlay(partial: Partial<ClientOverlay> = {}): ClientOverlay {
  return {
    version: "1.0",
    audit: {
      session_id: "ovl-test",
      turns: 1,
      phase: "confirm",
      source: "rules",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    client_profile: {},
    market_view: {
      stance: "risk_on",
      themes: ["ai_technology", "hedging_assets"],
      narrative_summary: "AI growth with hedge sleeve",
    },
    allocation: { asset_classes: ["equity"] },
    universe: {
      prompts: ["第二層：50% AI / 50% 避險"],
      supplement_tickers: ["BOTZ", "AIQ", "AVGO", "TSM", "GLD", "TLT"],
    },
    optimization: { objective: "max_sharpe" },
    deployment_schedule: {},
    clarification_questions: [],
    confidence: 0.8,
    rationale: "Mapped AI and hedge names into the universe.",
    ...partial,
  };
}

describe("overlay-feasibility", () => {
  it("flags 50/50 disjoint sleeves vs low drift as infeasible", () => {
    const check = minL1DriftForTarget(
      { SPY: 1 },
      { ai: 0.5, hedge: 0.5 },
      { ai: ["NVDA", "MSFT"], hedge: ["TLT", "GLD"] },
      0.3,
    );
    expect(check.feasible).toBe(false);
    expect(check.minRequiredDrift).toBeCloseTo(1.0, 5);
  });

  it("encodes §8 drift override threshold at 0.6", () => {
    expect(DRIFT_OVERRIDE_RM_MAX).toBe(0.6);
    expect(driftOverrideApproval(0.5).allowedForRm).toBe(true);
    expect(driftOverrideApproval(0.6).allowedForRm).toBe(true);
    expect(driftOverrideApproval(0.61).requiresSupervisor).toBe(true);
  });

  it("builds conflict options without silent half-answer", () => {
    const check = minL1DriftForTarget(
      { SPY: 1 },
      { ai: 0.5, hedge: 0.5 },
      { ai: ["A"], hedge: ["B"] },
      0.3,
    );
    const conflict = buildInfeasibleDriftConflict(check, { lang: "zh" });
    expect(conflict.options.map((o) => o.id)).toEqual([
      "raise-drift",
      "soften-target",
      "submit-gap",
    ]);
    expect(conflict.requires_supervisor).toBe(true);
  });

  it("rejects invalid stage attribution into clarifications", () => {
    const { valid, clarifications } = validateCapabilityGapStages([
      {
        stage: "allocator",
        kind: "unsupported_lever",
        missing_capability: "two_layer_sleeve_allocation",
        summary: "需要二層配置能力以表達袖珍結構",
        requested: {},
        severity: "blocking",
      },
      {
        // @ts-expect-error intentional invalid stage
        stage: "not_a_stage",
        kind: "unsupported_lever",
        missing_capability: "weird",
        summary: "invalid stage should clarify",
        requested: {},
        severity: "blocking",
      },
    ]);
    expect(valid).toHaveLength(1);
    expect(clarifications.length).toBeGreaterThan(0);
  });

  it("detects AI+hedge second-layer from themes and supplements", () => {
    const hit = detectSecondLayerAiHedgeIntent(baseOverlay(), {
      anchorTickers: new Set(["SPY", "NVDA", "MSFT"]),
    });
    expect(hit.detected).toBe(true);
    expect(hit.aiTickers).toEqual(
      expect.arrayContaining(["BOTZ", "AIQ", "AVGO", "TSM"]),
    );
    expect(hit.hedgeTickers).toEqual(expect.arrayContaining(["GLD", "TLT"]));
  });

  it("attaches drift conflict for 50/50 AI+hedge vs low drift (job-like)", () => {
    const overlay = attachMechanicalOverlayConflicts(baseOverlay(), {
      lang: "zh",
      declaredDrift: 0.25,
      anchorPositions: [
        { ticker: "SPY", weightLabel: "40%" },
        { ticker: "FXAIX", weightLabel: "15%" },
        { ticker: "XLV", weightLabel: "10%" },
        { ticker: "XLF", weightLabel: "10%" },
        { ticker: "NVDA", weightLabel: "10%" },
        { ticker: "AAPL", weightLabel: "8%" },
        { ticker: "MSFT", weightLabel: "7%" },
      ],
      transcript: "第二層配置：50% AI 產業、50% 避險",
    });
    expect(overlay.conflicts?.length).toBeGreaterThan(0);
    expect(overlay.conflicts?.[0]?.code).toBe("INFEASIBLE_DRIFT");
    expect(overlay.audit.phase).toBe("clarify");
  });

  it("attaches structural conflict when AI+hedge mapped only to supplements", () => {
    const overlay = attachMechanicalOverlayConflicts(
      baseOverlay({
        universe: {
          prompts: ["AI ETF 與避險資產"],
          supplement_tickers: ["BOTZ", "AIQ", "GLD", "TLT"],
        },
        rationale: "Added thematic tickers as supplements.",
      }),
      {
        lang: "zh",
        // High drift so L1 math does not mask the structural unsupported card.
        declaredDrift: 1.0,
        anchorPositions: [{ ticker: "SPY", weightLabel: "100%" }],
        transcript: "想要 AI 產業搭配避險配置",
      },
    );
    expect(overlay.conflicts?.some((c) => c.code === "UNSUPPORTED_TWO_LAYER")).toBe(
      true,
    );
  });
});
