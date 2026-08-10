import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDailyNavPlan,
  clearClientDailyNavCache,
  getCachedClientDailyNav,
  parseDailyNavResponse,
  parsePerTickerReturns,
  perTickerKey,
  realCagrPctForHolding,
  realCumulativePctForHolding,
  realReturnForHolding,
  weightedHoldingReturnPct,
} from "./client-daily-nav";
import type { ClientPerfHolding } from "./clients-charts";

afterEach(() => {
  clearClientDailyNavCache();
  vi.unstubAllGlobals();
});

const HOLDINGS: ClientPerfHolding[] = [
  {
    ticker: "spy",
    weight: 0.3,
    initial_weight: 0.28,
    asset_class: "equity",
    invested_at: "2024-03-15",
  },
  {
    ticker: "AGG",
    weight: 0.5,
    initial_weight: 0.52,
    asset_class: "bond",
    invested_at: "2024-03-15",
  },
];

describe("buildDailyNavPlan", () => {
  it("maps initial weights, uppercases tickers, slices invested_at", () => {
    const plan = buildDailyNavPlan(HOLDINGS, "2026-07-28");
    expect(plan).not.toBeNull();
    expect(plan!.holdings).toEqual([
      { ticker: "AGG", weight: 0.52, invested_at: "2024-03-15" },
      { ticker: "SPY", weight: 0.28, invested_at: "2024-03-15" },
    ]);
    expect(plan!.end).toBe("2026-07-28");
  });

  it("falls back to current weight when initial_weight is missing", () => {
    const plan = buildDailyNavPlan(
      [{ ticker: "SPY", weight: 0.4, asset_class: "equity" }],
      "2026-07-28",
    );
    expect(plan!.holdings).toEqual([{ ticker: "SPY", weight: 0.4 }]);
  });

  it("merges cash sleeves into a single CASH entry", () => {
    const plan = buildDailyNavPlan(
      [
        ...HOLDINGS,
        { ticker: "CASH", weight: 0.1, asset_class: "cash" },
        { ticker: "USD MMF", weight: 0.05, asset_class: "Cash" },
      ],
      "2026-07-28",
    );
    const cash = plan!.holdings.filter((h) => h.ticker === "CASH");
    expect(cash).toEqual([{ ticker: "CASH", weight: 0.15 }]);
  });

  it("returns null for cash-only or empty books (flat real path, no fetch)", () => {
    expect(
      buildDailyNavPlan(
        [{ ticker: "CASH", weight: 1, asset_class: "cash" }],
        "2026-07-28",
      ),
    ).toBeNull();
    expect(buildDailyNavPlan([], "2026-07-28")).toBeNull();
    expect(buildDailyNavPlan(HOLDINGS, null)).toBeNull();
  });

  it("drops non-positive weights from the payload", () => {
    const plan = buildDailyNavPlan(
      [
        { ticker: "SPY", weight: 0.4, asset_class: "equity" },
        { ticker: "DEAD", weight: 0, asset_class: "equity" },
      ],
      "2026-07-28",
    );
    expect(plan!.holdings.map((h) => h.ticker)).toEqual(["SPY"]);
  });

  it("key is content-based: order-independent, end-sensitive", () => {
    const a = buildDailyNavPlan(HOLDINGS, "2026-07-28")!;
    const b = buildDailyNavPlan([...HOLDINGS].reverse(), "2026-07-28")!;
    expect(a.key).toBe(b.key);
    const c = buildDailyNavPlan(HOLDINGS, "2026-07-29")!;
    expect(c.key).not.toBe(a.key);
  });
});

describe("parseDailyNavResponse", () => {
  it("parses, sorts, and normalizes dates", () => {
    const pts = parseDailyNavResponse({
      daily: [
        { date: "2024-03-02", nav: 1.01 },
        { date: "2024-03-01T00:00:00", nav: 1.0 },
      ],
    });
    expect(pts).toEqual([
      { date: "2024-03-01", nav: 1.0 },
      { date: "2024-03-02", nav: 1.01 },
    ]);
  });

  it("drops invalid rows and non-array payloads", () => {
    expect(parseDailyNavResponse(null)).toEqual([]);
    expect(parseDailyNavResponse({} as never)).toEqual([]);
    const pts = parseDailyNavResponse({
      daily: [
        { date: "2024-03-01", nav: 1 },
        { date: "2024-03-02", nav: 0 },
        { date: "2024-03-03", nav: Number.NaN },
        { date: "xx", nav: 1.1 },
        null as never,
      ],
    });
    expect(pts).toEqual([{ date: "2024-03-01", nav: 1 }]);
  });
});

describe("getCachedClientDailyNav", () => {
  function stubFetchOnce(impl: () => Promise<unknown>) {
    const fn = vi.fn(async () => {
      const payload = await impl();
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      } as Response;
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  it("dedupes concurrent requests by content key", async () => {
    const fetchMock = stubFetchOnce(async () => ({
      daily: [{ date: "2024-03-01", nav: 1.0 }],
      meta: {
        per_ticker: [
          {
            ticker: "SPY",
            invested_at: "2024-03-15",
            first_date: "2024-03-15",
            last_date: "2026-07-28",
            cumulative_return: 0.31,
          },
        ],
      },
    }));
    const plan = buildDailyNavPlan(HOLDINGS, "2026-07-28")!;
    const [a, b] = await Promise.all([
      getCachedClientDailyNav(plan),
      getCachedClientDailyNav({ ...plan }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.points).toEqual([{ date: "2024-03-01", nav: 1.0 }]);
    expect(a.perTicker.get("SPY|2024-03-15")?.cumReturn).toBe(0.31);
    expect(b).toEqual(a);
  });

  it("serves repeat calls from cache without re-fetching", async () => {
    const fetchMock = stubFetchOnce(async () => ({
      daily: [{ date: "2024-03-01", nav: 1.0 }],
    }));
    const plan = buildDailyNavPlan(HOLDINGS, "2026-07-28")!;
    await getCachedClientDailyNav(plan);
    await getCachedClientDailyNav(plan);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("evicts failed requests so a later call retries", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("network down");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ daily: [{ date: "2024-03-01", nav: 1.0 }] }),
        text: async () => "",
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const plan = buildDailyNavPlan(HOLDINGS, "2026-07-28")!;
    await expect(getCachedClientDailyNav(plan)).rejects.toThrow();
    const retry = await getCachedClientDailyNav(plan);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(retry.points).toEqual([{ date: "2024-03-01", nav: 1.0 }]);
    expect(retry.perTicker.size).toBe(0);
  });
});

describe("parsePerTickerReturns", () => {
  it("keys rows by ticker + invested_at and validates values", () => {
    const map = parsePerTickerReturns({
      daily: [],
      meta: {
        per_ticker: [
          {
            ticker: "spy",
            invested_at: "2024-03-15",
            first_date: "2024-03-15",
            last_date: "2026-07-28",
            cumulative_return: 0.31,
          },
          {
            ticker: "LATE",
            invested_at: null,
            first_date: "2025-01-02",
            last_date: "2026-07-28",
            cumulative_return: -0.12,
          },
          { ticker: "BAD", cumulative_return: Number.NaN },
          { ticker: "WORSE", cumulative_return: -1.2 },
          { ticker: "NODATE", cumulative_return: 0.1 },
        ] as never,
      },
    });
    expect(map.size).toBe(2);
    expect(map.get("SPY|2024-03-15")).toEqual({
      firstDate: "2024-03-15",
      lastDate: "2026-07-28",
      cumReturn: 0.31,
    });
    expect(map.get("LATE|")?.cumReturn).toBe(-0.12);
  });

  it("returns an empty map when meta is missing", () => {
    expect(parsePerTickerReturns(null).size).toBe(0);
    expect(parsePerTickerReturns({ daily: [] }).size).toBe(0);
  });
});

describe("real per-holding resolvers", () => {
  const map = parsePerTickerReturns({
    daily: [],
    meta: {
      per_ticker: [
        {
          ticker: "SPY",
          invested_at: "2024-03-15",
          first_date: "2024-03-15",
          last_date: "2026-07-28",
          cumulative_return: 0.5,
        },
      ],
    },
  });
  const spy: ClientPerfHolding = {
    ticker: "SPY",
    weight: 0.3,
    asset_class: "equity",
    invested_at: "2024-03-15",
  };

  it("resolves the real cumulative return in percent points", () => {
    expect(realCumulativePctForHolding(spy, map)).toBe(50);
    expect(realReturnForHolding(spy, map)?.firstDate).toBe("2024-03-15");
  });

  it("computes CAGR from the real return over firstDate → as_of", () => {
    // (1.5)^(1/2.37…) − 1 over 2024-03-15 → 2026-07-28 (~2.37y) ≈ 18.7%.
    const cagr = realCagrPctForHolding(spy, map, "2026-07-28");
    expect(cagr).toBeCloseTo(18.7, 1);
  });

  it("returns undefined for cash, unknown, or mismatched invested_at", () => {
    expect(
      realCumulativePctForHolding(
        { ticker: "CASH", weight: 0.1, asset_class: "cash" },
        map,
      ),
    ).toBeUndefined();
    expect(
      realCumulativePctForHolding(
        { ticker: "QQQ", weight: 0.1, asset_class: "equity", invested_at: "2024-03-15" },
        map,
      ),
    ).toBeUndefined();
    // Same ticker but a different sleeve (invested_at) misses the key.
    expect(
      realCumulativePctForHolding(
        { ticker: "SPY", weight: 0.1, asset_class: "equity", invested_at: "2025-01-01" },
        map,
      ),
    ).toBeUndefined();
    expect(realCumulativePctForHolding(spy, null)).toBeUndefined();
    expect(realCagrPctForHolding(spy, null, "2026-07-28")).toBeUndefined();
  });

  it("perTickerKey matches the payload builder normalization", () => {
    const plan = buildDailyNavPlan([spy], "2026-07-28")!;
    const entry = plan.holdings.find((h) => h.ticker === "SPY")!;
    expect(perTickerKey(entry.ticker, entry.invested_at)).toBe("SPY|2024-03-15");
    expect(perTickerKey("spy", undefined)).toBe("SPY|");
  });
});

describe("weightedHoldingReturnPct", () => {
  const resolve =
    (values: Record<string, { pct: number | undefined; real: boolean }>) =>
    (h: ClientPerfHolding) =>
      values[h.ticker] ?? { pct: undefined, real: false };

  it("weights by current weight with cash diluting at 0", () => {
    const holdings: ClientPerfHolding[] = [
      { ticker: "A", weight: 0.6, asset_class: "equity" },
      { ticker: "B", weight: 0.2, asset_class: "equity" },
      { ticker: "CASH", weight: 0.2, asset_class: "cash" },
    ];
    const out = weightedHoldingReturnPct(
      holdings,
      resolve({ A: { pct: 10, real: true }, B: { pct: 20, real: true } }),
    );
    // (0.6*10 + 0.2*20 + 0.2*0) / 1.0 = 10
    expect(out.pct).toBeCloseTo(10, 6);
    expect(out.allReal).toBe(true);
  });

  it("flags mixed real + reported aggregates as not allReal", () => {
    const holdings: ClientPerfHolding[] = [
      { ticker: "A", weight: 0.5, asset_class: "equity" },
      { ticker: "B", weight: 0.5, asset_class: "equity" },
    ];
    const out = weightedHoldingReturnPct(
      holdings,
      resolve({
        A: { pct: 10, real: true },
        B: { pct: 30, real: false }, // reported fallback
      }),
    );
    expect(out.pct).toBeCloseTo(20, 6);
    expect(out.allReal).toBe(false);
  });

  it("skips valueless holdings and returns undefined for cash-only", () => {
    const holdings: ClientPerfHolding[] = [
      { ticker: "A", weight: 0.5, asset_class: "equity" },
      { ticker: "CASH", weight: 0.5, asset_class: "cash" },
    ];
    const out = weightedHoldingReturnPct(holdings, resolve({}));
    expect(out.pct).toBeUndefined();
    expect(out.allReal).toBe(false);
  });
});
