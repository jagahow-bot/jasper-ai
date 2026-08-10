/**
 * Portfolio backcast (回推) series → goal-planning return bands.
 *
 * The API (`POST /backcast/monthly`) builds a synthetic monthly history for a
 * fixed target mix (peer-proxy fill for late listings, periodic rebalance to
 * target, turnover fees). This module converts that monthly series into the
 * annual-return inputs of `financial-goal-planning-returns`:
 *
 * - default expected return = annualized return of the series
 * - optimistic / conservative = P90 / P10 (median P50) of the annual-return
 *   distribution, surfaced via `PlanningReturnBand.p10/p50/p90Return`
 * - the existing confidence-floor UI keeps working: the band's floor/ceiling
 *   remain the confidence percentiles of the same distribution.
 *
 * Priority per the agreed design: realized client-book history (when it
 * describes the selected portfolio) beats the synthetic backcast.
 */

import type { ClientHolding } from "@/lib/clients";
import { isCashHolding } from "@/lib/clients";
import type { ClientNavPoint } from "@/lib/clients-charts";
import {
  planningReturnBandFromAnnualReturns,
  type PlanningReturnBand,
} from "@/lib/financial-goal-planning-returns";

export type BackcastMonthlyPoint = {
  /** YYYY-MM */
  month: string;
  /** Simple monthly return as a decimal (0.01 = +1%). */
  ret: number;
};

export type BackcastProxyFill = {
  proxies: string[];
  months_filled: number;
};

export type BackcastMeta = {
  window?: { start: string; end: string; months: number };
  data_source?: string;
  rebalance_rule?: string;
  fee_bps?: number;
  cash_weight?: number;
  first_valid_month?: Record<string, string | null>;
  dropped_tickers?: string[];
  proxy_fills?: Record<string, BackcastProxyFill>;
  peer_tickers_loaded?: string[];
  residual_zero_filled_cells?: number;
  assumptions?: string[];
};

export type BackcastMonthlyRow = {
  month: string;
  return: number;
  rebalanced?: boolean;
  fee?: number;
};

export type BackcastMonthlyResponse = {
  monthly: BackcastMonthlyRow[];
  meta: BackcastMeta;
};

/** Minimum monthly observations before trusting annualized stats at all. */
export const MIN_BACKCAST_MONTHS = 6;

function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/** Parse API rows into sorted, finite monthly points. */
export function parseBackcastMonthly(
  rows: BackcastMonthlyResponse["monthly"] | null | undefined,
): BackcastMonthlyPoint[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(
      (r): r is BackcastMonthlyRow =>
        Boolean(r) &&
        typeof r.month === "string" &&
        r.month.length >= 7 &&
        isFiniteNumber(r.return) &&
        r.return > -1,
    )
    .map((r) => ({ month: r.month.slice(0, 7), ret: r.return }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** Complete-calendar-year returns (12 monthly obs) compounded from monthly. */
export function calendarYearReturnsFromMonthly(
  monthly: BackcastMonthlyPoint[],
): number[] {
  const byYear = new Map<number, number[]>();
  for (const p of monthly) {
    const y = Number(p.month.slice(0, 4));
    if (!Number.isFinite(y)) continue;
    const arr = byYear.get(y) ?? [];
    arr.push(p.ret);
    byYear.set(y, arr);
  }
  const years = [...byYear.keys()].sort((a, b) => a - b);
  const out: number[] = [];
  for (const y of years) {
    const rets = byYear.get(y)!;
    if (rets.length !== 12) continue; // partial years excluded
    let growth = 1;
    for (const r of rets) growth *= 1 + r;
    if (growth > 0) out.push(growth - 1);
  }
  return out;
}

/** Geometric annualized return of the whole monthly series. */
export function annualizedReturnFromMonthly(
  monthly: BackcastMonthlyPoint[],
): number {
  if (monthly.length < 1) return NaN;
  let growth = 1;
  for (const p of monthly) growth *= 1 + p.ret;
  if (!(growth > 0)) return NaN;
  return growth ** (12 / monthly.length) - 1;
}

/** Last NAV per calendar month → simple monthly returns. */
export function monthlyReturnsFromNav(
  points: ClientNavPoint[],
): BackcastMonthlyPoint[] {
  if (!points?.length) return [];
  const lastByMonth = new Map<string, number>();
  const sorted = [...points]
    .filter((p) => p.date && isFiniteNumber(p.nav) && p.nav > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const p of sorted) {
    lastByMonth.set(p.date.slice(0, 7), p.nav);
  }
  const months = [...lastByMonth.keys()].sort();
  const out: BackcastMonthlyPoint[] = [];
  for (let i = 1; i < months.length; i++) {
    const prev = lastByMonth.get(months[i - 1]!)!;
    const cur = lastByMonth.get(months[i]!)!;
    if (prev > 0) out.push({ month: months[i]!, ret: cur / prev - 1 });
  }
  return out;
}

/**
 * Planning band from a monthly series (backcast or realized-history).
 *
 * ≥3 complete years → the standard winsorized/shrunk band over annual
 * returns. Shorter series still honor "expected return = annualized series
 * return": base uses the annualized geometric mean, with prior-styled ±2%
 * floors (too few years for a meaningful empirical distribution).
 */
export function planningBandFromMonthlySeries(
  monthly: BackcastMonthlyPoint[],
  priorReturn: number,
  confidenceLevel: number = 0.6,
): PlanningReturnBand {
  const annual = calendarYearReturnsFromMonthly(monthly);
  if (annual.length >= 3) {
    return planningReturnBandFromAnnualReturns(annual, priorReturn, confidenceLevel);
  }
  const ann = annualizedReturnFromMonthly(monthly);
  if (monthly.length >= MIN_BACKCAST_MONTHS && Number.isFinite(ann)) {
    const base = Math.min(0.35, Math.max(-0.15, ann));
    const c = Math.min(0.95, Math.max(0.5, confidenceLevel));
    return {
      baseReturn: base,
      floorReturn: base - 0.02,
      ceilingReturn: base + 0.02,
      optimisticDelta: 0.02,
      conservativeDelta: 0.02,
      confidenceLevel: c,
      geometricMean: base,
      winsorizedGeometricMean: base,
      arithmeticMean: base,
      planningCeiling: base,
      shrinkWeight: 0,
      annualVol: 0,
      sampleYears: annual.length,
      p10Return: base - 0.02,
      p50Return: base,
      p90Return: base + 0.02,
      priorReturn: priorReturn,
      method: "prior_fallback",
    };
  }
  return planningReturnBandFromAnnualReturns([], priorReturn, confidenceLevel);
}

/** Tolerance for treating a proposed mix as "the client's current book". */
export const BOOK_MATCH_WEIGHT_TOLERANCE = 0.05;

/**
 * True when `weights` covers the same non-cash tickers as the client book
 * with each weight within ±5pp — i.e. the selected proposal is effectively
 * the current portfolio, so realized book history describes it.
 */
export function weightsMatchClientBook(
  weights: Record<string, number> | null | undefined,
  holdings: ClientHolding[],
): boolean {
  if (!weights) return false;
  const book = new Map<string, number>();
  for (const h of holdings) {
    if (isCashHolding(h)) continue;
    const t = h.ticker.toUpperCase();
    book.set(t, (book.get(t) ?? 0) + h.weight);
  }
  const proposed = new Map<string, number>();
  for (const [t, w] of Object.entries(weights)) {
    if (!Number.isFinite(w) || w <= 0) continue;
    if (t.toUpperCase() === "CASH") continue;
    proposed.set(t.toUpperCase(), (proposed.get(t.toUpperCase()) ?? 0) + w);
  }
  if (book.size === 0 || proposed.size === 0) return false;
  const norm = (m: Map<string, number>) => {
    const total = [...m.values()].reduce((s, x) => s + x, 0) || 1;
    return new Map([...m.entries()].map(([k, v]) => [k, v / total]));
  };
  const bn = norm(book);
  const pn = norm(proposed);
  for (const [t, w] of bn) {
    const pw = pn.get(t);
    if (pw == null) return false;
    if (Math.abs(pw - w) > BOOK_MATCH_WEIGHT_TOLERANCE) return false;
  }
  for (const t of pn.keys()) {
    if (!bn.has(t)) return false;
  }
  return true;
}

/** The goal simulator's three return inputs, resolved from performance. */
export type GoalReturnDefaults = {
  annualReturn: number;
  optimisticDelta: number;
  conservativeDelta: number;
};

/** Where the resolved defaults came from. */
export type GoalReturnDefaultsSource = "realized" | "backcast";

export type GoalReturnDefaultsResolution = {
  defaults: GoalReturnDefaults;
  source: GoalReturnDefaultsSource;
  band: PlanningReturnBand;
  /** Monthly observations behind the band. */
  months: number;
};

/**
 * Current client book → backcast target weights. Tickers uppercased and
 * duplicate sleeves summed; CASH is kept (the API treats it as a 0% sleeve);
 * non-positive / non-finite weights dropped.
 */
export function holdingsToBackcastWeights(
  holdings: ClientHolding[],
): Record<string, number> {
  const out = new Map<string, number>();
  for (const h of holdings) {
    if (!Number.isFinite(h.weight) || h.weight <= 0) continue;
    const t = h.ticker.toUpperCase();
    out.set(t, (out.get(t) ?? 0) + h.weight);
  }
  return Object.fromEntries(out);
}

/** Round to 0.1pp — the precision the simulator percent inputs display. */
function roundTenthPercent(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Map a planning band onto the simulator's base return + deltas. */
export function goalReturnDefaultsFromBand(
  band: PlanningReturnBand,
): GoalReturnDefaults {
  return {
    annualReturn: roundTenthPercent(band.baseReturn),
    optimisticDelta: roundTenthPercent(band.optimisticDelta),
    conservativeDelta: roundTenthPercent(band.conservativeDelta),
  };
}

/**
 * Resolve default return inputs from the client's actual performance.
 * Priority per the agreed design: realized book history → synthetic backcast.
 * Returns null when neither series has ≥ MIN_BACKCAST_MONTHS observations
 * (callers keep their manual defaults in that case).
 */
export function resolveGoalReturnDefaults(args: {
  realizedMonthly?: BackcastMonthlyPoint[] | null;
  backcastMonthly?: BackcastMonthlyPoint[] | null;
  priorReturn: number;
  confidenceLevel?: number;
}): GoalReturnDefaultsResolution | null {
  const confidence = args.confidenceLevel ?? 0.6;
  const candidates: [GoalReturnDefaultsSource, BackcastMonthlyPoint[] | null | undefined][] = [
    ["realized", args.realizedMonthly],
    ["backcast", args.backcastMonthly],
  ];
  for (const [source, monthly] of candidates) {
    if (!monthly || monthly.length < MIN_BACKCAST_MONTHS) continue;
    const band = planningBandFromMonthlySeries(
      monthly,
      args.priorReturn,
      confidence,
    );
    return {
      defaults: goalReturnDefaultsFromBand(band),
      source,
      band,
      months: monthly.length,
    };
  }
  return null;
}

/** Human-readable summary of proxy fills for diagnostics/tooltips. */
export function backcastProxySummary(meta: BackcastMeta | null | undefined): {
  filledTickers: string[];
  monthsFilled: number;
} {
  const fills = meta?.proxy_fills ?? {};
  const filledTickers = Object.keys(fills).sort();
  const monthsFilled = Object.values(fills).reduce(
    (s, f) => s + (f?.months_filled ?? 0),
    0,
  );
  return { filledTickers, monthsFilled };
}
