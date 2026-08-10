/**
 * Pure chart helpers for the client dashboard (no i18n / React deps).
 */

export type ClientPieSlice = { name: string; value: number };
export type ClientNavPoint = { date: string; nav: number };
/** Cumulative return vs window start as a decimal fraction (0.05 = +5%). */
export type ClientReturnPoint = { date: string; ret: number };

export type ClientPerfTimeframe = "1M" | "3M" | "6M" | "YTD" | "1Y" | "MAX";

export const CLIENT_PERF_TIMEFRAMES: readonly ClientPerfTimeframe[] = [
  "1M",
  "3M",
  "6M",
  "YTD",
  "1Y",
  "MAX",
] as const;

/** Fallback lookback when holdings lack invested_at. */
export const CLIENT_PERF_HISTORY_MONTHS = 36;

type WeightHolding = { ticker: string; weight: number; asset_class?: string };
type WeightGroup = { id: string; holdings: WeightHolding[] };

/** Holding fields needed to reconstruct a performance path from client book data. */
export type ClientPerfHolding = WeightHolding & {
  initial_weight?: number;
  total_return?: number | null;
  return_ytd?: number | null;
  invested_at?: string | null;
};

/**
 * Pie slices from holdings weights (ticker labels).
 * When renormalize is true, weights are scaled to sum to 1 (for filtered groups).
 */
export function buildClientHoldingsPie(
  holdings: WeightHolding[],
  opts?: { renormalize?: boolean },
): ClientPieSlice[] {
  const slices = holdings
    .filter((h) => h.weight > 0)
    .map((h) => ({ name: h.ticker, value: h.weight }))
    .sort((a, b) => b.value - a.value);
  if (!opts?.renormalize || slices.length === 0) return slices;
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  return slices.map((x) => ({ ...x, value: x.value / total }));
}

function groupWeight(group: WeightGroup): number {
  return group.holdings.reduce((sum, h) => sum + h.weight, 0);
}

/**
 * Pie slices aggregated by holdings group (model / individual / cash sleeves).
 * `labelOf` supplies display names; empty or zero-weight groups are omitted.
 */
export function buildClientHoldingsGroupPie(
  groups: WeightGroup[],
  opts: {
    selectedIds?: readonly string[];
    labelOf: (group: WeightGroup) => string;
    renormalize?: boolean;
  },
): ClientPieSlice[] {
  const selected =
    opts.selectedIds != null ? new Set(opts.selectedIds) : null;
  const slices = groups
    .filter((g) => (selected ? selected.has(g.id) : true))
    .map((g) => ({
      name: opts.labelOf(g),
      value: groupWeight(g),
    }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
  if (!opts.renormalize || slices.length === 0) return slices;
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  return slices.map((x) => ({ ...x, value: x.value / total }));
}

/** Earliest date (inclusive) for a performance window ending at `asOfDate`. */
export function clientPerfWindowStart(
  timeframe: ClientPerfTimeframe,
  asOfDate: string,
): string | null {
  if (timeframe === "MAX") return null;
  const end = new Date(`${asOfDate}T12:00:00Z`);
  if (Number.isNaN(end.getTime())) return null;
  if (timeframe === "YTD") {
    return `${end.getUTCFullYear()}-01-01`;
  }
  const months =
    timeframe === "1M"
      ? 1
      : timeframe === "3M"
        ? 3
        : timeframe === "6M"
          ? 6
          : 12;
  const start = new Date(end);
  // Anchor on day 1 so subtracting months never overflows (e.g. Dec 31 → Sep 31).
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - months);
  return start.toISOString().slice(0, 10);
}

/**
 * Slice NAV history to the selected timeframe and rebase to cumulative return
 * (decimal) from the first point in the window.
 */
export function toClientPerformanceReturnSeries(
  points: ClientNavPoint[],
  timeframe: ClientPerfTimeframe,
  asOfDate: string,
): ClientReturnPoint[] {
  if (points.length === 0) return [];
  const start = clientPerfWindowStart(timeframe, asOfDate);
  let sliced =
    start == null ? points : points.filter((p) => p.date >= start);
  if (sliced.length === 0) sliced = points.slice(-1);
  const base = sliced[0]?.nav;
  if (!(base > 0)) return [];
  return sliced.map((p) => ({
    date: p.date,
    ret: Math.round((p.nav / base - 1) * 10000) / 10000,
  }));
}

/**
 * Portfolio return for the selected chart window as percent points.
 * Same endpoint the performance chart plots — use for table footer sync.
 */
export function windowReturnPctFromSeries(
  series: ClientReturnPoint[],
): number | undefined {
  if (series.length === 0) return undefined;
  const last = series[series.length - 1]?.ret;
  if (typeof last !== "number" || !Number.isFinite(last)) return undefined;
  return Math.round(last * 10000) / 100; // decimal → percent points, 2dp-ish via 4dp ret
}

function isCashHolding(h: Pick<ClientPerfHolding, "ticker" | "asset_class">): boolean {
  const t = h.ticker.toUpperCase();
  const c = (h.asset_class ?? "").toLowerCase();
  return (
    t === "CASH" ||
    c === "cash" ||
    c.includes("cash") ||
    c.includes("現金")
  );
}

function holdingCapital(h: ClientPerfHolding): number {
  const cap = h.initial_weight ?? h.weight;
  return Number.isFinite(cap) && cap > 0 ? cap : 0;
}

function hasReturnMetrics(h: ClientPerfHolding): boolean {
  if (isCashHolding(h)) return true;
  return (
    typeof h.total_return === "number" ||
    typeof h.return_ytd === "number"
  );
}

type GrowthKnot = { date: string; growth: number };

/** Growth factor knots: invested_at → 1, optional year-start, as_of → 1+R. */
export function holdingGrowthKnots(
  holding: ClientPerfHolding,
  asOfDate: string,
): GrowthKnot[] {
  if (isCashHolding(holding)) {
    return [{ date: asOfDate, growth: 1 }];
  }

  const invested = holding.invested_at || asOfDate;
  const total =
    typeof holding.total_return === "number"
      ? holding.total_return / 100
      : typeof holding.return_ytd === "number" &&
          invested.slice(0, 4) === asOfDate.slice(0, 4)
        ? holding.return_ytd / 100
        : 0;
  const ytd =
    typeof holding.return_ytd === "number" ? holding.return_ytd / 100 : null;

  const knots: GrowthKnot[] = [{ date: invested, growth: 1 }];
  const yearStart = `${asOfDate.slice(0, 4)}-01-01`;
  if (
    ytd != null &&
    invested < yearStart &&
    yearStart < asOfDate &&
    1 + ytd > 0
  ) {
    knots.push({ date: yearStart, growth: (1 + total) / (1 + ytd) });
  }
  knots.push({ date: asOfDate, growth: 1 + total });
  return knots.sort((a, b) => a.date.localeCompare(b.date));
}

function lerpGrowth(
  d0: string,
  g0: number,
  d1: string,
  g1: number,
  d: string,
): number {
  const t0 = Date.parse(`${d0}T12:00:00Z`);
  const t1 = Date.parse(`${d1}T12:00:00Z`);
  const t = Date.parse(`${d}T12:00:00Z`);
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || !Number.isFinite(t)) {
    return g1;
  }
  if (t1 <= t0) return g1;
  const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  if (g0 > 0 && g1 > 0) {
    return Math.exp(Math.log(g0) + u * (Math.log(g1) - Math.log(g0)));
  }
  return g0 + u * (g1 - g0);
}

/** Growth factor of a holding on date `d` (1 = purchase NAV). Before invest → 0. */
export function holdingGrowthOnDate(
  holding: ClientPerfHolding,
  date: string,
  asOfDate: string,
): number {
  if (isCashHolding(holding)) return 1;
  const invested = holding.invested_at;
  if (invested && date < invested) return 0;
  const knots = holdingGrowthKnots(holding, asOfDate);
  if (knots.length === 0) return 1;
  if (date <= knots[0].date) return knots[0].growth;
  for (let i = 1; i < knots.length; i++) {
    if (date <= knots[i].date) {
      return lerpGrowth(
        knots[i - 1].date,
        knots[i - 1].growth,
        knots[i].date,
        knots[i].growth,
        date,
      );
    }
  }
  return knots[knots.length - 1].growth;
}

function portfolioValueOnDate(
  holdings: ClientPerfHolding[],
  date: string,
  asOfDate: string,
): number {
  let v = 0;
  for (const h of holdings) {
    const cap = holdingCapital(h);
    if (!(cap > 0)) continue;
    if (isCashHolding(h)) {
      v += cap;
      continue;
    }
    if (h.invested_at && date < h.invested_at) continue;
    v += cap * holdingGrowthOnDate(h, date, asOfDate);
  }
  return v;
}

/** External capital deployed by `date` (cash always counted when present). */
function portfolioCapitalOnDate(
  holdings: ClientPerfHolding[],
  date: string,
): number {
  let c = 0;
  for (const h of holdings) {
    const cap = holdingCapital(h);
    if (!(cap > 0)) continue;
    if (isCashHolding(h)) {
      c += cap;
      continue;
    }
    if (h.invested_at && date < h.invested_at) continue;
    c += cap;
  }
  return c;
}

/** Inclusive calendar-day grid from start → as_of (demo path; no web price API). */
function dailyDates(startDate: string, asOfDate: string): string[] {
  const end = new Date(`${asOfDate}T12:00:00Z`);
  const start = new Date(`${startDate}T12:00:00Z`);
  if (Number.isNaN(end.getTime()) || Number.isNaN(start.getTime())) return [];
  if (start > end) return [asOfDate];

  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Current-weight average of return_ytd as a decimal (cash dilutes).
 * Same rule as `holdingsGroupReturnYtd` in clients.ts (percent points there).
 */
export function holdingsCurrentWeightYtdDecimal(
  holdings: ClientPerfHolding[],
): number | null {
  let wSum = 0;
  let retSum = 0;
  let investedWeight = 0;
  for (const h of holdings) {
    if (isCashHolding(h)) {
      wSum += h.weight;
      continue;
    }
    if (typeof h.return_ytd !== "number") continue;
    wSum += h.weight;
    investedWeight += h.weight;
    retSum += h.weight * (h.return_ytd / 100);
  }
  if (investedWeight <= 0 || wSum <= 0) return null;
  return retSum / wSum;
}

/**
 * Morph the YTD segment so rebase at year-start → as_of equals the table
 * current-weight YTD, while keeping the as_of NAV (book V/C) fixed for MAX.
 * Rescales growth-since-window-start (preserves non-monotonic V/C shape from
 * late contributions) rather than lerping NAV levels.
 */
function alignYtdEndpointToTable(
  points: ClientNavPoint[],
  holdings: ClientPerfHolding[],
  asOfDate: string,
): ClientNavPoint[] {
  const tableYtd = holdingsCurrentWeightYtdDecimal(holdings);
  if (tableYtd == null || !(1 + tableYtd > 0) || points.length < 2) {
    return points;
  }

  const yearStart = `${asOfDate.slice(0, 4)}-01-01`;
  const i0 = points.findIndex((p) => p.date >= yearStart);
  if (i0 < 0) return points;

  const navEnd = points[points.length - 1].nav;
  const nav0 = points[i0].nav;
  if (!(navEnd > 0) || !(nav0 > 0)) return points;

  const gEnd = navEnd / nav0;
  const gTarget = 1 + tableYtd;
  const nav0Target = navEnd / gTarget;
  if (!(nav0Target > 0) || !(gTarget > 0)) return points;

  const lastIdx = points.length - 1;
  const flatRaw = Math.abs(gEnd - 1) < 1e-12;
  const logScale =
    !flatRaw && gEnd > 0 ? Math.log(gTarget) / Math.log(gEnd) : null;

  return points.map((p, i) => {
    if (i < i0) return p;
    let nav: number;
    if (logScale == null) {
      const u = (i - i0) / Math.max(1, lastIdx - i0);
      nav = Math.exp(
        Math.log(nav0Target) + u * (Math.log(navEnd) - Math.log(nav0Target)),
      );
    } else {
      const g = p.nav / nav0;
      if (!(g > 0)) {
        nav = nav0Target;
      } else {
        nav = nav0Target * Math.exp(Math.log(g) * logScale);
      }
    }
    return { date: p.date, nav: Math.round(nav * 1e6) / 1e6 };
  });
}

/**
 * Build daily portfolio NAV index from holdings invested_at / total_return / return_ytd.
 * Emits capital-adjusted index V(t)/C(t) so external contributions at cost do not
 * look like performance (new money raises V and C equally).
 * - MAX end ≈ capital-weighted book growth V(as_of)/C(as_of) − 1
 *   (initial_weight × (1+total_return), cash at 1)
 * - YTD rebase end is forced to the table current-weight average of return_ytd
 *   (cash dilutes), matching holdingsGroupReturnYtd
 * Daily points are a deterministic interpolation between reported return knots —
 * no simulated noise is added.
 */
export function buildHoldingsCalibratedNavSeries(
  holdings: ClientPerfHolding[],
  asOfDate: string,
): ClientNavPoint[] {
  const usable = holdings.filter((h) => holdingCapital(h) > 0);
  if (usable.length === 0) return [];

  const investDates = usable
    .map((h) => h.invested_at)
    .filter((d): d is string => typeof d === "string" && d.length >= 8);
  const earliest =
    investDates.length > 0
      ? investDates.reduce((a, b) => (a < b ? a : b))
      : asOfDate;

  const dates = dailyDates(earliest, asOfDate);
  const points: ClientNavPoint[] = [];
  for (const date of dates) {
    const v = portfolioValueOnDate(usable, date, asOfDate);
    const c = portfolioCapitalOnDate(usable, date);
    if (c > 0 && v > 0) {
      const nav = v / c;
      points.push({ date, nav: Math.round(nav * 1e6) / 1e6 });
    }
  }
  return alignYtdEndpointToTable(points, usable, asOfDate);
}

/** True when at least one non-cash holding has return metrics to calibrate against. */
export function holdingsHavePerformanceMetrics(
  holdings: ClientPerfHolding[],
): boolean {
  return holdings.some(
    (h) => !isCashHolding(h) && hasReturnMetrics(h),
  );
}

/**
 * Portfolio NAV series ending at as_of_date, calibrated from the holdings'
 * reported invested_at / total_return / return_ytd.
 * Returns an empty series when no return metrics exist — callers must show a
 * "no data" state instead of a fabricated path.
 */
export function buildClientPerformanceSeries(
  client: {
    client_id: string;
    as_of_date: string;
    risk_profile: string;
    holdings: ClientPerfHolding[];
  },
): ClientNavPoint[] {
  if (!holdingsHavePerformanceMetrics(client.holdings)) return [];
  return buildHoldingsCalibratedNavSeries(client.holdings, client.as_of_date);
}
