import { describe, expect, it } from "vitest";
import {
  DEFAULT_BACKTEST_START,
  lastCompletedMonthEnd,
} from "./default-backtest-dates";

describe("lastCompletedMonthEnd", () => {
  it("returns prior month-end for mid-month dates", () => {
    expect(lastCompletedMonthEnd(new Date(2026, 6, 14))).toBe("2026-06-30");
    expect(lastCompletedMonthEnd(new Date(2026, 0, 15))).toBe("2025-12-31");
  });

  it("returns prior month-end on the 1st of a month", () => {
    expect(lastCompletedMonthEnd(new Date(2026, 6, 1))).toBe("2026-06-30");
  });

  it("handles February in leap years", () => {
    expect(lastCompletedMonthEnd(new Date(2024, 2, 5))).toBe("2024-02-29");
  });

  it("keeps a sensible default start", () => {
    expect(DEFAULT_BACKTEST_START).toBe("2010-01-01");
  });
});
