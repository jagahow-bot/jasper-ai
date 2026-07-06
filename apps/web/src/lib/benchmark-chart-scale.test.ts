import { describe, expect, it } from "vitest";
import {
  activeObjectiveAtTs,
  activeRegimeAtTs,
  alignWeightHistoryToEquityStart,
  extendWeightHistoryToEquityEnd,
  computeSharedDateDomain,
  dateRatio,
  formatChartTooltipLabel,
  objectiveBandRanges,
  parseDateTs,
  regimeBandRanges,
} from "./benchmark-chart-scale";

describe("benchmark-chart-scale", () => {
  it("alignWeightHistoryToEquityStart prepends equity anchor", () => {
    const out = alignWeightHistoryToEquityStart(
      [
        { date: "2020-03-01", SPY: 0.6 },
        { date: "2020-06-01", SPY: 0.7 },
      ],
      "2020-01-02",
    );
    expect(out[0].date).toBe("2020-01-02");
    expect(out[0].SPY).toBe(0.6);
    expect(out).toHaveLength(3);
  });

  it("extendWeightHistoryToEquityEnd appends terminal snapshot", () => {
    const out = extendWeightHistoryToEquityEnd(
      [
        { date: "2020-01-02", SPY: 0.6 },
        { date: "2020-03-01", SPY: 0.7 },
      ],
      "2020-06-30",
    );
    expect(out).toHaveLength(3);
    expect(out[2].date).toBe("2020-06-30");
    expect(out[2].SPY).toBe(0.7);
  });

  it("formats millisecond tooltip labels as ISO dates", () => {
    const ts = parseDateTs("2025-04-11");
    expect(formatChartTooltipLabel(ts)).toBe("2025-04-11");
    expect(formatChartTooltipLabel("2025-04-11")).toBe("2025-04-11");
  });

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

  it("includes score timeline dates in shared domain", () => {
    const domain = computeSharedDateDomain(
      [{ date: "2024-06-01", cumulative_return_pct: 0, price_index: 100 }],
      [],
      [{ date: "2024-01-01", active_regime: "neutral", switched: false }],
    );
    expect(domain!.min).toBe(parseDateTs("2024-01-01"));
    expect(domain!.max).toBe(parseDateTs("2024-06-01"));
  });

  it("resolves active regime at hovered timestamp", () => {
    const timeline = [
      { date: "2024-01-01", regime: "neutral", objective: "balanced" },
      {
        date: "2024-04-01",
        regime: "risk_on",
        active_regime: "risk_on",
        objective: "max_return",
      },
      {
        date: "2024-07-01",
        regime: "risk_off",
        active_regime: "risk_off",
        objective: "min_dd",
      },
    ];
    expect(activeRegimeAtTs(parseDateTs("2024-05-15"), timeline)).toBe("risk_on");
    expect(activeRegimeAtTs(parseDateTs("2024-07-01"), timeline)).toBe("risk_off");
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

  it("resolves active objective at hovered timestamp", () => {
    const timeline = [
      { date: "2024-01-01", regime: "neutral", objective: "max_sharpe" },
      { date: "2024-04-01", regime: "risk_on", objective: "max_return" },
      { date: "2024-07-01", regime: "risk_off", objective: "min_max_drawdown" },
    ];
    expect(activeObjectiveAtTs(parseDateTs("2024-05-15"), timeline)).toBe("max_return");
    expect(activeObjectiveAtTs(parseDateTs("2024-08-01"), timeline)).toBe(
      "min_max_drawdown",
    );
  });

  it("extends last objective band to domain max", () => {
    const max = parseDateTs("2024-12-31");
    const bands = objectiveBandRanges(
      [
        { date: "2024-06-01", regime: "risk_on", objective: "max_return" },
        { date: "2024-09-01", regime: "risk_off", objective: "min_max_drawdown" },
      ],
      max,
    );
    expect(bands).toHaveLength(2);
    expect(bands[1].objective).toBe("min_max_drawdown");
    expect(bands[1].endTs).toBe(max);
  });
});
