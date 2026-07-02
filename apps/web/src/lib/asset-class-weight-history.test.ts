import { describe, expect, it } from "vitest";
import {
  aggregateWeightHistoryByAssetClass,
  buildTickerAssetClassMap,
} from "./asset-class-weight-history";

describe("aggregateWeightHistoryByAssetClass", () => {
  const tickerToClass = buildTickerAssetClassMap([
    { ticker: "SPY", asset_class: "equity" },
    { ticker: "TLT", asset_class: "bond" },
    { ticker: "GLD", asset_class: "commodity" },
  ]);

  it("sums ticker weights into asset-class sleeves", () => {
    const { data, classKeys } = aggregateWeightHistoryByAssetClass(
      [
        { date: "2020-01-02", SPY: 0.6, TLT: 0.3, GLD: 0.1 },
        { date: "2020-02-02", SPY: 0.5, TLT: 0.4, GLD: 0.05, OTHER: 0.05 },
      ],
      ["SPY", "TLT", "GLD"],
      tickerToClass,
    );

    expect(classKeys).toEqual(["equity", "bond", "commodity", "other"]);
    expect(data[0]).toMatchObject({
      date: "2020-01-02",
      equity: 0.6,
      bond: 0.3,
      commodity: 0.1,
    });
    expect(data[1].other).toBeCloseTo(0.05);
  });
});
