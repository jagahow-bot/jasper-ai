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
import { objectiveLabel, useI18n } from "@/lib/i18n";
import type { JobSummary } from "@/lib/types";

type Props = {
  activeJobId?: string | null;
  onLoad: (jobId: string) => void;
  loadingJobId?: string | null;
};

function statusBadgeClass(status: JobSummary["status"]): string {
  if (status === "completed") return "pixel-badge-cyan";
  if (status === "failed") return "pixel-badge-warn";
  if (status === "running") return "pixel-badge";
  return "pixel-badge";
}

export function BacktestHistoryPanel({ activeJobId, onLoad, loadingJobId }: Props) {
  const { t } = useI18n();
  const [rows, setRows] = useState<LocalHistoryEntry[]>(() => readLocalBacktestHistory());
  const [fetchError, setFetchError] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setFetchError(false);
    const local = readLocalBacktestHistory();
    try {
      const apiRows = await listJobs(30);
      setRows(mergeHistoryLists(apiRows, local));
    } catch {
      setRows(local);
      setFetchError(true);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const empty = rows.length === 0;

  const statusLabel = (status: JobSummary["status"]): string => {
    const key = `history.status.${status}`;
    const label = t(key);
    return label === key ? status : label;
  };

  const subtitle = useMemo(() => {
    if (fetchError) return t("history.apiOffline");
    if (refreshing) return t("history.syncing");
    return rows.length === 1
      ? t("history.record", { count: rows.length })
      : t("history.records", { count: rows.length });
  }, [fetchError, refreshing, rows.length, t]);

  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-[var(--border)] pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="ui-section-title text-[var(--amber)]">{t("history.title")}</h2>
        <button
          type="button"
          className="ui-body text-[var(--cyan)] hover:underline disabled:opacity-50"
          onClick={() => void refresh()}
          disabled={refreshing}
          title={t("history.refresh")}
          aria-label={t("history.refresh")}
        >
          ↻
        </button>
      </div>
      <p className="mb-2 ui-hint">{subtitle}</p>

      {empty ? (
        <p className="ui-body text-dim">
          {t("history.empty")}
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
                className={`rounded border px-2 py-2 ui-body transition-colors ${
                  isActive
                    ? "border-[var(--cyan)] bg-[rgba(0,255,255,0.06)]"
                    : "border-[var(--border)] bg-[rgba(0,0,0,0.25)] hover:border-[var(--cyan)]/40"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`${statusBadgeClass(row.status)} text-[8px]`}>
                        {statusLabel(row.status)}
                      </span>
                      {isPro && (
                        <span className="pixel-badge pixel-badge-warn text-[8px]">PRO</span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-[var(--foreground)]">
                      {row.start_date} → {row.end_date}
                    </p>
                    <p className="truncate ui-hint">
                      {objectiveLabel(t, row.objective)}
                      {row.champion_model_code ? ` · ${row.champion_model_code}` : ""}
                    </p>
                    <p className="ui-hint text-[var(--cyan)]">
                      CAGR {formatPct(row.champion_cagr)} · Sharpe{" "}
                      {formatSharpe(row.champion_sharpe)}
                    </p>
                    <p className="truncate ui-hint">
                      {formatHistoryDate(row.created_at)} · {row.job_id.slice(0, 8)}…
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 border border-[var(--cyan)] px-2 py-1 font-pixel text-[8px] text-[var(--cyan)] hover:bg-[var(--cyan)] hover:text-black disabled:opacity-40"
                    disabled={isLoading || row.status !== "completed"}
                    onClick={() => onLoad(row.job_id)}
                  >
                    {isLoading ? "…" : t("history.load")}
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
