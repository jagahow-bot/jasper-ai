import { describe, expect, it } from "vitest";
import {
  hasEngineCapabilityReviewContent,
  isLegacyEnginePin,
  stageImplementationsDifferFromDefault,
} from "@/lib/engine-capability-review";
import type { BacktestResult } from "@/lib/types";
import type { ClientOverlay } from "@/lib/overlay-schema";
import stageCards from "@/data/stage-cards.json";

function bareResult(
  overrides: Partial<BacktestResult> = {},
): BacktestResult {
  return {
    job_id: "j1",
    scenario_id: "s1",
    benchmark: "SPY",
    period: { start: "2020-01-01", end: "2024-01-01" },
    candidates: [],
    equity_curve: [],
    efficient_frontier: [],
    narrative_facts: {},
    ...overrides,
  };
}

describe("engine-capability-review", () => {
  it("hides when only default stage pins are present", () => {
    const result = bareResult({
      stage_catalog_version: stageCards.catalog_version,
      stage_implementations: {
        ...(stageCards.stage_implementations as Record<string, string>),
      },
      param_catalog_version: 1,
      capabilities_used: null,
    });
    expect(hasEngineCapabilityReviewContent(result, null)).toBe(false);
  });

  it("shows for legacy pins", () => {
    const result = bareResult({
      stage_catalog_version: "v0-legacy",
      stage_implementations: "legacy-monolith",
    });
    expect(isLegacyEnginePin(result)).toBe(true);
    expect(hasEngineCapabilityReviewContent(result, null)).toBe(true);
  });

  it("shows when capabilities_used is non-empty", () => {
    const result = bareResult({
      capabilities_used: [
        {
          stage: "signals",
          implementation_id: "contrib_x",
          version: "0.1.0",
          status: "rm_confirmed",
          pending_supervisor_signoff: true,
        },
      ],
    });
    expect(hasEngineCapabilityReviewContent(result, null)).toBe(true);
  });

  it("shows when overlay has capability_gaps", () => {
    const overlay = {
      capability_gaps: [
        {
          stage: "allocator",
          kind: "unsupported_lever",
          missing_capability: "custom_tax_lot",
          summary: "Cannot express tax-lot harvesting.",
          requested: {},
          severity: "blocking",
        },
      ],
    } as ClientOverlay;
    expect(hasEngineCapabilityReviewContent(bareResult(), overlay)).toBe(true);
  });

  it("detects non-default stage implementations", () => {
    expect(
      stageImplementationsDifferFromDefault({
        ...(stageCards.stage_implementations as Record<string, string>),
        signals: "contrib_alt@2.0.0",
      }),
    ).toBe(true);
    expect(
      stageImplementationsDifferFromDefault({
        ...(stageCards.stage_implementations as Record<string, string>),
      }),
    ).toBe(false);
  });
});
