import { describe, expect, it } from "vitest";
import {
  DEFAULT_DIRECT_INDEX_SLEEVE,
  isUniverseStock,
  parseDirectIndexSleeveCount,
  pickDirectIndexStocks,
} from "./direct-indexing";
import { applyDirectIndexingToExtract } from "./overlay-direct-index";
import type { OverlayExtractOutput } from "./overlay-schema";
import { interpretOverlayFallback } from "./overlay-fallback";

function stockTickers(list: string[] | undefined): string[] {
  return (list ?? []).map((t) => t.toUpperCase()).filter((t) => isUniverseStock(t));
}

function emptyExtract(overrides: Partial<OverlayExtractOutput> = {}): OverlayExtractOutput {
  return {
    client_profile: { risk_tolerance: "moderate" },
    market_view: {
      stance: "risk_on",
      themes: [],
      narrative_summary: "Direct index overlay extract.",
    },
    allocation: { asset_classes: ["equity"] },
    universe: { prompts: [] },
    optimization: { objective: "max_sharpe" },
    clarification_questions: [],
    confidence: 0.8,
    rationale: "Direct index with stocks for the overlay extract.",
    ...overrides,
  };
}

describe("parseDirectIndexSleeveCount", () => {
  it("reads top 30 / 前 30 / 상위 30 and ignores S&P 500", () => {
    expect(parseDirectIndexSleeveCount("direct index S&P 500 top 30")).toBe(30);
    expect(parseDirectIndexSleeveCount("實施標普 500 直接索引，前 30 檔")).toBe(30);
    expect(parseDirectIndexSleeveCount("S&P 500 직접 인덱싱 상위 30")).toBe(30);
    expect(parseDirectIndexSleeveCount("前三十大個股直接指數化")).toBe(30);
    expect(parseDirectIndexSleeveCount("Implement direct indexing on SPY")).toBeUndefined();
    expect(parseDirectIndexSleeveCount("S&P 500 direct indexing")).toBeUndefined();
  });

  it("prefers the last stated count (clarification wins)", () => {
    expect(
      parseDirectIndexSleeveCount("direct index top 10\nClarification answers:\nA1: top 30"),
    ).toBe(30);
  });
});

describe("pickDirectIndexStocks sleeve size", () => {
  it("defaults to the compact mega sleeve when no N is stated", () => {
    const stocks = pickDirectIndexStocks("Implement direct indexing on SPY");
    expect(stocks.length).toBeGreaterThanOrEqual(DEFAULT_DIRECT_INDEX_SLEEVE);
    expect(stocks.length).toBeLessThanOrEqual(12);
    expect(stocks).toEqual(expect.arrayContaining(["AAPL", "MSFT", "NVDA", "BRK-B"]));
    expect(new Set(stocks).size).toBe(stocks.length);
  });

  it("honors top 30 as S&P large-caps, with AI as overweight not replacement", () => {
    const stocks = pickDirectIndexStocks(
      "direct indexing on SPY using S&P 500 top 30 with a moderate AI overweight",
    );
    expect(stocks.length).toBeGreaterThanOrEqual(30);
    expect(stocks.filter((t) => isUniverseStock(t)).length).toBeGreaterThanOrEqual(30);
    expect(stocks).toContain("NVDA");
    expect(stocks).toContain("MSFT");
    expect(stocks).toContain("BRK-B");
    expect(stocks).toContain("JPM");
    expect(stocks.indexOf("NVDA")).toBeLessThan(stocks.indexOf("BRK-B"));
  });

  it("honors 前 30", () => {
    const stocks = pickDirectIndexStocks("實施 SPY 標普 500 指數直接索引策略，使用前 30 檔");
    expect(stocks.filter((t) => isUniverseStock(t)).length).toBeGreaterThanOrEqual(30);
  });
});

describe("applyDirectIndexingToExtract does not keep the 8-name default when N=30", () => {
  it("expands Gemini's 8 mega-caps when the brief says top 30", () => {
    const extract = emptyExtract({
      universe: {
        construction: "direct_index",
        prompts: ["Direct index S&P 500"],
        supplement_tickers: ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "AVGO", "BRK-B"],
        proposed_tickers: [
          "AAPL",
          "MSFT",
          "NVDA",
          "AMZN",
          "GOOGL",
          "META",
          "AVGO",
          "BRK-B",
        ].map((ticker) => ({ ticker })),
      },
    });
    const out = applyDirectIndexingToExtract(
      extract,
      "Q1: How many names?\nA1: S&P 500 top 30",
      "en",
    );
    const supplements = stockTickers(out.universe.supplement_tickers);
    const proposed = stockTickers(out.universe.proposed_tickers?.map((p) => p.ticker));
    expect(supplements.length).toBeGreaterThanOrEqual(30);
    expect(proposed.length).toBeGreaterThanOrEqual(30);
    expect(out.asks?.find((a) => a.kind === "direct_index")?.tickers?.length).toBeGreaterThanOrEqual(
      30,
    );
  });
});

describe("overlay fallback summary sleeve", () => {
  it("lists ~8 names by default and ~30 when top 30 / 前 30 is stated", () => {
    const compact = interpretOverlayFallback(
      "Implement direct indexing on SPY with a moderate AI industry overweight",
      "en",
      "ovl-di-default",
      1,
    );
    const compactStocks = stockTickers(compact.universe.supplement_tickers);
    expect(compactStocks.length).toBeGreaterThanOrEqual(DEFAULT_DIRECT_INDEX_SLEEVE);
    expect(compactStocks.length).toBeLessThanOrEqual(12);

    const top30 = interpretOverlayFallback(
      "Implement direct indexing on the S&P 500 top 30 stocks with AI overweight",
      "en",
      "ovl-di-top30",
      1,
    );
    expect(stockTickers(top30.universe.supplement_tickers).length).toBeGreaterThanOrEqual(30);
    expect(
      stockTickers(top30.universe.proposed_tickers?.map((p) => p.ticker)).length,
    ).toBeGreaterThanOrEqual(30);

    const zh = interpretOverlayFallback(
      "實施 SPY 標普 500 指數直接索引，使用前 30 檔大型股",
      "zh",
      "ovl-di-zh-30",
      1,
    );
    expect(stockTickers(zh.universe.supplement_tickers).length).toBeGreaterThanOrEqual(30);
  });
});
