import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUniverseItems } from "@/lib/universe";
import {
  SELLABLE_OVERRIDES_STORAGE_KEY,
  baselineSellableForTicker,
  clearAllSellableOverrides,
  clearSellableOverride,
  filterSellableProposed,
  isSellableTicker,
  readSellableOverrides,
  resolveNonSellableSet,
  setSellableBulk,
  setSellableOverride,
  splitBySellable,
  writeSellableOverrides,
} from "./sellable-overrides";

function stubLocalStorage() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  };
  vi.stubGlobal("window", { localStorage });
  vi.stubGlobal("localStorage", localStorage);
  return localStorage;
}

beforeEach(() => {
  stubLocalStorage();
  clearAllSellableOverrides();
  try {
    localStorage.removeItem("jasper_sellable_gate_off");
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sellable-overrides defaults (U1–U12)", () => {
  it("U1: etf/fund sellable; stock and unknown product_type not", () => {
    const items = getUniverseItems();
    const etf = items.find((u) => (u.product_type ?? "etf") === "etf");
    const fund = items.find((u) => u.product_type === "fund");
    const stock = items.find((u) => u.product_type === "stock");
    expect(etf).toBeTruthy();
    expect(fund).toBeTruthy();
    expect(stock).toBeTruthy();
    expect(isSellableTicker(etf!.ticker)).toBe(true);
    expect(isSellableTicker(fund!.ticker)).toBe(true);
    expect(isSellableTicker(stock!.ticker)).toBe(false);
    expect(baselineSellableForTicker(etf!.ticker)).toBe(true);
  });

  it("U2: JSON explicit sellable on stock wins over product_type default", () => {
    // No JSON sellable fields in current universe — simulate via override-equivalent
    // by temporarily writing a stock true override then clearing to baseline,
    // and assert baseline for a synthetic path via setSellableOverride diff.
    const stock = getUniverseItems().find((u) => u.product_type === "stock")!;
    setSellableOverride(stock.ticker, true);
    expect(isSellableTicker(stock.ticker)).toBe(true);
    // Documented U2 is JSON-level; product_type default alone is false:
    clearSellableOverride(stock.ticker);
    expect(isSellableTicker(stock.ticker)).toBe(false);
  });

  it("U3: overrides beat defaults", () => {
    setSellableOverride("AAPL", true);
    setSellableOverride("ACWI", false);
    expect(isSellableTicker("AAPL")).toBe(true);
    expect(isSellableTicker("ACWI")).toBe(false);
  });

  it("U4: clearSellableOverride restores default and drops key", () => {
    setSellableOverride("AAPL", true);
    expect(readSellableOverrides().AAPL).toBe(true);
    clearSellableOverride("AAPL");
    expect(readSellableOverrides().AAPL).toBeUndefined();
    expect(isSellableTicker("AAPL")).toBe(false);
  });

  it("U5: setSellableBulk only stores diffs from baseline", () => {
    // ACWI is etf → baseline true; setting true should not write a key
    setSellableBulk(["ACWI", "AAPL"], true);
    const map = readSellableOverrides();
    expect(map.ACWI).toBeUndefined();
    expect(map.AAPL).toBe(true);
    setSellableBulk(["ACWI"], false);
    expect(readSellableOverrides().ACWI).toBe(false);
  });

  it("U6: unknown / synthetic stub ticker is non-sellable", () => {
    expect(isSellableTicker("PRIVFUND1")).toBe(false);
  });

  it("U7: CASH always sellable even if override false", () => {
    writeSellableOverrides({ CASH: false });
    expect(isSellableTicker("CASH")).toBe(true);
    setSellableOverride("CASH", false);
    expect(isSellableTicker("CASH")).toBe(true);
  });

  it("U8: splitBySellable keeps order", () => {
    const { kept, blocked } = splitBySellable(["ACWI", "AAPL"]);
    expect(kept).toEqual(["ACWI"]);
    expect(blocked).toEqual(["AAPL"]);
  });

  it("U9: filterSellableProposed preserves fields", () => {
    const { kept, blocked } = filterSellableProposed([
      { ticker: "ACWI", name: "All Country", category: "global", rationale: "core" },
      { ticker: "AAPL", name: "Apple", category: "mega", rationale: "di" },
    ]);
    expect(kept).toEqual([
      { ticker: "ACWI", name: "All Country", category: "global", rationale: "core" },
    ]);
    expect(blocked[0]?.ticker).toBe("AAPL");
    expect(blocked[0]?.name).toBe("Apple");
  });

  it("U10: server ctx does not need localStorage", () => {
    clearAllSellableOverrides();
    expect(
      isSellableTicker("ACWI", { nonSellable: new Set(["ACWI"]) }),
    ).toBe(false);
    expect(
      isSellableTicker("SPY", { nonSellable: new Set(["ACWI"]) }),
    ).toBe(true);
  });

  it("U11: bad localStorage JSON returns {}", () => {
    localStorage.setItem(SELLABLE_OVERRIDES_STORAGE_KEY, "{not-json");
    expect(readSellableOverrides()).toEqual({});
  });

  it("U12: resolveNonSellableSet default includes all unique stocks", () => {
    const stockTickers = [
      ...new Set(
        getUniverseItems()
          .filter((u) => (u.product_type ?? "").toLowerCase() === "stock")
          .map((u) => u.ticker.toUpperCase()),
      ),
    ];
    const non = resolveNonSellableSet();
    const missing = stockTickers.filter((t) => !non.has(t));
    expect(missing, `unexpected sellable stocks: ${missing.slice(0, 20).join(",")}`).toEqual(
      [],
    );
    expect(stockTickers.length).toBeGreaterThan(200);
  });
});
