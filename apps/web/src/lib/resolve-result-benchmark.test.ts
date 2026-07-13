import { describe, expect, it } from "vitest";
import {
  benchmarkTickerMismatch,
  resolveJobBenchmarkTicker,
  resolveResultBenchmarkTicker,
} from "./resolve-result-benchmark";

describe("resolveResultBenchmarkTicker", () => {
  it("prefers explicit request benchmark over stale job backtest_spec", () => {
    expect(
      resolveResultBenchmarkTicker(
        { benchmark_ticker: "SPY" },
        { backtest_spec: { benchmark: "ACWI" } },
      ),
    ).toBe("SPY");
  });

  it("falls back to job backtest_spec when request benchmark is missing", () => {
    expect(
      resolveResultBenchmarkTicker(
        {},
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

describe("resolveJobBenchmarkTicker", () => {
  it("reads persisted job benchmark", () => {
    expect(
      resolveJobBenchmarkTicker({ backtest_spec: { benchmark: "acwi" } }),
    ).toBe("ACWI");
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
