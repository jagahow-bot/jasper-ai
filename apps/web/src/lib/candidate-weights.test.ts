import { describe, expect, it } from "vitest";
import {
  buildAllocationRows,
  formatWeightPct,
  largestRemainderPercents,
  resolveCandidateWeights,
  weightsFromLatestHistory,
} from "./candidate-weights";

describe("candidate-weights", () => {
  it("reads terminal weight_history and ignores chart OTHER dust", () => {
    expect(
      weightsFromLatestHistory([
        { date: "2020-01-01", SPY: 0.5, QQQ: 0.5 },
        { date: "2021-01-01", SPY: 0.1735, QQQ: 0.226, OTHER: 0.0005, SMH: 0.1505 },
      ]),
    ).toEqual({ SPY: 0.1735, QQQ: 0.226, SMH: 0.1505 });
  });

  it("returns null when chart OTHER is truncated mass", () => {
    expect(
      weightsFromLatestHistory([
        { date: "2021-01-01", SPY: 0.1735, QQQ: 0.226, OTHER: 0.05, SMH: 0.1505 },
      ]),
    ).toBeNull();
  });

  it("keeps tiny named holdings instead of folding into OTHER", () => {
    expect(
      weightsFromLatestHistory(
        [{ date: "2026-06-30", SPY: 0.6, QQQ: 0.399, TINY: 0.001 }],
        0.0005,
      ),
    ).toEqual({ SPY: 0.6, QQQ: 0.399, TINY: 0.001 });
  });

  it("prefers weight_history over packaged round weights", () => {
    const resolved = resolveCandidateWeights({
      weights: { SMH: 0.2, SOXX: 0.2, SPY: 0.2, RSP: 0.15, USMV: 0.15 },
      analytics: {
        weight_history: [
          {
            date: "2026-06-30",
            SPY: 0.1147,
            SMH: 0.2,
            SOXX: 0.2,
            RSP: 0.1076,
            SCHD: 0.1506,
            USMV: 0.0294,
            XLV: 0.134,
            XLP: 0.0636,
          },
        ],
      },
    });
    expect(resolved.SPY).toBeCloseTo(0.1147, 4);
    expect(resolved.USMV).toBeCloseTo(0.0294, 4);
    expect(resolved.RSP).toBeCloseTo(0.1076, 4);
  });

  it("falls back to packaged weights when history OTHER is truncated", () => {
    const resolved = resolveCandidateWeights({
      weights: { SPY: 0.4, QQQ: 0.35, IWM: 0.2, GLD: 0.05 },
      analytics: {
        weight_history: [
          { date: "2026-06-30", SPY: 0.4, QQQ: 0.35, OTHER: 0.25 },
        ],
      },
    });
    expect(resolved).toEqual({ SPY: 0.4, QQQ: 0.35, IWM: 0.2, GLD: 0.05 });
    expect(resolved.OTHER).toBeUndefined();
  });

  it("formats weight percents to 2 decimals", () => {
    expect(formatWeightPct(20.0)).toBe("20.00%");
    expect(formatWeightPct(17.51)).toBe("17.51%");
  });

  it("largest-remainder display percents sum to 100 for equal thirds", () => {
    const pcts = largestRemainderPercents({
      GLD: 0.15,
      VWELX: 0.15,
      AGG: 0.15,
      SHY: 0.15,
      PG: 0.13333333333333336,
      IVV: 0.13333333333333336,
      TLT: 0.13333333333333336,
    });
    const sum = Object.values(pcts).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(100, 6);
    expect(
      Object.values(pcts).every((p) => Math.abs(p * 100 - Math.round(p * 100)) < 1e-9),
    ).toBe(true);
  });

  it("allocation rows for 4dp-packaged weights display as 100%", () => {
    const rows = buildAllocationRows({
      GLD: 0.15,
      VWELX: 0.15,
      AGG: 0.15,
      SHY: 0.15,
      PG: 0.1333,
      IVV: 0.1333,
      TLT: 0.1333,
    });
    const sumPct = rows.reduce((s, r) => s + r.pct, 0);
    expect(sumPct).toBeCloseTo(100, 6);
    expect(rows.some((r) => r.ticker === "OTHER" || r.ticker === "CASH")).toBe(false);
  });

  it("lists every named holding instead of inventing OTHER", () => {
    const rows = buildAllocationRows(
      { SPY: 0.6, QQQ: 0.35, AAA: 0.03, BBB: 0.02 },
      0.05,
    );
    // minWeight only drops rows below threshold; does not invent OTHER for the rest.
    expect(rows.map((r) => r.ticker).sort()).toEqual(["QQQ", "SPY"]);
    expect(rows.some((r) => r.ticker === "OTHER")).toBe(false);
    expect(rows.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(95, 6);
  });

  it("keeps small named holdings as their own rows", () => {
    const rows = buildAllocationRows({ SPY: 0.6, QQQ: 0.35, AAA: 0.03, BBB: 0.02 });
    expect(rows.find((r) => r.ticker === "AAA")).toBeDefined();
    expect(rows.find((r) => r.ticker === "BBB")).toBeDefined();
    expect(rows.some((r) => r.ticker === "OTHER")).toBe(false);
    expect(rows.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(100, 6);
  });

  it("keeps explicit CASH sleeve without inventing OTHER", () => {
    const rows = buildAllocationRows({ SPY: 0.7, QQQ: 0.25, CASH: 0.05 });
    expect(rows.find((r) => r.ticker === "CASH")?.pct).toBeCloseTo(5, 2);
    expect(rows.some((r) => r.ticker === "OTHER")).toBe(false);
  });

  it("adds implicit CASH when cash_reserve leaves partial investment", () => {
    const rows = buildAllocationRows({
      SPY: 0.0669,
      AVGO: 0.0667,
      BOTZ: 0.0667,
      GLD: 0.0667,
      GOOGL: 0.0666,
      MSFT: 0.0666,
      NVDA: 0.0666,
      SMH: 0.0666,
      TLT: 0.0666,
    });
    expect(rows.find((r) => r.ticker === "CASH")?.pct).toBeCloseTo(40, 1);
    expect(rows.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(100, 6);
  });
});
