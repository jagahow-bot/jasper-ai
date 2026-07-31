"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  BACKTEST_HISTORY_STORAGE_KEY,
  formatHistoryDate,
  formatPct,
  formatSharpe,
  historyEntryDisplayLabel,
  listLocalHistoryForClient,
  type LocalHistoryEntry,
} from "@/lib/backtest-history";
import { objectiveLabel, useI18n } from "@/lib/i18n";
import type { JobSummary } from "@/lib/types";

type Props = {
  clientId: string;
};

function statusBadgeClass(status: JobSummary["status"]): string {
  if (status === "completed") return "pixel-badge-cyan";
  if (status === "failed") return "pixel-badge-warn";
  if (status === "running") return "pixel-badge";
  return "pixel-badge";
}

export function ClientCustomizedHistoryPanel({ clientId }: Props) {
  const { t } = useI18n();
  const [rows, setRows] = useState<LocalHistoryEntry[]>([]);

  const refresh = useCallback(() => {
    setRows(listLocalHistoryForClient(clientId));
  }, [clientId]);

  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === BACKTEST_HISTORY_STORAGE_KEY) refresh();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh]);

  const statusLabel = (status: JobSummary["status"]): string => {
    const key = `history.status.${status}`;
    const label = t(key);
    return label === key ? status : label;
  };

  const countLabel =
    rows.length === 1
      ? t("clients.history.record", { count: rows.length })
      : t("clients.history.records", { count: rows.length });

  return (
    <section className="pixel-panel">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="ui-section-title">{t("clients.history.title")}</h2>
        <button
          type="button"
          className="ui-body text-[var(--primary)] hover:underline"
          onClick={refresh}
          title={t("history.refresh")}
          aria-label={t("history.refresh")}
        >
          ↻
        </button>
      </div>
      <p className="mb-3 ui-hint">{countLabel}</p>

      {rows.length === 0 ? (
        <p className="ui-body text-dim">{t("clients.history.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const label = historyEntryDisplayLabel(row);
            const isPro = row.optimization_mode === "pro_auto";
            const href = `/?job=${encodeURIComponent(row.job_id)}&client=${encodeURIComponent(clientId)}`;
            return (
              <li
                key={row.job_id}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 ui-body transition-colors hover:border-[var(--primary)]/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`${statusBadgeClass(row.status)} text-[8px]`}>
                        {statusLabel(row.status)}
                      </span>
                      {isPro && (
                        <span className="pixel-badge pixel-badge-warn text-[8px]">
                          PRO
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate font-medium text-[var(--foreground)]">
                      {label || t("clients.history.untitled")}
                    </p>
                    <p className="truncate ui-hint">
                      {row.start_date} → {row.end_date}
                      {" · "}
                      {objectiveLabel(t, row.objective)}
                      {row.champion_model_code
                        ? ` · ${row.champion_model_code}`
                        : ""}
                    </p>
                    <p className="ui-hint text-[var(--primary)]">
                      CAGR {formatPct(row.champion_cagr)} · Sharpe{" "}
                      {formatSharpe(row.champion_sharpe)}
                    </p>
                    <p className="truncate ui-hint">
                      {formatHistoryDate(row.created_at)} · {row.job_id.slice(0, 8)}…
                    </p>
                  </div>
                  {row.status === "completed" ? (
                    <Link
                      href={href}
                      className="shrink-0 rounded-md border border-[var(--primary)] px-2 py-1 text-xs font-medium text-[var(--primary)] hover:bg-[var(--primary)] hover:text-white"
                    >
                      {t("clients.history.open")}
                    </Link>
                  ) : (
                    <span className="shrink-0 rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-dim)] opacity-40">
                      {t("clients.history.open")}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
