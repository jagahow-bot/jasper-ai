import { compareModelCode } from "./align-y-axis-zero";

export type PerformanceCompareHorizon = "full_sample" | "in_sample";

export type PerformanceCompareCandidate = {
  model_code?: string | null;
  rank?: number;
  sharpe?: number;
  sortino?: number | null;
  cagr?: number | null;
  max_drawdown?: number | null;
  is_champion?: boolean;
  analytics?: {
    sample_metrics?: {
      in_sample?: Record<string, number>;
      out_of_sample?: Record<string, number> | null;
      full_sample?: Record<string, number>;
    };
  } | null;
};

export type HorizonMetricSnapshot = {
  sharpe: number;
  sortino: number;
  cagr: number;
  max_drawdown: number;
  volatility: number;
  objective_value?: number;
};

export function resolveHorizonMetrics(
  c: PerformanceCompareCandidate & { volatility?: number },
  horizon: PerformanceCompareHorizon = "full_sample",
): HorizonMetricSnapshot {
  const snap =
    horizon === "full_sample"
      ? c.analytics?.sample_metrics?.full_sample
      : c.analytics?.sample_metrics?.in_sample;
  if (snap) {
    return {
      sharpe: snap.sharpe ?? c.sharpe ?? 0,
      sortino: snap.sortino ?? c.sortino ?? 0,
      cagr: snap.cagr ?? c.cagr ?? 0,
      max_drawdown: snap.max_drawdown ?? c.max_drawdown ?? 0,
      volatility: snap.volatility ?? c.volatility ?? 0,
      objective_value: snap.objective_value,
    };
  }
  return {
    sharpe: c.sharpe ?? 0,
    sortino: c.sortino ?? 0,
    cagr: c.cagr ?? 0,
    max_drawdown: c.max_drawdown ?? 0,
    volatility: c.volatility ?? 0,
  };
}

/** Out-of-sample slice from sample_metrics when holdout is enabled. */
export function resolveOutOfSampleMetrics(
  c: PerformanceCompareCandidate & { volatility?: number },
): HorizonMetricSnapshot | null {
  const snap = c.analytics?.sample_metrics?.out_of_sample;
  if (!snap) return null;
  return {
    sharpe: snap.sharpe ?? 0,
    sortino: snap.sortino ?? 0,
    cagr: snap.cagr ?? 0,
    max_drawdown: snap.max_drawdown ?? 0,
    volatility: snap.volatility ?? 0,
    objective_value: snap.objective_value,
  };
}

const ROUND_CHAMPION_TIE_THRESHOLDS: Record<string, number> = {
  max_return: 0.005,
  min_max_drawdown: 0.005,
  min_cvar: 0.005,
  max_sharpe: 0.05,
  max_sortino: 0.05,
  mean_variance_utility: 0.05,
  risk_parity_erc: 0.05,
  max_diversification: 0.005,
  custom: 0.05,
  dynamic: 0.05,
  dynamic_comprehensive: 0.05,
};

function championTieThreshold(objective: string): number {
  return ROUND_CHAMPION_TIE_THRESHOLDS[objective] ?? 0.005;
}

function championSelectionHorizon(
  narrativeFacts?: Record<string, unknown> | null,
): PerformanceCompareHorizon {
  const oos =
    narrativeFacts?.enable_oos === true ||
    narrativeFacts?.oos_enabled === true;
  return oos ? "in_sample" : "full_sample";
}

function championPrimaryScore(
  c: PerformanceCompareCandidate,
  objective: string,
  horizon: PerformanceCompareHorizon,
): number {
  const m = resolveHorizonMetrics(c, horizon);
  if (m.objective_value != null) return Number(m.objective_value);
  if (objective === "max_return") return Number(m.cagr ?? -1e9);
  if (objective === "min_max_drawdown") return -Math.abs(Number(m.max_drawdown ?? 0));
  if (objective === "max_sortino") return Number(m.sortino ?? -1e9);
  if (objective === "min_cvar") return Number((c as { cvar_95?: number }).cvar_95 ?? -1e9);
  return Number(m.sharpe ?? -1e9);
}

function championSortKey(
  c: PerformanceCompareCandidate,
  objective: string,
  horizon: PerformanceCompareHorizon,
  bestPrimary: number,
  tieThreshold: number,
): [number, number, number, number] {
  const m = resolveHorizonMetrics(c, horizon);
  const primary = championPrimaryScore(c, objective, horizon);
  const sharpe = Number(m.sharpe ?? -1e9);
  const mdd = Number(m.max_drawdown ?? -1e9);
  if (Math.abs(primary - bestPrimary) <= tieThreshold) {
    return [bestPrimary, sharpe, mdd, primary];
  }
  return [primary, -1e9, -1e9, primary];
}

/** Objective-first champion across the full catalog (ALL ROUNDS tab). */
export function pickCatalogChampionModelKey(
  candidates: PerformanceCompareCandidate[],
  narrativeFacts?: Record<string, unknown> | null,
  horizonOverride?: PerformanceCompareHorizon,
): string | null {
  if (!candidates.length) return null;
  const objective = String(narrativeFacts?.objective ?? "max_sharpe");
  const horizon = horizonOverride ?? championSelectionHorizon(narrativeFacts);
  const tieThreshold = championTieThreshold(objective);
  const primaries = candidates.map((c) =>
    championPrimaryScore(c, objective, horizon),
  );
  const bestPrimary = Math.max(...primaries);
  let bestIdx = 0;
  let bestKey: [number, number, number, number] = [-1e9, -1e9, -1e9, -1e9];
  for (let i = 0; i < candidates.length; i++) {
    const key = championSortKey(
      candidates[i],
      objective,
      horizon,
      bestPrimary,
      tieThreshold,
    );
    if (
      key[0] > bestKey[0] ||
      (key[0] === bestKey[0] && key[1] > bestKey[1]) ||
      (key[0] === bestKey[0] && key[1] === bestKey[1] && key[2] > bestKey[2])
    ) {
      bestKey = key;
      bestIdx = i;
    }
  }
  return candidateModelKey(candidates[bestIdx]);
}

export function mapCandidatesToPerformanceHorizon(
  candidates: PerformanceCompareCandidate[],
  horizon: PerformanceCompareHorizon = "full_sample",
): PerformanceCompareCandidate[] {
  return candidates.map((c) => {
    const m = resolveHorizonMetrics(c, horizon);
    return { ...c, ...m };
  });
}

export type PerformanceCompareRow = {
  chartKey: string;
  name: string;
  model_code: string;
  modelKey: string;
  rank: number;
  isChampion: boolean;
  isBenchmark: boolean;
  isSelected?: boolean;
  sharpe: number;
  sortino: number;
  cagr_pct: number;
  mdd_pct: number;
};

export type BenchmarkBarMetrics = {
  sharpe?: number;
  sortino?: number;
  cagr?: number;
  max_drawdown?: number;
};

/** Catalog code for charting; empty/whitespace falls back so ticks are never blank. */
export function normalizeModelCode(
  c: { model_code?: string | null; rank?: number },
  index: number,
): string {
  const raw = typeof c.model_code === "string" ? c.model_code.trim() : "";
  if (raw) return raw;
  const rank = c.rank ?? index + 1;
  return `M?${rank}`;
}

export function candidateRowKey(
  c: { model_code?: string | null; rank?: number },
  index: number,
): string {
  const code = normalizeModelCode(c, index);
  return `${code}-r${c.rank ?? index}-i${index}`;
}

export function candidateModelKey(c: { model_code?: string | null; rank?: number }): string {
  return normalizeModelCode(c, 0);
}

/** Champion model_code for ★ marking; API ai_champion_model_code > champion_model_code > is_champion. */
export function resolveChampionModelKey(
  candidates: PerformanceCompareCandidate[],
  narrativeFacts?: Record<string, unknown> | null,
): string | null {
  if (narrativeFacts?.is_all_portfolios_view) {
    const catalog = narrativeFacts?.catalog_champion_model_code;
    if (typeof catalog === "string" && catalog.trim()) {
      const code = catalog.trim().toUpperCase();
      const match = candidates.find((c) => candidateModelKey(c) === code);
      if (match) return candidateModelKey(match);
      return code;
    }
    const picked = pickCatalogChampionModelKey(candidates, narrativeFacts);
    if (picked) return picked;
  }

  const aiChampion = narrativeFacts?.ai_champion_model_code;
  if (typeof aiChampion === "string" && aiChampion.trim()) {
    const code = aiChampion.trim().toUpperCase();
    const match = candidates.find((c) => candidateModelKey(c) === code);
    if (match) return candidateModelKey(match);
    return code;
  }

  const explicit = narrativeFacts?.champion_model_code;
  if (typeof explicit === "string" && explicit.trim()) {
    const code = explicit.trim();
    const match = candidates.find((c) => candidateModelKey(c) === code);
    if (match) return candidateModelKey(match);
    return code;
  }

  const flagged = candidates.find((c) => c.is_champion === true);
  if (flagged) return candidateModelKey(flagged);

  const rank1 = candidates.find((c) => c.rank === 1);
  if (rank1) return candidateModelKey(rank1);

  const pro = narrativeFacts?.pro_refinement as
    | { convergence_history?: { is_champion?: boolean }[] }
    | null
    | undefined;
  if (pro?.convergence_history?.some((p) => p.is_champion)) {
    const best = candidates[0];
    if (best) return candidateModelKey(best);
  }

  const first = candidates[0];
  return first ? candidateModelKey(first) : null;
}

/** Index of the champion trial row (AI/Pro pick > is_champion flag). */
export function resolveChampionCandidateIndex(
  candidates: PerformanceCompareCandidate[],
  narrativeFacts?: Record<string, unknown> | null,
): number {
  const championKey = resolveChampionModelKey(candidates, narrativeFacts);
  if (championKey) {
    const flagged = candidates.findIndex(
      (c) => c.is_champion === true && candidateModelKey(c) === championKey,
    );
    if (flagged >= 0) return flagged;
    const byKey = candidates.findIndex(
      (c) => candidateModelKey(c) === championKey,
    );
    if (byKey >= 0) return byKey;
  }

  const fallback = candidates.findIndex((c) => c.is_champion === true);
  if (fallback >= 0) return fallback;

  return candidates.length > 0 ? 0 : -1;
}

export function readPersistedAiChampionCode(
  narrativeFacts?: Record<string, unknown> | null,
): string | null {
  const raw = narrativeFacts?.ai_champion_model_code;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw.trim().toUpperCase();
}

function findOriginalCandidateIndex(
  candidates: PerformanceCompareCandidate[],
  target: PerformanceCompareCandidate,
): number {
  for (let j = 0; j < candidates.length; j++) {
    const orig = candidates[j];
    if (
      normalizeModelCode(orig, j) === normalizeModelCode(target, 0) &&
      (orig.rank ?? j + 1) === (target.rank ?? 0) &&
      metricsMatchForChampionResimDedupe(orig, target)
    ) {
      return j;
    }
  }
  return -1;
}

export function resolveDefaultSelectedRowKey(
  candidates: PerformanceCompareCandidate[],
  narrativeFacts?: Record<string, unknown> | null,
): string {
  const idx = resolveChampionCandidateIndex(candidates, narrativeFacts);
  if (idx < 0) return "";
  const c = candidates[idx];
  return candidateRowKey(c, idx);
}

const METRIC_DEDUPE_EPS = 1e-4;

function metricsMatchForChampionResimDedupe(
  a: PerformanceCompareCandidate,
  b: PerformanceCompareCandidate,
): boolean {
  return (
    Math.abs((a.sharpe ?? 0) - (b.sharpe ?? 0)) < METRIC_DEDUPE_EPS &&
    Math.abs((a.cagr ?? 0) - (b.cagr ?? 0)) < METRIC_DEDUPE_EPS &&
    Math.abs((a.max_drawdown ?? 0) - (b.max_drawdown ?? 0)) < METRIC_DEDUPE_EPS
  );
}

function preferCandidate(
  a: PerformanceCompareCandidate,
  b: PerformanceCompareCandidate,
  championModelKey: string | null,
): PerformanceCompareCandidate {
  const keyA = candidateModelKey(a);
  const keyB = candidateModelKey(b);
  const champA = championModelKey != null && keyA === championModelKey;
  const champB = championModelKey != null && keyB === championModelKey;
  if (champA && !champB) return a;
  if (champB && !champA) return b;
  if (championModelKey == null) {
    if (a.is_champion && !b.is_champion) return a;
    if (b.is_champion && !a.is_champion) return b;
  }
  const rankA = a.rank ?? 9999;
  const rankB = b.rank ?? 9999;
  return rankA <= rankB ? a : b;
}

/**
 * Collapse only true champion re-sim duplicates (same model_code and identical metrics).
 * Distinct Optuna trials that share a code keep separate bars.
 */
export function dedupeCandidatesForPerformanceChart(
  candidates: PerformanceCompareCandidate[],
  championModelKey: string | null,
): PerformanceCompareCandidate[] {
  const out: PerformanceCompareCandidate[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const code = normalizeModelCode(c, i);
    const dupIdx = out.findIndex(
      (o, j) =>
        normalizeModelCode(o, j) === code && metricsMatchForChampionResimDedupe(o, c),
    );
    if (dupIdx < 0) {
      out.push(c);
      continue;
    }
    out[dupIdx] = preferCandidate(out[dupIdx], c, championModelKey);
  }
  return out;
}

export function performanceCompareTickLabel(row: PerformanceCompareRow | undefined): string {
  if (!row) return "";
  if (row.isBenchmark) return row.name;
  return row.isChampion ? `${row.name} ★` : row.name;
}

export function buildPerformanceCompareRows(input: {
  candidates: PerformanceCompareCandidate[];
  championModelKey: string | null;
  championRowKey?: string | null;
  sortByModelCode: boolean;
  benchmarkBarMetrics?: BenchmarkBarMetrics | null;
  benchTicker: string;
  selectedChartKey?: string | null;
  /** Bar metrics horizon; defaults to full period (ttl). */
  horizon?: PerformanceCompareHorizon;
}): PerformanceCompareRow[] {
  const {
    candidates,
    championModelKey,
    championRowKey = null,
    sortByModelCode,
    benchmarkBarMetrics,
    benchTicker,
    selectedChartKey,
    horizon = "full_sample",
  } = input;

  const horizonCandidates = mapCandidatesToPerformanceHorizon(candidates, horizon);
  const deduped = dedupeCandidatesForPerformanceChart(horizonCandidates, championModelKey);
  const orderedCandidates = sortByModelCode
    ? [...deduped].sort((a, b) =>
        compareModelCode(
          normalizeModelCode(a, 0),
          normalizeModelCode(b, 0),
        ),
      )
    : deduped;

  const modelRows: PerformanceCompareRow[] = orderedCandidates.map((c, i) => {
    const modelKey = candidateModelKey(c);
    const model_code = normalizeModelCode(c, i);
    const origIdx = findOriginalCandidateIndex(horizonCandidates, c);
    const chartKey = candidateRowKey(c, origIdx >= 0 ? origIdx : i);
    return {
      chartKey,
      name: model_code,
      model_code,
      modelKey,
      rank: c.rank ?? i + 1,
      isChampion: Boolean(championRowKey && chartKey === championRowKey),
      isBenchmark: false,
      isSelected: Boolean(selectedChartKey && chartKey === selectedChartKey),
      sharpe: c.sharpe ?? 0,
      sortino: c.sortino ?? 0,
      cagr_pct: (c.cagr ?? 0) * 100,
      mdd_pct: Math.abs((c.max_drawdown ?? 0) * 100),
    };
  });

  if (!benchmarkBarMetrics) return modelRows;

  const bmSharpe = Number(benchmarkBarMetrics.sharpe ?? 0);
  const bmSortino = Number(benchmarkBarMetrics.sortino ?? bmSharpe);
  return [
    ...modelRows,
    {
      chartKey: `bench-${benchTicker}`,
      name: benchTicker,
      model_code: benchTicker,
      modelKey: `bench:${benchTicker}`,
      rank: 0,
      isChampion: false,
      isBenchmark: true,
      sharpe: bmSharpe,
      sortino: bmSortino,
      cagr_pct: Number(benchmarkBarMetrics.cagr ?? 0) * 100,
      mdd_pct: Math.abs(Number(benchmarkBarMetrics.max_drawdown ?? 0) * 100),
    },
  ];
}

export function performanceCompareRowsByChartKey(
  rows: PerformanceCompareRow[],
): Map<string, PerformanceCompareRow> {
  return new Map(rows.map((row) => [row.chartKey, row]));
}
