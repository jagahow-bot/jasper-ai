import { describe, expect, it } from "vitest";
import {
  DRIFT_SLIDER_STEP,
  MUST_INCLUDE_DRIFT_ESTIMATE,
  computeOverlayDriftHints,
  driftSyncActionForConfirm,
} from "./overlay-drift-sync";
import {
  attachDriftSyncAudit,
  groupWeightBandsFromOverlay,
  overlaySessionAuditSchema,
  type ClientOverlay,
} from "./overlay-schema";

function baseOverlay(partial: Partial<ClientOverlay> = {}): ClientOverlay {
  return {
    version: "1.0",
    audit: {
      session_id: "ovl-drift-sync",
      conversation_turns: 1,
      phase: "confirm",
      source: "rules",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    client_profile: {},
    market_view: {
      stance: "risk_on",
      themes: ["ai_technology"],
      narrative_summary: "AI growth sleeve for testing drift sync",
    },
    allocation: { asset_classes: ["equity"] },
    universe: {
      prompts: ["theme allocation"],
      supplement_tickers: ["NVDA", "MSFT", "GLD", "TLT"],
    },
    optimization: { objective: "max_sharpe" },
    deployment_schedule: {},
    clarification_questions: [],
    confidence: 0.8,
    rationale: "Test overlay for drift sync.",
    ...partial,
  };
}

const SPY_ANCHOR = { SPY: 1 };

describe("computeOverlayDriftHints", () => {
  it("U1: null/undefined overlay → zero hints", () => {
    for (const overlay of [null, undefined] as const) {
      const hints = computeOverlayDriftHints(overlay, {
        anchorWeights: SPY_ANCHOR,
        currentDrift: 0.3,
      });
      expect(hints.minRequiredDrift).toBe(0);
      expect(hints.suggestedDrift).toBe(0);
      expect(hints.headroomDrift).toBe(DRIFT_SLIDER_STEP);
      expect(hints.feasible).toBe(true);
      expect(hints.sources).toEqual([]);
      expect(hints.requiresSupervisor).toBe(false);
    }
  });

  it("U2: empty anchor → zero hints", () => {
    const overlay = baseOverlay({
      allocation: {
        asset_classes: ["equity"],
        sleeve_targets: { ai: 0.45 },
      },
    });
    const hints = computeOverlayDriftHints(overlay, {
      anchorWeights: {},
      currentDrift: 0.3,
    });
    expect(hints.minRequiredDrift).toBe(0);
    expect(hints.sources).toEqual([]);
    expect(hints.feasible).toBe(true);
  });

  it("U3: layer 1 theme sleeve_targets vs SPY=1", () => {
    const overlay = baseOverlay({
      allocation: {
        asset_classes: ["equity"],
        sleeve_targets: { ai: 0.45, hedge: 0.35 },
      },
      universe: {
        prompts: ["AI 45 / hedge 35"],
        supplement_tickers: ["NVDA", "MSFT", "GLD", "TLT"],
      },
    });
    const hints = computeOverlayDriftHints(overlay, {
      anchorWeights: SPY_ANCHOR,
      currentDrift: 0.3,
    });
    // minL1DriftForTarget: 0.5 * (|1−0| + |0−0.8|) = 0.9 when sleeves
    // share the supplement pool (weights stack on the same tickers).
    expect(hints.minRequiredDrift).toBeCloseTo(0.9, 5);
    expect(hints.sources).toHaveLength(2);
    expect(hints.sources.every((s) => s.kind === "sleeve_targets")).toBe(true);
    expect(hints.sources.map((s) => s.ref).sort()).toEqual(["ai", "hedge"]);
    expect(hints.feasible).toBe(false);
    expect(hints.suggestedDrift).toBe(0.9);
  });

  it("U4: sleeve_targets wins over band ask (no double-count)", () => {
    const overlay = baseOverlay({
      allocation: {
        asset_classes: ["equity"],
        sleeve_targets: { ai: 0.45 },
      },
      universe: {
        prompts: ["ai"],
        supplement_tickers: ["NVDA", "MSFT"],
      },
      asks: [
        {
          id: "band-1",
          title: "Hedge band",
          summary: "35% hedge",
          kind: "group_weight_band",
          group_id: "hedge",
          tickers: ["GLD", "TLT"],
          target_pct: 0.35,
          status: "proposed",
        },
      ],
    });
    const hints = computeOverlayDriftHints(overlay, {
      anchorWeights: SPY_ANCHOR,
      currentDrift: 0.5,
    });
    expect(hints.sources.every((s) => s.kind === "sleeve_targets")).toBe(true);
    // 0.5 * (1 + 0.45) = 0.725
    expect(hints.minRequiredDrift).toBeCloseTo(0.725, 5);
    expect(hints.sources.some((s) => s.kind === "group_weight_band")).toBe(
      false,
    );
  });

  it("U5: layer 2 band ask outside anchor", () => {
    const overlay = baseOverlay({
      asks: [
        {
          id: "band-ai",
          title: "AI band",
          summary: "40% AI",
          kind: "group_weight_band",
          group_id: "ai",
          tickers: ["NVDA", "MSFT"],
          target_pct: 0.4,
          status: "signed",
        },
      ],
    });
    const hints = computeOverlayDriftHints(overlay, {
      anchorWeights: SPY_ANCHOR,
      currentDrift: 0.3,
    });
    // 0.5 * (1 + 0.4) = 0.7
    expect(hints.minRequiredDrift).toBeCloseTo(0.7, 5);
    expect(hints.sources[0]?.kind).toBe("group_weight_band");
  });

  it("U6: unsigned band ask counted via includeUnsigned", () => {
    const overlay = baseOverlay({
      asks: [
        {
          id: "band-unsigned",
          title: "AI band",
          summary: "40% AI",
          kind: "group_weight_band",
          group_id: "ai",
          tickers: ["NVDA"],
          target_pct: 0.4,
          status: "proposed",
        },
      ],
    });
    expect(groupWeightBandsFromOverlay(overlay)).toHaveLength(0);
    expect(
      groupWeightBandsFromOverlay(overlay, { includeUnsigned: true }).length,
    ).toBeGreaterThan(0);
    const hints = computeOverlayDriftHints(overlay, {
      anchorWeights: SPY_ANCHOR,
      currentDrift: 0.3,
    });
    expect(hints.minRequiredDrift).toBeCloseTo(0.7, 5);
  });

  it("U7: layer 3 ticker_min without pct → 2 × estimate", () => {
    const overlay = baseOverlay({
      asks: [
        {
          id: "min-1",
          title: "Must include",
          summary: "Add two names",
          kind: "ticker_min",
          tickers: ["NVDA", "MSFT"],
          status: "proposed",
        },
      ],
    });
    const hints = computeOverlayDriftHints(overlay, {
      anchorWeights: SPY_ANCHOR,
      currentDrift: 0.5,
    });
    expect(hints.minRequiredDrift).toBeCloseTo(
      2 * MUST_INCLUDE_DRIFT_ESTIMATE,
      9,
    );
    expect(hints.sources.every((s) => s.kind === "must_include")).toBe(true);
  });

  it("U8: ticker_min with min_pct", () => {
    const overlay = baseOverlay({
      asks: [
        {
          id: "min-2",
          title: "Must include NVDA",
          summary: "5% floor",
          kind: "ticker_min",
          tickers: ["NVDA"],
          min_pct: 0.05,
          status: "proposed",
        },
      ],
    });
    const hints = computeOverlayDriftHints(overlay, {
      anchorWeights: SPY_ANCHOR,
      currentDrift: 0.5,
    });
    expect(hints.minRequiredDrift).toBeCloseTo(0.05, 9);
  });

  it("U9: narrative-only → zero demand", () => {
    const overlay = baseOverlay({
      market_view: {
        stance: "risk_on",
        themes: ["ai_technology", "hedging"],
        narrative_summary: "Prefer AI growth with some hedging.",
      },
    });
    const hints = computeOverlayDriftHints(overlay, {
      anchorWeights: SPY_ANCHOR,
      currentDrift: 0.3,
    });
    expect(hints.minRequiredDrift).toBe(0);
    expect(hints.sources).toEqual([]);
  });

  it("U10: slider-step ceil semantics", () => {
    // Use must_include floors so raw minRequired equals the ask pct exactly.
    const mk = (pct: number) =>
      computeOverlayDriftHints(
        baseOverlay({
          asks: [
            {
              id: "min-ceil",
              title: "Must include",
              summary: "floor",
              kind: "ticker_min",
              tickers: ["NVDA"],
              min_pct: pct,
              status: "proposed",
            },
          ],
        }),
        { anchorWeights: SPY_ANCHOR, currentDrift: 0.5 },
      );

    expect(mk(0.42).suggestedDrift).toBe(0.45);
    expect(mk(0.45).suggestedDrift).toBe(0.45);
    expect(mk(0.451).suggestedDrift).toBe(0.5);
  });

  it("U11: headroom caps at 1.0", () => {
    const hints = computeOverlayDriftHints(
      baseOverlay({
        asks: [
          {
            id: "min-head",
            title: "Must include",
            summary: "floor",
            kind: "ticker_min",
            tickers: ["NVDA"],
            min_pct: 0.95,
            status: "proposed",
          },
        ],
      }),
      { anchorWeights: SPY_ANCHOR, currentDrift: 0.5 },
    );
    expect(hints.suggestedDrift).toBe(0.95);
    expect(hints.headroomDrift).toBe(1);
  });

  it("U12: supervisor threshold via driftOverrideApproval", () => {
    const at60 = computeOverlayDriftHints(
      baseOverlay({
        asks: [
          {
            id: "min-60",
            title: "Must include",
            summary: "floor",
            kind: "ticker_min",
            tickers: ["NVDA"],
            min_pct: 0.6,
            status: "proposed",
          },
        ],
      }),
      { anchorWeights: SPY_ANCHOR, currentDrift: 0.5 },
    );
    expect(at60.suggestedDrift).toBe(0.6);
    expect(at60.requiresSupervisor).toBe(false);

    const at65 = computeOverlayDriftHints(
      baseOverlay({
        asks: [
          {
            id: "min-65",
            title: "Must include",
            summary: "floor",
            kind: "ticker_min",
            tickers: ["NVDA"],
            min_pct: 0.65,
            status: "proposed",
          },
        ],
      }),
      { anchorWeights: SPY_ANCHOR, currentDrift: 0.5 },
    );
    expect(at65.suggestedDrift).toBe(0.65);
    expect(at65.requiresSupervisor).toBe(true);
  });

  it("U13: feasible tolerance at equality", () => {
    const hints = computeOverlayDriftHints(
      baseOverlay({
        asks: [
          {
            id: "min-eq",
            title: "Must include",
            summary: "floor",
            kind: "ticker_min",
            tickers: ["NVDA"],
            min_pct: 0.45,
            status: "proposed",
          },
        ],
      }),
      { anchorWeights: SPY_ANCHOR, currentDrift: 0.45 + 1e-12 },
    );
    expect(hints.minRequiredDrift).toBeCloseTo(0.45, 9);
    expect(hints.feasible).toBe(true);
  });

  it("U15: empty membership pool falls back to anchor keys", () => {
    const overlay = baseOverlay({
      allocation: {
        asset_classes: ["equity"],
        sleeve_targets: { ai: 0.4 },
      },
      universe: { prompts: ["ai"], supplement_tickers: [] },
    });
    const hints = computeOverlayDriftHints(overlay, {
      anchorWeights: SPY_ANCHOR,
      currentDrift: 0.5,
    });
    // Fallback membership = [SPY]; target 0.4 on SPY → oneWay 0.3; finite, no throw.
    expect(Number.isFinite(hints.minRequiredDrift)).toBe(true);
    expect(hints.minRequiredDrift).toBeCloseTo(0.3, 5);
  });
});

describe("driftSyncActionForConfirm", () => {
  it("U14: raise when below suggested; never lower", () => {
    const hints = computeOverlayDriftHints(
      baseOverlay({
        asks: [
          {
            id: "min-raise",
            title: "Must include",
            summary: "floor",
            kind: "ticker_min",
            tickers: ["NVDA"],
            min_pct: 0.45,
            status: "proposed",
          },
        ],
      }),
      { anchorWeights: SPY_ANCHOR, currentDrift: 0.3 },
    );
    const raise = driftSyncActionForConfirm(hints, 0.3);
    expect(raise).toEqual({
      kind: "raise",
      from: 0.3,
      to: 0.45,
      requiresSupervisor: false,
    });

    expect(driftSyncActionForConfirm(hints, 0.45)).toEqual({ kind: "none" });
    expect(driftSyncActionForConfirm(hints, 0.8)).toEqual({ kind: "none" });
  });
});

describe("attachDriftSyncAudit", () => {
  it("U16: writes drift_sync, updates updated_at, schema-compatible", () => {
    const overlay = baseOverlay();
    const hints = computeOverlayDriftHints(
      baseOverlay({
        asks: [
          {
            id: "min-audit",
            title: "Must include",
            summary: "floor",
            kind: "ticker_min",
            tickers: ["NVDA"],
            min_pct: 0.45,
            status: "proposed",
          },
        ],
      }),
      { anchorWeights: SPY_ANCHOR, currentDrift: 0.3 },
    );
    const before = overlay.audit.updated_at;
    const next = attachDriftSyncAudit(overlay, hints, 0.45, 0.3);
    expect(next.audit.updated_at).not.toBe(before);
    expect(next.audit.drift_sync).toMatchObject({
      min_required_drift: hints.minRequiredDrift,
      applied_drift: 0.45,
      auto_raised: true,
      requires_supervisor: false,
    });
    expect(next.audit.drift_sync?.sources?.length).toBeGreaterThan(0);
    expect(next.audit.drift_sync).toBeDefined();
    // drift_sync is optional on the audit schema — old overlays without it still work
    const auditParsed = overlaySessionAuditSchema.safeParse(next.audit);
    expect(auditParsed.success).toBe(true);
    const oldAuditParsed = overlaySessionAuditSchema.safeParse(overlay.audit);
    expect(oldAuditParsed.success).toBe(true);
  });
});
