/**
 * Forward planning returns from calendar-year backtest performance.
 *
 * Pragmatic long-horizon path (not raw CAGR):
 * 1) Winsorize annual returns to damp single-year outliers
 * 2) Shrink sample geo-mean toward the original plan prior
 * 3) Cap the planning rate at the winsorized arithmetic mean (no fixed % ceiling)
 */

export type EquityPoint = { date: string; value: number };

/** Probability that a random historical year is at least the floor return. */
export const PLANNING_CONFIDENCE_LEVELS = [0.5, 0.6, 0.7, 0.8, 0.9] as const;
export type PlanningConfidenceLevel =
  (typeof PLANNING_CONFIDENCE_LEVELS)[number];

/** Trim extreme calendar years before forming planning rates. */
export const WINSOR_LOW_P = 0.1;
export const WINSOR_HIGH_P = 0.9;

/** Pseudo-years for shrink toward the original plan prior. */
export const SHRINK_PSEUDO_YEARS = 8;

export type PlanningReturnBand = {
  /** Constant annual return for the base path (after winsor / shrink / avg cap). */
  baseReturn: number;
  /** Floor return at the selected confidence (P(year ≥ floor) ≈ confidence). */
  floorReturn: number;
  /** Upper empirical percentile (symmetric: confidence quantile). */
  ceilingReturn: number;
  /** Added to base for optimistic scenario (fraction). */
  optimisticDelta: number;
  /** Subtracted from base for conservative scenario (fraction). */
  conservativeDelta: number;
  /** Selected confidence level (e.g. 0.6 = 60%). */
  confidenceLevel: number;
  /** Geometric mean of calendar-year returns (raw, before winsor). */
  geometricMean: number;
  /** Geometric mean after winsorize. */
  winsorizedGeometricMean: number;
  /** Arithmetic mean after winsorize (used as sample-based rate ceiling). */
  arithmeticMean: number;
  /** Effective ceiling applied to base (= winsorized arithmetic mean). */
  planningCeiling: number;
  /** Weight on sample vs prior in the shrink step. */
  shrinkWeight: number;
  /** Sample std of winsorized calendar-year returns. */
  annualVol: number;
  /** Number of complete calendar years used. */
  sampleYears: number;
  /** P10 of the (winsorized) annual-return distribution — conservative anchor. */
  p10Return: number;
  /** Median (P50) annual return. */
  p50Return: number;
  /** P90 annual return — optimistic anchor. */
  p90Return: number;
  priorReturn: number;
  method: "winsorized_mean_cap" | "prior_fallback";
};

/** Soft engine bounds only (avoid exploding / NaN paths). */
const SOFT_MAX = 0.35;
const SOFT_MIN = -0.15;

function sampleStd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const varSum = xs.reduce((s, x) => s + (x - mean) ** 2, 0);
  return Math.sqrt(varSum / (xs.length - 1));
}

function geometricMean(rets: number[]): number {
  if (rets.length === 0) return 0;
  let logSum = 0;
  for (const r of rets) {
    const growth = 1 + r;
    if (!(growth > 0)) return NaN;
    logSum += Math.log(growth);
  }
  return Math.exp(logSum / rets.length) - 1;
}

function arithmeticMean(rets: number[]): number {
  if (rets.length === 0) return NaN;
  return rets.reduce((s, x) => s + x, 0) / rets.length;
}

function softClamp(r: number): number {
  if (!Number.isFinite(r)) return 0.05;
  return Math.min(SOFT_MAX, Math.max(SOFT_MIN, r));
}

/** Linear interpolation percentile; `p` in [0, 1]; `xs` sorted ascending. */
export function empiricalPercentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return NaN;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const t = Math.min(1, Math.max(0, p));
  const idx = (sortedAsc.length - 1) * t;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo]!;
  const w = idx - lo;
  return sortedAsc[lo]! * (1 - w) + sortedAsc[hi]! * w;
}

/** Clip each year to [loP, hiP] empirical percentiles of the sample. */
export function winsorizeReturns(
  rets: number[],
  loP: number = WINSOR_LOW_P,
  hiP: number = WINSOR_HIGH_P,
): number[] {
  if (rets.length < 3) return [...rets];
  const sorted = [...rets].sort((a, b) => a - b);
  const lo = empiricalPercentile(sorted, loP);
  const hi = empiricalPercentile(sorted, hiP);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) return [...rets];
  return rets.map((r) => Math.min(hi, Math.max(lo, r)));
}

/**
 * Complete calendar-year total returns from an equity index series.
 */
export function calendarYearReturnsFromEquityCurve(
  curve: EquityPoint[],
): number[] {
  if (!curve || curve.length < 2) return [];
  const sorted = [...curve]
    .filter((p) => p.date && Number.isFinite(p.value) && p.value > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) return [];

  const byYear = new Map<number, EquityPoint>();
  for (const p of sorted) {
    const y = Number(p.date.slice(0, 4));
    if (!Number.isFinite(y)) continue;
    const prev = byYear.get(y);
    if (!prev || p.date >= prev.date) byYear.set(y, p);
  }

  const years = [...byYear.keys()].sort((a, b) => a - b);
  const rets: number[] = [];
  for (let i = 1; i < years.length; i++) {
    const y0 = years[i - 1]!;
    const y1 = years[i]!;
    if (y1 !== y0 + 1) continue;
    const a = byYear.get(y0)!.value;
    const b = byYear.get(y1)!.value;
    if (a > 0 && b > 0) rets.push(b / a - 1);
  }
  return rets;
}

function emptyBand(
  prior: number,
  c: number,
  annualReturns: number[],
): PlanningReturnBand {
  const geo = annualReturns.length ? geometricMean(annualReturns) : prior;
  const g = Number.isFinite(geo) ? geo : prior;
  return {
    baseReturn: prior,
    floorReturn: prior - 0.02,
    ceilingReturn: prior + 0.02,
    optimisticDelta: 0.02,
    conservativeDelta: 0.02,
    confidenceLevel: c,
    geometricMean: g,
    winsorizedGeometricMean: g,
    arithmeticMean: g,
    planningCeiling: g,
    shrinkWeight: 0,
    annualVol: sampleStd(annualReturns),
    sampleYears: annualReturns.length,
    p10Return: prior - 0.02,
    p50Return: prior,
    p90Return: prior + 0.02,
    priorReturn: prior,
    method: "prior_fallback",
  };
}

/**
 * Base path after winsorize → shrink toward prior → cap at winsorized average.
 * Floor / ceiling bands use winsorized annual percentiles at confidence c.
 * No fixed percentage planning ceiling (e.g. no hard 10%).
 */
export function planningReturnBandFromAnnualReturns(
  annualReturns: number[],
  priorReturn: number,
  confidenceLevel: number = 0.6,
): PlanningReturnBand {
  const prior = softClamp(
    Number.isFinite(priorReturn) ? priorReturn : 0.05,
  );
  const c = Math.min(0.95, Math.max(0.5, confidenceLevel));

  if (annualReturns.length < 3) {
    return emptyBand(prior, c, annualReturns);
  }

  const rawGeo = geometricMean(annualReturns);
  const winsorized = winsorizeReturns(annualReturns);
  const geoW = geometricMean(winsorized);
  const arithW = arithmeticMean(winsorized);
  const vol = sampleStd(winsorized);
  const n = winsorized.length;
  const shrinkWeight = n / (n + SHRINK_PSEUDO_YEARS);
  const shrunk =
    shrinkWeight * (Number.isFinite(geoW) ? geoW : prior) +
    (1 - shrinkWeight) * prior;

  // Sample average as upper bound (winsorized arithmetic mean only).
  const planningCeiling = softClamp(
    Number.isFinite(arithW) ? arithW : shrunk,
  );
  const baseReturn = softClamp(Math.min(shrunk, planningCeiling));

  const sorted = [...winsorized].sort((a, b) => a - b);
  // Keep empirical floors/ceilings for the confidence UI — do not clamp to
  // baseReturn (that made 50–80% all show the same number when the sample
  // was strong and base was already shrunk/capped below those percentiles).
  const floorReturn = softClamp(empiricalPercentile(sorted, 1 - c));
  const ceilingRaw = empiricalPercentile(sorted, c);
  const ceilingReturn = softClamp(
    Number.isFinite(ceilingRaw) ? ceilingRaw : baseReturn + 0.02,
  );

  return {
    baseReturn,
    floorReturn,
    ceilingReturn,
    optimisticDelta: Math.max(0, ceilingReturn - baseReturn),
    conservativeDelta: Math.max(0, baseReturn - floorReturn),
    confidenceLevel: c,
    geometricMean: Number.isFinite(rawGeo) ? rawGeo : prior,
    winsorizedGeometricMean: Number.isFinite(geoW) ? geoW : prior,
    arithmeticMean: Number.isFinite(arithW) ? arithW : prior,
    planningCeiling,
    shrinkWeight,
    annualVol: vol,
    sampleYears: n,
    p10Return: softClamp(empiricalPercentile(sorted, 0.1)),
    p50Return: softClamp(empiricalPercentile(sorted, 0.5)),
    p90Return: softClamp(empiricalPercentile(sorted, 0.9)),
    priorReturn: prior,
    method: "winsorized_mean_cap",
  };
}

export function planningReturnBandFromEquityCurve(
  curve: EquityPoint[],
  priorReturn: number,
  confidenceLevel: number = 0.6,
): PlanningReturnBand {
  return planningReturnBandFromAnnualReturns(
    calendarYearReturnsFromEquityCurve(curve),
    priorReturn,
    confidenceLevel,
  );
}
