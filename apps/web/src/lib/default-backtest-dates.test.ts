import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_BACKTEST_START,
  lastCompletedMonthEnd,
} from "./default-backtest-dates";

describe("lastCompletedMonthEnd", () => {
  it("returns prior month-end for mid-month dates", () => {
    assert.equal(lastCompletedMonthEnd(new Date(2026, 6, 14)), "2026-06-30");
    assert.equal(lastCompletedMonthEnd(new Date(2026, 0, 15)), "2025-12-31");
  });

  it("returns prior month-end on the 1st of a month", () => {
    assert.equal(lastCompletedMonthEnd(new Date(2026, 6, 1)), "2026-06-30");
  });

  it("handles February in leap years", () => {
    assert.equal(lastCompletedMonthEnd(new Date(2024, 2, 5)), "2024-02-29");
  });

  it("keeps a sensible default start", () => {
    assert.equal(DEFAULT_BACKTEST_START, "2018-01-01");
  });
});
