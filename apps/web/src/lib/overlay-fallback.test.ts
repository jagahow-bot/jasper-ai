import { describe, expect, it } from "vitest";
import { interpretOverlayFallback } from "./overlay-fallback";
import { isThematicSubstituteEtf, isUniverseStock } from "./direct-indexing";

const THEMATIC = ["AIQ", "BOTZ", "IRBO"];

function stockShare(tickers: string[]): number {
  if (!tickers.length) return 0;
  return tickers.filter((t) => isUniverseStock(t)).length / tickers.length;
}

describe("direct indexing overlay fallback", () => {
  it("maps English DI + AI tilt to stocks, not thematic ETFs", () => {
    const ov = interpretOverlayFallback(
      "Implement direct indexing on SPY with a moderate AI industry overweight",
      "en",
      "ovl-di-en-01",
      1,
    );
    const proposed = (ov.universe.proposed_tickers ?? []).map((p) => p.ticker.toUpperCase());
    const supplements = (ov.universe.supplement_tickers ?? []).map((t) => t.toUpperCase());
    const combined = [...proposed, ...supplements];

    expect(ov.universe.construction).toBe("direct_index");
    expect(ov.asks?.some((a) => a.kind === "direct_index")).toBe(true);
    expect(ov.asks?.some((a) => /direct index with stocks/i.test(a.title) || /direct index with stocks/i.test(a.summary))).toBe(
      true,
    );
    expect(combined.length).toBeGreaterThan(0);
    expect(stockShare(combined)).toBeGreaterThan(0.7);
    for (const t of THEMATIC) {
      expect(combined).not.toContain(t);
      expect(isThematicSubstituteEtf(t)).toBe(true);
    }
    expect(combined).toContain("NVDA");
    expect(combined).toContain("MSFT");
  });

  it("maps 直接索引 + AI 產業 to stocks (zh)", () => {
    const ov = interpretOverlayFallback(
      "實施 SPY 標普 500 指數直接索引策略，並適度提高 AI 產業配置權重",
      "zh",
      "ovl-di-zh-01",
      1,
    );
    const proposed = (ov.universe.proposed_tickers ?? []).map((p) => p.ticker.toUpperCase());
    const supplements = (ov.universe.supplement_tickers ?? []).map((t) => t.toUpperCase());
    const combined = [...proposed, ...supplements];

    expect(ov.universe.construction).toBe("direct_index");
    expect(ov.asks?.[0]?.kind).toBe("direct_index");
    expect(stockShare(combined)).toBeGreaterThan(0.7);
    for (const t of THEMATIC) {
      expect(combined).not.toContain(t);
    }
  });

  it("maps Korean 직접 인덱싱 to stocks", () => {
    const ov = interpretOverlayFallback(
      "SPY 직접 인덱싱 전략을 시행하고 AI 비중을 소폭 확대",
      "ko",
      "ovl-di-ko-01",
      1,
    );
    const combined = [
      ...(ov.universe.proposed_tickers ?? []).map((p) => p.ticker),
      ...(ov.universe.supplement_tickers ?? []),
    ].map((t) => t.toUpperCase());
    expect(ov.universe.construction).toBe("direct_index");
    expect(stockShare(combined)).toBeGreaterThan(0.7);
    expect(combined).not.toContain("AIQ");
  });
});
