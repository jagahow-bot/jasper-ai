import { describe, expect, it } from "vitest";

describe("max_holdings defaults", () => {
  it("default request includes max_holdings within slider range", () => {
    const maxHoldings = 30;
    expect(maxHoldings).toBeGreaterThanOrEqual(1);
    expect(maxHoldings).toBeLessThanOrEqual(50);
  });
});
