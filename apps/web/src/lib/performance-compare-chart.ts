import { compareModelCode } from "./align-y-axis-zero";

export type PerformanceCompareCandidate = {
  model_code?: string | null;
  rank?: number;
  sharpe?: number;
  sortino?: number | null;
  cagr?: number | null;
  max_drawdown?: number | null;
  is_champion?: boolean;
};

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
  if (a.is_champion && !b.is_champion) return a;
  if (b.is_champion && !a.is_champion) return b;
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
  preserveTrialOrder: boolean;
  benchmarkBarMetrics?: BenchmarkBarMetrics | null;
  benchTicker: string;
  selectedChartKey?: string | null;
}): PerformanceCompareRow[] {
  const {
    candidates,
    championModelKey,
    preserveTrialOrder,
    benchmarkBarMetrics,
    benchTicker,
    selectedChartKey,
  } = input;

  const deduped = dedupeCandidatesForPerformanceChart(candidates, championModelKey);
  const orderedCandidates = preserveTrialOrder
    ? deduped
    : [...deduped].sort((a, b) =>
        compareModelCode(
          normalizeModelCode(a, 0),
          normalizeModelCode(b, 0),
        ),
      );

  const modelRows: PerformanceCompareRow[] = orderedCandidates.map((c, i) => {
    const modelKey = candidateModelKey(c);
    const model_code = normalizeModelCode(c, i);
    const chartKey = candidateRowKey(c, i);
    return {
      chartKey,
      name: model_code,
      model_code,
      modelKey,
      rank: c.rank ?? i + 1,
      isChampion: championModelKey != null && modelKey === championModelKey,
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
