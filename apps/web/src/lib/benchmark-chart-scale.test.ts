import { describe, expect, it } from "vitest";
import {
  computeSharedDateDomain,
  dateRatio,
  parseDateTs,
  regimeBandRanges,
} from "./benchmark-chart-scale";

describe("benchmark-chart-scale", () => {
  it("uses min/max across benchmark and regime dates", () => {
    const domain = computeSharedDateDomain(
      [
        { date: "2024-03-15", cumulative_return_pct: 1, price_index: 100 },
        { date: "2024-06-01", cumulative_return_pct: 2, price_index: 101 },
      ],
      [{ date: "2024-01-10", regime: "neutral", objective: "balanced" }],
    );
    expect(domain).not.toBeNull();
    expect(domain!.min).toBe(parseDateTs("2024-01-10"));
    expect(domain!.max).toBe(parseDateTs("2024-06-01"));
  });

  it("places regime step on same scale as benchmark", () => {
    const min = parseDateTs("2024-01-01");
    const max = parseDateTs("2024-07-01");
    const step = parseDateTs("2024-04-01");
    expect(dateRatio(step, min, max)).toBeCloseTo(
      (step - min) / (max - min),
      5,
    );
  });

  it("extends last regime band to domain max", () => {
    const max = parseDateTs("2024-12-31");
    const bands = regimeBandRanges(
      [
        { date: "2024-06-01", regime: "risk_on", objective: "max_return" },
        { date: "2024-09-01", regime: "risk_off", objective: "min_dd" },
      ],
      max,
    );
    expect(bands).toHaveLength(2);
    expect(bands[1].endTs).toBe(max);
  });
});
