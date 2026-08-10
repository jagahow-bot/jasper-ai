import { describe, expect, it } from "vitest";
import type { ClientHolding } from "./clients";
import {
  annualizedReturnFromMonthly,
  backcastProxySummary,
  calendarYearReturnsFromMonthly,
  goalReturnDefaultsFromBand,
  holdingsToBackcastWeights,
  monthlyReturnsFromNav,
  parseBackcastMonthly,
  planningBandFromMonthlySeries,
  resolveGoalReturnDefaults,
  weightsMatchClientBook,
  MIN_BACKCAST_MONTHS,
  type BackcastMonthlyPoint,
} from "./financial-goal-backcast";

function months(startYear: number, count: number, ret: number): BackcastMonthlyPoint[] {
  const out: BackcastMonthlyPoint[] = [];
  let y = startYear;
  let m = 1;
  for (let i = 0; i < count; i++) {
    out.push({ month: `${y}-${String(m).padStart(2, "0")}`, ret });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

describe("parseBackcastMonthly", () => {
  it("sorts, trims to YYYY-MM, and drops invalid rows", () => {
    const rows = [
      { month: "2024-03", return: 0.01 },
      { month: "2024-01", return: 0.02 },
      { month: "bad", return: 0.01 },
      { month: "2024-02", return: Number.NaN },
      { month: "2024-04", return: -1.5 }, // impossible simple return
    ];
    // @ts-expect-error intentional malformed rows
    const pts = parseBackcastMonthly(rows);
    expect(pts.map((p) => p.month)).toEqual(["2024-01", "2024-03"]);
  });
});

describe("calendarYearReturnsFromMonthly", () => {
  it("compounds complete years only", () => {
    // 3% per month for all of 2023; partial 2024 excluded.
    const pts = [...months(2023, 12, 0.03), ...months(2024, 6, 0.5)];
    const annual = calendarYearReturnsFromMonthly(pts);
    expect(annual).toHaveLength(1);
    expect(annual[0]).toBeCloseTo(1.03 ** 12 - 1, 6);
  });

  it("returns [] for empty input", () => {
    expect(calendarYearReturnsFromMonthly([])).toEqual([]);
  });
});

describe("annualizedReturnFromMonthly", () => {
  it("geometric annualization", () => {
    expect(annualizedReturnFromMonthly(months(2023, 12, 0.01))).toBeCloseTo(
      1.01 ** 12 - 1,
      6,
    );
    expect(annualizedReturnFromMonthly(months(2023, 6, 0.01))).toBeCloseTo(
      1.01 ** 12 - 1,
      6,
    );
  });
});

describe("monthlyReturnsFromNav", () => {
  it("uses last NAV per month", () => {
    const nav = [
      { date: "2024-01-05", nav: 100 },
      { date: "2024-01-30", nav: 102 },
      { date: "2024-02-27", nav: 105.06 },
    ];
    const pts = monthlyReturnsFromNav(nav);
    expect(pts).toEqual([{ month: "2024-02", ret: 105.06 / 102 - 1 }]);
  });
});

describe("planningBandFromMonthlySeries", () => {
  it("uses the winsorized annual band once ≥3 complete years exist", () => {
    // 36 months with year-over-year variation so percentiles spread out.
    const pts: BackcastMonthlyPoint[] = [];
    const pattern = [0.03, -0.01, 0.02, 0.01, 0.025, -0.005, 0.015, 0.02, -0.02, 0.03, 0.01, 0.005];
    const yearScale = [0.4, 1.6, 0.9]; // weak / strong / middling years
    for (let i = 0; i < 36; i++) {
      const y = 2021 + Math.floor(i / 12);
      const m = (i % 12) + 1;
      pts.push({
        month: `${y}-${String(m).padStart(2, "0")}`,
        ret: pattern[i % 12]! * yearScale[Math.floor(i / 12)]!,
      });
    }
    const band = planningBandFromMonthlySeries(pts, 0.05, 0.6);
    expect(band.method).toBe("winsorized_mean_cap");
    expect(band.sampleYears).toBe(3);
    expect(band.p50Return).toBeGreaterThan(band.p10Return);
    expect(band.p90Return).toBeGreaterThan(band.p50Return);
    // Base near the annualized series return (shrunk toward prior).
    const ann = annualizedReturnFromMonthly(pts);
    expect(Math.abs(band.baseReturn - ann)).toBeLessThan(0.06);
  });

  it("short series: base = annualized series return (not the prior)", () => {
    const pts = months(2024, 9, 0.01); // 9 months, ~12.7% annualized
    const band = planningBandFromMonthlySeries(pts, 0.05, 0.6);
    expect(band.method).toBe("prior_fallback");
    expect(band.baseReturn).toBeCloseTo(1.01 ** 12 - 1, 4);
    expect(band.p50Return).toBeCloseTo(band.baseReturn, 6);
  });

  it("empty series falls back to the plan prior", () => {
    const band = planningBandFromMonthlySeries([], 0.05, 0.7);
    expect(band.baseReturn).toBeCloseTo(0.05, 6);
    expect(band.confidenceLevel).toBe(0.7);
  });
});

describe("weightsMatchClientBook", () => {
  const holdings: ClientHolding[] = [
    { ticker: "SPY", name: "S&P", asset_class: "equity", weight: 0.5 },
    { ticker: "AGG", name: "Agg", asset_class: "bond", weight: 0.3 },
    { ticker: "CASH", name: "Cash", asset_class: "cash", weight: 0.2 },
  ];

  it("matches same non-cash tickers within tolerance (cash ignored)", () => {
    expect(
      weightsMatchClientBook({ SPY: 0.62, AGG: 0.38 }, holdings),
    ).toBe(true);
    expect(
      weightsMatchClientBook({ SPY: 0.625, AGG: 0.375, CASH: 0.1 }, holdings),
    ).toBe(true);
  });

  it("rejects different tickers or big weight drift", () => {
    expect(weightsMatchClientBook({ SPY: 0.6, QQQ: 0.4 }, holdings)).toBe(false);
    expect(weightsMatchClientBook({ SPY: 0.9, AGG: 0.1 }, holdings)).toBe(false);
    expect(weightsMatchClientBook(null, holdings)).toBe(false);
    expect(weightsMatchClientBook({}, holdings)).toBe(false);
  });
});

describe("holdingsToBackcastWeights", () => {
  it("sums duplicate tickers, uppercases, and keeps the CASH sleeve", () => {
    const holdings: ClientHolding[] = [
      { ticker: "spy", name: "S&P", asset_class: "equity", weight: 0.3 },
      { ticker: "SPY", name: "S&P dup", asset_class: "equity", weight: 0.2 },
      { ticker: "CASH", name: "Cash", asset_class: "cash", weight: 0.1 },
    ];
    expect(holdingsToBackcastWeights(holdings)).toEqual({
      SPY: 0.5,
      CASH: 0.1,
    });
  });

  it("drops non-positive or non-finite weights", () => {
    const holdings: ClientHolding[] = [
      { ticker: "SPY", name: "S&P", asset_class: "equity", weight: 0 },
      { ticker: "AGG", name: "Agg", asset_class: "bond", weight: Number.NaN },
      { ticker: "QQQ", name: "Nasdaq", asset_class: "equity", weight: 0.4 },
    ];
    expect(holdingsToBackcastWeights(holdings)).toEqual({ QQQ: 0.4 });
  });
});

describe("goalReturnDefaultsFromBand", () => {
  it("maps band base/deltas and rounds to 0.1pp", () => {
    const band = planningBandFromMonthlySeries(
      months(2024, 9, 0.01),
      0.05,
      0.6,
    );
    const d = goalReturnDefaultsFromBand(band);
    expect(d.annualReturn).toBeCloseTo(1.01 ** 12 - 1, 3);
    expect(d.annualReturn * 1000).toBeCloseTo(Math.round(d.annualReturn * 1000), 9);
    expect(d.optimisticDelta).toBe(band.optimisticDelta);
    expect(d.conservativeDelta).toBe(band.conservativeDelta);
  });
});

describe("resolveGoalReturnDefaults", () => {
  const realized = months(2021, 36, 0.005);
  const backcast = months(2019, 24, -0.004);

  it("prefers realized history over backcast", () => {
    const r = resolveGoalReturnDefaults({
      realizedMonthly: realized,
      backcastMonthly: backcast,
      priorReturn: 0.05,
    });
    expect(r?.source).toBe("realized");
    expect(r?.months).toBe(36);
    expect(r?.defaults.annualReturn).toBeGreaterThan(0);
  });

  it("falls back to backcast when realized is too short", () => {
    const r = resolveGoalReturnDefaults({
      realizedMonthly: realized.slice(0, MIN_BACKCAST_MONTHS - 1),
      backcastMonthly: backcast,
      priorReturn: 0.05,
    });
    expect(r?.source).toBe("backcast");
    expect(r?.defaults.annualReturn).toBeLessThan(0);
  });

  it("returns null when neither series has enough months", () => {
    expect(
      resolveGoalReturnDefaults({
        realizedMonthly: realized.slice(0, 3),
        backcastMonthly: [],
        priorReturn: 0.05,
      }),
    ).toBeNull();
    expect(
      resolveGoalReturnDefaults({ priorReturn: 0.05 }),
    ).toBeNull();
  });

  it("annualReturn reflects the series, not the prior", () => {
    const r = resolveGoalReturnDefaults({
      backcastMonthly: months(2024, 9, 0.02), // ~26.8% annualized
      priorReturn: 0.05,
    });
    expect(r?.source).toBe("backcast");
    expect(r?.defaults.annualReturn).toBeCloseTo(1.02 ** 12 - 1, 3);
  });
});

describe("backcastProxySummary", () => {
  it("aggregates proxy fill metadata", () => {
    const s = backcastProxySummary({
      proxy_fills: {
        PDBC: { proxies: ["DBC"], months_filled: 58 },
        SGOV: { proxies: ["SHV", "ZERO_FILL"], months_filled: 12 },
      },
    });
    expect(s.filledTickers).toEqual(["PDBC", "SGOV"]);
    expect(s.monthsFilled).toBe(70);
    expect(backcastProxySummary(null).monthsFilled).toBe(0);
  });
});
