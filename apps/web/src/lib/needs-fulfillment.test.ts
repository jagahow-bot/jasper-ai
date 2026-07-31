import { describe, expect, it } from "vitest";
import { needsAllPassed, needsFloorRows } from "./needs-fulfillment";

describe("needs-fulfillment", () => {
  it("builds ledger rows with actual/limit detail", () => {
    const rows = needsFloorRows({
      max_drawdown_tolerance: 0.2,
      max_drawdown_actual: 0.18,
      within_drawdown_tolerance: true,
      must_include_tickers: ["BOTZ", "AIQ"],
      missing_must_include: ["BOTZ"],
      within_must_include: false,
      customization_drift_cap: 0.1,
      customization_drift_l1: 0.4,
      within_customization_drift: false,
    });
    expect(rows.map((r) => r.key)).toEqual([
      "drawdown",
      "mustInclude",
      "drift",
    ]);
    expect(rows.find((r) => r.key === "mustInclude")?.detail).toBe("BOTZ");
    expect(rows.find((r) => r.key === "drift")?.detail).toBe("40.0% / 10.0%");
    expect(needsAllPassed({
      within_drawdown_tolerance: true,
      within_must_include: false,
      max_drawdown_tolerance: 0.2,
      must_include_tickers: ["BOTZ"],
    })).toBe(false);
  });

  it("returns null overall when no commitments", () => {
    expect(needsAllPassed(null)).toBeNull();
    expect(needsFloorRows(null)).toEqual([]);
  });
});
