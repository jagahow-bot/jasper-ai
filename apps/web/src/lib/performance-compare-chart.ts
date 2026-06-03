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
 * One bar group per model_code. Pro champion re-sim can append a duplicate code;
 * keep the champion row and drop the extra category so x labels stay aligned.
 */
export function dedupeCandidatesForPerformanceChart(
  candidates: PerformanceCompareCandidate[],
  championModelKey: string | null,
): PerformanceCompareCandidate[] {
  const byCode = new Map<string, PerformanceCompareCandidate>();
  const order: string[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const code = normalizeModelCode(c, i);
    const existing = byCode.get(code);
    if (!existing) {
      byCode.set(code, c);
      order.push(code);
      continue;
    }
    byCode.set(code, preferCandidate(existing, c, championModelKey));
  }
  return order.map((code) => byCode.get(code)!);
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
}): PerformanceCompareRow[] {
  const {
    candidates,
    championModelKey,
    preserveTrialOrder,
    benchmarkBarMetrics,
    benchTicker,
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
    return {
      chartKey: candidateRowKey(c, i),
      name: model_code,
      model_code,
      modelKey,
      rank: c.rank ?? i + 1,
      isChampion: championModelKey != null && modelKey === championModelKey,
      isBenchmark: false,
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
