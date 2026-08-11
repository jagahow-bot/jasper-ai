import { describe, expect, it } from "vitest";
import { holdingDisplayName } from "./clients";
import { etfDisplayName } from "./etf-display-name";
import type { TFn } from "./i18n";

const t: TFn = ((key: string) => key) as TFn;

describe("etfDisplayName language awareness", () => {
  it("returns English for AAPL/DIS when UI lang is en", () => {
    expect(etfDisplayName("AAPL", "en")).toBe("Apple");
    expect(etfDisplayName("DIS", "en")).toBe("Walt Disney");
  });

  it("returns Chinese for AAPL/DIS when UI lang is zh", () => {
    expect(etfDisplayName("AAPL", "zh")).toBe("蘋果");
    expect(etfDisplayName("DIS", "zh")).toBe("迪士尼");
  });

  it("keeps EWT English label in en UI", () => {
    expect(etfDisplayName("EWT", "en")).toBe("iShares MSCI Taiwan ETF");
  });
});

describe("holdingDisplayName", () => {
  it("shows English demo holding names in en UI for AAPL/DIS", () => {
    expect(
      holdingDisplayName({ ticker: "AAPL", name: "Apple" }, t, "en"),
    ).toBe("Apple");
    expect(
      holdingDisplayName({ ticker: "DIS", name: "Walt Disney" }, t, "en"),
    ).toBe("Walt Disney");
  });

  it("falls back to English holding.name when map/universe would be wrong-script", () => {
    // Even if localized path were ticker-only, own English name wins.
    expect(
      holdingDisplayName({ ticker: "ZZZZ", name: "Custom English Co" }, t, "en"),
    ).toBe("Custom English Co");
  });
});
