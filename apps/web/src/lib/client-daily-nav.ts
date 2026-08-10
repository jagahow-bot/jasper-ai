/**
 * Client-book daily NAV from real price history (POST /backcast/daily-nav).
 *
 * The API reconstructs the capital-adjusted daily NAV index of the client's
 * book from real closes (cache → bundled parquet → yfinance, same-category
 * peer fill for late listings — see apps/api client_daily_nav). This module
 * builds the request payload from demo-client holdings, validates/parses the
 * response, and memoizes requests so the performance chart, the goal
 * simulator, and the goal-path compare panel share one fetch per book.
 *
 * No fabricated data: when the request fails or returns no points, callers
 * fall back to the calibrated series built from reported returns
 * (`buildClientPerformanceSeries`), never to a synthetic path.
 */

import type { ClientNavPoint, ClientPerfHolding } from "./clients-charts";
import { computeCagr } from "./clients";
import { fetchClientDailyNav } from "./api";

/** Cash detection tolerant of a missing asset_class (perf-holding shape). */
function isCashLike(h: Pick<ClientPerfHolding, "ticker" | "asset_class">): boolean {
  const t = h.ticker.toUpperCase();
  const c = (h.asset_class ?? "").toLowerCase();
  return t === "CASH" || c.includes("cash") || c.includes("現金");
}

export type DailyNavRequestHolding = {
  ticker: string;
  /** Initial capital weight (fraction of book at investment). */
  weight: number;
  invested_at?: string;
};

export type DailyNavPoint = { date: string; nav: number };

/** Per-priced-holding real return from the API (same series as the NAV path). */
export type DailyNavPerTicker = {
  ticker: string;
  /** invested_at as sent in the request (null when the holding had none). */
  invested_at?: string | null;
  first_date?: string | null;
  last_date?: string | null;
  /** Real close-to-close total return since first_date, as a decimal. */
  cumulative_return?: number | null;
};

export type ClientDailyNavResponse = {
  daily: DailyNavPoint[];
  meta?: {
    window?: { start: string; end: string; days: number };
    data_source?: string;
    cash_weight?: number;
    dropped_tickers?: string[];
    proxy_fills?: Record<
      string,
      { proxies: string[]; days_filled: number; zero_filled_days?: number }
    >;
    per_ticker?: DailyNavPerTicker[];
    assumptions?: string[];
  };
};

/** Real per-holding return used to reconcile the holdings table with the chart. */
export type HoldingRealReturn = {
  /** First priced day (anchor; peer-covered for late listings). */
  firstDate: string;
  lastDate: string;
  /** Cumulative total return since firstDate, as a decimal. */
  cumReturn: number;
};

/** Map key shared by the API per_ticker rows and book holdings. */
export function perTickerKey(
  ticker: string,
  investedAt: string | null | undefined,
): string {
  const inv = investedAt && investedAt.length >= 10 ? investedAt.slice(0, 10) : "";
  return `${ticker.toUpperCase()}|${inv}`;
}

export type DailyNavPlan = {
  holdings: DailyNavRequestHolding[];
  /** Book as-of date → API window end. */
  end: string;
  /** Content key for the shared request cache. */
  key: string;
};

const INVESTED_AT_RE = /^\d{4}-\d{2}-\d{2}/;

/**
 * Book holdings → daily-nav request payload.
 * Capital per holding = initial_weight ?? weight (current weight is the best
 * available proxy when the book has no initial weights). Cash sleeves merge
 * into one CASH entry (flat 0% per the API convention). Returns null when
 * there is nothing priceable — a cash-only book has a flat real path, so
 * callers keep the calibrated placeholder instead of fetching.
 */
export function buildDailyNavPlan(
  holdings: ClientPerfHolding[],
  asOfDate: string | null | undefined,
): DailyNavPlan | null {
  if (!asOfDate) return null;
  const out: DailyNavRequestHolding[] = [];
  let cashWeight = 0;
  for (const h of holdings) {
    const cap = h.initial_weight ?? h.weight;
    if (!Number.isFinite(cap) || cap <= 0) continue;
    if (isCashLike(h)) {
      cashWeight += cap;
      continue;
    }
    const entry: DailyNavRequestHolding = {
      ticker: h.ticker.toUpperCase(),
      weight: cap,
    };
    if (h.invested_at && INVESTED_AT_RE.test(h.invested_at)) {
      entry.invested_at = h.invested_at.slice(0, 10);
    }
    out.push(entry);
  }
  if (out.length === 0) return null;
  if (cashWeight > 0) {
    out.push({ ticker: "CASH", weight: Math.round(cashWeight * 1e6) / 1e6 });
  }
  out.sort(
    (a, b) =>
      a.ticker.localeCompare(b.ticker) ||
      (a.invested_at ?? "").localeCompare(b.invested_at ?? "") ||
      a.weight - b.weight,
  );
  const key = JSON.stringify({
    h: out.map((x) => [x.ticker, Math.round(x.weight * 1e6) / 1e6, x.invested_at ?? ""]),
    end: asOfDate,
  });
  return { holdings: out, end: asOfDate, key };
}

/** Parse/validate API rows into sorted NAV points; invalid rows dropped. */
export function parseDailyNavResponse(
  res: ClientDailyNavResponse | null | undefined,
): ClientNavPoint[] {
  if (!res || !Array.isArray(res.daily)) return [];
  return res.daily
    .filter(
      (p): p is DailyNavPoint =>
        Boolean(p) &&
        typeof p.date === "string" &&
        p.date.length >= 10 &&
        Number.isFinite(p.nav) &&
        p.nav > 0,
    )
    .map((p) => ({ date: p.date.slice(0, 10), nav: p.nav }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Parse meta.per_ticker into a lookup keyed by perTickerKey(ticker, invested_at). */
export function parsePerTickerReturns(
  res: ClientDailyNavResponse | null | undefined,
): Map<string, HoldingRealReturn> {
  const out = new Map<string, HoldingRealReturn>();
  const rows = res?.meta?.per_ticker;
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    if (!r || typeof r.ticker !== "string" || !r.ticker) continue;
    const cum = r.cumulative_return;
    if (typeof cum !== "number" || !Number.isFinite(cum) || cum <= -1) continue;
    if (typeof r.first_date !== "string" || r.first_date.length < 10) continue;
    if (typeof r.last_date !== "string" || r.last_date.length < 10) continue;
    out.set(perTickerKey(r.ticker, r.invested_at), {
      firstDate: r.first_date.slice(0, 10),
      lastDate: r.last_date.slice(0, 10),
      cumReturn: cum,
    });
  }
  return out;
}

/**
 * Real return for a book holding, keyed by ticker + invested_at (cash and
 * unpriced/dropped tickers resolve to undefined → caller falls back to the
 * reported total_return).
 */
export function realReturnForHolding(
  holding: Pick<ClientPerfHolding, "ticker" | "asset_class" | "invested_at">,
  perTicker: Map<string, HoldingRealReturn> | null | undefined,
): HoldingRealReturn | undefined {
  if (!perTicker || isCashLike(holding)) return undefined;
  return perTicker.get(perTickerKey(holding.ticker, holding.invested_at));
}

/** Real cumulative return in percent points, when priced. */
export function realCumulativePctForHolding(
  holding: Pick<ClientPerfHolding, "ticker" | "asset_class" | "invested_at">,
  perTicker: Map<string, HoldingRealReturn> | null | undefined,
): number | undefined {
  const real = realReturnForHolding(holding, perTicker);
  return real ? real.cumReturn * 100 : undefined;
}

/** Real CAGR (percent points) from the same real return over firstDate → as_of. */
export function realCagrPctForHolding(
  holding: Pick<ClientPerfHolding, "ticker" | "asset_class" | "invested_at">,
  perTicker: Map<string, HoldingRealReturn> | null | undefined,
  asOfDate: string | null | undefined,
): number | undefined {
  const real = realReturnForHolding(holding, perTicker);
  if (!real) return undefined;
  return computeCagr(real.firstDate, asOfDate, real.cumReturn);
}

export type ResolvedHoldingReturn = {
  /** Percent points; undefined when no value exists at all. */
  pct: number | undefined;
  /** True when the value came from real price history (not reported fallback). */
  real: boolean;
};

export type WeightedHoldingReturn = {
  pct: number | undefined;
  /** True when every valued non-cash holding resolved to real price data. */
  allReal: boolean;
};

/**
 * Current-weight average of per-holding returns with the
 * `holdingsGroupCumulativeReturn` convention: cash contributes its weight at
 * 0 (dilutes), holdings without any value are skipped, cash-only → undefined.
 */
export function weightedHoldingReturnPct<
  H extends { ticker: string; weight: number; asset_class?: string },
>(holdings: readonly H[], resolve: (h: H) => ResolvedHoldingReturn): WeightedHoldingReturn {
  let wSum = 0;
  let retSum = 0;
  let investedWeight = 0;
  let allReal = true;
  for (const h of holdings) {
    if (isCashLike(h)) {
      wSum += h.weight;
      continue;
    }
    const v = resolve(h);
    if (typeof v.pct !== "number" || !Number.isFinite(v.pct)) continue;
    if (!v.real) allReal = false;
    wSum += h.weight;
    investedWeight += h.weight;
    retSum += h.weight * v.pct;
  }
  if (investedWeight <= 0 || wSum <= 0) return { pct: undefined, allReal: false };
  return { pct: retSum / wSum, allReal };
}

const dailyNavCache = new Map<string, Promise<ClientDailyNavData>>();

/** Parsed bundle shared by the chart, goal simulator, and compare panel. */
export type ClientDailyNavData = {
  points: ClientNavPoint[];
  perTicker: Map<string, HoldingRealReturn>;
};

/**
 * Shared fetch with in-flight dedupe: the chart, goal simulator, and compare
 * panel request the same book concurrently. Failures are evicted so a later
 * render can retry.
 */
export function getCachedClientDailyNav(
  plan: DailyNavPlan,
): Promise<ClientDailyNavData> {
  const cached = dailyNavCache.get(plan.key);
  if (cached) return cached;
  const promise = fetchClientDailyNav(plan.holdings, { end: plan.end })
    .then((res) => ({
      points: parseDailyNavResponse(res),
      perTicker: parsePerTickerReturns(res),
    }))
    .catch((err) => {
      dailyNavCache.delete(plan.key);
      throw err;
    });
  dailyNavCache.set(plan.key, promise);
  return promise;
}

/** Test helper: drop memoized requests. */
export function clearClientDailyNavCache(): void {
  dailyNavCache.clear();
}
