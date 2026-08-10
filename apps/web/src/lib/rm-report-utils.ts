import { largestRemainderPercents, resolveCandidateWeights } from "@/lib/candidate-weights";
import {
  resolveChampionCandidateIndex,
  resolveHorizonMetrics,
  type HorizonMetricSnapshot,
  type PerformanceCompareHorizon,
} from "@/lib/performance-compare-chart";
import type { ClientOverlay } from "@/lib/overlay-schema";
import { getUniverseItems } from "@/lib/universe";
import type { BacktestResult } from "@/lib/types";

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

/**
 * Anchor vs customized comparison prefers metrics computed on the same
 * date-aligned / rebased equity window as the compare chart. Packaged
 * full_sample is only a fallback when curves cannot be aligned.
 */
export const BENCHMARK_COMPARE_HORIZON: PerformanceCompareHorizon = "full_sample";

const TRADING_DAYS_PER_YEAR = 252;
const MS_PER_DAY = 86_400_000;
const DEFAULT_RISK_FREE = 0.04;
const MIN_ANNUAL_VOL = 1e-6;

export type BenchmarkCompareChartRow = {
  date: string;
  anchor: number;
  customized: number;
};

export type TrafficLight = "better" | "worse" | "neutral";

export type MetricCompareRow = {
  key: string;
  label: string;
  anchorValue: number;
  customizedValue: number;
  anchorDisplay: string;
  customizedDisplay: string;
  deltaDisplay: string;
  trafficLight: TrafficLight;
  /** Lower-is-better metric (drawdown, vol). */
  lowerIsBetter: boolean;
};

export type HoldingDiffRow = {
  ticker: string;
  anchorPct: number;
  customizedPct: number;
  deltaPct: number;
  change: "added" | "removed" | "increased" | "decreased" | "unchanged";
};

export type RmCandidatePick = {
  /** Model code (e.g. M0007) for the customized trial; champion when omitted. */
  customizedModelCode?: string | null;
};

function pickChampion(result: BacktestResult) {
  const idx = resolveChampionCandidateIndex(
    result.candidates,
    result.narrative_facts,
  );
  return idx >= 0 ? result.candidates[idx] : result.candidates[0];
}

function pickCandidate(result: BacktestResult, modelCode?: string | null) {
  if (modelCode) {
    const match = result.candidates.find(
      (c) => (c.model_code ?? "").toUpperCase() === modelCode.toUpperCase(),
    );
    if (match) return match;
  }
  return pickChampion(result);
}

function pickChampionHorizonMetrics(result: BacktestResult) {
  const champ = pickChampion(result);
  if (!champ) return null;
  return resolveHorizonMetrics(champ, BENCHMARK_COMPARE_HORIZON);
}

function pickCustomizedHorizonMetrics(
  result: BacktestResult,
  pick?: RmCandidatePick,
) {
  const candidate = pickCandidate(result, pick?.customizedModelCode);
  if (!candidate) return null;
  return resolveHorizonMetrics(candidate, BENCHMARK_COMPARE_HORIZON);
}

function pickChampionEquityCurve(result: BacktestResult) {
  const champ = pickChampion(result);
  return champ?.equity_curve ?? result.equity_curve ?? [];
}

/**
 * Equity for the customized (selected) trial.
 * When a specific model is requested, do NOT fall back to the job-level
 * champion curve — slim payloads omit non-champion equity_curve until
 * lazy charts are merged. Returning [] lets the panel show loading/empty
 * instead of a misleading stuck champion line.
 */
function pickCustomizedEquityCurve(
  result: BacktestResult,
  pick?: RmCandidatePick,
) {
  const candidate = pickCandidate(result, pick?.customizedModelCode);
  const curve = candidate?.equity_curve;
  if (Array.isArray(curve) && curve.length > 0) return curve;
  if (pick?.customizedModelCode) {
    const code = pick.customizedModelCode.toUpperCase();
    const champ = pickChampion(result);
    const isChamp =
      (champ?.model_code ?? "").toUpperCase() === code;
    if (isChamp) return result.equity_curve ?? [];
    return [];
  }
  return candidate?.equity_curve ?? result.equity_curve ?? [];
}

/** Exported for BenchmarkComparePanel / tests — resolve customized equity only. */
export function resolveCustomizedEquityCurve(
  result: BacktestResult,
  pick?: RmCandidatePick,
) {
  return pickCustomizedEquityCurve(result, pick);
}

/**
 * The candidate whose equity curve feeds goal planning — same resolution as
 * resolveCustomizedEquityCurve, so backcast weights match the curve source.
 */
export function resolveCustomizedCandidate(
  result: BacktestResult,
  pick?: RmCandidatePick,
) {
  return pickCandidate(result, pick?.customizedModelCode) ?? null;
}

/** Exported for Quant baseline — anchor (champion) equity from a result. */
export function resolveChampionEquityCurve(result: BacktestResult) {
  return pickChampionEquityCurve(result);
}

/**
 * Intersect two equity curves on shared dates and rebase both to 100 at the
 * common start so ending levels reflect relative performance over the same window.
 */
export function alignAndRebaseEquityCurves(
  anchor: { date: string; value: number }[],
  customized: { date: string; value: number }[],
): BenchmarkCompareChartRow[] | null {
  if (!anchor.length || !customized.length) return null;

  const anchorMap = new Map(anchor.map((d) => [d.date, d.value]));
  const customizedMap = new Map(customized.map((d) => [d.date, d.value]));
  const commonDates = [...anchorMap.keys()]
    .filter((d) => customizedMap.has(d))
    .sort();

  if (commonDates.length < 2) return null;

  const startDate = commonDates[0];
  const anchorBase = anchorMap.get(startDate)!;
  const customizedBase = customizedMap.get(startDate)!;
  if (anchorBase <= 0 || customizedBase <= 0) return null;

  return commonDates.map((date) => ({
    date,
    anchor: (anchorMap.get(date)! / anchorBase) * 100,
    customized: (customizedMap.get(date)! / customizedBase) * 100,
  }));
}

export function buildBenchmarkCompareChartData(
  baseResult: BacktestResult,
  adjustedResult: BacktestResult,
  pick?: RmCandidatePick,
): BenchmarkCompareChartRow[] | null {
  const anchorCurve = pickChampionEquityCurve(baseResult);
  const customizedCurve = pickCustomizedEquityCurve(adjustedResult, pick);
  return alignAndRebaseEquityCurves(anchorCurve, customizedCurve);
}

/** Rebased index (start=100) → cumulative return % from common start (start≈0). */
export function rebasedEquityToCumulativePct(
  rows: BenchmarkCompareChartRow[],
): BenchmarkCompareChartRow[] {
  return rows.map((row) => ({
    date: row.date,
    anchor: row.anchor - 100,
    customized: row.customized - 100,
  }));
}

function sampleStd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  let sumSq = 0;
  for (const x of xs) sumSq += (x - mean) ** 2;
  return Math.sqrt(sumSq / (xs.length - 1));
}

function calendarYearsBetween(start: string, end: string): number {
  const a = Date.parse(`${start}T12:00:00Z`);
  const b = Date.parse(`${end}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 1e-6;
  return Math.max((b - a) / MS_PER_DAY / 365.25, 1e-6);
}

function medianGapDays(dates: string[]): number {
  if (dates.length < 2) return 1;
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const a = Date.parse(`${dates[i - 1]}T12:00:00Z`);
    const b = Date.parse(`${dates[i]}T12:00:00Z`);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
      gaps.push((b - a) / MS_PER_DAY);
    }
  }
  if (!gaps.length) return 1;
  gaps.sort((x, y) => x - y);
  return gaps[Math.floor(gaps.length / 2)]!;
}

/**
 * CAGR / Sharpe / MDD / vol from a rebased-to-100 equity path.
 * Matches engine conventions on dense (≈daily) curves; uses calendar
 * annualization when the series is sparse (downsampled intersection).
 */
export function metricsFromRebasedEquitySeries(
  dates: string[],
  values: number[],
  riskFreeRate = DEFAULT_RISK_FREE,
): HorizonMetricSnapshot | null {
  if (dates.length < 2 || values.length !== dates.length) return null;
  const start = values[0]!;
  const end = values[values.length - 1]!;
  if (!(start > 0) || !(end > 0)) return null;

  const rets: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]!;
    if (prev > 0) rets.push(values[i]! / prev - 1);
  }
  if (rets.length < 2) return null;

  const multiple = end / start;
  const gap = medianGapDays(dates);
  const denseDaily = gap <= 3;
  const years = denseDaily
    ? Math.max(values.length / TRADING_DAYS_PER_YEAR, 1e-6)
    : calendarYearsBetween(dates[0]!, dates[dates.length - 1]!);
  const cagr = multiple ** (1 / years) - 1;

  let sharpe = 0;
  let volatility = MIN_ANNUAL_VOL;
  if (denseDaily) {
    const dailyRf = (1 + riskFreeRate) ** (1 / TRADING_DAYS_PER_YEAR) - 1;
    const excess = rets.map((r) => r - dailyRf);
    const std = sampleStd(excess);
    const meanEx = excess.reduce((s, x) => s + x, 0) / excess.length;
    volatility = Math.max(std * Math.sqrt(TRADING_DAYS_PER_YEAR), MIN_ANNUAL_VOL);
    sharpe =
      std > 1e-10
        ? (Math.sqrt(TRADING_DAYS_PER_YEAR) * meanEx) / std
        : 0;
  } else {
    const calYears = calendarYearsBetween(
      dates[0]!,
      dates[dates.length - 1]!,
    );
    const obsPerYear = rets.length / calYears;
    const meanRet = rets.reduce((s, x) => s + x, 0) / rets.length;
    const std = sampleStd(rets);
    const periodRf = (1 + riskFreeRate) ** (1 / Math.max(obsPerYear, 1e-6)) - 1;
    volatility = Math.max(std * Math.sqrt(obsPerYear), MIN_ANNUAL_VOL);
    sharpe = std > 1e-10 ? ((meanRet - periodRf) / std) * Math.sqrt(obsPerYear) : 0;
  }

  let peak = start;
  let maxDrawdown = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = v / peak - 1;
      if (dd < maxDrawdown) maxDrawdown = dd;
    }
  }

  return {
    sharpe,
    sortino: 0,
    cagr,
    max_drawdown: maxDrawdown,
    volatility,
  };
}

/** Metrics for both series on the shared chart window (null if cannot align). */
export function metricsFromBenchmarkCompareChart(
  chart: BenchmarkCompareChartRow[],
  riskFreeRate = DEFAULT_RISK_FREE,
): { anchor: HorizonMetricSnapshot; customized: HorizonMetricSnapshot } | null {
  if (!chart || chart.length < 3) return null;
  const dates = chart.map((r) => r.date);
  const anchor = metricsFromRebasedEquitySeries(
    dates,
    chart.map((r) => r.anchor),
    riskFreeRate,
  );
  const customized = metricsFromRebasedEquitySeries(
    dates,
    chart.map((r) => r.customized),
    riskFreeRate,
  );
  if (!anchor || !customized) return null;
  return { anchor, customized };
}

function resolveCompareMetricPair(
  baseResult: BacktestResult,
  adjustedResult: BacktestResult,
  pick?: RmCandidatePick,
): { base: HorizonMetricSnapshot; adj: HorizonMetricSnapshot } | null {
  const chart = buildBenchmarkCompareChartData(baseResult, adjustedResult, pick);
  const fromChart = chart ? metricsFromBenchmarkCompareChart(chart) : null;
  if (fromChart) return { base: fromChart.anchor, adj: fromChart.customized };

  const base = pickChampionHorizonMetrics(baseResult);
  const adj = pickCustomizedHorizonMetrics(adjustedResult, pick);
  if (!base || !adj) return null;
  return { base, adj };
}

function fmtPct(v: number, digits = 2): string {
  return `${(v * 100).toFixed(digits)}%`;
}

function trafficForDelta(
  delta: number,
  lowerIsBetter: boolean,
  epsilon = 0.0001,
): TrafficLight {
  if (Math.abs(delta) < epsilon) return "neutral";
  const improved = lowerIsBetter ? delta < 0 : delta > 0;
  return improved ? "better" : "worse";
}

export function buildMetricCompareRows(
  baseResult: BacktestResult,
  adjustedResult: BacktestResult,
  labels: {
    cagr: string;
    sharpe: string;
    mdd: string;
    vol: string;
  },
  pick?: RmCandidatePick,
): MetricCompareRow[] {
  const pair = resolveCompareMetricPair(baseResult, adjustedResult, pick);
  if (!pair) return [];
  const { base, adj } = pair;

  const specs: Array<{
    key: string;
    label: string;
    anchorValue: number;
    customizedValue: number;
    lowerIsBetter: boolean;
    format: (v: number) => string;
  }> = [
    {
      key: "cagr",
      label: labels.cagr,
      anchorValue: base.cagr,
      customizedValue: adj.cagr,
      lowerIsBetter: false,
      format: (v) => fmtPct(v),
    },
    {
      key: "sharpe",
      label: labels.sharpe,
      anchorValue: base.sharpe,
      customizedValue: adj.sharpe,
      lowerIsBetter: false,
      format: (v) => v.toFixed(2),
    },
    {
      key: "mdd",
      label: labels.mdd,
      anchorValue: base.max_drawdown,
      customizedValue: adj.max_drawdown,
      lowerIsBetter: true,
      format: (v) => fmtPct(v),
    },
    {
      key: "vol",
      label: labels.vol,
      anchorValue: base.volatility,
      customizedValue: adj.volatility,
      lowerIsBetter: true,
      format: (v) => fmtPct(v),
    },
  ];

  return specs.map((s) => {
    // Severity metrics (MDD): Δ = |customized| − |anchor| so a shallower
    // drawdown shows negative (improved), not signed arithmetic (+0.8%).
    const delta = s.lowerIsBetter
      ? Math.abs(s.customizedValue) - Math.abs(s.anchorValue)
      : s.customizedValue - s.anchorValue;
    const deltaPrefix = delta > 0 ? "+" : "";
    const deltaDisplay =
      s.key === "sharpe"
        ? `${deltaPrefix}${delta.toFixed(2)}`
        : `${deltaPrefix}${(delta * 100).toFixed(2)}%`;
    return {
      key: s.key,
      label: s.label,
      anchorValue: s.anchorValue,
      customizedValue: s.customizedValue,
      anchorDisplay: s.format(s.anchorValue),
      customizedDisplay: s.format(s.customizedValue),
      deltaDisplay,
      trafficLight: trafficForDelta(delta, s.lowerIsBetter),
      lowerIsBetter: s.lowerIsBetter,
    };
  });
}

export function buildHoldingsDiff(
  baseResult: BacktestResult,
  adjustedResult: BacktestResult,
  anchorHoldings?: { ticker: string; weight: number }[],
  pick?: RmCandidatePick,
): HoldingDiffRow[] {
  const baseChamp = pickChampion(baseResult);
  const adjChamp = pickCandidate(adjustedResult, pick?.customizedModelCode);

  // Prefer terminal weight_history over packaged `weights` — OOS assembly can
  // stash holdout-fresh-start last_weights that look artificially round, while
  // the full-path rebalance history holds the real allocator end-weights.
  const anchorWeights: Record<string, number> = {};
  if (anchorHoldings?.length) {
    for (const h of anchorHoldings) {
      anchorWeights[h.ticker.toUpperCase()] = h.weight;
    }
  } else {
    Object.assign(anchorWeights, resolveCandidateWeights(baseChamp));
  }

  const customizedWeights = resolveCandidateWeights(adjChamp);
  const anchorPcts = largestRemainderPercents(anchorWeights, 2);
  const customizedPcts = largestRemainderPercents(customizedWeights, 2);

  const tickers = new Set([
    ...Object.keys(anchorWeights),
    ...Object.keys(customizedWeights),
  ]);

  const rows: HoldingDiffRow[] = [];
  for (const ticker of [...tickers].sort()) {
    // Chart truncation bucket — never show as a fake investment ticker.
    if (ticker === "OTHER" || ticker === "__OTHER__") continue;
    const anchorPct = anchorPcts[ticker] ?? 0;
    const customizedPct = customizedPcts[ticker] ?? 0;
    const deltaPct = customizedPct - anchorPct;

    let change: HoldingDiffRow["change"] = "unchanged";
    if (anchorPct < 0.1 && customizedPct >= 0.1) change = "added";
    else if (anchorPct >= 0.1 && customizedPct < 0.1) change = "removed";
    else if (deltaPct > 0.5) change = "increased";
    else if (deltaPct < -0.5) change = "decreased";

    if (change === "unchanged" && Math.abs(deltaPct) < 0.1) continue;

    rows.push({ ticker, anchorPct, customizedPct, deltaPct, change });
  }

  return rows.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
}

export type TalkingPointsInput = {
  metrics: MetricCompareRow[];
  holdingsDiff: HoldingDiffRow[];
  overlay: ClientOverlay | null;
  adjustedResult: BacktestResult;
  anchorLabel: string;
  objectiveKey: string;
  lang: "zh" | "ko" | "en";
  t: TranslateFn;
  customizedModelCode?: string | null;
};

function pickCustomizedWeights(
  result: BacktestResult,
  modelCode?: string | null,
): Record<string, number> {
  return resolveCandidateWeights(pickCandidate(result, modelCode));
}

function computeAssetMixFromWeights(weights: Record<string, number>): Record<string, number> {
  const classByTicker = new Map(
    getUniverseItems().map((u) => [u.ticker.toUpperCase(), u.asset_class]),
  );
  const mix: Record<string, number> = {};
  for (const [ticker, weight] of Object.entries(weights)) {
    if (weight < 0.001) continue;
    const cls = classByTicker.get(ticker.toUpperCase()) ?? "other";
    mix[cls] = (mix[cls] ?? 0) + weight;
  }
  return mix;
}

function resolveExposureMix(
  result: BacktestResult,
  modelCode?: string | null,
): Record<string, number> {
  const champ = pickCandidate(result, modelCode);
  const exposure = champ?.analytics?.exposure;
  if (exposure?.by_asset_class && Object.keys(exposure.by_asset_class).length > 0) {
    return exposure.by_asset_class;
  }
  if (exposure?.equity_pct != null || exposure?.bond_pct != null) {
    const mix: Record<string, number> = {};
    if (exposure.equity_pct != null) mix.equity = exposure.equity_pct;
    if (exposure.bond_pct != null) mix.bond = exposure.bond_pct;
    if (exposure.other_pct != null) mix.other = exposure.other_pct;
    return mix;
  }
  return computeAssetMixFromWeights(pickCustomizedWeights(result, modelCode));
}

function assetClassLabel(t: TranslateFn, cls: string): string {
  const key = cls === "other" ? "institutional.other" : `institutional.${cls}`;
  const val = t(key);
  return val === key ? cls.replace(/_/g, " ") : val;
}

function formatAssetMix(
  mix: Record<string, number>,
  t: TranslateFn,
  lang: "zh" | "ko" | "en",
): string {
  const sep = lang === "en" ? ", " : "、";
  return Object.entries(mix)
    .filter(([, weight]) => weight >= 0.01)
    .sort((a, b) => b[1] - a[1])
    .map(([cls, weight]) => `${assetClassLabel(t, cls)} ${(weight * 100).toFixed(0)}%`)
    .join(sep);
}

function formatTopHoldings(
  weights: Record<string, number>,
  lang: "zh" | "ko" | "en",
  limit = 3,
): string {
  const sep = lang === "en" ? ", " : "、";
  const wrap = (ticker: string, pct: string) =>
    lang === "en" ? `${ticker} (${pct})` : `${ticker}（${pct}）`;
  return Object.entries(weights)
    .filter(([, weight]) => weight >= 0.001)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([ticker, weight]) => wrap(ticker, `${(weight * 100).toFixed(1)}%`))
    .join(sep);
}

function summarizeHoldingsChanges(
  holdingsDiff: HoldingDiffRow[],
  t: TranslateFn,
  lang: "zh" | "ko" | "en",
  limit = 3,
): string {
  const sep = lang === "en" ? "; " : "、";
  return holdingsDiff
    .filter((row) => row.change !== "unchanged")
    .slice(0, limit)
    .map((row) => {
      const deltaAbs = Math.abs(row.deltaPct).toFixed(1);
      if (row.change === "added") {
        return t("rm.talking.changeAdded", {
          ticker: row.ticker,
          pct: row.customizedPct.toFixed(1),
        });
      }
      if (row.change === "removed") {
        return t("rm.talking.changeRemoved", { ticker: row.ticker });
      }
      if (row.change === "increased") {
        return t("rm.talking.changeIncreased", {
          ticker: row.ticker,
          delta: deltaAbs,
        });
      }
      if (row.change === "decreased") {
        return t("rm.talking.changeDecreased", {
          ticker: row.ticker,
          delta: deltaAbs,
        });
      }
      return row.ticker;
    })
    .join(sep);
}

function portfolioTiltKey(
  equityPct: number,
  bondPct: number,
): "defensive" | "growth" | "balanced" {
  if (bondPct >= equityPct + 0.05) return "defensive";
  if (equityPct >= bondPct + 0.15) return "growth";
  return "balanced";
}

function localizedRiskTolerance(t: TranslateFn, value?: string): string {
  if (!value) return "";
  const key = `rm.talking.riskTolerance.${value}`;
  const val = t(key);
  return val === key ? value : val;
}

function localizedMarketStance(t: TranslateFn, stance?: string): string {
  if (!stance) return "";
  const key = `regime.${stance}`;
  const val = t(key);
  return val === key ? stance.replace(/_/g, " ") : val;
}

function buildClientGoalPoint(input: TalkingPointsInput): string | null {
  const { overlay, t } = input;
  if (!overlay) return null;

  const { client_profile: profile, market_view: marketView } = overlay;
  const liquidity = profile.liquidity_need;

  if (liquidity?.within_months) {
    const amount =
      liquidity.amount_usd != null
        ? t("rm.talking.liquidityAmount", {
            amount: liquidity.amount_usd.toLocaleString(),
          })
        : "";
    return t("rm.talking.clientLiquidity", {
      months: liquidity.within_months,
      amount,
    });
  }

  if (profile.risk_tolerance) {
    const mix = resolveExposureMix(
      input.adjustedResult,
      input.customizedModelCode,
    );
    const equityPct = mix.equity ?? 0;
    const bondPct = mix.bond ?? 0;
    const tilt = portfolioTiltKey(equityPct, bondPct);
    return t("rm.talking.clientRiskTolerance", {
      tolerance: localizedRiskTolerance(t, profile.risk_tolerance),
      tilt: t(`rm.talking.tilt.${tilt}`),
    });
  }

  if (marketView.narrative_summary) {
    return t("rm.talking.clientMarketView", {
      stance: localizedMarketStance(t, marketView.stance),
      summary: marketView.narrative_summary,
    });
  }

  if (overlay.universe.prompts.length > 0) {
    return t("rm.talking.clientUniverse", {
      rules: overlay.universe.prompts.join(
        input.lang === "en" ? "; " : "；",
      ),
    });
  }

  return null;
}

function buildObjectivePoint(input: TalkingPointsInput): string | null {
  const { metrics, objectiveKey, t } = input;
  const objectiveLabel = t(`objective.${objectiveKey}`);
  const objective =
    objectiveLabel === `objective.${objectiveKey}`
      ? objectiveKey.replace(/_/g, " ")
      : objectiveLabel;

  const metricByObjective: Record<string, MetricCompareRow | undefined> = {
    min_max_drawdown: metrics.find((m) => m.key === "mdd"),
    max_sharpe: metrics.find((m) => m.key === "sharpe"),
    max_return: metrics.find((m) => m.key === "cagr"),
    min_cvar: metrics.find((m) => m.key === "vol"),
  };
  const focus = metricByObjective[objectiveKey] ?? metrics.find((m) => m.key === "mdd");

  const specificKey = `rm.talking.objective.${objectiveKey}`;
  const specific = t(specificKey, {
    objective,
    customized: focus?.customizedDisplay ?? "—",
    anchor: focus?.anchorDisplay ?? "—",
    delta: focus?.deltaDisplay ?? "—",
  });
  if (specific !== specificKey) return specific;

  return t("rm.talking.objective.generic", {
    objective,
    customized: focus?.customizedDisplay ?? "—",
    anchor: focus?.anchorDisplay ?? "—",
    delta: focus?.deltaDisplay ?? "—",
  });
}

function buildPerformancePoint(input: TalkingPointsInput): string {
  const { metrics, t } = input;
  const cagr = metrics.find((m) => m.key === "cagr");
  const mdd = metrics.find((m) => m.key === "mdd");
  const vol = metrics.find((m) => m.key === "vol");
  const sharpe = metrics.find((m) => m.key === "sharpe");

  if (cagr?.trafficLight === "better") {
    const extras: string[] = [];
    if (mdd?.trafficLight === "better") {
      extras.push(
        t("rm.talking.extraMddImproved", { delta: mdd.deltaDisplay }),
      );
    }
    if (vol?.trafficLight === "better") {
      extras.push(
        t("rm.talking.extraVolReduced", { delta: vol.deltaDisplay }),
      );
    }
    const formattedExtras = extras.length
      ? input.lang === "en"
        ? `; ${extras.join("; ")}`
        : `；${extras.join("；")}`
      : "";
    return t("rm.talking.performanceWin", {
      cagrDelta: cagr.deltaDisplay,
      extras: formattedExtras,
    });
  }

  if (cagr?.trafficLight === "worse") {
    const tradeoffs: string[] = [];
    if (mdd?.trafficLight === "better") {
      tradeoffs.push(
        t("rm.talking.tradeoffMdd", { delta: mdd.deltaDisplay }),
      );
    }
    if (vol?.trafficLight === "better") {
      tradeoffs.push(
        t("rm.talking.tradeoffVol", { delta: vol.deltaDisplay }),
      );
    }
    if (sharpe?.trafficLight === "better") {
      tradeoffs.push(t("rm.talking.tradeoffSharpe"));
    }
    return t("rm.talking.performanceTradeoff", {
      cagrDelta: cagr.deltaDisplay,
      tradeoffs:
        tradeoffs.join(input.lang === "en" ? "; " : "；") ||
        t("rm.talking.tradeoffGeneric"),
    });
  }

  const highlights: string[] = [];
  if (mdd?.trafficLight === "better") {
    highlights.push(t("rm.talking.tradeoffMdd", { delta: mdd.deltaDisplay }));
  }
  if (vol?.trafficLight === "better") {
    highlights.push(t("rm.talking.tradeoffVol", { delta: vol.deltaDisplay }));
  }
  if (sharpe?.trafficLight === "better") {
    highlights.push(t("rm.talking.tradeoffSharpe"));
  }

  return t("rm.talking.performanceSimilar", {
    highlights:
      highlights.join(input.lang === "en" ? "; " : "；") ||
      t("rm.talking.similarGeneric"),
  });
}

export function buildTalkingPoints(input: TalkingPointsInput): string[] {
  const points: string[] = [];
  const weights = pickCustomizedWeights(
    input.adjustedResult,
    input.customizedModelCode,
  );
  const assetMix = resolveExposureMix(
    input.adjustedResult,
    input.customizedModelCode,
  );
  const mixText = formatAssetMix(assetMix, input.t, input.lang);
  const topHoldings = formatTopHoldings(weights, input.lang);

  if (mixText && topHoldings) {
    points.push(
      input.t("rm.talking.portfolioStructure", {
        assetMix: mixText,
        topHoldings,
      }),
    );
  } else if (topHoldings) {
    points.push(
      input.t("rm.talking.portfolioHoldingsOnly", { topHoldings }),
    );
  }

  const changes = summarizeHoldingsChanges(
    input.holdingsDiff,
    input.t,
    input.lang,
  );
  if (changes) {
    points.push(
      input.t("rm.talking.vsAnchorChanges", {
        anchor: input.anchorLabel,
        changes,
      }),
    );
  }

  const clientGoal = buildClientGoalPoint(input);
  if (clientGoal) points.push(clientGoal);

  const objectivePoint = buildObjectivePoint(input);
  if (objectivePoint) points.push(objectivePoint);

  points.push(buildPerformancePoint(input));
  points.push(input.t("rm.talking.compliance"));

  return points.slice(0, 6);
}
