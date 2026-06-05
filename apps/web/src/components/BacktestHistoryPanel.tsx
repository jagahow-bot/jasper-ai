"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { listJobs } from "@/lib/api";
import {
  formatHistoryDate,
  formatPct,
  formatSharpe,
  mergeHistoryLists,
  readLocalBacktestHistory,
  type LocalHistoryEntry,
} from "@/lib/backtest-history";
import { OBJECTIVE_LABELS } from "@/lib/constants";
import type { JobSummary } from "@/lib/types";

type Props = {
  activeJobId?: string | null;
  onLoad: (jobId: string) => void;
  loadingJobId?: string | null;
};

function objectiveLabel(objective: string): string {
  return OBJECTIVE_LABELS[objective as keyof typeof OBJECTIVE_LABELS] ?? objective;
}

function statusBadgeClass(status: JobSummary["status"]): string {
  if (status === "completed") return "pixel-badge-cyan";
  if (status === "failed") return "pixel-badge-warn";
  if (status === "running") return "pixel-badge";
  return "pixel-badge";
}

export function BacktestHistoryPanel({ activeJobId, onLoad, loadingJobId }: Props) {
  const [rows, setRows] = useState<LocalHistoryEntry[]>(() => readLocalBacktestHistory());
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setFetchError(null);
    const local = readLocalBacktestHistory();
    try {
      const apiRows = await listJobs(30);
      setRows(mergeHistoryLists(apiRows, local));
    } catch {
      setRows(local);
      setFetchError("API offline — local only");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const empty = rows.length === 0;

  const subtitle = useMemo(() => {
    if (fetchError) return fetchError;
    if (refreshing) return "Syncing…";
    return `${rows.length} ${rows.length === 1 ? "record" : "records"}`;
  }, [fetchError, refreshing, rows.length]);

  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-[var(--border)] pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-pixel text-[9px] text-[var(--amber)]">Backtest history</h2>
        <button
          type="button"
          className="font-terminal text-sm text-[var(--cyan)] hover:underline disabled:opacity-50"
          onClick={() => void refresh()}
          disabled={refreshing}
        >
          ↻
        </button>
      </div>
      <p className="mb-2 font-terminal text-xs text-[var(--muted)]">{subtitle}</p>

      {empty ? (
        <p className="font-terminal text-sm text-[var(--muted)]">
          Completed backtests appear here. After refresh, entries may still load from
          the API when the server retains them.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {rows.map((row) => {
            const isActive = activeJobId === row.job_id;
            const isLoading = loadingJobId === row.job_id;
            const isPro = row.optimization_mode === "pro_auto";
            return (
              <li
                key={row.job_id}
                className={`rounded border px-2 py-2 font-terminal text-sm transition-colors ${
                  isActive
                    ? "border-[var(--cyan)] bg-[rgba(0,255,255,0.06)]"
                    : "border-[var(--border)] bg-[rgba(0,0,0,0.25)] hover:border-[var(--cyan)]/40"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`${statusBadgeClass(row.status)} text-[8px]`}>
                        {row.status}
                      </span>
                      {isPro && (
                        <span className="pixel-badge pixel-badge-warn text-[8px]">PRO</span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-[var(--foreground)]">
                      {row.start_date} → {row.end_date}
                    </p>
                    <p className="truncate text-xs text-[var(--muted)]">
                      {objectiveLabel(row.objective)}
                      {row.champion_model_code ? ` · ${row.champion_model_code}` : ""}
                    </p>
                    <p className="text-xs text-[var(--cyan)]">
                      CAGR {formatPct(row.champion_cagr)} · Sharpe{" "}
                      {formatSharpe(row.champion_sharpe)}
                    </p>
                    <p className="truncate text-[10px] text-[var(--muted)]">
                      {formatHistoryDate(row.created_at)} · {row.job_id.slice(0, 8)}…
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 border border-[var(--cyan)] px-2 py-1 font-pixel text-[8px] text-[var(--cyan)] hover:bg-[var(--cyan)] hover:text-black disabled:opacity-40"
                    disabled={isLoading || row.status !== "completed"}
                    onClick={() => onLoad(row.job_id)}
                  >
                    {isLoading ? "…" : "LOAD"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
