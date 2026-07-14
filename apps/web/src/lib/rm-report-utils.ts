import {
  resolveChampionCandidateIndex,
  resolveHorizonMetrics,
  type PerformanceCompareHorizon,
} from "@/lib/performance-compare-chart";
import type { ClientOverlay } from "@/lib/overlay-schema";
import { getUniverseItems } from "@/lib/universe";
import type { BacktestResult } from "@/lib/types";

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

/** Anchor vs customized comparison always uses full report window (matches equity curves). */
export const BENCHMARK_COMPARE_HORIZON: PerformanceCompareHorizon = "full_sample";

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

function pickCustomizedEquityCurve(
  result: BacktestResult,
  pick?: RmCandidatePick,
) {
  const candidate = pickCandidate(result, pick?.customizedModelCode);
  return candidate?.equity_curve ?? result.equity_curve ?? [];
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
  const base = pickChampionHorizonMetrics(baseResult);
  const adj = pickCustomizedHorizonMetrics(adjustedResult, pick);
  if (!base || !adj) return [];

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

  const anchorWeights: Record<string, number> = {};
  if (anchorHoldings?.length) {
    for (const h of anchorHoldings) {
      anchorWeights[h.ticker.toUpperCase()] = h.weight;
    }
  } else if (baseChamp?.weights) {
    for (const [t, w] of Object.entries(baseChamp.weights)) {
      if (w > 0.001) anchorWeights[t.toUpperCase()] = w;
    }
  }

  const customizedWeights: Record<string, number> = {};
  if (adjChamp?.weights) {
    for (const [t, w] of Object.entries(adjChamp.weights)) {
      if (w > 0.001) customizedWeights[t.toUpperCase()] = w;
    }
  }

  const tickers = new Set([
    ...Object.keys(anchorWeights),
    ...Object.keys(customizedWeights),
  ]);

  const rows: HoldingDiffRow[] = [];
  for (const ticker of [...tickers].sort()) {
    const anchorPct = (anchorWeights[ticker] ?? 0) * 100;
    const customizedPct = (customizedWeights[ticker] ?? 0) * 100;
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
  const candidate = pickCandidate(result, modelCode);
  return candidate?.weights ?? {};
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
