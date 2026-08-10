import { describe, expect, it } from "vitest";
import {
  calendarYearReturnsFromEquityCurve,
  empiricalPercentile,
  planningReturnBandFromAnnualReturns,
  winsorizeReturns,
} from "./financial-goal-planning-returns";

describe("empiricalPercentile", () => {
  it("interpolates", () => {
    expect(empiricalPercentile([0, 10], 0.5)).toBeCloseTo(5, 6);
    expect(empiricalPercentile([1, 2, 3, 4], 0)).toBe(1);
    expect(empiricalPercentile([1, 2, 3, 4], 1)).toBe(4);
  });
});

describe("winsorizeReturns", () => {
  it("clips a single extreme bull year", () => {
    const rets = [0.08, 0.09, 0.1, 0.07, 0.11, 0.85];
    const w = winsorizeReturns(rets);
    expect(Math.max(...w)).toBeLessThan(0.85);
    expect(Math.max(...w)).toBeLessThanOrEqual(0.5);
  });
});

describe("calendarYearReturnsFromEquityCurve", () => {
  it("computes consecutive calendar-year returns", () => {
    const curve = [
      { date: "2020-01-02", value: 100 },
      { date: "2020-12-31", value: 110 },
      { date: "2021-12-31", value: 121 },
      { date: "2022-12-30", value: 100 },
      { date: "2023-12-29", value: 115 },
    ];
    const rets = calendarYearReturnsFromEquityCurve(curve);
    expect(rets).toHaveLength(3);
    expect(rets[0]).toBeCloseTo(121 / 110 - 1, 6);
  });
});

describe("planningReturnBandFromAnnualReturns", () => {
  it("caps base at winsorized average, not a fixed 10%", () => {
    const rets = [-0.1, 0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4];
    const band = planningReturnBandFromAnnualReturns(rets, 0.05, 0.6);
    expect(band.method).toBe("winsorized_mean_cap");
    expect(band.confidenceLevel).toBe(0.6);
    expect(band.baseReturn).toBeLessThanOrEqual(band.planningCeiling + 1e-9);
    expect(band.planningCeiling).toBeCloseTo(band.arithmeticMean, 6);
    // No fixed 10% philosophy ceiling — high samples may exceed 10%.
    expect(band.planningCeiling).toBeGreaterThan(0.1);
    expect(band.geometricMean).toBeGreaterThanOrEqual(band.baseReturn - 1e-9);
  });

  it("raises confidence → lowers empirical floor (not stuck at base)", () => {
    const rets = [-0.1, 0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4];
    const at50 = planningReturnBandFromAnnualReturns(rets, 0.05, 0.5);
    const at70 = planningReturnBandFromAnnualReturns(rets, 0.05, 0.7);
    const at90 = planningReturnBandFromAnnualReturns(rets, 0.05, 0.9);
    expect(at50.floorReturn).toBeGreaterThan(at70.floorReturn);
    expect(at70.floorReturn).toBeGreaterThan(at90.floorReturn);
    // Conservative band only bites when floor is below the planning base.
    expect(at90.conservativeDelta).toBeGreaterThanOrEqual(at50.conservativeDelta);
  });

  it("dampens a single-year outlier versus raw geo mean", () => {
    const calm = [0.06, 0.07, 0.08, 0.05, 0.09, 0.07, 0.08, 0.06];
    const spiked = [...calm, 1.2];
    const calmBand = planningReturnBandFromAnnualReturns(calm, 0.05, 0.6);
    const spikeBand = planningReturnBandFromAnnualReturns(spiked, 0.05, 0.6);
    expect(spikeBand.baseReturn - calmBand.baseReturn).toBeLessThan(0.03);
    expect(spikeBand.geometricMean).toBeGreaterThan(spikeBand.winsorizedGeometricMean);
  });

  it("falls back to prior when too few years", () => {
    const band = planningReturnBandFromAnnualReturns([0.3, 0.4], 0.05, 0.6);
    expect(band.method).toBe("prior_fallback");
    expect(band.baseReturn).toBeCloseTo(0.05, 6);
  });
});
