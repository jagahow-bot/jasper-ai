import type { BacktestRequest, BacktestResult, JobSummary } from "./types";
import { resolveChampionCandidateIndex } from "./performance-compare-chart";

export const BACKTEST_HISTORY_STORAGE_KEY = "jasper_backtest_history_v1";
const MAX_LOCAL_ENTRIES = 30;

export type LocalHistoryEntry = JobSummary & {
  request?: BacktestRequest;
  result?: BacktestResult;
};

function readRaw(): LocalHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(BACKTEST_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as LocalHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function writeRaw(entries: LocalHistoryEntry[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      BACKTEST_HISTORY_STORAGE_KEY,
      JSON.stringify(entries.slice(0, MAX_LOCAL_ENTRIES)),
    );
  } catch {
    /* quota or private mode */
  }
}

export function readLocalBacktestHistory(): LocalHistoryEntry[] {
  return readRaw();
}

export function upsertLocalBacktestHistory(entry: LocalHistoryEntry) {
  const entries = readRaw().filter((e) => e.job_id !== entry.job_id);
  entries.unshift(entry);
  writeRaw(entries);
}

export function buildLocalJobSummary(
  jobId: string,
  request: BacktestRequest,
  result: BacktestResult,
): JobSummary {
  const championIdx = resolveChampionCandidateIndex(
    result.candidates,
    result.narrative_facts,
  );
  const champion =
    championIdx >= 0 ? result.candidates[championIdx] : result.candidates[0];
  return {
    job_id: jobId,
    created_at: new Date().toISOString(),
    status: "completed",
    start_date: request.start_date,
    end_date: request.end_date,
    objective: String(result.narrative_facts?.objective ?? request.objective),
    optimization_mode: request.optimization_mode ?? "standard",
    scenario_id: request.scenario_id,
    champion_model_code: champion?.model_code ?? null,
    champion_cagr: champion?.cagr ?? null,
    champion_sharpe: champion?.sharpe ?? null,
  };
}

export function recordCompletedBacktest(
  jobId: string,
  request: BacktestRequest,
  result: BacktestResult,
) {
  const summary = buildLocalJobSummary(jobId, request, result);
  upsertLocalBacktestHistory({ ...summary, request, result });
}

/** Merge API summaries with local-only rows (dedupe by job_id, newest first). */
export function mergeHistoryLists(
  apiRows: JobSummary[],
  localRows: LocalHistoryEntry[],
): LocalHistoryEntry[] {
  const merged = new Map<string, LocalHistoryEntry>();
  for (const row of apiRows) {
    merged.set(row.job_id, { ...row });
  }
  for (const row of localRows) {
    const existing = merged.get(row.job_id);
    merged.set(row.job_id, existing ? { ...existing, ...row } : { ...row });
  }
  return [...merged.values()].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at)),
  );
}

export function formatHistoryDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatPct(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

export function formatSharpe(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}
