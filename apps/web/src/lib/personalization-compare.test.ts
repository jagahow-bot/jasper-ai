import { describe, expect, it } from "vitest";
import {
  buildSingleTrackPersonalizationCompare,
  isSingleTrackPersonalizationCompare,
} from "@/lib/personalization-compare";
import type { BacktestRequest, BacktestResult, PersonalizationCompare } from "@/lib/types";

function stubResult(jobId: string): BacktestResult {
  return {
    job_id: jobId,
    candidates: [],
    equity_curve: [],
    narrative_facts: {},
  } as unknown as BacktestResult;
}

function stubRequest(overrides: Partial<BacktestRequest> = {}): BacktestRequest {
  return {
    start_date: "2020-01-01",
    end_date: "2024-12-31",
    objective: "min_max_drawdown",
    ...overrides,
  } as BacktestRequest;
}

describe("personalization-compare", () => {
  it("buildSingleTrackPersonalizationCompare mirrors solo result and forces skip flag", () => {
    const result = stubResult("solo-1");
    const request = stubRequest({ skip_anchor_compare: true });
    const compare = buildSingleTrackPersonalizationCompare({
      result,
      request,
      anchorPortfolioId: "skip-baseline",
      anchorLabel: "No baseline",
      customizedLabel: "Customized",
    });

    expect(compare.baseResult).toBe(result);
    expect(compare.adjustedResult).toBe(result);
    expect(compare.adjustedRequest.skip_anchor_compare).toBe(true);
    expect(compare.adjustedRequest.anchor_job_id).toBeNull();
    expect(isSingleTrackPersonalizationCompare(compare)).toBe(true);
  });

  it("isSingleTrackPersonalizationCompare is false for distinct dual-track jobs", () => {
    const compare: PersonalizationCompare = {
      anchorPortfolioId: "classic-60-40",
      anchorLabel: "Balanced",
      customizedLabel: "Customized",
      baseResult: stubResult("anchor"),
      baseRequest: stubRequest(),
      adjustedResult: stubResult("custom"),
      adjustedRequest: stubRequest({ skip_anchor_compare: false }),
    };
    expect(isSingleTrackPersonalizationCompare(compare)).toBe(false);
  });
});
