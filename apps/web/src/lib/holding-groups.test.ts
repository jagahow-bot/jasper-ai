import { describe, expect, it, beforeEach } from "vitest";
import {
  capSlicesForChart,
  groupHoldings,
  normalizeSliceWeights,
  resolveSectorKey,
  resetHoldingGroupsWarnings,
  shouldHideRegionView,
  type UniverseMeta,
} from "./holding-groups";

const UNIVERSE = new Map<string, UniverseMeta>([
  [
    "NVDA",
    {
      ticker: "NVDA",
      asset_class: "equity",
      region: "us",
      sector: "tech",
      product_type: "stock",
    },
  ],
  [
    "TLT",
    {
      ticker: "TLT",
      asset_class: "bond",
      region: "us",
      sector: "bond",
      product_type: "etf",
    },
  ],
  [
    "IVV",
    {
      ticker: "IVV",
      asset_class: "equity",
      region: "us",
      sector: "broad_market",
      product_type: "etf",
    },
  ],
]);

const LABEL_CTX = {
  lang: "en" as const,
  assetClassLabel: (k: string) => k,
  regionLabel: (k: string) => k,
};

describe("groupHoldings", () => {
  beforeEach(() => {
    resetHoldingGroupsWarnings();
  });

  const holdings = [
    { ticker: "NVDA", weight: 0.4 },
    { ticker: "IVV", weight: 0.35 },
    { ticker: "TLT", weight: 0.25 },
  ];

  it("groups by asset class", () => {
    const slices = groupHoldings(holdings, "assetClass", UNIVERSE, LABEL_CTX);
    const byKey = Object.fromEntries(slices.map((s) => [s.key, s.weight]));
    expect(byKey.equity).toBeCloseTo(0.75);
    expect(byKey.bond).toBeCloseTo(0.25);
  });

  it("groups by sector with bond bucket", () => {
    const slices = groupHoldings(holdings, "sector", UNIVERSE, LABEL_CTX);
    const byKey = Object.fromEntries(slices.map((s) => [s.key, s.weight]));
    expect(byKey.tech).toBeCloseTo(0.4);
    expect(byKey.broad_market).toBeCloseTo(0.35);
    expect(byKey.bond).toBeCloseTo(0.25);
  });

  it("groups by region", () => {
    const slices = groupHoldings(holdings, "region", UNIVERSE, LABEL_CTX);
    expect(slices).toHaveLength(1);
    expect(slices[0].key).toBe("us");
    expect(slices[0].weight).toBeCloseTo(1);
  });

  it("shouldHideRegionView when single region", () => {
    expect(shouldHideRegionView(holdings, UNIVERSE)).toBe(true);
  });
});

describe("capSlicesForChart", () => {
  it("merges tail into other", () => {
    const slices = [
      { key: "a", label: "A", weight: 0.5, count: 1 },
      { key: "b", label: "B", weight: 0.3, count: 1 },
      { key: "c", label: "C", weight: 0.2, count: 1 },
    ];
    const capped = capSlicesForChart(slices, 2, "Other");
    expect(capped).toHaveLength(2);
    expect(capped[0].key).toBe("a");
    expect(capped[1].key).toBe("other");
    expect(capped[1].weight).toBeCloseTo(0.5);
  });
});

describe("resolveSectorKey", () => {
  it("maps non-equity to sleeve key", () => {
    expect(
      resolveSectorKey({
        ticker: "GLD",
        asset_class: "commodity",
        sector: "commodity",
      }),
    ).toBe("commodity");
  });
});

describe("normalizeSliceWeights", () => {
  it("renormalizes to fraction sum 1", () => {
    const norm = normalizeSliceWeights([
      { key: "a", label: "A", weight: 0.6, count: 1 },
      { key: "b", label: "B", weight: 0.4, count: 1 },
    ]);
    expect(norm.reduce((s, x) => s + x.value, 0)).toBeCloseTo(1);
  });
});
