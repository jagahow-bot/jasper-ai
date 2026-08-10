import { describe, expect, it } from "vitest";
import { holdingsGroupCumulativeReturn } from "./clients";
import {
  buildClientHoldingsGroupPie,
  buildClientHoldingsPie,
  buildClientPerformanceSeries,
  buildHoldingsCalibratedNavSeries,
  clientPerfWindowStart,
  holdingGrowthKnots,
  holdingGrowthOnDate,
  holdingsCurrentWeightYtdDecimal,
  holdingsHavePerformanceMetrics,
  toClientPerformanceReturnSeries,
  windowReturnPctFromSeries,
  type ClientNavPoint,
  type ClientPerfHolding,
} from "./clients-charts";

describe("buildClientHoldingsPie", () => {
  it("maps tickers and sorts by weight desc", () => {
    const slices = buildClientHoldingsPie([
      { ticker: "AGG", weight: 0.3 },
      { ticker: "SPY", weight: 0.7 },
    ]);
    expect(slices.map((s) => s.name)).toEqual(["SPY", "AGG"]);
    expect(slices[0].value).toBe(0.7);
  });

  it("renormalizes when requested", () => {
    const slices = buildClientHoldingsPie(
      [
        { ticker: "SPY", weight: 0.4 },
        { ticker: "AGG", weight: 0.1 },
      ],
      { renormalize: true },
    );
    const sum = slices.reduce((a, s) => a + s.value, 0);
    expect(sum).toBeCloseTo(1, 6);
  });
});

describe("buildClientHoldingsGroupPie", () => {
  const groups = [
    {
      id: "model-a",
      holdings: [{ ticker: "SPY", weight: 0.4 }],
    },
    {
      id: "cash",
      holdings: [{ ticker: "CASH", weight: 0.1 }],
    },
    {
      id: "sat",
      holdings: [{ ticker: "AAPL", weight: 0.2 }],
    },
  ];

  it("aggregates by group label and respects selection", () => {
    const slices = buildClientHoldingsGroupPie(groups, {
      selectedIds: ["model-a", "cash"],
      labelOf: (g) => (g.id === "model-a" ? "Growth book" : "Cash"),
    });
    expect(slices).toEqual([
      { name: "Growth book", value: 0.4 },
      { name: "Cash", value: 0.1 },
    ]);
  });

  it("renormalizes selected group weights", () => {
    const slices = buildClientHoldingsGroupPie(groups, {
      selectedIds: ["model-a", "cash"],
      labelOf: (g) => g.id,
      renormalize: true,
    });
    expect(slices.map((s) => s.name)).toEqual(["model-a", "cash"]);
    expect(slices[0].value).toBeCloseTo(0.8, 6);
    expect(slices[1].value).toBeCloseTo(0.2, 6);
  });
});

describe("toClientPerformanceReturnSeries", () => {
  const points: ClientNavPoint[] = [
    { date: "2025-01-31", nav: 100 },
    { date: "2025-02-28", nav: 110 },
    { date: "2025-03-31", nav: 105 },
    { date: "2025-06-30", nav: 120 },
    { date: "2025-12-31", nav: 130 },
  ];

  it("rebases MAX window to 0 at start", () => {
    const series = toClientPerformanceReturnSeries(
      points,
      "MAX",
      "2025-12-31",
    );
    expect(series[0]).toEqual({ date: "2025-01-31", ret: 0 });
    expect(series[1].ret).toBeCloseTo(0.1, 4);
    expect(series.at(-1)?.ret).toBeCloseTo(0.3, 4);
  });

  it("slices 3M window and rebases", () => {
    const denser: ClientNavPoint[] = [
      { date: "2025-08-31", nav: 100 },
      { date: "2025-09-30", nav: 102 },
      { date: "2025-10-31", nav: 104 },
      { date: "2025-11-30", nav: 108 },
      { date: "2025-12-31", nav: 110 },
    ];
    expect(clientPerfWindowStart("3M", "2025-12-31")).toBe("2025-09-01");
    const series = toClientPerformanceReturnSeries(
      denser,
      "3M",
      "2025-12-31",
    );
    expect(series[0]?.date).toBe("2025-09-30");
    expect(series[0].ret).toBe(0);
    expect(series.at(-1)?.ret).toBeCloseTo(110 / 102 - 1, 4);
  });

  it("uses YTD calendar year start", () => {
    expect(clientPerfWindowStart("YTD", "2025-07-28")).toBe("2025-01-01");
    const series = toClientPerformanceReturnSeries(
      points,
      "YTD",
      "2025-12-31",
    );
    expect(series[0].date).toBe("2025-01-31");
    expect(series[0].ret).toBe(0);
  });
});

describe("holdingGrowthKnots / holdingGrowthOnDate", () => {
  const asOf = "2026-07-28";
  const holding: ClientPerfHolding = {
    ticker: "SPY",
    weight: 0.3,
    initial_weight: 0.28,
    asset_class: "equity",
    total_return: 18.5,
    return_ytd: 9.2,
    invested_at: "2024-03-15",
  };

  it("anchors invest=1, as_of=1+total, and year-start from YTD", () => {
    const knots = holdingGrowthKnots(holding, asOf);
    expect(knots).toEqual([
      { date: "2024-03-15", growth: 1 },
      { date: "2026-01-01", growth: (1 + 0.185) / (1 + 0.092) },
      { date: "2026-07-28", growth: 1.185 },
    ]);
  });

  it("returns 0 before invest and 1+total on as_of", () => {
    expect(holdingGrowthOnDate(holding, "2024-01-01", asOf)).toBe(0);
    expect(holdingGrowthOnDate(holding, asOf, asOf)).toBeCloseTo(1.185, 6);
  });
});

describe("buildHoldingsCalibratedNavSeries", () => {
  const asOf = "2025-07-01";
  const holdings: ClientPerfHolding[] = [
    {
      ticker: "A",
      weight: 0.6,
      initial_weight: 0.5,
      asset_class: "equity",
      total_return: 100,
      return_ytd: 10,
      invested_at: "2024-01-01",
    },
    {
      ticker: "B",
      weight: 0.4,
      initial_weight: 0.5,
      asset_class: "equity",
      total_return: 0,
      return_ytd: 0,
      invested_at: "2024-01-01",
    },
  ];

  it("ends at book growth from initial capital", () => {
    const nav = buildHoldingsCalibratedNavSeries(holdings, asOf);
    expect(nav[0]?.date).toBe("2024-01-01");
    expect(nav[0]?.nav).toBeCloseTo(1, 6);
    // V(end)/C(end) = (0.5*2 + 0.5*1) / 1 = 1.5 → +50% from start
    expect(nav.at(-1)?.date).toBe(asOf);
    expect(nav.at(-1)?.nav).toBeCloseTo(1.5, 6);

    const maxRet = toClientPerformanceReturnSeries(nav, "MAX", asOf);
    expect(maxRet[0]?.ret).toBe(0);
    expect(maxRet.at(-1)?.ret).toBeCloseTo(0.5, 4);
  });

  it("emits approx-daily points (not month-end only)", () => {
    const nav = buildHoldingsCalibratedNavSeries(holdings, asOf);
    // 2024-01-01 → 2025-07-01 ≈ 548 calendar days
    expect(nav.length).toBeGreaterThan(500);
    expect(nav[1]?.date).toBe("2024-01-02");
    const mid = nav.findIndex((p) => p.date === "2024-06-15");
    expect(mid).toBeGreaterThan(0);
    expect(nav[mid + 1]?.date).toBe("2024-06-16");
  });

  it("keeps book endpoints with a deterministic path (no simulated noise)", () => {
    const nav = buildHoldingsCalibratedNavSeries(holdings, asOf);
    expect(nav[0]?.nav).toBeCloseTo(1, 6);
    expect(nav.at(-1)?.nav).toBeCloseTo(1.5, 6);

    // Same inputs → identical series; no RNG anywhere in the path.
    const again = buildHoldingsCalibratedNavSeries(holdings, asOf);
    expect(again).toEqual(nav);

    // Reported knots are monotone between anchor dates, so daily moves
    // between them never invert the direction of the reported return.
    const dailyRets = nav.slice(1).map((p, i) => p.nav / nav[i]!.nav - 1);
    expect(dailyRets.every((r) => r >= 0)).toBe(true);
    expect(dailyRets.some((r) => r > 1e-9)).toBe(true);
  });

  it("YTD rebase end matches current-weight table return_ytd", () => {
    const tableYtd = holdingsCurrentWeightYtdDecimal(holdings);
    // (0.6*10% + 0.4*0%) / 1 = 6%
    expect(tableYtd).toBeCloseTo(0.06, 6);

    const nav = buildHoldingsCalibratedNavSeries(holdings, asOf);
    const ytd = toClientPerformanceReturnSeries(nav, "YTD", asOf);
    expect(ytd[0]?.ret).toBe(0);
    expect(ytd[0]?.date).toBe("2025-01-01");
    expect(ytd.at(-1)?.ret).toBeCloseTo(tableYtd!, 4);
    expect(windowReturnPctFromSeries(ytd)).toBeCloseTo(tableYtd! * 100, 2);
  });

  it("MAX window return matches table footer via shared helper", () => {
    const nav = buildHoldingsCalibratedNavSeries(holdings, asOf);
    const maxRet = toClientPerformanceReturnSeries(nav, "MAX", asOf);
    expect(maxRet.at(-1)?.ret).toBeCloseTo(0.5, 4);
    expect(windowReturnPctFromSeries(maxRet)).toBeCloseTo(50, 2);
  });

  it("does not spike when a large holding is added later at cost", () => {
    const staggered: ClientPerfHolding[] = [
      {
        ticker: "SMALL",
        weight: 0.15,
        initial_weight: 0.1,
        asset_class: "equity",
        total_return: 20,
        return_ytd: 5,
        invested_at: "2024-01-01",
      },
      {
        ticker: "LARGE",
        weight: 0.85,
        initial_weight: 0.9,
        asset_class: "equity",
        total_return: 0,
        return_ytd: 0,
        invested_at: "2025-04-01",
      },
    ];
    const nav = buildHoldingsCalibratedNavSeries(staggered, asOf);
    expect(nav[0]?.nav).toBeCloseTo(1, 6);

    const beforeAdd = nav.filter((p) => p.date < "2025-04-01");
    const afterAdd = nav.filter((p) => p.date >= "2025-04-01");
    expect(beforeAdd.length).toBeGreaterThan(0);
    expect(afterAdd.length).toBeGreaterThan(0);

    // Raw V would jump ~0.1→1.0 (+~900%); capital-adjusted index must stay sane.
    for (const p of nav) {
      expect(p.nav).toBeGreaterThan(0.5);
      expect(p.nav).toBeLessThan(2);
    }
    const maxJump = Math.max(
      ...nav.slice(1).map((p, i) => Math.abs(p.nav / nav[i].nav - 1)),
    );
    expect(maxJump).toBeLessThan(0.5);

    // End ≈ capital-weighted total return: V/C - 1 = (0.1*1.2 + 0.9*1)/1 - 1 = 0.02
    expect(nav.at(-1)?.nav).toBeCloseTo(1.02, 6);
    const maxRet = toClientPerformanceReturnSeries(nav, "MAX", asOf);
    expect(maxRet.at(-1)?.ret).toBeCloseTo(0.02, 4);

    // YTD still matches current-weight avg (cash-dilution rule, no cash here)
    const ytd = toClientPerformanceReturnSeries(nav, "YTD", asOf);
    expect(ytd.at(-1)?.ret).toBeCloseTo(
      holdingsCurrentWeightYtdDecimal(staggered)!,
      4,
    );
  });

  it("buildClientPerformanceSeries prefers calibrated path when metrics exist", () => {
    expect(holdingsHavePerformanceMetrics(holdings)).toBe(true);
    const series = buildClientPerformanceSeries({
      client_id: "demo",
      as_of_date: asOf,
      risk_profile: "moderate",
      holdings,
    });
    expect(series.at(-1)?.nav).toBeCloseTo(1.5, 6);
  });

  it("returns no series when holdings lack return metrics (no synthetic fallback)", () => {
    const bare: ClientPerfHolding[] = [
      { ticker: "SPY", weight: 1, asset_class: "equity" },
    ];
    expect(holdingsHavePerformanceMetrics(bare)).toBe(false);
    const series = buildClientPerformanceSeries({
      client_id: "demo-bare",
      as_of_date: asOf,
      risk_profile: "moderate",
      holdings: bare,
    });
    expect(series).toEqual([]);
  });

  it("cash dilutes table YTD the same way as holdingsGroupReturnYtd", () => {
    const withCash: ClientPerfHolding[] = [
      {
        ticker: "A",
        weight: 0.8,
        initial_weight: 0.7,
        asset_class: "equity",
        total_return: 20,
        return_ytd: 10,
        invested_at: "2024-01-01",
      },
      {
        ticker: "CASH",
        weight: 0.2,
        initial_weight: 0.3,
        asset_class: "cash",
        total_return: null,
        return_ytd: null,
      },
    ];
    // (0.8*10% + 0.2*0) / 1 = 8%
    expect(holdingsCurrentWeightYtdDecimal(withCash)).toBeCloseTo(0.08, 6);
    const nav = buildHoldingsCalibratedNavSeries(withCash, asOf);
    const ytd = toClientPerformanceReturnSeries(nav, "YTD", asOf);
    expect(ytd.at(-1)?.ret).toBeCloseTo(0.08, 4);
    // MAX = V/C - 1 = (0.7*1.2 + 0.3*1)/1 - 1 = 0.14
    expect(
      toClientPerformanceReturnSeries(nav, "MAX", asOf).at(-1)?.ret,
    ).toBeCloseTo(0.14, 4);
  });
});

describe("holdingsGroupCumulativeReturn", () => {
  it("weights cumulative holding-period returns, cash dilutes at 0%", () => {
    const group = {
      id: "g",
      type: "individual" as const,
      holdings: [
        {
          ticker: "ARKK",
          weight: 0.5,
          asset_class: "equity",
          total_return: -52,
          return_ytd: -6,
          invested_at: "2021-12-01",
        },
        {
          ticker: "QQQ",
          weight: 0.3,
          asset_class: "equity",
          total_return: 48,
          return_ytd: 11,
          invested_at: "2021-12-01",
        },
        {
          ticker: "CASH",
          weight: 0.2,
          asset_class: "cash",
          total_return: null,
          return_ytd: null,
        },
      ],
    };
    // (0.5*-52 + 0.3*48 + 0.2*0) / 1.0 = -11.6 percent points
    expect(holdingsGroupCumulativeReturn(group, "2026-07-28")).toBeCloseTo(
      -11.6,
      6,
    );
  });

  it("falls back to YTD only when invested in the as-of year", () => {
    const group = {
      id: "g",
      type: "individual" as const,
      holdings: [
        {
          ticker: "NEW",
          weight: 1,
          asset_class: "equity",
          return_ytd: 7.5,
          invested_at: "2026-02-01",
        },
      ],
    };
    expect(holdingsGroupCumulativeReturn(group, "2026-07-28")).toBeCloseTo(
      7.5,
      6,
    );
    // Different year → no cumulative return resolvable
    expect(holdingsGroupCumulativeReturn(group, "2027-01-15")).toBeUndefined();
  });
});
