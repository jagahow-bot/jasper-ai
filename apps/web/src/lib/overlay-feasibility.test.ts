import { describe, expect, it } from "vitest";
import {
  DRIFT_OVERRIDE_RM_MAX,
  buildInfeasibleDriftConflict,
  driftOverrideApproval,
  minL1DriftForTarget,
  validateCapabilityGapStages,
} from "./overlay-feasibility";

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
});
