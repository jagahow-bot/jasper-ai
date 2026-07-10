import { describe, expect, it } from "vitest";
import {
  benchmarkTickerMismatch,
  resolveResultBenchmarkTicker,
} from "./resolve-result-benchmark";

describe("resolveResultBenchmarkTicker", () => {
  it("prefers job backtest_spec benchmark for metrics alignment", () => {
    expect(
      resolveResultBenchmarkTicker(
        { benchmark_ticker: "SPY" },
        { backtest_spec: { benchmark: "VT" } },
      ),
    ).toBe("VT");
  });

  it("falls back to request benchmark when job spec is missing", () => {
    expect(
      resolveResultBenchmarkTicker({ benchmark_ticker: "QQQ" }, {}),
    ).toBe("QQQ");
  });

  it("defaults to SPY", () => {
    expect(resolveResultBenchmarkTicker(null, null)).toBe("SPY");
  });
});

describe("benchmarkTickerMismatch", () => {
  it("detects anchor vs stale job benchmark", () => {
    expect(
      benchmarkTickerMismatch(
        { benchmark_ticker: "SPY" },
        { backtest_spec: { benchmark: "VT" } },
      ),
    ).toBe(true);
  });

  it("is false when aligned or incomplete", () => {
    expect(
      benchmarkTickerMismatch(
        { benchmark_ticker: "SPY" },
        { backtest_spec: { benchmark: "SPY" } },
      ),
    ).toBe(false);
    expect(benchmarkTickerMismatch({}, { backtest_spec: { benchmark: "VT" } })).toBe(
      false,
    );
  });
});
